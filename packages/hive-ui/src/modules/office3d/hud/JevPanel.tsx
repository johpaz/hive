import { useState } from "react";
import { ChevronDown, ChevronUp, Diamond } from "lucide-react";
import { useCanvasStore, type CanvasJevDecision, type GraphNode, type JevStatus } from "@/stores/canvasStore";
import type { DeskModel } from "../state/useOfficeModel";
import { formatJevCost, formatTokenCount, jevKindLabel, jevStateLabel } from "../state/jev";

/**
 * Lo que aporta Jev al enjambre: cuántas decisiones tomó, cuánto contexto le
 * ahorró al modelo principal y qué decidió por última vez.
 */
export function JevPanel({
  status,
  decisions,
  coordinator,
  desks,
}: {
  status: JevStatus | null;
  decisions: CanvasJevDecision[];
  coordinator: GraphNode | null;
  desks: DeskModel[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const byAgent = useCanvasStore((s) => s.jevByAgent);
  if (!status || status.state === "off") return null;

  const nameOf = (id: string) =>
    id === coordinator?.id ? coordinator.name : desks.find((d) => d.agent.id === id)?.agent.name ?? id;
  const totals = status.totals ?? { decisions: 0, savedTokens: 0, costUsd: 0 };
  const latest = decisions[decisions.length - 1];
  const avgLatency = decisions.length
    ? Math.round(decisions.reduce((sum, d) => sum + d.latencyMs, 0) / decisions.length)
    : null;
  const ranking = Object.entries(byAgent)
    .sort(([, a], [, b]) => b.savedTokens - a.savedTokens)
    .slice(0, 4);

  return (
    <section
      className={`office3d-jev office3d-glass ${status.state === "fallback" ? "is-fallback" : ""} ${collapsed ? "is-collapsed" : ""}`}
      aria-label="Jev, plano de decisión"
    >
      <header className="office3d-jev-head">
        <span className="office3d-jev-icon"><Diamond size={14} /></span>
        <div>
          <span className="office3d-section-kicker">PLANO DE DECISIÓN</span>
          <h2>Jev · {jevStateLabel(status.state)}</h2>
        </div>
        <button
          type="button"
          className="office3d-roster-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Mostrar detalle de Jev" : "Ocultar detalle de Jev"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </header>

      <dl className="office3d-jev-metrics">
        <div>
          <dt>Decisiones</dt>
          <dd>{totals.decisions}</dd>
        </div>
        <div>
          <dt>{totals.savedTokens >= 0 ? "Tokens ahorrados" : "Tokens añadidos"}</dt>
          <dd>~{formatTokenCount(totals.savedTokens)}</dd>
        </div>
        <div>
          <dt>Costo Jev</dt>
          <dd>{formatJevCost(totals.costUsd)}</dd>
        </div>
      </dl>

      {!collapsed && (
        <>
          {status.state === "fallback" && status.lastError && (
            <p className="office3d-jev-warn">Usando el flujo clásico: {status.lastError}</p>
          )}

          {latest && (
            <div className="office3d-jev-latest">
              <span>Última decisión · {nameOf(latest.agentId)} · {jevKindLabel(latest.kind)}</span>
              <p>{latest.summary}</p>
              {latest.recommendedAgentId && (latest.mcpOff?.length
                ? <p className="office3d-jev-warn">{nameOf(latest.recommendedAgentId)} es el indicado, pero necesita encender {latest.mcpOff.join(", ")}</p>
                : <p>Recomendó delegar en {nameOf(latest.recommendedAgentId)}</p>)}
            </div>
          )}

          {ranking.length > 0 && (
            <ul className="office3d-jev-agents" aria-label="Ahorro por agente desde que abriste la oficina">
              {ranking.map(([agentId, agent]) => (
                <li key={agentId}>
                  <span>{nameOf(agentId)}</span>
                  <b>{agent.savedTokens >= 0 ? "−" : "+"}{formatTokenCount(agent.savedTokens)}</b>
                  <small>{agent.decisions} dec.</small>
                </li>
              ))}
            </ul>
          )}

          <p className="office3d-jev-note">
            Estimación frente al flujo clásico (caracteres ÷ 4)
            {avgLatency !== null ? ` · ${avgLatency} ms de media` : ""}
          </p>
        </>
      )}
    </section>
  );
}

/** Fila de inspector: qué le ha aportado Jev a este agente en esta sesión. */
export function JevInspectorRow({ agentId }: { agentId: string }) {
  const contribution = useCanvasStore((s) => s.jevByAgent[agentId]);
  if (!contribution) return null;
  return (
    <div className="office3d-inspector-row">
      <span className="office3d-inspector-label">Jev</span>
      <span className="font-mono">
        {contribution.decisions} dec. · {contribution.savedTokens >= 0 ? "−" : "+"}
        {formatTokenCount(contribution.savedTokens)} tok
      </span>
    </div>
  );
}
