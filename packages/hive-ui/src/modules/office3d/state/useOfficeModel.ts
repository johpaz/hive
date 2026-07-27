import { useMemo } from "react";
import type { Agent } from "@/types";
import type { GraphEdge, GraphNode } from "@/stores/canvasStore";

function hashHue(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
}

function catalogAgentColor(id: string): string {
  return `hsl(${hashHue(id)}, 68%, 58%)`;
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
export type DeskState = "archived" | "disabled" | "idle" | "thinking" | "tool_call" | "stuck";

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

export interface OfficeInteraction {
  id: string;
  kind: "delegates" | "reviews";
  sourceId: string;
  targetId: string;
  taskId: string | null;
  taskName: string | null;
}

export function officeInteractionsFromEdges(graphEdges: GraphEdge[]): OfficeInteraction[] {
  const interactions: OfficeInteraction[] = [];
  for (const edge of graphEdges) {
    if (edge.edgeType !== "delegates" && edge.edgeType !== "reviews") continue;
    interactions.push({
      id: edge.id,
      kind: edge.edgeType as OfficeInteraction["kind"],
      sourceId: edge.source,
      targetId: edge.target,
      taskId: (edge.data?.taskId as string | null) ?? null,
      taskName: (edge.data?.taskName as string | null) ?? null,
    });
  }
  return interactions;
}

export function officeWorkersFromAgents(agents: Agent[]): Agent[] {
  return agents.filter((agent) => agent.role === "worker");
}

const STATUS_PRIORITY: Record<string, number> = { tool_call: 3, thinking: 2, stuck: 2, idle: 1 };

function normalizeStatus(status: string): DeskState {
  if (status === "archived") return "archived";
  if (status === "tool_call" || status === "thinking" || status === "stuck") return status;
  if (status === "error" || status === "failed") return "stuck";
  return "idle";
}

export function useOfficeModel(agents: Agent[], graphNodes: GraphNode[], graphEdges: GraphEdge[] = []) {
  return useMemo(() => {
    const coordinatorAgent = agents.find((agent) => agent.role === "coordinator");
    const coordinatorLive = graphNodes.find(
      (node) => node.type === "agent" && (node.id === coordinatorAgent?.id || node.data?.role === "coordinator"),
    );
    const coordinator: GraphNode | undefined = coordinatorAgent
      ? {
          id: coordinatorAgent.id,
          name: coordinatorAgent.name,
          description: coordinatorAgent.description,
          type: "agent",
          status: coordinatorLive?.status ?? coordinatorAgent.status,
          data: { ...(coordinatorLive?.data ?? {}), role: "coordinator" },
        }
      : coordinatorLive;

    // Every worker row returned by /api/agents occupies a desk. Source and ID
    // affect neither inclusion nor presentation; archived/manual-disabled rows
    // remain visible with their actual database state.
    const visibleAgents = officeWorkersFromAgents(agents);

    const desks: DeskModel[] = visibleAgents.map((agent, index) => {
      // Catalog agents keep their own fixed id everywhere (agents table,
      // canvas snapshot, WS status updates) — direct id match, no indirection.
      const liveNodes = graphNodes.filter((n) => n.type === "agent" && n.id === agent.id);

      const position = deskPosition(index);
      const color = catalogAgentColor(agent.id);

      if (agent.status === "archived") {
        return { agent, state: "archived", currentTool: null, currentTask: null, taskId: null, delegatedBy: null, workerCount: 0, position, color };
      }

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

    const interactions = officeInteractionsFromEdges(graphEdges);

    return { coordinator, desks, interactions };
  }, [agents, graphNodes, graphEdges]);
}
