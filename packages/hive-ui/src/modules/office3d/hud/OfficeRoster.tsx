import { useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Crown, Radio } from "lucide-react";
import type { CanvasWorkEvent, GraphNode } from "@/stores/canvasStore";
import type { DeskModel, OfficeInteraction } from "../state/useOfficeModel";
import { useOffice3DStore } from "../state/office3dStore";

const STATE_LABEL: Record<DeskModel["state"], string> = {
  archived: "Archivado",
  disabled: "Desactivado",
  idle: "Disponible",
  thinking: "Pensando",
  tool_call: "Ejecutando",
  stuck: "Necesita ayuda",
};

function shortRole(desk: DeskModel) {
  const description = desk.agent.description?.trim();
  if (!description) return "Agente especialista";
  return description.length > 62 ? `${description.slice(0, 59)}…` : description;
}

export function OfficeRoster({
  coordinator,
  desks,
  interactions,
  workEvents,
}: {
  coordinator: GraphNode | null;
  desks: DeskModel[];
  interactions: OfficeInteraction[];
  workEvents: CanvasWorkEvent[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const selectedId = useOffice3DStore((state) => state.selectedAgentId);
  const select = useOffice3DStore((state) => state.select);
  const deskById = new Map(desks.map((desk) => [desk.agent.id, desk]));
  const nameOf = (id: string) =>
    id === coordinator?.id
      ? coordinator.name
      : deskById.get(id)?.agent.name ?? id;
  const latestByTask = new Map<string, CanvasWorkEvent>();
  for (const event of workEvents) latestByTask.set(event.taskRef, event);

  return (
    <aside
      className={`office3d-roster office3d-glass ${collapsed ? "is-collapsed" : ""}`}
      aria-label="Equipo y flujo de trabajo"
    >
      <div className="office3d-roster-heading">
        <div className="office3d-roster-title">
          <span className="office3d-section-kicker">CENTRO DE OPERACIONES</span>
          <h2>Quién hace qué</h2>
        </div>
        <span className="office3d-roster-live" aria-label={`${interactions.length} flujos activos`}>
          <Radio size={15} className={interactions.length ? "is-active" : ""} />
        </span>
        <button
          type="button"
          className="office3d-roster-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Abrir centro de operaciones" : "Colapsar centro de operaciones"}
          title={collapsed ? "Abrir centro de operaciones" : "Colapsar centro de operaciones"}
        >
          {collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      <div className="office3d-roster-content">
        <button
          type="button"
          className={`office3d-roster-coordinator ${selectedId === coordinator?.id ? "is-selected" : ""}`}
          onClick={() => coordinator && select(selectedId === coordinator.id ? null : coordinator.id)}
          disabled={!coordinator}
        >
          <Crown size={17} />
          <span>
            <small>ABEJA REINA · COORDINADOR</small>
            <strong>{coordinator?.name ?? "Conectando…"}</strong>
            <em>Asigna · supervisa · recibe</em>
          </span>
        </button>

        <div className="office3d-flow">
          <div className="office3d-section-title">
            Flujo activo <span>{interactions.length}</span>
          </div>
          {interactions.length === 0 ? (
            <p className="office3d-flow-empty">El equipo está disponible. Las delegaciones aparecerán aquí.</p>
          ) : (
            interactions.map((interaction) => {
              const target = deskById.get(interaction.targetId);
              const latest = interaction.taskId ? latestByTask.get(interaction.taskId) : null;
              const stage =
                latest?.phase === "completed" || latest?.phase === "review_passed"
                  ? 3
                  : interaction.kind === "reviews"
                    ? 2
                    : target?.state === "thinking" || target?.state === "tool_call"
                      ? 1
                      : 0;
              const failed =
                latest?.phase === "failed" ||
                latest?.phase === "aborted" ||
                latest?.phase === "review_failed" ||
                latest?.phase === "blocked";
              return (
              <div className={`office3d-flow-item ${failed ? "is-failed" : ""}`} key={interaction.id}>
                <span>{nameOf(interaction.sourceId)}</span>
                <ArrowRight size={12} />
                <span>{nameOf(interaction.targetId)}</span>
                <strong>{interaction.kind === "reviews" ? "Revisión" : "Delegación"}</strong>
                {interaction.taskName && <small>{interaction.taskName}</small>}
                <div className="office3d-flow-steps" aria-label="Progreso del trabajo">
                  {["Delegado", "Trabajando", "Revisando", failed ? "Atención" : "Entregado"].map((label, index) => (
                    <span
                      key={label}
                      className={`${index < stage ? "is-done" : ""} ${index === stage ? "is-current" : ""}`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              );
            })
          )}
        </div>

        <div className="office3d-agents-list">
          <div className="office3d-section-title">Especialistas <span>{desks.length}</span></div>
          {desks.map((desk) => (
            <button
              type="button"
              key={desk.agent.id}
              className={`office3d-agent-row ${selectedId === desk.agent.id ? "is-selected" : ""}`}
              onClick={() => select(selectedId === desk.agent.id ? null : desk.agent.id)}
              style={{ ["--agent-color" as string]: desk.color }}
            >
              <span className={`office3d-agent-status office3d-name-dot--${desk.state}`} />
              <span className="office3d-agent-copy">
                <strong>{desk.agent.name}</strong>
                <small>{desk.currentTask || shortRole(desk)}</small>
              </span>
              <em>{STATE_LABEL[desk.state]}</em>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
