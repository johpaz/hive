import { useMemo } from "react";
import type { Specialist } from "@/types/specialists";
import type { GraphNode } from "@/stores/canvasStore";
import { deskPosition, specialistColor } from "./legoTheme";

export type DeskState = "disabled" | "dormant" | "idle" | "thinking" | "tool_call" | "stuck";

export interface DeskModel {
  specialist: Specialist;
  state: DeskState;
  currentTool: string | null;
  workerCount: number;
  position: { x: number; y: number };
  color: string;
}

const STATUS_PRIORITY: Record<string, number> = { tool_call: 3, thinking: 2, stuck: 2, idle: 1 };

function normalizeStatus(status: string): DeskState {
  if (status === "tool_call" || status === "thinking" || status === "stuck") return status;
  if (status === "error" || status === "failed") return "stuck";
  return "idle";
}

export function useOfficeModel(specialists: Specialist[], graphNodes: GraphNode[]) {
  return useMemo(() => {
    const coordinator = graphNodes.find((n) => n.type === "agent" && n.data?.role === "coordinator");

    const desks: DeskModel[] = specialists.map((specialist, index) => {
      const liveNodes = graphNodes.filter(
        (n) => n.type === "agent" && n.data?.specialistId === specialist.id,
      );

      const position = deskPosition(specialist.id, index);
      const color = specialistColor(specialist.id);

      if (!specialist.active) {
        return { specialist, state: "disabled", currentTool: null, workerCount: 0, position, color };
      }
      if (liveNodes.length === 0) {
        return { specialist, state: "dormant", currentTool: null, workerCount: 0, position, color };
      }

      const best = liveNodes
        .slice()
        .sort((a, b) => (STATUS_PRIORITY[b.status] ?? 0) - (STATUS_PRIORITY[a.status] ?? 0))[0];

      return {
        specialist,
        state: normalizeStatus(best.status),
        currentTool: (best.data?.currentTool as string | null) ?? null,
        workerCount: liveNodes.length,
        position,
        color,
      };
    });

    return { coordinator, desks };
  }, [specialists, graphNodes]);
}
