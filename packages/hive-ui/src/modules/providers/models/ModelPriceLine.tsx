import type { Model } from "@/types";
import { getModelPrice, isFree, formatUsdPer1M } from "@/lib/model-pricing";

interface ModelPriceLineProps {
  model: Model;
  /** Agrega el contexto del modelo al lado del precio, cuando se conoce. */
  showContext?: boolean;
}

/**
 * Precio de un modelo en USD por millón de tokens.
 *
 * "Sin tarifa" y "Gratis" se muestran distinto a propósito: son estados
 * diferentes y confundirlos hace creer que un modelo de pago no cuesta nada.
 * El precio sale del mismo catálogo que alimenta el costo del dashboard.
 */
export function ModelPriceLine({ model, showContext = false }: ModelPriceLineProps) {
  const price = getModelPrice(model);
  const context = model.contextWindow ?? model.context_window;

  const contextLabel = showContext && context
    ? `${context >= 1_000_000 ? `${(context / 1_000_000).toFixed(context % 1_000_000 === 0 ? 0 : 1)}M` : `${Math.round(context / 1000)}K`} ctx`
    : null;

  return (
    <span className="flex items-center gap-1.5 text-[10px] leading-tight font-mono">
      {price === null ? (
        <span className="text-white/25" title="Este modelo no tiene tarifa en el catálogo: su consumo se contabiliza como $0">
          Sin tarifa
        </span>
      ) : isFree(price) ? (
        <span className="text-emerald-400/70">Gratis</span>
      ) : (
        <span className="text-white/40" title="USD por millón de tokens (entrada / salida)">
          <span className="text-white/55">{formatUsdPer1M(price.input)}</span>
          <span className="text-white/25"> / </span>
          <span className="text-white/55">{formatUsdPer1M(price.output)}</span>
          <span className="text-white/25"> /1M</span>
        </span>
      )}
      {contextLabel && (
        <>
          <span className="text-white/15">·</span>
          <span className="text-white/30">{contextLabel}</span>
        </>
      )}
    </span>
  );
}
