/**
 * Descubrimiento de modelos del provider (pestaña "Descubrir" del alta).
 *
 * Es sólo lectura a propósito: el sync persiste TODO lo que devuelve el provider
 * (102 modelos en NVIDIA), que no es lo que querés al explorar para agregar uno.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ModelDoc, ProviderDoc } from "../packages/core/src/storage/collections";
import {
  fetchProviderModelNames,
  handleGetProviderAvailableModels,
} from "../packages/core/src/gateway/routes/providers";

const passthrough = (r: Response) => r;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  closeHiveDb();
});

/** Captura la URL pedida y responde una lista OpenAI-compatible. */
function mockModelsEndpoint(ids: string[]) {
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: any) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
  }) as any;
  return calls;
}

describe("fetchProviderModelNames", () => {
  test("cuelga /models del base_url tal cual está guardado", async () => {
    const calls = mockModelsEndpoint(["a", "b"]);
    const result = await fetchProviderModelNames("nvidia", "https://integrate.api.nvidia.com/v1");

    expect(calls[0]).toBe("https://integrate.api.nvidia.com/v1/models");
    expect(result.names).toEqual(["a", "b"]);
  });

  test("respeta un base_url que no termina en /v1", async () => {
    // Z.ai sirve en /api/paas/v4. La versión anterior recortaba "/v1" y lo volvía
    // a agregar, armando ".../api/paas/v4/v1/models" — un 404 garantizado.
    const calls = mockModelsEndpoint(["glm-5.2"]);
    await fetchProviderModelNames("z-ai", "https://api.z.ai/api/paas/v4");

    expect(calls[0]).toBe("https://api.z.ai/api/paas/v4/models");
  });

  test("ModelScope apunta al dominio internacional", async () => {
    // Un token internacional da 401 contra el endpoint .cn aunque el listado de
    // modelos responda 200 en ambos: ese listado es público y no valida la key.
    const calls = mockModelsEndpoint(["Qwen-Ambassador/Qwen3.8-Max"]);
    const result = await fetchProviderModelNames("modelscope", "https://api-inference.modelscope.ai/v1");

    expect(calls[0]).toBe("https://api-inference.modelscope.ai/v1/models");
    expect(result.names).toEqual(["Qwen-Ambassador/Qwen3.8-Max"]);
  });

  test("Ollama usa /api/tags, no /models", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (input: any) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ models: [{ name: "llama3.3:8b" }] }), { status: 200 });
    }) as any;

    const result = await fetchProviderModelNames("ollama", "http://localhost:11434");
    expect(calls[0]).toBe("http://localhost:11434/api/tags");
    expect(result.names).toEqual(["llama3.3:8b"]);
  });

  test("un provider sin base_url da error explícito en vez de pegarle a undefined", async () => {
    const result = await fetchProviderModelNames("z-ai", null);
    expect(result.error).toContain("base_url");
    expect(result.status).toBe(400);
  });

  test("propaga el código del provider cuando falla", async () => {
    globalThis.fetch = mock(async () => new Response("nope", { status: 401 })) as any;
    const result = await fetchProviderModelNames("nvidia", "https://x/v1");
    expect(result.error).toContain("401");
    expect(result.status).toBe(502);
  });
});

describe("GET /api/providers/:id/available-models", () => {
  const request = (id: string) =>
    new Request(`http://localhost/api/providers/${id}/available-models`);

  test("no persiste nada de lo que devuelve el provider", async () => {
    mockModelsEndpoint(["uno", "dos", "tres"]);
    const modelsCol = await col<ModelDoc>("models");
    const before = (await modelsCol.findBy("provider_id", "nvidia")).length;

    await handleGetProviderAvailableModels(request("nvidia"), passthrough, "nvidia");

    expect((await modelsCol.findBy("provider_id", "nvidia")).length).toBe(before);
  });

  test("marca los que ya están agregados y devuelve la clave prefijada", async () => {
    const modelsCol = await col<ModelDoc>("models");
    await modelsCol.put("nvidia/ya-esta", {
      id: "nvidia/ya-esta", provider_id: "nvidia", name: "Ya está",
      model_type: "llm", context_window: 1000, capabilities: null,
      enabled: true, active: true, source: "discovered",
      input_per_1m: 0, output_per_1m: 0,
    });
    mockModelsEndpoint(["ya-esta", "nuevo"]);

    const res = await handleGetProviderAvailableModels(request("nvidia"), passthrough, "nvidia");
    const { models } = await res.json() as {
      models: Array<{ wire_id: string; id: string; already_added: boolean }>;
    };

    const yaEsta = models.find((m) => m.wire_id === "ya-esta")!;
    const nuevo = models.find((m) => m.wire_id === "nuevo")!;
    expect(yaEsta.already_added).toBe(true);
    expect(yaEsta.id).toBe("nvidia/ya-esta");
    expect(nuevo.already_added).toBe(false);
  });

  test("404 cuando el provider no existe", async () => {
    const res = await handleGetProviderAvailableModels(request("no-existe"), passthrough, "no-existe");
    expect(res.status).toBe(404);
  });

  test("usa el base_url que el usuario tenga configurado", async () => {
    const providersCol = await col<ProviderDoc>("providers");
    const nvidia = (await providersCol.get("nvidia"))!;
    await providersCol.put("nvidia", { ...nvidia.doc, base_url: "https://proxy.interno/v1" }, { expectedVersion: nvidia.version });

    const calls = mockModelsEndpoint(["x"]);
    await handleGetProviderAvailableModels(request("nvidia"), passthrough, "nvidia");

    expect(calls[0]).toBe("https://proxy.interno/v1/models");
  });
});
