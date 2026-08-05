// Importar el seed arrastra los módulos de storage, que resuelven la ruta de la
// BD al cargarse. Sin esto el archivo podía dejar apuntando la BD real.
process.env.HIVE_DB_PATH = ":memory:";

import { describe, expect, test } from "bun:test";
import { SEED_DATA } from "../packages/core/src/storage/seed";
import { catalogModelKey, wireModelId, isResellerProvider } from "../packages/core/src/storage/model-id";

/**
 * Guardas del catálogo de modelos.
 *
 * La colección `models` se indexa por una sola clave, así que dos entradas que
 * colapsen a la misma la pisan entre sí — pasó de verdad con `z-ai/glm-5.2`,
 * sembrado a la vez en NVIDIA NIM y en OpenRouter, donde una fila desaparecía en
 * silencio. Y un modelo LLM sin precio se reporta como $0 en el dashboard, que es
 * indistinguible de un endpoint realmente gratuito.
 */
describe("catálogo de modelos (SEED_DATA.models)", () => {
  test("ninguna entrada colapsa a la misma clave de BD", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const model of SEED_DATA.models) {
      const key = catalogModelKey(model.providerId, model.id);
      const previous = seen.get(key);
      if (previous) {
        collisions.push(`${key} ← ${previous} y ${model.providerId}/${model.id}`);
      }
      seen.set(key, `${model.providerId}/${model.id}`);
    }

    expect(collisions).toEqual([]);
  });

  test("todo modelo llm trae precio de entrada y de salida", () => {
    const unpriced = SEED_DATA.models
      .filter((m) => m.modelType === "llm")
      .filter((m) => m.inputPer1M === undefined || m.outputPer1M === undefined)
      .map((m) => `${m.providerId}/${m.id}`);

    expect(unpriced).toEqual([]);
  });

  test("los precios son números no negativos", () => {
    const invalid = SEED_DATA.models
      .filter((m) => m.modelType === "llm")
      .filter((m) => !(typeof m.inputPer1M === "number" && m.inputPer1M >= 0)
        || !(typeof m.outputPer1M === "number" && m.outputPer1M >= 0))
      .map((m) => `${m.providerId}/${m.id}`);

    expect(invalid).toEqual([]);
  });

  test("todo modelo apunta a un provider sembrado", () => {
    const providerIds = new Set(SEED_DATA.providers.map((p) => p.id));
    const orphans = SEED_DATA.models
      .filter((m) => !providerIds.has(m.providerId))
      .map((m) => `${m.providerId}/${m.id}`);

    expect(orphans).toEqual([]);
  });
});

describe("catalogModelKey / wireModelId", () => {
  test("los revendedores prefijan y los propietarios no", () => {
    expect(catalogModelKey("nvidia", "z-ai/glm-5.2")).toBe("nvidia/z-ai/glm-5.2");
    expect(catalogModelKey("openrouter", "z-ai/glm-5.2")).toBe("openrouter/z-ai/glm-5.2");
    expect(catalogModelKey("anthropic", "claude-opus-5")).toBe("claude-opus-5");
    expect(catalogModelKey("z-ai", "glm-5.2")).toBe("glm-5.2");
    // ModelScope revende modelos de terceros (Qwen/, deepseek-ai/, zai-org/),
    // que se solapan con los de NVIDIA y OpenRouter.
    expect(catalogModelKey("modelscope", "Qwen/Qwen3.5-397B-A17B")).toBe("modelscope/Qwen/Qwen3.5-397B-A17B");
    expect(wireModelId("modelscope", "modelscope/Qwen-Ambassador/Qwen3.8-Max")).toBe("Qwen-Ambassador/Qwen3.8-Max");
  });

  test("`id` en el catálogo es siempre el nombre del cable, no la clave ya prefijada", () => {
    // No es idempotente a propósito: aplicarlo dos veces prefija dos veces. Un
    // atajo `startsWith` para evitarlo rompía los modelos cuyo namespace propio
    // coincide con el id del provider (ver el caso de abajo).
    expect(catalogModelKey("opencode-go", "glm-5.1")).toBe("opencode-go/glm-5.1");
    for (const model of SEED_DATA.models) {
      expect(model.id.startsWith(`${model.providerId}/${model.providerId}/`)).toBe(false);
    }
  });

  test("un modelo propio del revendedor conserva su namespace tras el strip", () => {
    // El nombre de cable de NVIDIA para su Nemotron ya empieza con "nvidia/",
    // así que la clave lleva el prefijo dos veces a propósito.
    const key = catalogModelKey("nvidia", "nvidia/nemotron-3-super-120b-a12b");
    expect(key).toBe("nvidia/nvidia/nemotron-3-super-120b-a12b");
    expect(wireModelId("nvidia", key)).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  test("wireModelId revierte catalogModelKey para todo el catálogo", () => {
    for (const model of SEED_DATA.models) {
      const key = catalogModelKey(model.providerId, model.id);
      expect(wireModelId(model.providerId, key)).toBe(model.id);
    }
  });

  test("wireModelId no toca a los providers propietarios", () => {
    expect(isResellerProvider("anthropic")).toBe(false);
    expect(wireModelId("anthropic", "claude-opus-5")).toBe("claude-opus-5");
  });
});
