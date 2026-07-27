import { col, fromIndexable } from "../storage/hive"
import type { AgentDoc, McpServerDoc } from "../storage/collections"

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
  | "ag-ui:event"

const subscribers = new Set<{ send: (data: string) => void }>()

interface AgentLiveState {
  status: string
  currentTool: string | null
  currentTask: string | null
  taskId: string | null
  delegatedBy: string | null
}
const agentLiveState = new Map<string, AgentLiveState>()

const LIVE_DEFAULTS: AgentLiveState = {
  status: "idle",
  currentTool: null,
  currentTask: null,
  taskId: null,
  delegatedBy: null,
}

export function subscribeCanvas(ws: { send: (data: string) => void }) {
  subscribers.add(ws)
}

export function unsubscribeCanvas(ws: { send: (data: string) => void }) {
  subscribers.delete(ws)
}

export function emitCanvas(type: CanvasEventType, data: any) {
  // Track live agent state for new subscribers
  if (type === "canvas:node_update" && data?.nodeId && data?.changes) {
    const prev = agentLiveState.get(data.nodeId) ?? { ...LIVE_DEFAULTS }
    const c = data.changes
    agentLiveState.set(data.nodeId, {
      status: c.status ?? prev.status,
      currentTool: "currentTool" in c ? c.currentTool : prev.currentTool,
      currentTask: "currentTask" in c ? c.currentTask : prev.currentTask,
      taskId: "taskId" in c ? c.taskId : prev.taskId,
      delegatedBy: "delegatedBy" in c ? c.delegatedBy : prev.delegatedBy,
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

/**
 * Marca visualmente el inicio de una delegación coordinador→worker:
 * el worker muestra la tarea en curso y aparece el edge "delegates".
 */
export function emitDelegationStarted(opts: {
  workerId: string
  parentAgentId: string
  taskRef: string
  taskName: string
}) {
  emitCanvas("canvas:node_update", {
    nodeId: opts.workerId,
    changes: {
      status: "thinking",
      currentTask: opts.taskName,
      taskId: opts.taskRef,
      delegatedBy: opts.parentAgentId,
    },
  })
  if (opts.parentAgentId) {
    emitCanvas("canvas:edge_add", {
      id: `deleg_${opts.taskRef}`,
      source: opts.parentAgentId,
      target: opts.workerId,
      edgeType: "delegates",
      data: { taskId: opts.taskRef, taskName: opts.taskName },
    })
  }
}

/** Limpia el estado visual de delegación (éxito, fallo o aborto). */
export function emitDelegationFinished(opts: { workerId: string; taskRef: string }) {
  emitCanvas("canvas:node_update", {
    nodeId: opts.workerId,
    changes: { status: "idle", currentTool: null, currentTask: null, taskId: null, delegatedBy: null },
  })
  emitCanvas("canvas:edge_remove", { id: `deleg_${opts.taskRef}` })
}

/**
 * Fase de verificación del loop: el verificador independiente revisa la
 * entrega del worker. Se visualiza como un eslabón worker → verificador.
 */
export function emitVerificationStarted(opts: {
  verifierId: string
  workerId: string
  taskRef: string
  taskName: string
}) {
  emitCanvas("canvas:node_update", {
    nodeId: opts.verifierId,
    changes: {
      status: "thinking",
      currentTask: `Verificar: ${opts.taskName}`,
      taskId: opts.taskRef,
      delegatedBy: opts.workerId,
    },
  })
  emitCanvas("canvas:edge_add", {
    id: `review_${opts.taskRef}`,
    source: opts.workerId,
    target: opts.verifierId,
    edgeType: "reviews",
    data: { taskId: opts.taskRef, taskName: opts.taskName },
  })
}

export function emitVerificationFinished(opts: { verifierId: string; taskRef: string }) {
  emitCanvas("canvas:node_update", {
    nodeId: opts.verifierId,
    changes: { status: "idle", currentTool: null, currentTask: null, taskId: null, delegatedBy: null },
  })
  emitCanvas("canvas:edge_remove", { id: `review_${opts.taskRef}` })
}

export async function getCanvasSnapshot() {
  const agentsCol = await col<AgentDoc>("agents")
  const agentNodes = (await agentsCol.scan({}))
    .map(e => e.doc)
    .map((a) => {
      const live = agentLiveState.get(a.id)
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        status: live?.status ?? a.status,
        type: "agent",
        data: {
          role: a.role,
          currentTool: live?.currentTool ?? null,
          currentTask: live?.currentTask ?? null,
          taskId: live?.taskId ?? null,
          delegatedBy: live?.delegatedBy ?? null,
          source: a.source ?? null,
        },
      }
    })

  const mcpServersCol = await col<McpServerDoc>("mcpServers")
  const mcpNodes = (await mcpServersCol.scan({}))
    .map(e => e.doc)
    .filter(m => m.enabled)
    .map((m) => ({
      id: `mcp:${m.id}`,
      name: m.name,
      status: m.status,
      type: "mcp",
    }))

  // Edges: delegaciones activas coordinador → worker (sobreviven reconexiones)
  const delegationEdges = Array.from(agentLiveState.entries())
    .filter(([, s]) => s.delegatedBy && s.taskId)
    .map(([workerId, s]) => ({
      id: `deleg_${s.taskId}`,
      source: s.delegatedBy as string,
      target: workerId,
      edgeType: "delegates",
      data: { taskId: s.taskId, taskName: s.currentTask },
    }))

  return {
    nodes: [...agentNodes, ...mcpNodes],
    edges: [...delegationEdges],
  }
}
