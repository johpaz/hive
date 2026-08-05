/**
 * Semántica del re-seed de modelos: wipe & recreate.
 *
 * Actualizar el catálogo debe ser editar SEED_DATA.models y arrancar. Eso exige
 * que las filas de catálogo se borren enteras (para que ningún campo viejo
 * sobreviva a una entrada corregida) sin llevarse por delante ni la elección del
 * usuario, ni los modelos descubiertos en runtime, ni los providers/claves.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ModelDoc, ProviderDoc } from "../packages/core/src/storage/collections";
import { seedAllData, SEED_DATA } from "../packages/core/src/storage/seed";
import { catalogModelKey } from "../packages/core/src/storage/model-id";

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

const A_SEEDED_MODEL = () => {
  const m = SEED_DATA.models.find((x) => x.modelType === "llm" && x.providerId === "anthropic")!;
  return catalogModelKey(m.providerId, m.id);
};

describe("re-seed de modelos", () => {
  test("preserva enabled/active de los ids que sobreviven", async () => {
    const modelsCol = await col<ModelDoc>("models");
    const id = A_SEEDED_MODEL();

    const before = await modelsCol.get(id);
    expect(before).toBeTruthy();
    await modelsCol.put(id, { ...before!.doc, active: true, enabled: true }, { expectedVersion: before!.version });

    await seedAllData();

    const after = await modelsCol.get(id);
    expect(after!.doc.active).toBe(true);
    expect(after!.doc.enabled).toBe(true);
  });

  test("borra las filas de catálogo que salieron del seed", async () => {
    const modelsCol = await col<ModelDoc>("models");
    // Una fila de catálogo que ya no está en SEED_DATA (modelo retirado, como
    // los 8 modelos NVIDIA que devolvían 410).
    await modelsCol.put("provider-x/modelo-retirado", {
      id: "provider-x/modelo-retirado", provider_id: "nvidia", name: "Retirado",
      model_type: "llm", context_window: 1000, capabilities: null,
      enabled: true, active: true, source: "catalog",
      input_per_1m: 1, output_per_1m: 1,
    });

    await seedAllData();

    expect(await modelsCol.get("provider-x/modelo-retirado")).toBeFalsy();
  });

  test("conserva los modelos descubiertos en runtime", async () => {
    const modelsCol = await col<ModelDoc>("models");
    await modelsCol.put("llama3.3:8b", {
      id: "llama3.3:8b", provider_id: "ollama", name: "llama3.3:8b",
      model_type: "llm", context_window: 0, capabilities: null,
      enabled: true, active: true, source: "discovered",
      input_per_1m: 0, output_per_1m: 0,
    });

    await seedAllData();

    const survivor = await modelsCol.get("llama3.3:8b");
    expect(survivor).toBeTruthy();
    expect(survivor!.doc.active).toBe(true);
  });

  test("recrea los campos de catálogo desde cero", async () => {
    const modelsCol = await col<ModelDoc>("models");
    const id = A_SEEDED_MODEL();
    const original = (await modelsCol.get(id))!;

    // Un valor corrupto/desactualizado no debe sobrevivir al re-seed.
    await modelsCol.put(id, { ...original.doc, context_window: 42, input_per_1m: 999 }, { expectedVersion: original.version });

    await seedAllData();

    const after = (await modelsCol.get(id))!.doc;
    expect(after.context_window).toBe(original.doc.context_window);
    expect(after.input_per_1m).toBe(original.doc.input_per_1m ?? null);
  });

  test("cada modelo llm queda con su precio en la BD", async () => {
    const modelsCol = await col<ModelDoc>("models");
    const rows = (await modelsCol.scan({})).filter((r) => r.doc.model_type === "llm" && r.doc.source === "catalog");

    expect(rows.length).toBeGreaterThan(0);
    const sinPrecio = rows
      .filter((r) => typeof r.doc.input_per_1m !== "number" || typeof r.doc.output_per_1m !== "number")
      .map((r) => r.id);
    expect(sinPrecio).toEqual([]);
  });

  test("los ids de revendedor quedan prefijados y no colisionan", async () => {
    const modelsCol = await col<ModelDoc>("models");

    // z-ai/glm-5.2 se sirve desde NVIDIA y desde OpenRouter: antes una fila
    // pisaba a la otra porque la colección se indexaba sólo por model id.
    const nvidia = await modelsCol.get("nvidia/z-ai/glm-5.2");
    const openrouter = await modelsCol.get("openrouter/z-ai/glm-5.2");

    expect(nvidia?.doc.provider_id).toBe("nvidia");
    expect(openrouter?.doc.provider_id).toBe("openrouter");
    // Endpoint gratuito de NVIDIA vs. OpenRouter de pago — el costo ya no se confunde.
    expect(nvidia!.doc.input_per_1m).toBe(0);
    expect(openrouter!.doc.input_per_1m).toBeGreaterThan(0);
  });
});

describe("re-seed de providers", () => {
  test("es sólo aditivo: no borra ni reescribe los existentes", async () => {
    const providersCol = await col<ProviderDoc>("providers");

    // El usuario activó un provider y le puso un base_url propio.
    const anthropic = (await providersCol.get("anthropic"))!;
    await providersCol.put("anthropic", { ...anthropic.doc, active: true, enabled: true, base_url: "https://proxy.interno" }, { expectedVersion: anthropic.version });

    // Y tiene un provider que ya no está en el catálogo.
    await providersCol.put("provider-propio", {
      id: "provider-propio", name: "Propio", base_url: null, category: "llm",
      num_ctx: null, num_gpu: -1, enabled: true, active: true, created_at: Date.now(),
    });

    await seedAllData();

    const after = (await providersCol.get("anthropic"))!.doc;
    expect(after.base_url).toBe("https://proxy.interno");
    expect(after.active).toBe(true);
    expect(await providersCol.get("provider-propio")).toBeTruthy();
  });

  test("crea los providers del catálogo que faltaban", async () => {
    const providersCol = await col<ProviderDoc>("providers");
    await providersCol.delete("z-ai");
    expect(await providersCol.get("z-ai")).toBeFalsy();

    await seedAllData();

    expect(await providersCol.get("z-ai")).toBeTruthy();
  });
});
