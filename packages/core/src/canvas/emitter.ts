import { getDb } from "../storage/sqlite"

export interface CanvasEvent {
  type: CanvasEventType
  data: any
  timestamp: number
}

export type CanvasEventType =
  | "canvas:snapshot"
  | "canvas:node_add"
  | "canvas:node_update"
  | "canvas:node_remove"
  | "canvas:edge_add"
  | "canvas:edge_remove"
  | "canvas:render"
  | "canvas:ask"
  | "canvas:confirm"
  | "canvas:clear"
  | "ag-ui:event"

const subscribers = new Set<{ send: (data: string) => void }>()

interface AgentLiveState { status: string; currentTool: string | null }
const agentLiveState = new Map<string, AgentLiveState>()
const canvasComponents = new Map<string, unknown>()

export function subscribeCanvas(ws: { send: (data: string) => void }) {
  subscribers.add(ws)
}

export function unsubscribeCanvas(ws: { send: (data: string) => void }) {
  subscribers.delete(ws)
}

export function emitCanvas(type: CanvasEventType, data: any) {
  // Track canvas components for new subscribers
  if (type === "canvas:render" && data?.component?.id) {
    canvasComponents.set(data.component.id, data.component)
  }
  if (type === "canvas:clear") {
    canvasComponents.clear()
  }

  // Track live agent state for new subscribers
  if (type === "canvas:node_update" && data?.nodeId && data?.changes) {
    const prev = agentLiveState.get(data.nodeId) ?? { status: "idle", currentTool: null }
    agentLiveState.set(data.nodeId, {
      status: data.changes.status ?? prev.status,
      currentTool: "currentTool" in data.changes ? data.changes.currentTool : prev.currentTool,
    })
  }

  const event: CanvasEvent = { type, data, timestamp: Date.now() }
  const payload = JSON.stringify(event)
  for (const ws of subscribers) {
    try {
      ws.send(payload)
    } catch {
      subscribers.delete(ws)
    }
  }
}

export function removeCanvasComponent(id: string) {
  canvasComponents.delete(id);
}

export function getCanvasSnapshot() {
  const db = getDb()

  const agentNodes = db
    .query<any, []>("SELECT id, name, description, role, status FROM agents")
    .all()
    .map((a: any) => {
      const live = agentLiveState.get(a.id)
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        status: live?.status ?? a.status,
        type: "agent",
        data: { role: a.role, currentTool: live?.currentTool ?? null },
      }
    })

  const mcpNodes = db
    .query<any, []>("SELECT id, name, status FROM mcp_servers WHERE enabled = 1")
    .all()
    .map((m: any) => ({
      id: `mcp:${m.id}`,
      name: m.name,
      status: m.status,
      type: "mcp",
    }))

  // Proyectos activos
  const projectNodes = db
    .query<any, []>("SELECT id, name, type, status, progress, agent_id FROM projects WHERE status IN ('active','pending','paused')")
    .all()
    .map((p: any) => ({
      id: `project_${p.id}`,
      name: p.name,
      status: p.status,
      type: "project",
      data: { progress: p.progress, projectType: p.type, agentId: p.agent_id },
    }))

  // Tareas de proyectos activos
  const taskNodes = db
    .query<any, []>(`
      SELECT t.id, t.name, t.status, t.progress, t.agent_id, t.project_id
      FROM tasks t
      INNER JOIN projects p ON t.project_id = p.id
      WHERE p.status IN ('active','pending','paused')
    `)
    .all()
    .map((t: any) => ({
      id: `task_${t.id}`,
      name: t.name,
      status: t.status,
      type: "task",
      data: { progress: t.progress, agentId: t.agent_id, projectId: t.project_id },
    }))

  // Edges: proyecto → tarea
  const projectTaskEdges = taskNodes.map((t: any) => ({
    id: `edge_proj_task_${t.id.replace("task_", "")}`,
    source: `project_${t.data.projectId}`,
    target: t.id,
    edgeType: "contains",
  }))

  // Edges: tarea → agente asignado
  const taskAgentEdges = taskNodes
    .filter((t: any) => t.data.agentId)
    .map((t: any) => ({
      id: `edge_task_agent_${t.id.replace("task_", "")}`,
      source: t.id,
      target: t.data.agentId,
      edgeType: "assigned_to",
    }))

  return {
    nodes: [...agentNodes, ...mcpNodes, ...projectNodes, ...taskNodes],
    edges: [...projectTaskEdges, ...taskAgentEdges],
    components: Array.from(canvasComponents.values()),
  }
}
