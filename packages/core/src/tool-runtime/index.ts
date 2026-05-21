import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { availableParallelism } from "node:os"
import type { Config } from "../config/loader.ts"
import { loadConfig } from "../config/loader.ts"

export type ToolCallLike = {
  id: string
  function: {
    name: string
    arguments: unknown
  }
}

export type RuntimeTool = {
  name: string
  execute?: (params: Record<string, unknown>, config?: any) => Promise<unknown>
}

export type ToolRuntimeConfig = {
  enabled?: boolean
  maxWorkers?: number
  toolTimeoutMs?: number
  parallelToolCalls?: boolean
}

export type ExecuteToolBatchOptions = {
  toolCalls: ToolCallLike[]
  allTools: RuntimeTool[]
  toolConfig: {
    user_id?: string
    thread_id?: string
    channel?: string
    workspace?: string | null
  }
  hiveConfig?: Config
  workerPool?: ToolRuntimeConfig
  mainThreadToolNames?: string[]
  signal?: AbortSignal
}

export type ToolBatchResult = {
  toolCall: ToolCallLike
  toolName: string
  result: unknown
  ok: boolean
  durationMs: number
  error?: SerializedError
  timedOut?: boolean
  aborted?: boolean
}

type SerializedError = {
  name: string
  message: string
  stack?: string
}

type WorkerMessage =
  | {
    type: "result"
    jobId: string
    ok: boolean
    result?: unknown
    error?: SerializedError
    durationMs: number
  }
  | {
    type: "rpc_call"
    rpcId: string
    jobId: string
    toolName: string
    args: unknown
    toolConfig: Record<string, unknown>
  }

type QueuedJob = {
  id: string
  batchId: string
  index: number
  toolCall: ToolCallLike
  allTools: RuntimeTool[]
  toolConfig: ExecuteToolBatchOptions["toolConfig"]
  hiveConfig: Config
  mainThreadToolNames: string[]
  timeoutMs: number
  resolve: (result: ToolBatchResult) => void
  settled: boolean
  startedAt: number
  timer?: ReturnType<typeof setTimeout>
}

type WorkerSlot = {
  worker: Worker
  busy: boolean
  job?: QueuedJob
}

function resolveWorkerEntry(): string {
  const candidates = [
    new URL("./tool-worker.js", import.meta.url),
    new URL("./tool-worker.ts", import.meta.url),
    new URL("../packages/core/src/tool-runtime/tool-worker.js", import.meta.url),
    new URL("../packages/core/src/tool-runtime/tool-worker.ts", import.meta.url),
  ]

  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate.href
    }
  }

  throw new Error(
    `Tool worker entry not found. Tried: ${candidates.map((candidate) => fileURLToPath(candidate)).join(", ")}`
  )
}

function serializeError(error: unknown): SerializedError {
  const err = error instanceof Error ? error : new Error(String(error))
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  }
}

function toolErrorResult(
  toolName: string,
  message: string,
  extra: Partial<ToolBatchResult> = {}
): unknown {
  return {
    error: true,
    tool: toolName,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  }
}

const DEFAULT_MAIN_THREAD_TOOL_NAMES = new Set([
  // These tools depend on process-local singleton state (SQLite DB, live
  // channel senders, schedulers, browser sessions, or in-memory services).
  "search_knowledge",
  "save_note",
  "memory_write",
  "memory_read",
  "memory_list",
  "memory_search",
  "memory_delete",
  "agent_create",
  "agent_find",
  "agent_archive",
  "task_status",
  "bus_publish",
  "bus_read",
  "get_available_models",
  "meeting_start",
  "meeting_add_segment",
  "meeting_stop",
  "meeting_report",
  "browser_navigate",
  "browser_screenshot",
  "browser_click",
  "browser_type",
  "browser_extract",
  "browser_script",
  "browser_wait",
  "canvas_render",
  "canvas_ask",
  "canvas_confirm",
  "canvas_show_card",
  "canvas_show_progress",
  "canvas_show_list",
  "canvas_clear",
  "a2ui_create_surface",
  "a2ui_update_components",
  "a2ui_update_data_model",
  "a2ui_delete_surface",
  "cron.create",
  "cron.list",
  "cron.update",
  "cron.pause",
  "cron.resume",
  "cron.delete",
  "cron.trigger",
  "cron.history",
  "notify",
  "report_progress",
  "task_delegate",
  "task_delegate_code",
  "voice_transcribe",
  "voice_speak",
])

async function executeInMainThread(job: {
  toolCall: ToolCallLike
  allTools: RuntimeTool[]
  toolConfig: ExecuteToolBatchOptions["toolConfig"]
}): Promise<unknown> {
  const toolName = job.toolCall.function.name
  const tool = job.allTools.find((candidate) => candidate.name === toolName)
  if (!tool?.execute) {
    return toolErrorResult(toolName, `Tool '${toolName}' not found or not executable`)
  }

  try {
    const args = typeof job.toolCall.function.arguments === "string"
      ? JSON.parse(job.toolCall.function.arguments)
      : job.toolCall.function.arguments
    return await tool.execute((args ?? {}) as Record<string, unknown>, { configurable: job.toolConfig })
  } catch (error) {
    return toolErrorResult(toolName, (error as Error).message)
  }
}

class ToolWorkerPool {
  private workers: WorkerSlot[] = []
  private queue: QueuedJob[] = []
  private readonly maxWorkers: number

  constructor(maxWorkers: number) {
    this.maxWorkers = Math.max(1, maxWorkers)
  }

  execute(job: Omit<QueuedJob, "resolve" | "settled" | "startedAt">): Promise<ToolBatchResult> {
    return new Promise((resolve) => {
      this.queue.push({
        ...job,
        resolve,
        settled: false,
        startedAt: 0,
      })
      this.drain()
    })
  }

  abortBatch(batchId: string, reason = "Tool execution aborted"): void {
    const remaining: QueuedJob[] = []
    const aborted: QueuedJob[] = []
    for (const job of this.queue) {
      if (job.batchId === batchId) aborted.push(job)
      else remaining.push(job)
    }
    this.queue = remaining

    for (const job of aborted) {
      job.resolve({
        toolCall: job.toolCall,
        toolName: job.toolCall.function.name,
        result: toolErrorResult(job.toolCall.function.name, reason),
        ok: false,
        durationMs: 0,
        error: { name: "AbortError", message: reason },
        aborted: true,
      })
    }

    for (const slot of this.workers) {
      if (slot.busy && slot.job?.batchId === batchId) {
        this.finishJob(slot, {
          toolCall: slot.job.toolCall,
          toolName: slot.job.toolCall.function.name,
          result: toolErrorResult(slot.job.toolCall.function.name, reason),
          ok: false,
          durationMs: Math.round(performance.now() - slot.job.startedAt),
          error: { name: "AbortError", message: reason },
          aborted: true,
        }, true)
      }
    }
  }

  dispose(): void {
    for (const slot of this.workers) {
      slot.worker.terminate()
    }
    this.workers = []
    this.queue = []
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const slot = this.getIdleSlot()
      if (!slot) return

      const job = this.queue.shift()!
      this.startJob(slot, job)
    }
  }

  private getIdleSlot(): WorkerSlot | null {
    const idle = this.workers.find((slot) => !slot.busy)
    if (idle) return idle

    if (this.workers.length >= this.maxWorkers) return null

    const slot = this.createSlot()
    this.workers.push(slot)
    return slot
  }

  private createSlot(): WorkerSlot {
    const worker = new Worker(resolveWorkerEntry(), { type: "module" })
    const slot: WorkerSlot = { worker, busy: false }

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if (message.type === "rpc_call") {
        void this.handleRpc(slot, message)
        return
      }

      const job = slot.job
      if (!job || job.id !== message.jobId) return

      this.finishJob(slot, {
        toolCall: job.toolCall,
        toolName: job.toolCall.function.name,
        result: message.ok ? message.result : toolErrorResult(job.toolCall.function.name, message.error?.message || "Tool failed"),
        ok: message.ok && !(message.result && typeof message.result === "object" && (message.result as any).error === true),
        durationMs: message.durationMs,
        error: message.error,
      })
    }

    worker.onerror = (event) => {
      const job = slot.job
      if (!job) return

      const location = [event.filename, event.lineno, event.colno].filter(Boolean).join(":")
      const message = location
        ? `${event.message || "Tool worker failed"} (${location})`
        : (event.message || "Tool worker failed")

      this.finishJob(slot, {
        toolCall: job.toolCall,
        toolName: job.toolCall.function.name,
        result: toolErrorResult(job.toolCall.function.name, message),
        ok: false,
        durationMs: Math.round(performance.now() - job.startedAt),
        error: { name: "WorkerError", message },
      }, true)
    }

    return slot
  }

  private startJob(slot: WorkerSlot, job: QueuedJob): void {
    slot.busy = true
    slot.job = job
    job.startedAt = performance.now()
    job.timer = setTimeout(() => {
      if (job.settled) return

      this.finishJob(slot, {
        toolCall: job.toolCall,
        toolName: job.toolCall.function.name,
        result: toolErrorResult(job.toolCall.function.name, `Tool timed out after ${job.timeoutMs}ms`),
        ok: false,
        durationMs: Math.round(performance.now() - job.startedAt),
        error: { name: "TimeoutError", message: `Tool timed out after ${job.timeoutMs}ms` },
        timedOut: true,
      }, true)
    }, job.timeoutMs)

    slot.worker.postMessage({
      type: "run",
      jobId: job.id,
      toolName: job.toolCall.function.name,
      args: job.toolCall.function.arguments,
      toolConfig: job.toolConfig,
      hiveConfig: job.hiveConfig,
      mainThreadToolNames: job.mainThreadToolNames,
    })
  }

  private async handleRpc(
    slot: WorkerSlot,
    message: Extract<WorkerMessage, { type: "rpc_call" }>
  ): Promise<void> {
    const job = slot.job
    if (!job || job.id !== message.jobId || job.settled) return

    try {
      const result = await executeInMainThread({
        toolCall: {
          id: job.toolCall.id,
          function: {
            name: message.toolName,
            arguments: message.args,
          },
        },
        allTools: job.allTools,
        toolConfig: job.toolConfig,
      })
      slot.worker.postMessage({ type: "rpc_result", rpcId: message.rpcId, ok: true, result })
    } catch (error) {
      slot.worker.postMessage({ type: "rpc_result", rpcId: message.rpcId, ok: false, error: serializeError(error) })
    }
  }

  private finishJob(slot: WorkerSlot, result: ToolBatchResult, restart = false): void {
    const job = slot.job
    if (!job || job.settled) return

    job.settled = true
    if (job.timer) clearTimeout(job.timer)
    job.resolve(result)

    if (restart) {
      slot.worker.terminate()
      const index = this.workers.indexOf(slot)
      if (index >= 0) {
        this.workers[index] = this.createSlot()
      }
    } else {
      slot.busy = false
      slot.job = undefined
    }

    this.drain()
  }
}

let sharedPool: ToolWorkerPool | null = null
let sharedPoolSize = 0

function getDefaultMaxWorkers(): number {
  return Math.min(4, Math.max(1, availableParallelism()))
}

function resolveRuntimeConfig(config?: ToolRuntimeConfig): Required<ToolRuntimeConfig> {
  return {
    enabled: config?.enabled ?? true,
    maxWorkers: config?.maxWorkers ?? getDefaultMaxWorkers(),
    toolTimeoutMs: config?.toolTimeoutMs ?? 300000,
    parallelToolCalls: config?.parallelToolCalls ?? true,
  }
}

function getPool(maxWorkers: number): ToolWorkerPool {
  if (!sharedPool || sharedPoolSize !== maxWorkers) {
    sharedPool = new ToolWorkerPool(maxWorkers)
    sharedPoolSize = maxWorkers
  }
  return sharedPool
}

export async function executeToolBatch(options: ExecuteToolBatchOptions): Promise<ToolBatchResult[]> {
  const runtimeConfig = resolveRuntimeConfig(options.workerPool)
  const hiveConfig = options.hiveConfig ?? loadConfig()
  const mainThreadToolNames = [
    ...DEFAULT_MAIN_THREAD_TOOL_NAMES,
    ...(options.mainThreadToolNames ?? []),
  ]

  if (options.signal?.aborted) {
    return options.toolCalls.map((toolCall) => ({
      toolCall,
      toolName: toolCall.function.name,
      result: toolErrorResult(toolCall.function.name, "Tool execution aborted"),
      ok: false,
      durationMs: 0,
      error: { name: "AbortError", message: "Tool execution aborted" },
      aborted: true,
    }))
  }

  if (!runtimeConfig.enabled || !runtimeConfig.parallelToolCalls || options.toolCalls.length <= 1) {
    const results: ToolBatchResult[] = []
    for (const toolCall of options.toolCalls) {
      const startedAt = performance.now()
      const result = await executeInMainThread({
        toolCall,
        allTools: options.allTools,
        toolConfig: options.toolConfig,
      })
      results.push({
        toolCall,
        toolName: toolCall.function.name,
        result,
        ok: !(result && typeof result === "object" && (result as any).error === true),
        durationMs: Math.round(performance.now() - startedAt),
      })
    }
    return results
  }

  const pool = getPool(runtimeConfig.maxWorkers)
  const batchId = crypto.randomUUID()
  const abortHandler = () => pool.abortBatch(batchId, "Tool execution aborted")
  options.signal?.addEventListener("abort", abortHandler, { once: true })

  try {
    const results = await Promise.all(options.toolCalls.map((toolCall, index) => pool.execute({
      id: `${Date.now()}:${index}:${crypto.randomUUID()}`,
      batchId,
      index,
      toolCall,
      allTools: options.allTools,
      toolConfig: options.toolConfig,
      hiveConfig,
      mainThreadToolNames,
      timeoutMs: runtimeConfig.toolTimeoutMs,
    })))

    return results.sort((a, b) => {
      const aIndex = options.toolCalls.indexOf(a.toolCall)
      const bIndex = options.toolCalls.indexOf(b.toolCall)
      return aIndex - bIndex
    })
  } finally {
    options.signal?.removeEventListener("abort", abortHandler)
  }
}

export function shutdownToolRuntime(): void {
  sharedPool?.dispose()
  sharedPool = null
  sharedPoolSize = 0
}
