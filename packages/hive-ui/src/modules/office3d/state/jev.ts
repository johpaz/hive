import { useEffect } from "react";
import { apiClient } from "@/lib/api";
import type { Provider } from "@/types";
import { useCanvasStore, type CanvasJevDecision, type JevStatus } from "@/stores/canvasStore";

/** Violeta del plano de decisión: distinto del ámbar de la colmena y del color de cada agente. */
export const JEV_COLOR = "#a78bfa";
export const JEV_FALLBACK_COLOR = "#94a3b8";

const KIND_LABEL: Record<CanvasJevDecision["kind"], string> = {
  context: "Contexto",
  iteration: "Iteración",
  parallel: "Paralelismo",
};

export function jevKindLabel(kind: CanvasJevDecision["kind"]): string {
  return KIND_LABEL[kind];
}

export function jevStateLabel(state: JevStatus["state"]): string {
  return state === "ready" ? "activo" : state === "fallback" ? "flujo clásico" : "desactivado";
}

/** 6100 → "6,1k"; 830 → "830". */
export function formatTokenCount(tokens: number): string {
  const abs = Math.abs(tokens);
  if (abs < 1000) return String(Math.round(abs));
  return `${(abs / 1000).toLocaleString("es", { maximumFractionDigits: 1 })}k`;
}

/** Signo desde el punto de vista del modelo principal: menos tokens es "−". */
export function jevSavingChip(savedTokens: number): string | null {
  if (Math.abs(savedTokens) < 50) return null;
  return `${savedTokens > 0 ? "−" : "+"}${formatTokenCount(savedTokens)} tok`;
}

export function formatJevCost(costUsd: number): string {
  if (costUsd === 0) return "$0";
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(3)}`;
}

/**
 * Estado y decisiones de Jev para la oficina. El WebSocket solo anuncia cambios,
 * así que al abrir la página se toma el estado inicial de /api/providers.
 */
export function useJevOffice(): { status: JevStatus | null; decisions: CanvasJevDecision[] } {
  const status = useCanvasStore((s) => s.jevStatus);
  const decisions = useCanvasStore((s) => s.jevDecisions);
  const setJevStatus = useCanvasStore((s) => s.setJevStatus);

  useEffect(() => {
    if (useCanvasStore.getState().jevStatus) return;
    let cancelled = false;
    apiClient<{ providers: Provider[] }>("/api/providers")
      .then(({ providers }) => {
        const jev = providers.find((p) => p.id === "openrouter")?.jev;
        if (!cancelled && jev && !useCanvasStore.getState().jevStatus) setJevStatus(jev);
      })
      .catch(() => { /* sin estado inicial: el oráculo aparece con la primera decisión */ });
    return () => {
      cancelled = true;
    };
  }, [setJevStatus]);

  return { status, decisions };
}
