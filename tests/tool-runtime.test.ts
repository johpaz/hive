import { afterEach, describe, expect, it } from "bun:test"
import { executeToolBatch, shutdownToolRuntime, type RuntimeTool, type ToolCallLike } from "../packages/core/src/tool-runtime/index.ts"
import { loadConfig } from "../packages/core/src/config/loader.ts"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function toolCall(id: string, name: string, args: unknown = {}): ToolCallLike {
  return {
    id,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  }
}

describe("tool runtime worker pool", () => {
  afterEach(() => {
    shutdownToolRuntime()
  })

  it("runs multiple tools in parallel through worker scheduling", async () => {
    const tools: RuntimeTool[] = ["slow_a", "slow_b", "slow_c"].map((name) => ({
      name,
      execute: async () => {
        await delay(120)
        return { name }
      },
    }))

    const startedAt = performance.now()
    const results = await executeToolBatch({
      toolCalls: [
        toolCall("1", "slow_a"),
        toolCall("2", "slow_b"),
        toolCall("3", "slow_c"),
      ],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 3, toolTimeoutMs: 1000, parallelToolCalls: true },
    })
    const elapsed = performance.now() - startedAt

    expect(results.map((result) => (result.result as any).name)).toEqual(["slow_a", "slow_b", "slow_c"])
    expect(elapsed).toBeLessThan(260)
  })

  it("preserves input order when tools complete out of order", async () => {
    const tools: RuntimeTool[] = [
      { name: "first", execute: async () => { await delay(120); return { value: 1 } } },
      { name: "second", execute: async () => { await delay(20); return { value: 2 } } },
      { name: "third", execute: async () => { await delay(60); return { value: 3 } } },
    ]

    const results = await executeToolBatch({
      toolCalls: [toolCall("1", "first"), toolCall("2", "second"), toolCall("3", "third")],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 3, toolTimeoutMs: 1000, parallelToolCalls: true },
    })

    expect(results.map((result) => result.toolName)).toEqual(["first", "second", "third"])
    expect(results.map((result) => (result.result as any).value)).toEqual([1, 2, 3])
  })

  it("isolates tool errors without cancelling sibling tools", async () => {
    const tools: RuntimeTool[] = [
      { name: "ok", execute: async () => ({ ok: true }) },
      { name: "fail", execute: async () => { throw new Error("boom") } },
      { name: "also_ok", execute: async () => ({ ok: "also" }) },
    ]

    const results = await executeToolBatch({
      toolCalls: [toolCall("1", "ok"), toolCall("2", "fail"), toolCall("3", "also_ok")],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 3, toolTimeoutMs: 1000, parallelToolCalls: true },
    })

    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect((results[1].result as any).error).toBe(true)
    expect((results[1].result as any).message).toContain("boom")
    expect(results[2].ok).toBe(true)
  })

  it("routes non-reconstructible tools through main-thread RPC", async () => {
    let executedInMainThread = false
    const tools: RuntimeTool[] = [
      {
        name: "ExampleServer__live_tool",
        execute: async (params) => {
          executedInMainThread = true
          return { echoed: params.value }
        },
      },
      {
        name: "other_rpc_tool",
        execute: async () => ({ ok: true }),
      },
    ]

    const results = await executeToolBatch({
      toolCalls: [
        toolCall("1", "ExampleServer__live_tool", { value: "ok" }),
        toolCall("2", "other_rpc_tool"),
      ],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 1, toolTimeoutMs: 1000, parallelToolCalls: true },
    })

    expect(executedInMainThread).toBe(true)
    expect(results[0].ok).toBe(true)
    expect(results[0].result).toEqual({ echoed: "ok" })
  })

  it("routes singleton-backed native tools through main-thread RPC", async () => {
    const executed = new Set<string>()
    const tools: RuntimeTool[] = [
      "search_knowledge",
      "save_note",
      "memory_write",
      "meeting_start",
    ].map((name) => ({
      name,
      execute: async () => {
        executed.add(name)
        return { name, mainThread: true }
      },
    }))

    const results = await executeToolBatch({
      toolCalls: [
        toolCall("1", "search_knowledge", { query: "canvas" }),
        toolCall("2", "save_note", { key: "k", value: "v" }),
        toolCall("3", "memory_write", { key: "m", value: "v" }),
        toolCall("4", "meeting_start", { title: "sync" }),
      ],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 2, toolTimeoutMs: 1000, parallelToolCalls: true },
    })

    expect(results.every((result) => result.ok)).toBe(true)
    expect(executed).toEqual(new Set(["search_knowledge", "save_note", "memory_write", "meeting_start"]))
    expect(results.map((result) => (result.result as any).mainThread)).toEqual([true, true, true, true])
  })

  it("marks timed out tools and keeps completed tools", async () => {
    const tools: RuntimeTool[] = [
      { name: "fast", execute: async () => ({ done: true }) },
      { name: "timeout", execute: async () => { await delay(400); return { late: true } } },
    ]

    const results = await executeToolBatch({
      toolCalls: [toolCall("1", "fast"), toolCall("2", "timeout")],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 2, toolTimeoutMs: 150, parallelToolCalls: true },
    })

    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect(results[1].timedOut).toBe(true)
    expect((results[1].result as any).error).toBe(true)
  })

  it("marks queued and running work as aborted", async () => {
    const controller = new AbortController()
    const tools: RuntimeTool[] = [
      { name: "slow_one", execute: async () => { await delay(200); return { done: 1 } } },
      { name: "slow_two", execute: async () => { await delay(200); return { done: 2 } } },
    ]

    setTimeout(() => controller.abort(), 30)

    const results = await executeToolBatch({
      toolCalls: [toolCall("1", "slow_one"), toolCall("2", "slow_two")],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 1, toolTimeoutMs: 1000, parallelToolCalls: true },
      signal: controller.signal,
    })

    expect(results.every((result) => result.aborted)).toBe(true)
    expect(results.map((result) => result.toolName)).toEqual(["slow_one", "slow_two"])
  })
})
