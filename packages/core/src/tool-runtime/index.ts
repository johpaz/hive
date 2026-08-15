import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { availableParallelism } from "node:os"
import type { Config } from "../config/loader.ts"
import { loadConfig } from "../config/loader.ts"
import { logger } from "../utils/logger.ts"
import { embeddedToolWorkerPath } from "./embedded-worker.generated.ts"

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
  /** Per-tool timeout (ms) override from the Tool definition. */
  timeoutMs?: number
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
    /** The currently-running agent's own id (agent-loop.ts's opts.agentId) — read by tools that need to know who's calling them (task_delegate's parent lookup, agent_create's parent_id, bus_publish's sender). */
    agent_id?: string
    run_id?: string
    turn_id?: string
    task_id?: string
    session_id?: string
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

let cachedWorkerEntry: string | null | undefined

/**
 * Locate the tool worker entry, or null when this build ships without one.
 *
 * Returning null instead of throwing is deliberate: workers are an
 * optimization, and a packaging gap must never take a whole turn down with it
 * (it did until v1.0.3 — every desktop install failed each multi-tool turn
 * with "Tool worker entry not found"). The caller degrades to the main thread.
 */
function resolveWorkerEntry(): string | null {
  if (cachedWorkerEntry !== undefined) return cachedWorkerEntry

  const candidates = [
    new URL("./tool-worker.js", import.meta.url),
    new URL("./tool-worker.ts", import.meta.url),
    new URL("../packages/core/src/tool-runtime/tool-worker.js", import.meta.url),
    new URL("../packages/core/src/tool-runtime/tool-worker.ts", import.meta.url),
  ]

  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) {
      cachedWorkerEntry = candidate.href
      return cachedWorkerEntry
    }
  }

  const fallbacks: string[] = []
  const envPath = process.env.HIVE_TOOL_WORKER_PATH
  if (envPath) fallbacks.push(envPath)

  try {
    const execDir = dirname(process.execPath)
    fallbacks.push(join(execDir, "tool-worker.js"))
    fallbacks.push(join(execDir, "packages", "core", "src", "tool-runtime", "tool-worker.js"))
  } catch {
    // process.execPath is not available — skip execDir-based fallbacks
  }

  fallbacks.push("/app/tool-worker.js")

  for (const filePath of fallbacks) {
    if (existsSync(filePath)) {
      cachedWorkerEntry = filePath
      return cachedWorkerEntry
    }
  }

  // Standalone executable: the worker was embedded at compile time and lives in
  // the virtual bunfs, where existsSync() reports false — so it is taken on
  // trust. It is only ever set by scripts/build-gateway.ts.
  if (embeddedToolWorkerPath) {
    cachedWorkerEntry = embeddedToolWorkerPath
    return cachedWorkerEntry
  }

  logger.warn(
    "[tool-runtime] No tool worker entry found — running tool batches on the main thread (sequentially)",
    { tried: [...candidates.map((candidate) => fileURLToPath(candidate)), ...fallbacks] }
  )
  cachedWorkerEntry = null
  return null
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
  // These tools depend on process-local singleton state (HiveDB handle, live
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
  "browser_navigate",
  "browser_screenshot",
  "artifact_inspect",
  "artifact_read",
  "browser_click",
  "browser_type",
  "browser_extract",
  "browser_script",
  "browser_wait",
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
  "task_list",
])

async function executeInMainThread(job: {
  toolCall: ToolCallLike
  allTools: RuntimeTool[]
  toolConfig: ExecuteToolBatchOptions["toolConfig"]
  signal?: AbortSignal
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
    return await tool.execute((args ?? {}) as Record<string, unknown>, { configurable: job.toolConfig, signal: job.signal })
  } catch (error) {
    return toolErrorResult(toolName, (error as Error).message)
  }
}

/**
 * Bounds a single tool execution to its own timeout window (per-operation, not
 * an aggregate turn deadline). A slow tool loses its race and yields a normal
 * error result — the underlying promise is left to settle on its own (main-thread
 * tools have no cross-realm handle to kill), but the caller is freed to move on.
 */
export function executeInMainThreadWithTimeout(
  job: { toolCall: ToolCallLike; allTools: RuntimeTool[]; toolConfig: ExecuteToolBatchOptions["toolConfig"]; signal?: AbortSignal },
  timeoutMs: number,
): Promise<unknown> {
  const toolName = job.toolCall.function.name
  return Promise.race([
    executeInMainThread(job),
    new Promise<unknown>((resolve) => {
      setTimeout(() => resolve(toolErrorResult(toolName, `Tool execution timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

class ToolWorkerPool {
  private workers: WorkerSlot[] = []
  private queue: QueuedJob[] = []
  private readonly maxWorkers: number
  private readonly workerEntry: string
  private disposed = false

  constructor(maxWorkers: number, workerEntry: string) {
    this.maxWorkers = Math.max(1, maxWorkers)
    this.workerEntry = workerEntry
  }

  execute(job: Omit<QueuedJob, "resolve" | "settled" | "startedAt">): Promise<ToolBatchResult> {
    return new Promise((resolve) => {
      if (this.disposed) {
        resolve({
          toolCall: job.toolCall,
          toolName: job.toolCall.function.name,
          result: toolErrorResult(job.toolCall.function.name, "Tool runtime shut down"),
          ok: false,
          durationMs: 0,
          error: { name: "AbortError", message: "Tool runtime shut down" },
          aborted: true,
        })
        return
      }
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
    this.disposed = true
    const reason = "Tool runtime shut down"

    for (const job of this.queue) {
      if (job.settled) continue
      job.settled = true
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
    this.queue = []

    for (const slot of this.workers) {
      const job = slot.job
      if (job && !job.settled) {
        job.settled = true
        if (job.timer) clearTimeout(job.timer)
        job.resolve({
          toolCall: job.toolCall,
          toolName: job.toolCall.function.name,
          result: toolErrorResult(job.toolCall.function.name, reason),
          ok: false,
          durationMs: Math.round(performance.now() - job.startedAt),
          error: { name: "AbortError", message: reason },
          aborted: true,
        })
      }
      slot.job = undefined
      slot.busy = false
      slot.worker.terminate()
    }
    this.workers = []
  }

  private drain(): void {
    if (this.disposed) return
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
    const worker = new Worker(this.workerEntry, { type: "module" })
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
    const worker = slot.worker

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
      if (this.disposed || slot.job !== job || job.settled || slot.worker !== worker) return
      worker.postMessage({ type: "rpc_result", rpcId: message.rpcId, ok: true, result })
    } catch (error) {
      if (this.disposed || slot.job !== job || job.settled || slot.worker !== worker) return
      try {
        worker.postMessage({ type: "rpc_result", rpcId: message.rpcId, ok: false, error: serializeError(error) })
      } catch {
        // El worker pudo terminar entre la comprobación y el envío.
      }
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

/**
 * Resolve the effective timeout (ms) for a single tool call.
 * Priority: Tool.timeoutMs → config.tools.timeouts[name] → workerPool.toolTimeoutMs.
 */
function resolveToolTimeout(
  toolName: string,
  allTools: RuntimeTool[],
  hiveConfig: Config,
  baseTimeoutMs: number,
): number {
  // 1. Tool definition timeoutMs (carried on the RuntimeTool via ContextTool cast)
  const def = allTools.find((t) => t.name === toolName)
  if (def?.timeoutMs && def.timeoutMs > 0) return def.timeoutMs
  // 2. config.tools.timeouts[name]
  const cfgOverride = hiveConfig?.tools?.timeouts?.[toolName]
  if (typeof cfgOverride === "number" && cfgOverride > 0) return cfgOverride
  // 3. base (workerPool.toolTimeoutMs)
  return baseTimeoutMs
}

function getPool(maxWorkers: number): ToolWorkerPool | null {
  const workerEntry = resolveWorkerEntry()
  if (!workerEntry) return null

  if (!sharedPool || sharedPoolSize !== maxWorkers) {
    sharedPool = new ToolWorkerPool(maxWorkers, workerEntry)
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

  // A null pool means workers are disabled, unnecessary (single call), or
  // unavailable in this build — all three degrade to the main thread.
  const pool = runtimeConfig.enabled && runtimeConfig.parallelToolCalls && options.toolCalls.length > 1
    ? getPool(runtimeConfig.maxWorkers)
    : null

  if (!pool) {
    const results: ToolBatchResult[] = []
    for (const toolCall of options.toolCalls) {
      const startedAt = performance.now()
      const effectiveTimeout = resolveToolTimeout(
        toolCall.function.name,
        options.allTools,
        hiveConfig,
        runtimeConfig.toolTimeoutMs,
      )
      const result = await executeInMainThreadWithTimeout({
        toolCall,
        allTools: options.allTools,
        toolConfig: options.toolConfig,
        signal: options.signal,
      }, effectiveTimeout)
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
      timeoutMs: resolveToolTimeout(
        toolCall.function.name,
        options.allTools,
        hiveConfig,
        runtimeConfig.toolTimeoutMs,
      ),
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
