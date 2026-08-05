import { col, updateDoc } from "../../storage/hive.ts"
import { getHiveDb } from "../../storage/hivedb.ts"
import type { ModelDoc, AgentDoc, ProviderDoc } from "../../storage/collections.ts"
import { catalogModelKey, wireModelId } from "../../storage/model-id.ts"
import { invalidateModelPricingCache } from "../../storage/usage.ts"
import type { Config } from "../../config/loader.ts"

export async function handleGetModels(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const providerId = url.searchParams.get("provider_id")

  const modelsCol = await col<ModelDoc>("models")
  const entries = providerId
    ? await modelsCol.findBy("provider_id", providerId)
    : await modelsCol.scan({})

  // `wire_id` = el nombre que el provider espera, derivado acá y no en el front:
  // la lista de providers revendedores vive en storage/model-id.ts y no debe
  // duplicarse en la UI.
  const models = entries
    .map(e => ({ ...e.doc, wire_id: wireModelId(e.doc.provider_id, e.doc.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return addCorsHeaders(Response.json({ models }), req)
}

/** Precio opcional: sólo se acepta un número finito >= 0; cualquier otra cosa queda como "sin tarifa". */
function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** `["chat","vision"]` → string JSON; acepta ya-un-string o un array. */
function parseCapabilities(value: unknown): string | null {
  if (!value) return null
  if (typeof value === "string") return value.trim() || null
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : null
  return null
}

export async function handleCreateModel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))

  const providerId = body.provider_id || body.providerId
  const name = body.name
  const modelType = body.model_type || body.modelType || "llm"
  const contextWindow = Number(body.context_window ?? body.contextWindow) || 50000

  if (!name || !providerId) {
    return addCorsHeaders(Response.json({ ok: false, error: "name and provider_id are required" }, { status: 400 }), req)
  }

  // El id del request es el nombre que el provider espera en el cable; la clave
  // de la BD lleva el prefijo del revendedor (igual que el catálogo sembrado).
  const wireId = body.id || name
  const id = catalogModelKey(providerId, wireId)
  const modelsCol = await col<ModelDoc>("models")
  const existing = await modelsCol.get(id)
  if (existing) {
    return addCorsHeaders(Response.json({ ok: false, error: "Model already exists", id, model: existing.doc }, { status: 409 }), req)
  }

  const model: ModelDoc = {
    id, name, provider_id: providerId, model_type: modelType,
    context_window: contextWindow,
    capabilities: parseCapabilities(body.capabilities),
    enabled: true, active: true,
    // "discovered" y no "catalog": un modelo agregado a mano no se puede recrear
    // desde SEED_DATA, así que el wipe del re-seed no debe borrarlo.
    source: "discovered",
    input_per_1m: parsePrice(body.input_per_1m ?? body.inputPer1M),
    output_per_1m: parsePrice(body.output_per_1m ?? body.outputPer1M),
  }
  await modelsCol.put(id, model, { expectedVersion: 0 })
  invalidateModelPricingCache()

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
  // Los providers salen de la BD, no de una lista fija: la que estaba acá se
  // quedó sin nvidia, groq, minimax, qwen, z-ai ni opencode-go, y cada provider
  // nuevo del catálogo habría que acordarse de agregarlo también acá.
  const providersCol = await col<ProviderDoc>("providers")
  const availableProviders = (await providersCol.scan({}))
    .filter(p => (p.doc.category ?? "llm") === "llm")
    .map(p => p.doc.id)
    .sort()

  return addCorsHeaders(Response.json({
    config: config.models || {},
    availableProviders,
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
  invalidateModelPricingCache()
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
  const newName: string | undefined = body.name
  // El id que llega es el nombre de cable; la clave lleva el prefijo del revendedor.
  const newId: string | undefined = body.id
    ? catalogModelKey(existing.doc.provider_id, body.id)
    : undefined

  // Campos de catálogo editables. `undefined` = "no lo mandaron, no lo toques";
  // null en un precio sí es un cambio explícito a "sin tarifa".
  const patch: Partial<ModelDoc> = {}
  if (newName) patch.name = newName
  if (body.model_type ?? body.modelType) patch.model_type = (body.model_type ?? body.modelType) as ModelDoc["model_type"]
  const ctx = Number(body.context_window ?? body.contextWindow)
  if (Number.isFinite(ctx) && ctx > 0) patch.context_window = ctx
  if ("capabilities" in body) patch.capabilities = parseCapabilities(body.capabilities)
  if ("input_per_1m" in body || "inputPer1M" in body) patch.input_per_1m = parsePrice(body.input_per_1m ?? body.inputPer1M)
  if ("output_per_1m" in body || "outputPer1M" in body) patch.output_per_1m = parsePrice(body.output_per_1m ?? body.outputPer1M)

  if (!newId || newId === oldId) {
    await modelsCol.put(oldId, { ...existing.doc, ...patch }, { expectedVersion: existing.version })
    invalidateModelPricingCache()
    const model = (await modelsCol.get(oldId))?.doc
    return addCorsHeaders(Response.json({ ok: true, model }), req)
  }

  // ID is changing — atomically rename the model and re-point every agent
  // that referenced the old id (this is the repo's one "transaction").
  const checkConflict = await modelsCol.get(newId)
  if (checkConflict) {
    return addCorsHeaders(Response.json({ ok: false, error: "Ya existe un modelo con ese ID" }, { status: 409 }), req)
  }

  // El rename arrastra también el resto de campos editados en el mismo submit.
  const newModel: ModelDoc = { ...existing.doc, ...patch, id: newId }

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
  invalidateModelPricingCache()

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
