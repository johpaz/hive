import { Diamond } from "lucide-react";
import { useAgents } from "@/stores/useGlobalConfigStore";

export interface JevUsage {
  decisions: number;
  costUsd: number;
  /** Tokens de entrada del modelo principal evitados (estimado); negativo si Jev añadió contexto. */
  savedTokens: number;
  savedCostUsd: number;
  byAgent: Record<string, { decisions: number; costUsd: number; savedTokens: number; savedCostUsd: number }>;
}

function formatTokens(tokens: number): string {
  const abs = Math.abs(tokens);
  const sign = tokens < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

function formatUsd(usd: number): string {
  const abs = Math.abs(usd);
  const sign = usd < 0 ? "−" : "";
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(3)}`;
  if (abs > 0) return `${sign}$${abs.toFixed(5)}`;
  return "$0.00";
}

/**
 * Jev en el panel de uso: lo que cuesta el plano de decisión frente a lo que
 * le ahorra al modelo principal de cada agente en el mismo período.
 */
export function JevUsageBlock({ jev }: { jev: JevUsage | undefined }) {
  const { agents } = useAgents();
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  const active = !!jev && jev.decisions > 0;
  const net = jev ? jev.savedCostUsd - jev.costUsd : 0;
  const ratio = jev && jev.costUsd > 0 && jev.savedCostUsd > 0 ? jev.savedCostUsd / jev.costUsd : null;
  // A model without a tariff in the catalog prices every saved token at $0.
  const unpriced = !!jev && jev.savedTokens > 0 && jev.savedCostUsd === 0;
  const ranking = jev
    ? Object.entries(jev.byAgent).sort(([, a], [, b]) => b.savedTokens - a.savedTokens).slice(0, 5)
    : [];

  return (
    <div className={`rounded-lg border p-3 ${active ? "border-violet-500/30 bg-violet-500/5" : "bg-card/50"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Diamond className={`h-3 w-3 ${active ? "text-violet-400" : ""}`} />
          <span className="font-medium">Jev · Plano de decisión</span>
        </div>
        {ratio !== null && (
          <span className="text-xs font-bold text-violet-300">
            ahorra {ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× lo que cuesta
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-violet-500/5 rounded-md p-2">
          <div className="text-xs text-muted-foreground mb-1">Decisiones</div>
          <div className={`text-lg font-bold ${active ? "text-violet-300" : "text-muted-foreground"}`}>
            {jev ? jev.decisions.toLocaleString("es") : "—"}
          </div>
        </div>
        <div className="bg-violet-500/5 rounded-md p-2">
          <div className="text-xs text-muted-foreground mb-1">Costo Jev</div>
          <div className="text-lg font-bold text-violet-300">{jev ? formatUsd(jev.costUsd) : "—"}</div>
        </div>
        <div className="bg-violet-500/5 rounded-md p-2">
          <div className="text-xs text-muted-foreground mb-1">Tokens ahorrados (modelo principal)</div>
          <div className={`text-lg font-bold ${jev && jev.savedTokens < 0 ? "text-amber-400" : "text-emerald-400"}`}>
            {jev ? `~${formatTokens(jev.savedTokens)}` : "—"}
          </div>
        </div>
        <div className="bg-violet-500/5 rounded-md p-2">
          <div className="text-xs text-muted-foreground mb-1">Ahorro neto estimado</div>
          <div className={`text-lg font-bold ${net < 0 ? "text-amber-400" : "text-emerald-400"}`}>
            {jev ? formatUsd(net) : "—"}
          </div>
        </div>
      </div>

      {ranking.length > 0 && (
        <div className="mt-3 pt-3 border-t border-violet-500/20">
          <div className="rounded-md border border-violet-500/10 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-violet-500/5 text-muted-foreground">
                <tr>
                  <th className="text-left p-1.5 font-medium">Agente</th>
                  <th className="text-right p-1.5 font-medium">Decisiones</th>
                  <th className="text-right p-1.5 font-medium">Tokens ahorrados</th>
                  <th className="text-right p-1.5 font-medium">Ahorro</th>
                  <th className="text-right p-1.5 font-medium">Costo Jev</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map(([agentId, agent]) => (
                  <tr key={agentId} className="border-t border-violet-500/10">
                    <td className="p-1.5 font-medium truncate max-w-[10rem]">{nameOf(agentId)}</td>
                    <td className="p-1.5 text-right">{agent.decisions}</td>
                    <td className={`p-1.5 text-right ${agent.savedTokens < 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {formatTokens(agent.savedTokens)}
                    </td>
                    <td className="p-1.5 text-right">{formatUsd(agent.savedCostUsd)}</td>
                    <td className="p-1.5 text-right text-violet-300">{formatUsd(agent.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-2 text-xs text-muted-foreground italic">
        {!active
          ? "Sin decisiones de Jev en este período. Se activa al guardar una clave de OpenRouter."
          : unpriced
            ? "El modelo principal no tiene tarifa en el catálogo: los tokens ahorrados se valoran en $0."
            : "Estimación frente al flujo clásico (caracteres ÷ 4), con la tarifa de entrada del modelo de cada agente."}
      </div>
    </div>
  );
}
