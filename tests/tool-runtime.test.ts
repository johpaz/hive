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
    // Tres tools de 120 ms: en serie serían 360 ms, en paralelo ~120. El umbral
    // separa las dos hipótesis con aire de sobra — el anterior (260 ms) dejaba
    // 20 ms de margen y fallaba en un runner de 2 núcleos por 4 milisegundos,
    // que es ruido de planificación y no una regresión.
    expect(elapsed).toBeLessThan(330)
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

  it("settles in-flight RPC work when the runtime shuts down", async () => {
    const tools: RuntimeTool[] = [
      {
        name: "ExampleServer__slow_live_tool",
        execute: async () => {
          await delay(100)
          return { late: true }
        },
      },
      { name: "other_rpc_tool", execute: async () => ({ ok: true }) },
    ]

    const pending = executeToolBatch({
      toolCalls: [
        toolCall("1", "ExampleServer__slow_live_tool"),
        toolCall("2", "other_rpc_tool"),
      ],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 1, toolTimeoutMs: 1000, parallelToolCalls: true },
    })

    await delay(20)
    shutdownToolRuntime()

    const results = await pending
    expect(results.every((result) => result.aborted)).toBe(true)
  })

  it("routes singleton-backed native tools through main-thread RPC", async () => {
    const executed = new Set<string>()
    const tools: RuntimeTool[] = [
      "search_knowledge",
      "save_note",
      "memory_write",
      "task_status",
      "project_create",
    ].map((name) => ({
      name,
      execute: async () => {
        executed.add(name)
        return { name, mainThread: true }
      },
    }))

    const results = await executeToolBatch({
      toolCalls: [
        toolCall("1", "search_knowledge", { query: "A2UI" }),
        toolCall("2", "save_note", { key: "k", value: "v" }),
        toolCall("3", "memory_write", { key: "m", value: "v" }),
        toolCall("4", "task_status", { task_id: "t1" }),
        toolCall("5", "project_create", { name: "release" }),
      ],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 2, toolTimeoutMs: 1000, parallelToolCalls: true },
    })

    expect(results.every((result) => result.ok)).toBe(true)
    expect(executed).toEqual(new Set(["search_knowledge", "save_note", "memory_write", "task_status", "project_create"]))
    expect(results.map((result) => (result.result as any).mainThread)).toEqual([true, true, true, true, true])
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

  it("sigue sirviendo lotes después de un aborto, sin dejar workers de más", async () => {
    // Un aborto descarta el worker y NO levanta un reemplazo: el siguiente lote
    // es quien lo crea. Antes se recreaba en el acto, y ese worker a medio
    // arrancar —que nadie iba a usar— hacía que Bun se cayera con SIGSEGV al
    // cerrar el proceso (CI: workers_spawned 13, terminated 11).
    const controller = new AbortController()
    const tools: RuntimeTool[] = [
      { name: "slow_one", execute: async () => { await delay(200); return { done: 1 } } },
      { name: "slow_two", execute: async () => { await delay(200); return { done: 2 } } },
      { name: "quick_one", execute: async () => ({ ok: 1 }) },
      { name: "quick_two", execute: async () => ({ ok: 2 }) },
    ]

    setTimeout(() => controller.abort(), 30)
    await executeToolBatch({
      toolCalls: [toolCall("1", "slow_one"), toolCall("2", "slow_two")],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 1, toolTimeoutMs: 1000, parallelToolCalls: true },
      signal: controller.signal,
    })

    const results = await executeToolBatch({
      toolCalls: [toolCall("3", "quick_one"), toolCall("4", "quick_two")],
      allTools: tools,
      toolConfig: {},
      hiveConfig: loadConfig(),
      workerPool: { enabled: true, maxWorkers: 1, toolTimeoutMs: 1000, parallelToolCalls: true },
    })

    expect(results.every((result) => result.ok)).toBe(true)
    expect(results.map((result) => result.toolName)).toEqual(["quick_one", "quick_two"])
  })

  it("passes toolConfig (including agent_id) through to a single tool call's config.configurable", async () => {
    // Single tool call → always the serial/main-thread path (executeToolBatch's
    // `toolCalls.length <= 1` branch) — exactly what task_delegate/agent_create/
    // bus_publish go through. Regression test for a real bug: toolConfig never
    // included agent_id, so config.configurable.agent_id was always undefined
    // inside every tool's execute() (task_delegate's parent-agent lookup always
    // failed as a result — see agent-loop.ts's toolConfig construction).
    let seenConfigurable: Record<string, unknown> | undefined;
    const tools: RuntimeTool[] = [
      {
        name: "whoami",
        execute: async (_params, config) => {
          seenConfigurable = config?.configurable;
          return { ok: true };
        },
      },
    ];

    await executeToolBatch({
      toolCalls: [toolCall("1", "whoami")],
      allTools: tools,
      toolConfig: { agent_id: "bee-coordinator", user_id: "u1", thread_id: "t1", channel: "webchat", workspace: "/tmp/ws" },
      hiveConfig: loadConfig(),
    });

    expect(seenConfigurable?.agent_id).toBe("bee-coordinator");
    expect(seenConfigurable?.user_id).toBe("u1");
    expect(seenConfigurable?.workspace).toBe("/tmp/ws");
  })
})
