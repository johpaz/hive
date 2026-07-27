import { X } from "lucide-react";
import type { GraphNode } from "@/stores/canvasStore";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import { humanizeTool } from "@/modules/office3d/state/toolLabels";
import { useOffice3DStore } from "../state/office3dStore";

const STATE_LABEL: Record<DeskModel["state"], string> = {
  archived: "Archivado manualmente",
  disabled: "Desactivado",
  idle: "En espera",
  thinking: "Pensando",
  tool_call: "Ejecutando herramienta",
  stuck: "Atascado",
};

export function AgentInspector({ desk, delegatorName }: { desk: DeskModel | null; delegatorName: string }) {
  const select = useOffice3DStore((s) => s.select);
  if (!desk) return null;

  const { agent } = desk;
  return (
    <aside className="office3d-inspector" style={{ ["--agent-color" as string]: desk.color }}>
      <button type="button" className="office3d-inspector-close" onClick={() => select(null)} aria-label="Cerrar">
        <X size={14} />
      </button>

      <div className="office3d-inspector-head">
        <span className="office3d-inspector-orb" />
        <div>
          <h3 className="office3d-inspector-name">{agent.name}</h3>
          <span className="office3d-inspector-id">{agent.id}</span>
        </div>
      </div>

      <div className="office3d-inspector-row">
        <span className="office3d-inspector-label">Rol</span>
        <span>{agent.role === "coordinator" ? "Coordinador" : "Especialista"}</span>
      </div>
      <div className="office3d-inspector-row">
        <span className="office3d-inspector-label">Estado</span>
        <span className={`office3d-state-chip office3d-state-chip--${desk.state}`}>
          {STATE_LABEL[desk.state]}
        </span>
      </div>
      {desk.currentTask && (
        <div className="office3d-inspector-row">
          <span className="office3d-inspector-label">Tarea</span>
          <span className="office3d-inspector-task">{desk.currentTask}</span>
        </div>
      )}
      {desk.delegatedBy && (
        <div className="office3d-inspector-row">
          <span className="office3d-inspector-label">Delegado por</span>
          <span>{delegatorName}</span>
        </div>
      )}
      {desk.currentTool && (
        <div className="office3d-inspector-row">
          <span className="office3d-inspector-label">Herramienta</span>
          <span className="office3d-inspector-tool">{humanizeTool(desk.currentTool)}</span>
        </div>
      )}
      <div className="office3d-inspector-row">
        <span className="office3d-inspector-label">Workers</span>
        <span className="font-mono">{desk.workerCount}</span>
      </div>
      {agent.description && <p className="office3d-inspector-desc">{agent.description}</p>}
    </aside>
  );
}

export function CoordinatorInspector({ coordinator }: { coordinator: GraphNode | null }) {
  const select = useOffice3DStore((s) => s.select);
  if (!coordinator) return null;

  return (
    <aside className="office3d-inspector office3d-inspector--coordinator" style={{ ["--agent-color" as string]: "#f59e0b" }}>
      <button type="button" className="office3d-inspector-close" onClick={() => select(null)} aria-label="Cerrar">
        <X size={14} />
      </button>
      <div className="office3d-inspector-head">
        <span className="office3d-inspector-orb" />
        <div>
          <span className="office3d-inspector-eyebrow">Coordinador principal</span>
          <h3 className="office3d-inspector-name">{coordinator.name}</h3>
        </div>
      </div>
      <div className="office3d-inspector-row">
        <span className="office3d-inspector-label">Función</span>
        <span>Asigna y supervisa</span>
      </div>
      <div className="office3d-inspector-row">
        <span className="office3d-inspector-label">Estado</span>
        <span className={`office3d-state-chip office3d-state-chip--${coordinator.status}`}>
          {coordinator.status === "tool_call" ? "Ejecutando herramienta" : coordinator.status === "thinking" ? "Pensando" : "En espera"}
        </span>
      </div>
      {typeof coordinator.description === "string" && (
        <p className="office3d-inspector-desc">{coordinator.description}</p>
      )}
    </aside>
  );
}
