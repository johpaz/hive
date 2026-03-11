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
