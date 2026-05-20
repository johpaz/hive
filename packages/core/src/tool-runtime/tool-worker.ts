import { createAllTools } from "../tools/index.ts"
import type { Config } from "../config/loader.ts"

type WorkerRunMessage = {
  type: "run"
  jobId: string
  toolName: string
  args: unknown
  toolConfig: Record<string, unknown>
  hiveConfig: Config
  mainThreadToolNames: string[]
}

type WorkerRpcResponse = {
  type: "rpc_result"
  rpcId: string
  ok: boolean
  result?: unknown
  error?: SerializedError
}

type SerializedError = {
  name: string
  message: string
  stack?: string
}

const pendingRpc = new Map<string, {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()

function serializeError(error: unknown): SerializedError {
  const err = error instanceof Error ? error : new Error(String(error))
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  }
}

function parseArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    return JSON.parse(args) as Record<string, unknown>
  }
  if (args && typeof args === "object") {
    return args as Record<string, unknown>
  }
  return {}
}

function requestMainThreadTool(
  jobId: string,
  toolName: string,
  args: unknown,
  toolConfig: Record<string, unknown>
): Promise<unknown> {
  const rpcId = `${jobId}:${crypto.randomUUID()}`
  return new Promise((resolve, reject) => {
    pendingRpc.set(rpcId, { resolve, reject })
    postMessage({
      type: "rpc_call",
      rpcId,
      jobId,
      toolName,
      args,
      toolConfig,
    })
  })
}

async function runTool(message: WorkerRunMessage): Promise<void> {
  const startedAt = performance.now()

  try {
    const parsedArgs = parseArgs(message.args)
    const forceMainThread = message.mainThreadToolNames.includes(message.toolName)
    const allTools = forceMainThread ? [] : createAllTools(message.hiveConfig)
    const tool = allTools.find((candidate) => candidate.name === message.toolName)

    const result = tool?.execute
      ? await tool.execute(parsedArgs, { configurable: message.toolConfig })
      : await requestMainThreadTool(message.jobId, message.toolName, parsedArgs, message.toolConfig)

    postMessage({
      type: "result",
      jobId: message.jobId,
      ok: true,
      result,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error) {
    postMessage({
      type: "result",
      jobId: message.jobId,
      ok: false,
      error: serializeError(error),
      durationMs: Math.round(performance.now() - startedAt),
    })
  }
}

onmessage = (event: MessageEvent<WorkerRunMessage | WorkerRpcResponse>) => {
  const message = event.data

  if (message.type === "rpc_result") {
    const pending = pendingRpc.get(message.rpcId)
    if (!pending) return

    pendingRpc.delete(message.rpcId)
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      const error = new Error(message.error?.message || "Tool RPC failed")
      error.name = message.error?.name || "ToolRpcError"
      error.stack = message.error?.stack
      pending.reject(error)
    }
    return
  }

  if (message.type === "run") {
    void runTool(message)
  }
}
