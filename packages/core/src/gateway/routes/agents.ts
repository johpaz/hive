import { col, updateDoc, toIndexable, fromIndexable } from "../../storage/hive"
import type { AgentDoc, UserDoc } from "../../storage/collections"
import { emitCanvas } from "../../canvas/emitter"
import { storeAgentHeaders, deleteAgentSecrets } from "../../storage/crypto"
import { getDefaultLLM } from "../../agent/llm-client"

export async function handleGetAgents(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const typeFilter = url.searchParams.get("type")

  const agentsCol = await col<AgentDoc>("agents")
  const usersCol = await col<UserDoc>("users")

  const rows = typeFilter
    ? await agentsCol.findBy("status", typeFilter)
    : await agentsCol.scan({})

  const sorted = [...rows].sort((a, b) => b.doc.created_at - a.doc.created_at)

  const agents = await Promise.all(sorted.map(async (row) => {
    const user = await usersCol.get(row.doc.user_id)
    return {
      // Basic fields
      id: row.doc.id,
      userId: row.doc.user_id,
      name: row.doc.name,
      description: row.doc.description,
      systemPrompt: row.doc.system_prompt,
      tone: row.doc.tone,

      // Role & status
      role: row.doc.role,
      status: row.doc.status,
      enabled: row.doc.enabled,

      // Provider & model
      providerId: fromIndexable(row.doc.provider_id),
      modelId: fromIndexable(row.doc.model_id),

      // Tools & skills
      toolsJson: row.doc.tools_json,
      skillsJson: row.doc.skills_json,

      // Hierarchy
      parentId: fromIndexable(row.doc.parent_id),
      maxIterations: row.doc.max_iterations,

      // Workspace
      workspace: row.doc.workspace,

      // User preferences (denormalized from users for the settings UI)
      userPreferences: user?.doc.notes ?? null,

      // Headers (encrypted) — presence check happens via the crypto layer now
      hasHeaders: false,

      // Timestamps
      createdAt: new Date(row.doc.created_at * 1000).toISOString(),
      updatedAt: new Date(row.doc.updated_at * 1000).toISOString(),

      // Virtual fields (not from DB)
      taskCount: 0,
      successRate: 100,
    }
  }))

  return addCorsHeaders(Response.json({ agents }), req)
}

export async function handleCreateAgent(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const agentsCol = await col<AgentDoc>("agents")

  // Default provider/model from the DB when the request doesn't specify one
  const defaultLLM = (!body.providerId || !body.modelId) ? await getDefaultLLM() : null
  const providerId = body.providerId || defaultLLM?.provider || null
  const modelId = body.modelId || defaultLLM?.model || null

  const agentId: string = body.id || crypto.randomUUID().replace(/-/g, "")
  const now = Date.now()
  const existing = await agentsCol.get(agentId)

  const agent: AgentDoc = {
    id: agentId,
    user_id: existing?.doc.user_id ?? "",
    name: body.name,
    description: body.description || "",
    system_prompt: existing?.doc.system_prompt ?? null,
    tone: body.tone || "friendly",
    role: existing?.doc.role ?? "coordinator",
    status: existing?.doc.status ?? "idle",
    enabled: true,
    provider_id: toIndexable(providerId),
    model_id: toIndexable(modelId),
    tools_json: existing?.doc.tools_json ?? null,
    skills_json: existing?.doc.skills_json ?? null,
    parent_id: existing?.doc.parent_id ?? toIndexable(null),
    max_iterations: existing?.doc.max_iterations ?? 10,
    workspace: body.workspace || null,
    lastTraceAt: existing?.doc.lastTraceAt ?? null,
    created_at: existing?.doc.created_at ?? now,
    updated_at: now,
  }
  await agentsCol.put(agentId, agent, existing ? { expectedVersion: existing.version } : undefined)

  if (body.headers && agentId) {
    await storeAgentHeaders(agentId, body.headers)
  }

  emitCanvas("canvas:node_add", {
    node: { id: agentId, name: body.name, status: "idle", type: "agent" }
  })

  return addCorsHeaders(Response.json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      providerId: fromIndexable(agent.provider_id),
      modelId: fromIndexable(agent.model_id),
      tone: agent.tone,
      status: agent.status,
      enabled: agent.enabled,
      active: true,
      createdAt: new Date(agent.created_at * 1000).toISOString(),
      workspace: agent.workspace,
    }
  }), req)
}

export async function handleUpdateAgent(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const agentId = url.pathname.split("/").pop()

  if (!agentId) {
    return addCorsHeaders(new Response("Missing ID", { status: 400 }), req)
  }

  const body = await req.json().catch(() => ({}))
  const agentsCol = await col<AgentDoc>("agents")
  const existing = await agentsCol.get(agentId)
  if (!existing) {
    return addCorsHeaders(new Response("Agent not found", { status: 404 }), req)
  }

  const patch: Partial<AgentDoc> = {}

  // Map: doc field → camelCase body key
  const fieldMap: Record<keyof AgentDoc, string> = {
    name: "name", description: "description", provider_id: "providerId", model_id: "modelId",
    system_prompt: "systemPrompt", status: "status", enabled: "enabled", tone: "tone",
    workspace: "workspace", role: "role", max_iterations: "maxIterations",
  } as any

  for (const [docField, camelKey] of Object.entries(fieldMap) as Array<[keyof AgentDoc, string]>) {
    const val = (body as any)[docField] !== undefined ? (body as any)[docField] : (body as any)[camelKey]
    if (val === undefined) continue
    if (docField === "provider_id" || docField === "model_id" || docField === "parent_id") {
      (patch as any)[docField] = toIndexable(val)
    } else {
      (patch as any)[docField] = typeof val === "object" ? JSON.stringify(val) : val
    }
  }

  const agentHeaders = body.headers !== undefined ? body.headers : body.config?.headers
  if (agentHeaders !== undefined) {
    await storeAgentHeaders(agentId, agentHeaders)
  }

  const userPreferences = body.userPreferences !== undefined ? body.userPreferences : body.user_preferences
  if (userPreferences !== undefined && existing.doc.user_id) {
    await updateDoc<UserDoc>("users", existing.doc.user_id, { notes: userPreferences }).catch(() => { /* user not found */ })
  }

  if (Object.keys(patch).length > 0) {
    await agentsCol.put(agentId, { ...existing.doc, ...patch, updated_at: Date.now() }, { expectedVersion: existing.version })
    emitCanvas("canvas:node_update", { id: agentId, updates: body })
  }

  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleDeleteAgent(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const agentId = url.pathname.split("/").pop()

  if (!agentId) {
    return addCorsHeaders(new Response("Missing ID", { status: 400 }), req)
  }

  const agentsCol = await col<AgentDoc>("agents")
  await agentsCol.delete(agentId)
  await deleteAgentSecrets(agentId)

  emitCanvas("canvas:node_remove", { id: agentId })

  return addCorsHeaders(Response.json({ ok: true }), req)
}
