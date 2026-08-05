import type { Model } from "@/types";

/**
 * Precios de modelos para la UI.
 *
 * La fuente de verdad es el catálogo del backend (`SEED_DATA.models` →
 * `ModelDoc.input_per_1m` / `output_per_1m`), que es lo mismo que usa el cálculo
 * de costo del dashboard. Acá sólo se formatea.
 *
 * `null`/`undefined` significa "sin tarifa conocida" (modelo agregado a mano o
 * descubierto en runtime) y NO es lo mismo que 0: hay que distinguirlo del
 * endpoint realmente gratuito, o el usuario cree que un modelo de pago no cuesta.
 */

export interface ModelPrice {
  input: number;
  output: number;
}

export function getModelPrice(model: Model): ModelPrice | null {
  const input = model.input_per_1m ?? model.inputPer1M;
  const output = model.output_per_1m ?? model.outputPer1M;
  if (typeof input !== "number" || typeof output !== "number") return null;
  return { input, output };
}

export function isFree(price: ModelPrice): boolean {
  return price.input === 0 && price.output === 0;
}

/** `$0.10` — con los decimales justos para no mostrar "$0.03" como "$0.0". */
export function formatUsdPer1M(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(3)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value % 1 === 0 ? value : value.toFixed(2)}`;
}

/** `$0.10 / $0.60` (entrada / salida) o `Gratis`. */
export function formatPricePair(price: ModelPrice): string {
  if (isFree(price)) return "Gratis";
  return `${formatUsdPer1M(price.input)} / ${formatUsdPer1M(price.output)}`;
}

/**
 * Resumen de un provider: el modelo más barato por token de entrada.
 * Devuelve null cuando ningún modelo tiene tarifa conocida.
 */
export function summarizeProviderPricing(models: Model[]): {
  label: string;
  allFree: boolean;
} | null {
  const prices = models.map(getModelPrice).filter((p): p is ModelPrice => p !== null);
  if (prices.length === 0) return null;

  if (prices.every(isFree)) return { label: "Gratis", allFree: true };

  const paid = prices.filter((p) => !isFree(p));
  const cheapest = Math.min(...paid.map((p) => p.input));
  return { label: `desde ${formatUsdPer1M(cheapest)}/1M`, allFree: false };
}
