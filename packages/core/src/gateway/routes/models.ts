import { getDb } from "../../storage/sqlite.ts"
import type { Config } from "../../config/loader.ts"

export async function handleGetModels(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const providerId = url.searchParams.get("provider_id")

  let models
  if (providerId) {
    models = getDb().query("SELECT * FROM models WHERE provider_id = ? ORDER BY name").all(providerId)
  } else {
    models = getDb().query("SELECT * FROM models ORDER BY name").all()
  }

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

  const existing = getDb().query("SELECT * FROM models WHERE id = ?").get(id) as any
  if (existing) {
    return addCorsHeaders(Response.json({ ok: false, error: "Model already exists", id, model: existing }, { status: 409 }), req)
  }

  getDb().query(`
    INSERT INTO models(id, name, provider_id, model_type, context_window, enabled, active)
    VALUES(?, ?, ?, ?, ?, 1, 1)
  `).run(id, name, providerId, modelType, contextWindow)

  const model = getDb().query("SELECT * FROM models WHERE id = ?").get(id)
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

  getDb().query(`UPDATE models SET active = ?, enabled = ? WHERE id = ?`).run(active ? 1 : 0, active ? 1 : 0, modelId)

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

  const existing = getDb().query("SELECT * FROM models WHERE id = ?").get(modelId) as any
  if (!existing) {
    return addCorsHeaders(Response.json({ ok: false, error: "Model not found" }, { status: 404 }), req)
  }

  const agents = getDb().query("SELECT id, name FROM agents WHERE model_id = ?").all(modelId) as any[]
  if (agents.length > 0) {
    const names = agents.map(a => a.name).join(", ")
    return addCorsHeaders(Response.json({ ok: false, error: `En uso por agentes: ${names}` }, { status: 409 }), req)
  }

  getDb().query("DELETE FROM models WHERE id = ?").run(modelId)
  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleUpdateModel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/)
  const oldId = pathMatch ? decodeURIComponent(pathMatch[1]) : null

  if (!oldId) {
    return addCorsHeaders(Response.json({ ok: false, error: "model id required" }, { status: 400 }), req)
  }

  const existing = getDb().query("SELECT * FROM models WHERE id = ?").get(oldId) as any
  if (!existing) {
    return addCorsHeaders(Response.json({ ok: false, error: "Model not found" }, { status: 404 }), req)
  }

  const body = await req.json().catch(() => ({}))
  const newId: string | undefined = body.id
  const newName: string | undefined = body.name

  if (!newId || newId === oldId) {
    // Only name change
    const name = newName || existing.name
    getDb().query("UPDATE models SET name = ? WHERE id = ?").run(name, oldId)
    const model = getDb().query("SELECT * FROM models WHERE id = ?").get(oldId)
    return addCorsHeaders(Response.json({ ok: true, model }), req)
  }

  // ID is changing — use a transaction to migrate agents references
  const checkConflict = getDb().query("SELECT id FROM models WHERE id = ?").get(newId) as any
  if (checkConflict) {
    return addCorsHeaders(Response.json({ ok: false, error: "Ya existe un modelo con ese ID" }, { status: 409 }), req)
  }

  const name = newName || existing.name
  getDb().transaction(() => {
    getDb().query(`
      INSERT INTO models(id, name, provider_id, model_type, context_window, capabilities, enabled, active)
      SELECT ?, ?, provider_id, model_type, context_window, capabilities, enabled, active FROM models WHERE id = ?
    `).run(newId, name, oldId)
    getDb().query("UPDATE agents SET model_id = ? WHERE model_id = ?").run(newId, oldId)
    getDb().query("DELETE FROM models WHERE id = ?").run(oldId)
  })()

  const model = getDb().query("SELECT * FROM models WHERE id = ?").get(newId)
  return addCorsHeaders(Response.json({ ok: true, model }), req)
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
