import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";

/**
 * Consumo real por provider, desde `/api/usage-stats` (colección `usageRollups`).
 *
 * Se pide una sola vez en la lista y se reparte a las tarjetas: que cada
 * ProviderCard hiciera su propio fetch serían N requests por render de la
 * pantalla.
 */

export interface ProviderUsage {
  tokens: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface UsageStatsResponse {
  byProvider: Record<string, ProviderUsage>;
}

export function useProviderUsage(hours = 24 * 30) {
  const [byProvider, setByProvider] = useState<Record<string, ProviderUsage> | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient<UsageStatsResponse>(`/api/usage-stats?hours=${hours}`)
      .then((data) => {
        if (!cancelled) setByProvider(data.byProvider ?? {});
      })
      .catch(() => {
        // Sin métricas la tarjeta muestra "—", no un número inventado.
        if (!cancelled) setByProvider(null);
      });
    return () => { cancelled = true; };
  }, [hours]);

  return byProvider;
}

/** `$12.34` / `$0.0042` — sin redondear a cero un gasto real pero pequeño. */
export function formatCostUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** `1.2M` / `340K` / `812` */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
