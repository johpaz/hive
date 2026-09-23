import type { LLMMessage, LLMToolDef } from "./llm-client"
import type { SkillDescriptor } from "./skill-selector"
import type { ContextTool } from "./context-compiler"
import type { PlaybookRule } from "./playbook-selector"
import { MINIMAL_TOOLS } from "./minimal-loadout"
import { searchCapabilities } from "./capability-search"
import { mcpToolFullName } from "./tool-selector"
import { askJev, getJevKey, type JevAnswer, type JevQuestion } from "./jev-decisions"
import { col } from "../storage/hive"
import type { AgentDoc, McpServerDoc, McpToolDoc } from "../storage/collections"

export interface JevDecisionMetrics {
  latencyMs: number
  costUsd: number
}

/** "activo": connected now; "disponible": enabled, connects on first use; "apagado": disabled. */
export type JevMcpState = "activo" | "disponible" | "apagado"

export interface JevMcpServer {
  id: string
  name: string
  state: JevMcpState
  tools: number
}

export interface JevSpecialist {
  id: string
  name: string
  description: string
  tools: string[]
  mcp: Array<{ name: string; state: JevMcpState }>
}

/**
 * What the swarm can do right now: every enabled worker (catalog and
 * agent_create alike) with its tools, and every MCP server with its state.
 * Jev routes and selects over this, so it never recommends a specialist whose
 * MCP is off or proposes a tool that is not connected.
 */
export async function describeSwarmCapabilities(
  mcpManager: { getServerTools(key: string): unknown[] | undefined } | null,
  opts: { includeSpecialists: boolean },
): Promise<{ mcpServers: JevMcpServer[]; specialists: JevSpecialist[] }> {
  const servers = (await (await col<McpServerDoc>("mcpServers")).scan({})).map(e => e.doc)
  const mcpServers: JevMcpServer[] = servers.map(server => {
    const tools = mcpManager?.getServerTools(server.id)?.length || mcpManager?.getServerTools(server.name)?.length || 0
    return { id: server.id, name: server.name, tools, state: !server.enabled ? "apagado" : tools > 0 ? "activo" : "disponible" }
  })
  if (!opts.includeSpecialists) return { mcpServers, specialists: [] }

  const byId = new Map(mcpServers.map(s => [s.id, s]))
  const parse = (json: string | null | undefined): string[] => {
    try { return json ? (JSON.parse(json) as unknown[]).map(String) : [] } catch { return [] }
  }
  const specialists = (await (await col<AgentDoc>("agents")).scan({}))
    .map(e => e.doc)
    .filter(a => a.role === "worker" && a.enabled && a.status !== "archived")
    .map(a => ({
      id: a.id,
      name: a.name,
      description: (a.description ?? a.name).slice(0, 200),
      tools: parse(a.tool_allowlist_json).slice(0, 12),
      mcp: parse(a.mcp_server_ids_json).map(id => byId.get(id)).filter((s): s is JevMcpServer => !!s)
        .map(s => ({ name: s.name, state: s.state })),
    }))
  return { mcpServers, specialists }
}

/** One roster line: what the coordinator needs to pick a specialist without calling agent_find. */
export function renderSpecialistLine(s: JevSpecialist): string {
  const mcp = s.mcp.length ? ` · MCP: ${s.mcp.map(m => `${m.name} (${m.state})`).join(", ")}` : ""
  return `- ${s.id} (${s.name})${mcp}`
}

export interface JevContextPlan {
  messages: LLMMessage[]
  tools: LLMToolDef[]
  skills: SkillDescriptor[]
  agentId: string | null
  /**
   * MCP servers the recommended specialist depends on that are off. Non-empty
   * means "this is the right specialist, but the user must turn these on
   * first" — delegating now would hand it a task it cannot do.
   */
  agentMcpOff: string[]
  selectedMessageIds: number[]
  selectedToolNames: string[]
  selectedSkillNames: string[]
  selectedScratchpadKeys: string[]
  selectedPlaybookIds: string[]
  decision: JevDecisionMetrics
}

const excerpt = (value: unknown, max = 450): string =>
  (typeof value === "string" ? value : JSON.stringify(value) ?? "").slice(0, max)
const probability = (answer: JevAnswer | undefined): number | null => answer?.type === "noul" ? answer.noul : null
const MANDATORY_TAIL = 4
/** Below this many characters of prunable tool output, a decision costs more latency than it saves. */
const MIN_PRUNABLE_CHARS = 4000

/** Decisions select only from already authorized, discoverable candidates. */
export async function planJevContext(input: {
  objective: string
  messages: LLMMessage[]
  tools: LLMToolDef[]
  allTools: ContextTool[]
  skills: SkillDescriptor[]
  scratchpadNotes?: Array<{ key: string; value: string }>
  playbookRules?: PlaybookRule[]
  isWorker: boolean
  /** From describeSwarmCapabilities; absent means "unknown", not "none". */
  swarm?: { mcpServers: JevMcpServer[]; specialists: JevSpecialist[] }
}): Promise<JevContextPlan | null> {
  if (!await getJevKey().catch(() => null)) return null
  const { objective, messages, tools, allTools, skills, isWorker } = input
  const mandatoryMessages = new Set<number>()
  // The last two exchanges carry the thread's immediate referents ("hazlo otra
  // vez", "el anterior"); dropping them sent the model into conversation_read loops.
  for (let i = Math.max(0, messages.length - MANDATORY_TAIL); i < messages.length; i++) mandatoryMessages.add(i)
  messages.forEach((message, i) => {
    if (Array.isArray(message.content) || (typeof message.content === "string" && message.content.startsWith("<hive:internal_event"))) mandatoryMessages.add(i)
  })

  const candidateMessageIds = messages.map((_, i) => i).filter(i => !mandatoryMessages.has(i))
  let candidateTools: ContextTool[] = tools.filter(t => !MINIMAL_TOOLS.has(t.function.name))
    .map(t => allTools.find(a => a.name === t.function.name))
    .filter((t): t is ContextTool => !!t)
  try {
    const hits = await searchCapabilities(objective, { types: ["tool", "mcp"], k: 12 })
    // allTools only holds MCP tools of servers that are enabled, connected and
    // allowed for this agent — resolving through it is what keeps a dormant or
    // foreign server's tools out of the plan.
    const available = new Map(allTools.map(t => [t.name, t]))
    const mcpTools = await col<McpToolDoc>("mcpTools")
    const names = await Promise.all(hits.map(async h => {
      if (h.type !== "mcp") return h.rawId
      const tool = (await mcpTools.get(h.rawId))?.doc
      return tool ? mcpToolFullName(tool.server_name, tool.tool_name) : null
    }))
    const discovered = names.map(n => n ? available.get(n) : undefined).filter((t): t is ContextTool => !!t && !MINIMAL_TOOLS.has(t.name))
    candidateTools = [...new Map([...candidateTools, ...discovered].map(t => [t.name, t])).values()].slice(0, 24)
  } catch { /* index unavailable: retain the current loadout */ }

  const optionalSkills = skills.filter(s => s.active && s.body).slice(0, 8)
  const scratchpadNotes = (input.scratchpadNotes ?? []).slice(-16)
  const playbookRules = (input.playbookRules ?? []).slice(0, 8)
  // Specialists with an MCP off stay eligible: Jev still names the right one,
  // and the coordinator asks the user to turn the server on instead of
  // delegating a task the specialist cannot do yet.
  const agents = isWorker ? [] : (input.swarm?.specialists ?? []).slice(0, 16)
  const questions: Record<string, JevQuestion> = {}
  for (const i of candidateMessageIds) questions[`history_${i}`] = { type: "noul", instructions: `Is earlier conversation item ${i} necessary to complete the current objective?` }
  for (const tool of candidateTools) questions[`tool_${tool.name}`] = { type: "noul", instructions: `Will tool ${tool.name} likely be needed for the current objective?` }
  for (const skill of optionalSkills) questions[`skill_${skill.id}`] = { type: "noul", instructions: `Are instructions from skill ${skill.name} needed for the current objective?` }
  for (const note of scratchpadNotes) questions[`note_${note.key}`] = { type: "noul", instructions: `Is scratchpad note ${note.key} needed for the current objective?` }
  for (const rule of playbookRules) questions[`rule_${rule.id}`] = { type: "noul", instructions: `Does playbook rule ${rule.id} apply to the current objective?` }
  if (agents.length) questions.agent = {
    type: "choice", instructions: "Which existing specialist should handle a bounded part of this objective, or should the coordinator handle it?",
    criteria: {
      coordinator: "No bounded specialist task is needed",
      ...Object.fromEntries(agents.map(a => [a.id, [
        a.description,
        a.tools.length ? `tools: ${a.tools.join(", ")}` : "",
        a.mcp.length ? `MCP: ${a.mcp.map(m => `${m.name} (${m.state})`).join(", ")}` : "",
      ].filter(Boolean).join(" · ").slice(0, 400)])),
    },
  }
  const decision = await askJev({
    objective: objective.slice(0, 3500),
    history: candidateMessageIds.map(i => ({ id: i, role: messages[i].role, content: excerpt(messages[i].content) })),
    tools: candidateTools.map(t => ({ name: t.name, description: t.description.slice(0, 240) })),
    skills: optionalSkills.map(s => ({ id: s.id, name: s.name, description: s.description.slice(0, 240) })),
    notes: scratchpadNotes.map(n => ({ key: n.key, value: n.value.slice(0, 350) })),
    rules: playbookRules.map(r => ({ id: r.id, rule: r.rule.slice(0, 350) })),
    mcp_servers: (input.swarm?.mcpServers ?? []).map(s => ({ name: s.name, state: s.state, tools: s.tools })),
  }, questions)
  if (!decision) return null

  const selected = new Set(messages.map((_, i) => i).filter(i => mandatoryMessages.has(i) ||
    !candidateMessageIds.includes(i) || (probability(decision.answers[`history_${i}`]) ?? 1) >= 0.35))
  // A reply travels with the user turn it answered: Gemini silently drops a
  // model turn that has no preceding user turn.
  for (const i of [...selected]) {
    if (messages[i].role !== "assistant") continue
    for (let j = i - 1; j >= 0; j--) if (messages[j].role === "user") { selected.add(j); break }
  }
  const selectedMessageIds = [...selected].sort((a, b) => a - b)
  const selectedToolNames = candidateTools.filter(t => (probability(decision.answers[`tool_${t.name}`]) ?? 1) >= 0.35).map(t => t.name)
  const selectedSkills = optionalSkills.filter(s => (probability(decision.answers[`skill_${s.id}`]) ?? 1) >= 0.35)
  const toolMap = new Map(allTools.map(t => [t.name, t]))
  const selectedNames = new Set(selectedToolNames)
  const candidateNames = new Set(candidateTools.map(t => t.name))
  const combinedTools = tools.filter(t => !candidateNames.has(t.function.name) || selectedNames.has(t.function.name))
  for (const name of selectedToolNames) {
    const tool = toolMap.get(name)
    if (tool && !combinedTools.some(t => t.function.name === name)) combinedTools.push({
      type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })
  }
  const agentAnswer = decision.answers.agent
  const agentId = agentAnswer?.type === "choice" && agentAnswer.confidence >= 0.7 && agentAnswer.choice !== "coordinator"
    ? agentAnswer.choice : null
  const agentMcpOff = agents.find(a => a.id === agentId)?.mcp.filter(m => m.state === "apagado").map(m => m.name) ?? []
  return {
    messages: selectedMessageIds.map(i => messages[i]), tools: combinedTools,
    skills: selectedSkills, agentId, agentMcpOff, selectedMessageIds, selectedToolNames,
    selectedSkillNames: selectedSkills.map(s => s.name),
    selectedScratchpadKeys: scratchpadNotes.filter(n => (probability(decision.answers[`note_${n.key}`]) ?? 1) >= 0.35).map(n => n.key),
    selectedPlaybookIds: playbookRules.filter(r => (probability(decision.answers[`rule_${r.id}`]) ?? 1) >= 0.35).map(r => r.id),
    decision: { latencyMs: decision.latencyMs, costUsd: decision.costUsd },
  }
}

/**
 * Only independent reads, or separate delegated tasks, may execute concurrently.
 * null leaves the batch to the runtime default; `decision` is present only when Jev was asked.
 */
export async function jevWantsParallel(calls: Array<{ function: { name: string; arguments: unknown } }>): Promise<{ parallel: boolean; decision?: JevDecisionMetrics } | null> {
  if (calls.length < 2) return null
  if (!await getJevKey().catch(() => null)) return null
  const names = calls.map(c => c.function.name)
  const readOnly = names.every(n => /^(fs_read|fs_list|fs_glob|fs_exists|web_search|web_fetch|memory_read|memory_search|artifact_read|artifact_inspect|task_status|agent_find)$/.test(n))
  const delegated = names.every(n => n === "task_delegate")
  if (!readOnly && !delegated) return { parallel: false }
  if (delegated) {
    const ids = calls.map(call => {
      try {
        const args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments
        return String(args?.worker_id ?? "")
      } catch { return "" }
    })
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) return { parallel: false }
    const agentsCol = await col<AgentDoc>("agents")
    const agents = await Promise.all(ids.map(id => agentsCol.get(id)))
    const workspaces = agents.map(row => row?.doc.workspace)
    if (workspaces.some(path => !path) || new Set(workspaces).size !== workspaces.length) return { parallel: false }
  }
  const result = await askJev({ calls: calls.map(c => ({ tool: c.function.name, arguments: excerpt(c.function.arguments, 700) })) }, {
    independent: { type: "noul", instructions: "Can every listed operation run concurrently without needing the result of another listed operation?" },
  })
  const answer = result?.answers.independent
  return result && answer?.type === "noul"
    ? { parallel: answer.noul >= 0.8, decision: { latencyMs: result.latencyMs, costUsd: result.costUsd } }
    : null
}

export async function planJevIteration(input: {
  objective: string
  messages: LLMMessage[]
  tools: LLMToolDef[]
}): Promise<{ messages: LLMMessage[]; tools: LLMToolDef[]; action: string; omittedResults: number; decision: JevDecisionMetrics } | null> {
  const toolIndices = input.messages.map((m, i) => m.role === "tool" ? i : -1).filter(i => i >= 0)
  if (!toolIndices.length) return null
  const older = toolIndices.slice(0, -1).slice(-8)
  const prunableChars = older.reduce((sum, i) => sum + excerpt(input.messages[i].content, Infinity).length, 0)
  if (prunableChars < MIN_PRUNABLE_CHARS) return null
  const questions: Record<string, JevQuestion> = {
    action: {
      type: "choice",
      instructions: "What capability should the text model use next to complete the current objective?",
      criteria: {
        continue: "Continue reasoning with currently available tools",
        delegate: "Formulate a bounded task for an existing specialist",
        discover: "Discover another tool or skill before continuing",
        finish: "The evidence is sufficient to compose the final answer without more tools",
      },
    },
  }
  for (const i of older) questions[`result_${i}`] = {
    type: "noul", instructions: `Is result ${i} still needed to complete the current objective?`,
  }
  const result = await askJev({
    objective: input.objective.slice(0, 2800),
    results: toolIndices.slice(-9).map(i => ({ id: i, tool: input.messages[i].name, content: excerpt(input.messages[i].content, 650) })),
  }, questions)
  if (!result) return null
  const omitted = new Set(older.filter(i => (probability(result.answers[`result_${i}`]) ?? 1) < 0.35))
  const projected = input.messages.map((m, i) => omitted.has(i)
    ? { ...m, content: "[Previous tool result omitted from this call]" } : m)
  const answer = result.answers.action
  const latestResult = input.messages[toolIndices[toolIndices.length - 1]]
  const resultFailed = typeof latestResult.content === "string" && (latestResult.content.startsWith("[Tool Error]") || latestResult.content.includes('"error":true'))
  const proposedAction = answer?.type === "choice" && answer.confidence >= (answer.choice === "finish" ? 0.85 : 0.7) ? answer.choice : "continue"
  const action = proposedAction === "finish" && resultFailed ? "continue" : proposedAction
  let tools = input.tools
  if (action === "finish") tools = []
  else if (action === "delegate") tools = tools.filter(t => ["task_delegate", "agent_find", "search_knowledge"].includes(t.function.name))
  else if (action === "discover") tools = tools.filter(t => t.function.name === "search_knowledge")
  const decision = { latencyMs: result.latencyMs, costUsd: result.costUsd }
  if (action !== "finish" && tools.length === 0) return { messages: projected, tools: input.tools, action: "continue", omittedResults: omitted.size, decision }
  return { messages: projected, tools, action, omittedResults: omitted.size, decision }
}
