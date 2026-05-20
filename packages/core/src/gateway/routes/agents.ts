import { getDb } from "../../storage/sqlite"
import { emitCanvas } from "../../canvas/emitter"
import { storeAgentHeaders, deleteAgentSecrets } from "../../storage/crypto"

export async function handleGetAgents(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const typeFilter = url.searchParams.get("type")
  
  let whereClause = ""
  if (typeFilter) {
    whereClause = "WHERE a.status = ?"
  }

  const rows = getDb().query(`
    SELECT a.*, u.notes as user_preferences,
    CASE WHEN a.headers_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_headers
    FROM agents a
    LEFT JOIN users u ON a.user_id = u.id
    ${whereClause}
    ORDER BY a.created_at DESC
  `).all(...(typeFilter ? [typeFilter] : [])) as Record<string, unknown>[]

  const agents = rows.map(row => ({
    // Basic fields
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    tone: row.tone,

    // Role & status
    role: row.role as 'coordinator' | 'worker',
    status: row.status,
    enabled: Boolean(row.enabled),

    // Provider & model
    providerId: row.provider_id,
    modelId: row.model_id,

    // Tools & skills
    toolsJson: row.tools_json,
    skillsJson: row.skills_json,

    // Hierarchy
    parentId: row.parent_id,
    maxIterations: row.max_iterations,

    // Workspace
    workspace: row.workspace,

    // Headers (encrypted)
    hasHeaders: row.has_headers === 1,

    // Timestamps
    createdAt: new Date((row.created_at as number) * 1000).toISOString(),
    updatedAt: new Date((row.updated_at as number) * 1000).toISOString(),

    // Virtual fields (not from DB)
    taskCount: 0,
    successRate: 100,
  }))

  return addCorsHeaders(Response.json({ agents }), req)
}

export async function handleCreateAgent(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  let agentId: string

  if (body.id) {
    agentId = body.id
    getDb().query(`
      INSERT INTO agents(id, name, description, provider_id, model_id, tone, enabled, workspace)
      VALUES(?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      agentId,
      body.name,
      body.description || "",
      body.providerId || "openai",
      body.modelId || "gpt-4o",
      body.tone || "friendly",
      body.workspace || null
    )
  } else {
    const result = getDb().query(`
      INSERT INTO agents(name, description, provider_id, model_id, tone, enabled, workspace)
      VALUES(?, ?, ?, ?, ?, 1, ?)
      RETURNING id
    `).get(
      body.name,
      body.description || "",
      body.providerId || "openai",
      body.modelId || "gpt-4o",
      body.tone || "friendly",
      body.workspace || null
    ) as { id: string } | undefined
    agentId = result?.id || ""
  }

  if (body.headers && agentId) {
    await storeAgentHeaders(agentId, body.headers)
  }

  emitCanvas("canvas:node_add", {
    node: { id: agentId, name: body.name, status: "idle", type: "agent" }
  })

  const agent = getDb().query(`
    SELECT id, name, description, provider_id, model_id, tone, status, enabled, active, created_at, workspace
    FROM agents WHERE id = ?
  `).get(agentId) as Record<string, unknown> | undefined

  if (!agent) {
    return addCorsHeaders(Response.json({ ok: false, error: "Agent not found" }), req)
  }

  return addCorsHeaders(Response.json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      providerId: agent.provider_id,
      modelId: agent.model_id,
      tone: agent.tone,
      status: agent.status,
      enabled: agent.enabled === 1,
      active: agent.active === 1,
      createdAt: new Date((agent.created_at as number) * 1000).toISOString(),
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

  const updates: string[] = []
  const params: unknown[] = []

  // Map: snake_case DB field → camelCase body key
  const fieldMap: Record<string, string> = {
    name:            "name",
    description:     "description",
    provider_id:     "providerId",
    model_id:        "modelId",
    system_prompt:   "systemPrompt",
    status:          "status",
    enabled:         "enabled",
    tone:            "tone",
    workspace:       "workspace",
    role:            "role",
    max_iterations:  "maxIterations",
  }

  for (const [dbField, camelKey] of Object.entries(fieldMap)) {
    const val = body[dbField] !== undefined ? body[dbField] : body[camelKey]
    if (val !== undefined) {
      updates.push(`${dbField} = ?`)
      params.push(typeof val === 'object' ? JSON.stringify(val) : val)
    }
  }

  const agentHeaders = body.headers !== undefined ? body.headers : body.config?.headers
  if (agentHeaders !== undefined) {
    await storeAgentHeaders(agentId, agentHeaders)
  }

  const userPreferences = body.userPreferences !== undefined ? body.userPreferences : body.user_preferences
  if (userPreferences !== undefined) {
    const agentRow = getDb().query("SELECT user_id FROM agents WHERE id = ?").get(agentId) as { user_id: string } | undefined
    if (agentRow?.user_id) {
      getDb().query(`UPDATE users SET notes = ? WHERE id = ?`).run(userPreferences, agentRow.user_id)
    }
  }

  if (updates.length > 0) {
    updates.push("updated_at = unixepoch()")
    params.push(agentId)
    getDb().query(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])

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

  getDb().query(`DELETE FROM agents WHERE id = ?`).run(agentId)
  await deleteAgentSecrets(agentId)

  emitCanvas("canvas:node_remove", { id: agentId })

  return addCorsHeaders(Response.json({ ok: true }), req)
}
