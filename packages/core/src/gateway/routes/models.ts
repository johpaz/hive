import { col, updateDoc } from "../../storage/hive.ts"
import { getHiveDb } from "../../storage/hivedb.ts"
import type { ModelDoc, AgentDoc } from "../../storage/collections.ts"
import type { Config } from "../../config/loader.ts"

export async function handleGetModels(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const providerId = url.searchParams.get("provider_id")

  const modelsCol = await col<ModelDoc>("models")
  const entries = providerId
    ? await modelsCol.findBy("provider_id", providerId)
    : await modelsCol.scan({})

  const models = entries.map(e => e.doc).sort((a, b) => a.name.localeCompare(b.name))

  return addCorsHeaders(Response.json({ models }), req)
}

export async function handleCreateModel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))

  const providerId = body.provider_id || body.providerId
  const name = body.name
  const modelType = body.model_type || body.modelType || "llm"
  const contextWindow = body.context_window || body.contextWindow || 50000

  if (!name || !providerId) {
    return addCorsHeaders(Response.json({ ok: false, error: "name and provider_id are required" }, { status: 400 }), req)
  }

  const id = body.id || name
  const modelsCol = await col<ModelDoc>("models")
  const existing = await modelsCol.get(id)
  if (existing) {
    return addCorsHeaders(Response.json({ ok: false, error: "Model already exists", id, model: existing.doc }, { status: 409 }), req)
  }

  const model: ModelDoc = {
    id, name, provider_id: providerId, model_type: modelType,
    context_window: contextWindow, capabilities: null, enabled: true, active: true,
  }
  await modelsCol.put(id, model, { expectedVersion: 0 })

  return addCorsHeaders(Response.json({ ok: true, id, model }, { status: 201 }), req)
}

export async function handleToggleModel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  // URL pattern: /api/models/:id/toggle — extract model id from path
  const pathMatch = url.pathname.match(/^\/api\/models\/([^/]+)\/toggle$/)
  const modelId = pathMatch ? decodeURIComponent(pathMatch[1]) : null
  const body = await req.json().catch(() => ({}))
  const { active } = body

  if (!modelId || active === undefined) {
    return addCorsHeaders(Response.json({ success: false, error: "model id and active required" }), req)
  }

  await updateDoc<ModelDoc>("models", modelId, { active: !!active, enabled: !!active }).catch(() => { /* not found */ })

  return addCorsHeaders(Response.json({ success: true, active }), req)
}

export async function handleGetModelsConfig(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  config: Config
): Promise<Response> {
  return addCorsHeaders(Response.json({
    config: config.models || {},
    availableProviders: ["openai", "anthropic", "gemini", "kimi", "ollama", "openrouter", "deepseek"],
  }), req);
}

export async function handleDeleteModel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/)
  const modelId = pathMatch ? decodeURIComponent(pathMatch[1]) : null

  if (!modelId) {
    return addCorsHeaders(Response.json({ ok: false, error: "model id required" }, { status: 400 }), req)
  }

  const modelsCol = await col<ModelDoc>("models")
  const existing = await modelsCol.get(modelId)
  if (!existing) {
    return addCorsHeaders(Response.json({ ok: false, error: "Model not found" }, { status: 404 }), req)
  }

  const agentsCol = await col<AgentDoc>("agents")
  const agents = await agentsCol.findBy("model_id", modelId)
  if (agents.length > 0) {
    const names = agents.map(a => a.doc.name).join(", ")
    return addCorsHeaders(Response.json({ ok: false, error: `En uso por agentes: ${names}` }, { status: 409 }), req)
  }

  await modelsCol.delete(modelId)
  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleUpdateModel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/)
  const oldId = pathMatch ? decodeURIComponent(pathMatch[1]) : null

  if (!oldId) {
    return addCorsHeaders(Response.json({ ok: false, error: "model id required" }, { status: 400 }), req)
  }

  const modelsCol = await col<ModelDoc>("models")
  const existing = await modelsCol.get(oldId)
  if (!existing) {
    return addCorsHeaders(Response.json({ ok: false, error: "Model not found" }, { status: 404 }), req)
  }

  const body = await req.json().catch(() => ({}))
  const newId: string | undefined = body.id
  const newName: string | undefined = body.name

  if (!newId || newId === oldId) {
    // Only name change
    const name = newName || existing.doc.name
    await modelsCol.put(oldId, { ...existing.doc, name }, { expectedVersion: existing.version })
    const model = (await modelsCol.get(oldId))?.doc
    return addCorsHeaders(Response.json({ ok: true, model }), req)
  }

  // ID is changing — atomically rename the model and re-point every agent
  // that referenced the old id (this is the repo's one "transaction").
  const checkConflict = await modelsCol.get(newId)
  if (checkConflict) {
    return addCorsHeaders(Response.json({ ok: false, error: "Ya existe un modelo con ese ID" }, { status: 409 }), req)
  }

  const name = newName || existing.doc.name
  const newModel: ModelDoc = { ...existing.doc, id: newId, name }

  const agentsCol = await col<AgentDoc>("agents")
  const affectedAgents = await agentsCol.findBy("model_id", oldId)

  const db = await getHiveDb()
  await db.batch([
    { op: "put", collection: "models", id: newId, doc: newModel, expectedVersion: 0 },
    { op: "delete", collection: "models", id: oldId },
    ...affectedAgents.map(a => ({
      op: "put" as const, collection: "agents", id: a.id,
      doc: { ...a.doc, model_id: newId }, expectedVersion: a.version,
    })),
  ])

  return addCorsHeaders(Response.json({ ok: true, model: newModel }), req)
}

export async function handleUpdateModelsConfig(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  config: Config,
  agent?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { defaultProvider, defaults, providers } = body;

  config.models = config.models || {};
  if (defaultProvider) config.models.defaultProvider = defaultProvider;
  if (defaults) config.models.defaults = { ...(config.models.defaults || {}), ...defaults };
  if (providers) config.models.providers = { ...(config.models.providers || {}), ...providers };

  if (agent) {
    await agent.updateConfig(config);
  }

  return addCorsHeaders(Response.json({ success: true }), req);
}
