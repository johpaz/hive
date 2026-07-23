import "./office.css";
import type { Specialist } from "@/types/specialists";
import type { GraphNode } from "@/stores/canvasStore";
import { useOfficeModel, type DeskState } from "./useOfficeModel";
import { LegoDesk } from "./LegoDesk";
import { LegoMinifig } from "./LegoMinifig";
import { ActivityBubble } from "./ActivityBubble";
import { useFinishFlash } from "./useFinishFlash";
import { DelegationLayer } from "./DelegationLayer";
import { Building2 } from "lucide-react";

const COORDINATOR_POS = { x: 50, y: 14 };

interface LegoOfficeProps {
  specialists: Specialist[];
  graphNodes: GraphNode[];
}

function coordinatorState(node: GraphNode | undefined): DeskState {
  if (!node) return "dormant";
  if (node.status === "tool_call" || node.status === "thinking" || node.status === "stuck") return node.status;
  return "idle";
}

export function LegoOffice({ specialists, graphNodes }: LegoOfficeProps) {
  const { coordinator, desks } = useOfficeModel(specialists, graphNodes);

  if (specialists.length === 0) {
    return (
      <div className="lego-office flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-white/20">
          <Building2 className="h-10 w-10 opacity-30" />
          <p className="text-sm">La oficina está vacía</p>
          <p className="text-xs text-white/15">Los especialistas aparecerán aquí en cuanto se sincronicen</p>
        </div>
      </div>
    );
  }

  const cState = coordinatorState(coordinator);
  const currentTool = (coordinator?.data?.currentTool as string | null) ?? null;
  const coordinatorJustFinished = useFinishFlash(cState);

  return (
    <div className="lego-office">
      <div className="lego-office__floor" />
      <DelegationLayer coordinatorPos={COORDINATOR_POS} desks={desks} />

      {/* Coordinator */}
      <div className="lego-coordinator" style={{ left: `${COORDINATOR_POS.x}%`, top: `${COORDINATOR_POS.y}%` }}>
        <div className="relative">
          <div className="lego-coordinator__glow" />
          <ActivityBubble state={cState} currentTool={currentTool} workerCount={1} justFinished={coordinatorJustFinished} />
          <LegoMinifig color="#a855f7" state={cState === "dormant" ? "idle" : cState} size={76} />
        </div>
        <div className="lego-desk__placard border-purple-500/30">
          <span className="lego-desk__dot bg-purple-400" style={{ boxShadow: "0 0 8px rgba(168,85,247,0.7)" }} />
          <span className="lego-desk__name text-purple-200">{coordinator?.name ?? "Coordinador"}</span>
        </div>
      </div>

      {desks.map((desk) => (
        <LegoDesk key={desk.specialist.id} desk={desk} />
      ))}
    </div>
  );
}
