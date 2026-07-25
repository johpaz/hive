import { useMemo } from "react";
import type { Agent } from "@/types";
import type { GraphNode } from "@/stores/canvasStore";

const AGENT_COLORS: Record<string, string> = {
  web_researcher: "#3b82f6",
  browser_operator: "#06b6d4",
  workspace_file_operator: "#10b981",
  software_engineer: "#22c55e",
  office_document_agent: "#f59e0b",
  a2ui_builder: "#6366f1",
  schedule_automation_agent: "#14b8a6",
  api_operator: "#ef4444",
  mcp_integration_operator: "#84cc16",
  acceptance_verifier: "#94a3b8",
};

function hashHue(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
}

function catalogAgentColor(id: string): string {
  return AGENT_COLORS[id] ?? `hsl(${hashHue(id)}, 65%, 55%)`;
}

function deskPosition(index: number): { x: number; y: number } {
  const columns = 5;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return { x: 12 + column * 19, y: 48 + row * 34 };
}

// No more "dormant" — catalog agents are seeded rows in `agents`, always
// present in the canvas snapshot. A desk just reflects its live status
// (idle by default) or "disabled" when the agent's own enabled flag is off.
export type DeskState = "disabled" | "idle" | "thinking" | "tool_call" | "stuck";

export interface DeskModel {
  agent: Agent;
  state: DeskState;
  currentTool: string | null;
  currentTask: string | null;
  taskId: string | null;
  delegatedBy: string | null;
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

export function useOfficeModel(catalogAgents: Agent[], graphNodes: GraphNode[]) {
  return useMemo(() => {
    const coordinator = graphNodes.find((n) => n.type === "agent" && n.data?.role === "coordinator");

    const desks: DeskModel[] = catalogAgents.map((agent, index) => {
      // Catalog agents keep their own fixed id everywhere (agents table,
      // canvas snapshot, WS status updates) — direct id match, no indirection.
      const liveNodes = graphNodes.filter((n) => n.type === "agent" && n.id === agent.id);

      const position = deskPosition(index);
      const color = catalogAgentColor(agent.id);

      if (!agent.enabled) {
        return { agent, state: "disabled", currentTool: null, currentTask: null, taskId: null, delegatedBy: null, workerCount: 0, position, color };
      }

      const best = liveNodes
        .slice()
        .sort((a, b) => (STATUS_PRIORITY[b.status] ?? 0) - (STATUS_PRIORITY[a.status] ?? 0))[0];

      return {
        agent,
        state: best ? normalizeStatus(best.status) : "idle",
        currentTool: (best?.data?.currentTool as string | null) ?? null,
        currentTask: (best?.data?.currentTask as string | null) ?? null,
        taskId: (best?.data?.taskId as string | null) ?? null,
        delegatedBy: (best?.data?.delegatedBy as string | null) ?? null,
        workerCount: liveNodes.length,
        position,
        color,
      };
    });

    return { coordinator, desks };
  }, [catalogAgents, graphNodes]);
}
