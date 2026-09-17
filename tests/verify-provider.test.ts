/**
 * La verificación de NVIDIA/ModelScope prueba varios modelos candidatos porque
 * el listado público mezcla modelos que la cuenta no tiene habilitados (404) o
 * que ya se retiraron (410). Un candidato que tarda más que el timeout no dice
 * nada de la key: tiene que contar igual que esos y pasar al siguiente, no
 * abortar toda la verificación.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { col } from "../packages/core/src/storage/hive";
import { handleVerifyProvider } from "../packages/core/src/gateway/routes/setup";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

beforeAll(async () => {
  const providers = await col("providers");
  await providers.put("nvidia", {
    id: "nvidia", name: "NVIDIA", base_url: "https://nim.test/v1", category: "llm",
    num_ctx: null, num_gpu: -1, enabled: true, active: true, created_at: 0,
  });
});

/** Simula NIM: `/models` lista los candidatos y cada chat responde según `behaviour`. */
function mockNim(behaviour: Record<string, () => Promise<Response>>): string[] {
  const tried: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/models")) return Response.json({ data: Object.keys(behaviour).map((id) => ({ id })) });
    const model = JSON.parse(String(init?.body)).model as string;
    tried.push(model);
    return behaviour[model]();
  }) as typeof fetch;
  return tried;
}

async function verify(): Promise<{ success: boolean; error: string | null }> {
  const res = await handleVerifyProvider(new Request("http://localhost/api/setup/verify-provider", {
    method: "POST",
    body: JSON.stringify({ provider: "nvidia", apiKey: "nvapi-test" }),
  }));
  return res.json();
}

describe("verify-provider con catálogo público (NVIDIA)", () => {
  test("un candidato que agota el timeout no aborta: se prueba el siguiente", async () => {
    const tried = mockNim({
      "lento/modelo": () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
      "sano/modelo": async () => Response.json({ choices: [] }),
    });
    expect(await verify()).toEqual({ success: true, error: null });
    expect(tried).toEqual(["lento/modelo", "sano/modelo"]);
  });

  test("un 401 sigue cortando: la key es inválida", async () => {
    const tried = mockNim({
      "a/modelo": async () => new Response("unauthorized", { status: 401 }),
      "b/modelo": async () => Response.json({ choices: [] }),
    });
    expect((await verify()).success).toBe(false);
    expect(tried).toEqual(["a/modelo"]);
  });
});
