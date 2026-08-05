import { describe, expect, test } from "vitest";
import {
  getModelPrice,
  isFree,
  formatUsdPer1M,
  formatPricePair,
  summarizeProviderPricing,
} from "./model-pricing";
import type { Model } from "@/types";

const model = (over: Partial<Model>): Model => ({
  id: "m", name: "M", enabled: true, ...over,
});

describe("getModelPrice", () => {
  test("lee la forma snake_case que manda la API", () => {
    expect(getModelPrice(model({ input_per_1m: 3, output_per_1m: 15 }))).toEqual({ input: 3, output: 15 });
  });

  test("acepta la variante camelCase", () => {
    expect(getModelPrice(model({ inputPer1M: 1, outputPer1M: 5 }))).toEqual({ input: 1, output: 5 });
  });

  test("null es tarifa desconocida, no gratis", () => {
    expect(getModelPrice(model({ input_per_1m: null, output_per_1m: null }))).toBeNull();
    expect(getModelPrice(model({}))).toBeNull();
  });

  test("0 sí es gratis y se distingue de desconocido", () => {
    const price = getModelPrice(model({ input_per_1m: 0, output_per_1m: 0 }));
    expect(price).toEqual({ input: 0, output: 0 });
    expect(isFree(price!)).toBe(true);
  });
});

describe("formatUsdPer1M", () => {
  test("mantiene los decimales de los precios muy bajos", () => {
    // Qwen3.7 Flash cuesta $0.03: redondear a 1 decimal lo mostraría como "$0.0".
    expect(formatUsdPer1M(0.03)).toBe("$0.03");
    expect(formatUsdPer1M(0.003)).toBe("$0.003");
  });

  test("formatea los tramos habituales", () => {
    expect(formatUsdPer1M(0)).toBe("$0");
    expect(formatUsdPer1M(0.1)).toBe("$0.10");
    expect(formatUsdPer1M(3)).toBe("$3");
    // toFixed redondea sobre el float binario, así que un ".xx5" puede caer para
    // cualquiera de los dos lados (0.435 baja, 1.475 sube). A nivel de display
    // —centavos por millón de tokens— da igual: se fija el comportamiento real
    // en vez de agregar redondeo decimal exacto que nadie va a percibir.
    expect(formatUsdPer1M(0.435)).toBe("$0.43");
    expect(formatUsdPer1M(1.475)).toBe("$1.48");
  });
});

describe("formatPricePair", () => {
  test("entrada / salida", () => {
    expect(formatPricePair({ input: 0.1, output: 0.6 })).toBe("$0.10 / $0.60");
  });

  test("gratis en vez de $0 / $0", () => {
    expect(formatPricePair({ input: 0, output: 0 })).toBe("Gratis");
  });
});

describe("summarizeProviderPricing", () => {
  test("toma el modelo de pago más barato", () => {
    const summary = summarizeProviderPricing([
      model({ input_per_1m: 5, output_per_1m: 30 }),
      model({ input_per_1m: 0.1, output_per_1m: 0.6 }),
      model({ input_per_1m: 1, output_per_1m: 6 }),
    ]);
    expect(summary).toEqual({ label: "desde $0.10/1M", allFree: false });
  });

  test("un provider enteramente gratuito se marca como tal", () => {
    const summary = summarizeProviderPricing([
      model({ input_per_1m: 0, output_per_1m: 0 }),
      model({ input_per_1m: 0, output_per_1m: 0 }),
    ]);
    expect(summary).toEqual({ label: "Gratis", allFree: true });
  });

  test("los modelos gratis no bajan el 'desde' de un provider de pago", () => {
    // Si NVIDIA (gratis) y OpenRouter (de pago) conviven, "desde $0" sería
    // engañoso para el provider que sí cobra.
    const summary = summarizeProviderPricing([
      model({ input_per_1m: 0, output_per_1m: 0 }),
      model({ input_per_1m: 2, output_per_1m: 6 }),
    ]);
    expect(summary).toEqual({ label: "desde $2/1M", allFree: false });
  });

  test("sin tarifas conocidas no inventa un precio", () => {
    expect(summarizeProviderPricing([model({}), model({ input_per_1m: null })])).toBeNull();
    expect(summarizeProviderPricing([])).toBeNull();
  });
});
