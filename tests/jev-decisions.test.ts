process.env.HIVE_DB_PATH = ":memory:"

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap"
import { closeHiveDb } from "../packages/core/src/storage/hivedb"
import { col } from "../packages/core/src/storage/hive"
import { storeProviderApiKey } from "../packages/core/src/storage/crypto"
import type { ProviderDoc, UsageRecordDoc } from "../packages/core/src/storage/collections"
import { askJev, emitJevDecision, getJevKey, getJevStatus, resetJevStatus } from "../packages/core/src/agent/jev-decisions"
import { getUsageStats } from "../packages/core/src/storage/usage"
import { executeToolBatch } from "../packages/core/src/tool-runtime"
import { describeSwarmCapabilities, planJevContext, planJevIteration } from "../packages/core/src/agent/jev-planner"
import { toIndexable } from "../packages/core/src/storage/hive"
import type { AgentDoc, McpServerDoc } from "../packages/core/src/storage/collections"
import { handleUpdateProvider } from "../packages/core/src/gateway/routes/providers"
import { addMessage, saveScratchpadNote } from "../packages/core/src/agent/conversation-store"
import { conversationReadTool } from "../packages/core/src/tools/core"

const provider: ProviderDoc = {
  id: "openrouter", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1",
  category: "llm", enabled: true, active: true, num_ctx: null, num_gpu: -1, created_at: 1,
}

beforeEach(async () => {
  closeHiveDb()
  await ensureHiveDb()
  await (await col<ProviderDoc>("providers")).put("openrouter", provider)
  await storeProviderApiKey("openrouter", "test-openrouter-key")
  resetJevStatus()
})

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
  closeHiveDb()
})

describe("Jev decision plane", () => {
  test("uses the OpenRouter Decisions endpoint and validates bounded answers", async () => {
    let requested = false
    const result = await askJev({ message: "route this" }, {
      route: { type: "choice", instructions: "Choose", criteria: { files: "File task", web: "Web task" } },
    }, { fetcher: (async (url, init) => {
      requested = true
      expect(url).toBe("https://openrouter.ai/api/alpha/decisions")
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-openrouter-key")
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe("typesafe/jev-1.13")
      return Response.json({ answers: { route: { type: "choice", choice: "files", confidence: 0.9, probabilities: { files: 0.9, web: 0.1 } } }, usage: { input_tokens: 120, output_tokens: 0, cost: 0.00000504 } })
    }) as unknown as typeof fetch })
    expect(requested).toBe(true)
    expect(result?.answers.route).toMatchObject({ choice: "files" })
    expect((await getJevStatus()).state).toBe("ready")
    const records = await col<UsageRecordDoc>("usageRecords")
    for (let attempt = 0; attempt < 20 && !(await records.scan({})).length; attempt++) await Bun.sleep(5)
    expect((await records.scan({}))[0]?.doc.cost_usd).toBeCloseTo(0.00000504, 10)
  })

  test("falls back for invalid answers and when OpenRouter is disabled", async () => {
    const invalid = await askJev("task", {
      route: { type: "choice", instructions: "Choose", criteria: { files: "File task" } },
    }, { fetcher: (async () => Response.json({ answers: { route: { type: "choice", choice: "unknown", confidence: 1 } } })) as unknown as typeof fetch })
    expect(invalid).toBeNull()
    expect((await getJevStatus()).state).toBe("fallback")

    await (await col<ProviderDoc>("providers")).put("openrouter", { ...provider, active: false })
    expect(await getJevKey()).toBeNull()
    expect((await getJevStatus()).state).toBe("off")
  })

  test("removing the stored key returns to the legacy path", async () => {
    delete process.env.OPENROUTER_API_KEY
    const request = new Request("http://localhost/api/providers/openrouter", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clearApiKey: true }),
    })
    const response = await handleUpdateProvider(request, result => result)
    expect(response.status).toBe(200)
    expect(await getJevKey()).toBeNull()
  })

  test("saving an OpenRouter key activates Jev immediately", async () => {
    await (await col<ProviderDoc>("providers")).put("openrouter", { ...provider, active: false, enabled: false })
    expect(await getJevKey()).toBeNull()
    const request = new Request("http://localhost/api/providers/openrouter", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "replacement-test-key" }),
    })
    const response = await handleUpdateProvider(request, result => result)
    expect(response.status).toBe(200)
    expect((await (await col<ProviderDoc>("providers")).get("openrouter"))?.doc.active).toBe(true)
    expect(await getJevKey()).toBe("replacement-test-key")
    expect((await getJevStatus()).state).toBe("ready")
  })

  test("keeps the active conversation and filters optional history and tools", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, value]) => {
        const question = value as { type: string }
        return [id, question.type === "choice"
          ? { type: "choice", choice: "coordinator", confidence: 0.95, probabilities: { coordinator: 0.95 } }
          : { type: "noul", noul: id === "tool_fs_read" ? 0.99 : 0.01 }]
      }))
      return Response.json({ answers, usage: { input_tokens: 0, output_tokens: 0 } })
    }) as unknown as typeof fetch
    try {
      const messages = [
        { role: "user" as const, content: "old topic" },
        { role: "assistant" as const, content: "old reply" },
        { role: "user" as const, content: "previous request" },
        { role: "assistant" as const, content: "previous answer" },
        { role: "user" as const, content: "read the report" },
        { role: "assistant" as const, content: "I will inspect it" },
      ]
      const readTool = { type: "function" as const, function: { name: "fs_read", description: "Read a file", parameters: { type: "object" } } }
      const plan = await planJevContext({
        objective: "read the report", messages, tools: [readTool],
        allTools: [{ name: "fs_read", description: "Read a file", parameters: { type: "object" } }],
        skills: [], isWorker: true,
      })
      expect(plan?.messages).toEqual(messages.slice(-4))
      expect(plan?.tools.map(t => t.function.name)).toContain("fs_read")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("keeps a selected reply together with the user turn it answered", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      const answers = Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: "noul", noul: id === "history_1" ? 0.9 : 0.01 }]))
      return Response.json({ answers, usage: { input_tokens: 0, output_tokens: 0 } })
    }) as unknown as typeof fetch
    try {
      const messages = [
        { role: "user" as const, content: "build the dashboard" },
        { role: "assistant" as const, content: "dashboard published" },
        { role: "user" as const, content: "unrelated" },
        { role: "assistant" as const, content: "unrelated reply" },
        { role: "user" as const, content: "more" },
        { role: "assistant" as const, content: "more reply" },
        { role: "user" as const, content: "publish it again" },
        { role: "assistant" as const, content: "on it" },
      ]
      const plan = await planJevContext({ objective: "publish it again", messages, tools: [], allTools: [], skills: [], isWorker: true })
      expect(plan?.selectedMessageIds).toEqual([0, 1, 4, 5, 6, 7])
      expect(plan?.messages[0].role).toBe("user")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("skips the iteration decision when there is little tool output to prune", async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => { calls++; return Response.json({}) }) as unknown as typeof fetch
    try {
      const plan = await planJevIteration({
        objective: "find the agent",
        messages: [
          { role: "user", content: "find the agent" },
          { role: "tool", name: "agent_find", content: "ok: true" },
          { role: "tool", name: "agent_find", content: "ok: true" },
        ],
        tools: [],
      })
      expect(plan).toBeNull()
      expect(calls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("persists decisions for the dashboard, pricing savings at the advised model", async () => {
    emitJevDecision({ agentId: "bee", kind: "context", summary: "3/15 mensajes", savedTokens: 10_000, latencyMs: 300, costUsd: 0.0001, provider: "kimi", model: "kimi-k2.6" })
    emitJevDecision({ agentId: "a2ui_builder", kind: "iteration", summary: "continuar", savedTokens: -1_000, latencyMs: 250, costUsd: 0.00002, provider: "kimi", model: "kimi-k2.6" })
    let jev = (await getUsageStats(1)).jev
    for (let attempt = 0; attempt < 40 && jev.decisions < 2; attempt++) {
      await Bun.sleep(5)
      jev = (await getUsageStats(1)).jev
    }
    expect(jev.decisions).toBe(2)
    expect(jev.costUsd).toBeCloseTo(0.00012, 10)
    expect(jev.savedTokens).toBe(9_000)
    // Kimi K2.6 input costs $0.60 per 1M tokens; the negative decision counts against the saving.
    expect(jev.savedCostUsd).toBeCloseTo(9_000 * 0.6 / 1_000_000, 10)
    expect(jev.byAgent.bee).toMatchObject({ decisions: 1, savedTokens: 10_000 })
    expect(jev.byAgent.a2ui_builder.savedTokens).toBe(-1_000)
  })

  test("maps every enabled specialist and the real state of each MCP server", async () => {
    const servers = await col<McpServerDoc>("mcpServers")
    const server = (id: string, enabled: boolean) => ({
      id, name: id, transport: "stdio", command: "x", args: null, url: null, enabled, active: enabled,
      builtin: false, status: "idle", tools_count: 1,
    }) as unknown as McpServerDoc
    await servers.put("email", server("email", true))
    await servers.put("crm", server("crm", true))
    await servers.put("legacy", server("legacy", false))
    const agents = await col<AgentDoc>("agents")
    const worker = (id: string, mcp: string[], extra: Partial<AgentDoc> = {}) => ({
      id, user_id: "u", name: id, description: `${id} work`, system_prompt: null, tone: null, role: "worker",
      status: "idle", enabled: true, provider_id: toIndexable(null), model_id: toIndexable(null), tools_json: null,
      skills_json: null, parent_id: toIndexable(null), max_iterations: 5, workspace: null, lastTraceAt: null,
      created_at: 1, updated_at: 1, mcp_server_ids_json: JSON.stringify(mcp), ...extra,
    }) as AgentDoc
    await agents.put("mailer", worker("mailer", ["email"]))
    await agents.put("seller", worker("seller", ["crm"], { source: "catalog", tool_allowlist_json: JSON.stringify(["crm_search"]) }))
    await agents.put("old", worker("old", ["legacy"]))
    await agents.put("off", worker("off", [], { enabled: false }))

    // Only "email" has live tools in the manager right now.
    const manager = { getServerTools: (key: string) => key === "email" ? [{}, {}] : undefined }
    const swarm = await describeSwarmCapabilities(manager, { includeSpecialists: true })

    expect(swarm.mcpServers.find(s => s.name === "email")).toMatchObject({ state: "activo", tools: 2 })
    expect(swarm.mcpServers.find(s => s.name === "crm")?.state).toBe("disponible")
    expect(swarm.mcpServers.find(s => s.name === "legacy")?.state).toBe("apagado")
    // agent_create workers count, not only catalog ones; disabled ones do not.
    const ids = swarm.specialists.map(s => s.id)
    expect(ids).toEqual(expect.arrayContaining(["mailer", "old", "seller"]))
    expect(ids).not.toContain("off")
    expect(swarm.specialists.find(s => s.id === "seller")?.tools).toEqual(["crm_search"])

    let criteria: Record<string, string> = {}
    let state: { mcp_servers?: unknown[] } = {}
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      criteria = body.questions.agent?.criteria ?? {}
      state = body.state
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id,
        (q as { type: string }).type === "choice"
          ? { type: "choice", choice: "old", confidence: 0.9, probabilities: { old: 0.9 } }
          : { type: "noul", noul: 0.9 }]))
      return Response.json({ answers, usage: { input_tokens: 0, output_tokens: 0 } })
    }) as unknown as typeof fetch
    let plan: Awaited<ReturnType<typeof planJevContext>> = null
    try {
      plan = await planJevContext({ objective: "migrate the legacy records", messages: [], tools: [], allTools: [], skills: [], isWorker: false, swarm })
    } finally {
      globalThis.fetch = originalFetch
    }
    // A specialist whose MCP is off stays eligible, marked as such...
    expect(Object.keys(criteria)).toEqual(expect.arrayContaining(["coordinator", "mailer", "seller", "old"]))
    expect(criteria.old).toContain("MCP: legacy (apagado)")
    expect(criteria.mailer).toContain("MCP: email (activo)")
    expect(state.mcp_servers).toHaveLength(3)
    // ...and when it is the right one, the plan says what must be turned on
    // so the coordinator asks the user instead of delegating.
    expect(plan?.agentId).toBe("old")
    expect(plan?.agentMcpOff).toEqual(["legacy"])
  })

  test("runs a safe batch concurrently only when Jev requests it", async () => {
    const seen: string[] = []
    const tools = ["first", "second"].map(name => ({
      name,
      execute: async () => { seen.push(`start:${name}`); await Bun.sleep(15); seen.push(`end:${name}`); return name },
    }))
    const toolCalls = tools.map((tool, i) => ({ id: String(i), function: { name: tool.name, arguments: "{}" } }))
    await executeToolBatch({ toolCalls, allTools: tools, toolConfig: {}, workerPool: { enabled: false }, parallelToolCalls: true })
    expect(seen).toEqual(["start:first", "start:second", "end:first", "end:second"])
    seen.length = 0
    await executeToolBatch({ toolCalls, allTools: tools, toolConfig: {}, workerPool: { enabled: false }, parallelToolCalls: false })
    expect(seen).toEqual(["start:first", "end:first", "start:second", "end:second"])
  })

  test("recovers only messages from the current thread", async () => {
    const messageId = await addMessage("thread-a", "user", "My invoice number is 314")
    await saveScratchpadNote("thread-a", "invoice", "314", "agent")
    await addMessage("thread-b", "user", "Private unrelated message")
    const result = await conversationReadTool.execute({ message_ids: [messageId] }, { configurable: { thread_id: "thread-a" } }) as { ok: boolean; messages: Array<{ id: number; role: string; source: string; content: string }> }
    expect(result.ok).toBe(true)
    expect(result.messages).toEqual([{ id: messageId, role: "user", source: "message", content: "My invoice number is 314" }])
    const denied = await conversationReadTool.execute({ query: "Private" }, { configurable: { thread_id: "thread-a" } }) as { messages: unknown[] }
    expect(denied.messages).toEqual([])
    const note = await conversationReadTool.execute({ note_keys: ["invoice"] }, { configurable: { thread_id: "thread-a" } }) as { notes: unknown[] }
    expect(note.notes).toEqual([{ key: "invoice", value: "314" }])
  })
})
