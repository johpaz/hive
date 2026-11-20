process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ModelDoc } from "../packages/core/src/storage/collections";
import { analyzeImage, getVisionAnalyzerModelId, setVisionAnalyzerModelId } from "../packages/core/src/multimodal/vision-analyzer";

const prevHome = process.env.HIVE_HOME;
beforeEach(async () => {
  closeHiveDb();
  process.env.HIVE_HOME = mkdtempSync(join(tmpdir(), "hive-analyzer-"));
  await ensureHiveDb();
});
afterEach(() => {
  closeHiveDb();
  if (prevHome === undefined) delete process.env.HIVE_HOME; else process.env.HIVE_HOME = prevHome;
});

async function addModel(id: string, caps: string[], type: ModelDoc["model_type"] = "llm") {
  await (await col<ModelDoc>("models")).put(id, {
    id, provider_id: "openrouter", name: id, model_type: type, context_window: 1000,
    capabilities: JSON.stringify(caps), enabled: true, active: true,
  } as ModelDoc);
}

const png = { type: "base64" as const, data: "aGk=", mimeType: "image/png" };

describe("modelo analizador de visión", () => {
  test("sin modelo configurado devuelve null (el llamador usa su respaldo)", async () => {
    expect(await getVisionAnalyzerModelId()).toBeNull();
    expect(await analyzeImage(png)).toBeNull();
  });

  test("solo acepta modelos LLM con visión", async () => {
    await addModel("solo-texto", ["chat"]);
    await addModel("con-vision", ["chat", "vision"]);
    await expect(setVisionAnalyzerModelId("solo-texto")).rejects.toThrow("visión");
    await expect(setVisionAnalyzerModelId("no-existe")).rejects.toThrow("no existe");
    await setVisionAnalyzerModelId("con-vision");
    expect(await getVisionAnalyzerModelId()).toBe("con-vision");
    await setVisionAnalyzerModelId(null);
    expect(await getVisionAnalyzerModelId()).toBeNull();
  });

  test("un PDF no pasa por el analizador (lo atiende el OCR de siempre)", async () => {
    await addModel("con-vision", ["chat", "vision"]);
    await setVisionAnalyzerModelId("con-vision");
    expect(await analyzeImage({ type: "base64", data: "aGk=", mimeType: "application/pdf" })).toBeNull();
  });

  test("con modelo configurado envía la imagen y devuelve la descripción", async () => {
    await addModel("con-vision", ["chat", "vision"]);
    await setVisionAnalyzerModelId("con-vision");
    const calls: any[] = [];
    const real = await import("../packages/core/src/agent/llm-client");
    mock.module("../packages/core/src/agent/llm-client", () => ({
      ...real,
      resolveProviderConfig: async () => ({ provider: "openrouter", model: "x", apiKey: "k" }),
      callLLM: async (o: any) => { calls.push(o); return { content: "Un recibo por $10", stop_reason: "stop" }; },
    }));
    expect(await analyzeImage(png)).toBe("Un recibo por $10");
    expect(calls[0].messages[0].content[1].image_url.url).toStartWith("data:image/png;base64,");
    expect(calls[0].model).toBe("con-vision"); // sin recortar el prefijo del provider
    mock.module("../packages/core/src/agent/llm-client", () => real);
  });

  test("manda la clave del modelo sin recortar el prefijo y reporta el fallo del proveedor", async () => {
    await addModel("openrouter/vendor/vl-x", ["chat", "vision"]);
    await setVisionAnalyzerModelId("openrouter/vendor/vl-x");
    const calls: any[] = [];
    const real = await import("../packages/core/src/agent/llm-client");
    mock.module("../packages/core/src/agent/llm-client", () => ({
      ...real,
      resolveProviderConfig: async () => ({ provider: "openrouter", model: "x", apiKey: "k" }),
      callLLM: async (o: any) => { calls.push(o); return { content: `${real.LLM_ERROR_PREFIX} el modelo ya no existe (HTTP 404)`, stop_reason: "error" }; },
    }));
    await expect(analyzeImage(png)).rejects.toThrow("HTTP 404");
    expect(calls[0].model).toBe("openrouter/vendor/vl-x");
    mock.module("../packages/core/src/agent/llm-client", () => real);
  });
});
