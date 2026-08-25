import { col, updateDoc, updateManyByIndex } from "../../storage/hive"
import type { ProviderDoc, ModelDoc, AgentDoc } from "../../storage/collections"
import { catalogModelKey, wireModelId } from "../../storage/model-id"
import {
  maskApiKey,
  loadProviderApiKey, storeProviderApiKey,
  loadProviderHeaders, storeProviderHeaders,
} from "../../storage/crypto"
import { loadHiveAgentsModel, getHiveAgentsModelStatus } from "../../agent/llm-providers/hiveagents"
import { logger } from "../../utils/logger"

const log = logger.child("gateway")

export async function handleGetProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const providersCol = await col<ProviderDoc>("providers")
  const modelsCol = await col<ModelDoc>("models")
  const rawProviders = await providersCol.scan({})
  const modelsRows = await modelsCol.scan({})

  const modelsByProvider: Record<string, Record<string, unknown>[]> = {}
  for (const m of modelsRows) {
    const pid = m.doc.provider_id
    if (!modelsByProvider[pid]) modelsByProvider[pid] = []
    modelsByProvider[pid].push({ ...m.doc, provider_id: pid, wire_id: wireModelId(pid, m.doc.id) })
  }

  const providers = await Promise.all(rawProviders.map(async (p) => {
    const apiKey = await loadProviderApiKey(p.doc.id)
    const headers = await loadProviderHeaders(p.doc.id)
    const providerModels = modelsByProvider[p.doc.id] || []
    return {
      id: p.doc.id,
      name: p.doc.name,
      base_url: p.doc.base_url,
      category: p.doc.category ?? "llm",
      enabled: p.doc.enabled,
      active: p.doc.active,
      num_ctx: p.doc.num_ctx ?? null,
      has_api_key: apiKey ? 1 : 0,
      has_headers: Object.keys(headers).length > 0 ? 1 : 0,
      masked_api_key: apiKey ? maskApiKey(apiKey) : null,
      models: providerModels,
    }
  }))

  return addCorsHeaders(Response.json({ providers }), req)
}

export async function handleCreateProvider(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const providersCol = await col<ProviderDoc>("providers")
  const existing = await providersCol.get(body.id)

  await providersCol.put(body.id, {
    id: body.id, name: body.name, base_url: body.base_url || null,
    category: existing?.doc.category ?? "llm",
    num_ctx: existing?.doc.num_ctx ?? null, num_gpu: existing?.doc.num_gpu ?? -1,
    enabled: body.enabled !== undefined ? !!body.enabled : true,
    active: true,
    created_at: existing?.doc.created_at ?? Date.now(),
  }, existing ? { expectedVersion: existing.version } : undefined)

  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleToggleProvider(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const providerId = url.pathname.split("/")[3]
  const body = await req.json().catch(() => ({}))
  const { active } = body

  if (active === undefined) {
    return addCorsHeaders(new Response("Missing active field", { status: 400 }), req)
  }

  await updateDoc<ProviderDoc>("providers", providerId, { active: !!active, enabled: !!active })

  // Cascade: activate/deactivate all models for this provider
  await updateManyByIndex<ModelDoc>("models", "provider_id", providerId, { active: !!active, enabled: !!active })

  return addCorsHeaders(Response.json({ success: true, active }), req)
}

export async function handleUpdateProvider(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const providerIdMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/)

  if (!providerIdMatch) {
    return addCorsHeaders(new Response("Invalid path", { status: 400 }), req)
  }

  const id = providerIdMatch[1]
  const body = await req.json().catch(() => ({}))
  const patch: Partial<ProviderDoc> = {}

  if (body.name) patch.name = body.name
  const baseUrl = body.base_url !== undefined ? body.base_url : body.baseUrl
  if (baseUrl !== undefined) patch.base_url = baseUrl || null
  if (body.enabled !== undefined) patch.enabled = !!body.enabled
  if (body.active !== undefined) patch.active = !!body.active
  if (body.config?.apiKey || body.apiKey) {
    await storeProviderApiKey(id, body.config?.apiKey || body.apiKey)
  }
  if (body.headers) {
    await storeProviderHeaders(id, body.headers)
  }
  const numCtx = body.num_ctx !== undefined ? body.num_ctx : body.numCtx
  if (numCtx !== undefined) patch.num_ctx = numCtx ? Number(numCtx) : null

  if (Object.keys(patch).length > 0) {
    await updateDoc<ProviderDoc>("providers", id, patch).catch(() => { /* provider not found */ })

    // Cascade active/enabled changes to models
    if (patch.active !== undefined) {
      await updateManyByIndex<ModelDoc>("models", "provider_id", id, { active: patch.active, enabled: patch.active })
    } else if (patch.enabled !== undefined) {
      await updateManyByIndex<ModelDoc>("models", "provider_id", id, { enabled: patch.enabled, active: patch.enabled })
    }
  }

  return addCorsHeaders(Response.json({ ok: true }), req)
}

/**
 * Pregunta al provider qué modelos sirve hoy. NO escribe en la BD: la usan tanto
 * el sync como el explorador del formulario de alta.
 *
 * El `base_url` guardado ya incluye el segmento de versión
 * (`.../v1`, `.../api/paas/v4`), así que sólo se le cuelga `/models`. La versión
 * anterior recortaba `/v1` para volver a agregarlo, lo que funcionaba de casualidad
 * en los `/v1` y armaba `/api/paas/v4/v1/models` en los demás.
 */
// Una sola forma en vez de una unión discriminada: el proyecto compila sin
// `strictNullChecks`, y sin él TS no estrecha `if (!result.ok)`.
interface DiscoveryResult {
  names: string[]
  error?: string
  /** Código HTTP a devolver cuando `error` está presente. */
  status?: number
}

export async function fetchProviderModelNames(
  providerId: string,
  baseUrl: string | null
): Promise<DiscoveryResult> {
  if (providerId === "ollama") {
    const host = (baseUrl || "http://localhost:11434").replace(/\/+$/, "").replace(/\/(v1|api)$/, "")
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return { names: [], error: `Ollama responded ${res.status}`, status: 502 }
    const data = await res.json() as { models: Array<{ name: string }> }
    return { names: (data.models || []).map(m => m.name) }
  }

  if (!baseUrl) {
    return { names: [], error: `El provider "${providerId}" no tiene base_url configurada.`, status: 400 }
  }

  // Se manda la key si el provider tiene una: hay endpoints cuyo listado es
  // público (ModelScope, NVIDIA) y otros que devuelven 401 sin autenticar
  // (DashScope), donde sin esto el explorador de modelos no servía.
  const apiKey = await loadProviderApiKey(providerId).catch(() => null)
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers,
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return { names: [], error: `${providerId} responded ${res.status}`, status: 502 }
  const data = await res.json() as { data: Array<{ id: string }> }
  return { names: (data.data || []).map(m => m.id) }
}

/**
 * GET /api/providers/:id/available-models — sólo lectura.
 * El sync persiste TODO lo que devuelve el provider (102 modelos en NVIDIA), que
 * no es lo que quieres al explorar para agregar uno: acá se devuelve la lista y el
 * usuario elige.
 */
export async function handleGetProviderAvailableModels(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  providerId: string
): Promise<Response> {
  const providersCol = await col<ProviderDoc>("providers")
  const providerEntry = await providersCol.get(providerId)
  if (!providerEntry) {
    return addCorsHeaders(Response.json({ error: "Provider not found" }, { status: 404 }), req)
  }

  try {
    const result = await fetchProviderModelNames(providerId, providerEntry.doc.base_url)
    if (result.error) {
      return addCorsHeaders(Response.json({ error: result.error }, { status: result.status }), req)
    }

    // Qué ya está agregado, para que la UI lo marque en vez de duplicarlo.
    const modelsCol = await col<ModelDoc>("models")
    const existing = new Set((await modelsCol.findBy("provider_id", providerId)).map(m => m.id))

    const models = result.names.map(name => ({
      wire_id: name,
      id: catalogModelKey(providerId, name),
      already_added: existing.has(catalogModelKey(providerId, name)),
    })).sort((a, b) => a.wire_id.localeCompare(b.wire_id))

    return addCorsHeaders(Response.json({ models }), req)
  } catch (err) {
    return addCorsHeaders(Response.json({
      error: `No se pudo consultar ${providerId}: ${(err as Error).message}`,
    }, { status: 502 }), req)
  }
}

export async function handleSyncProviderModels(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  providerId: string
): Promise<Response> {
  const providersCol = await col<ProviderDoc>("providers")
  const modelsCol = await col<ModelDoc>("models")
  const providerEntry = await providersCol.get(providerId)

  if (!providerEntry) {
    return addCorsHeaders(new Response("Provider not found", { status: 404 }), req)
  }

  try {
    const discovered = await fetchProviderModelNames(providerId, providerEntry.doc.base_url)
    if (discovered.error) {
      return addCorsHeaders(Response.json({ error: discovered.error }, { status: discovered.status }), req)
    }
    const modelNames = discovered.names

    if (modelNames.length === 0) {
      return addCorsHeaders(Response.json({ error: "No models found from provider" }, { status: 400 }), req)
    }

    // Los ids se guardan con la clave de catálogo (prefijada en los providers
    // revendedores) para que dos servicios que sirvan el mismo modelo no se
    // pisen la fila.
    const discoveredKeys = new Set(modelNames.map(n => catalogModelKey(providerId, n)))
    for (const name of modelNames) {
      const key = catalogModelKey(providerId, name)
      const existing = await modelsCol.get(key)
      await modelsCol.put(key, {
        id: key, provider_id: providerId, name,
        model_type: existing?.doc.model_type ?? "llm",
        context_window: existing?.doc.context_window ?? 32768,
        capabilities: existing?.doc.capabilities ?? null,
        enabled: true, active: true,
        source: existing?.doc.source ?? "discovered",
        input_per_1m: existing?.doc.input_per_1m ?? null,
        output_per_1m: existing?.doc.output_per_1m ?? null,
      }, existing ? { expectedVersion: existing.version } : undefined)
    }

    // Disable models that are no longer present
    const existingModels = await modelsCol.findBy("provider_id", providerId)
    for (const row of existingModels) {
      if (!discoveredKeys.has(row.id)) {
        await modelsCol.put(row.id, { ...row.doc, active: false, enabled: false }, { expectedVersion: row.version })
      }
    }

    // Se devuelve el doc completo: recortar los campos dejaba a la UI sin
    // context_window ni precio justo después de sincronizar.
    const models = (await modelsCol.findBy("provider_id", providerId)).map(m => m.doc)

    return addCorsHeaders(Response.json({
      success: true,
      synced: modelNames.length,
      models
    }), req)
  } catch (err: unknown) {
    const errorMsg = (err as Error).message
    const hint = providerId === "ollama"
      ? "Could not connect to Ollama"
      : `Could not connect to provider: ${errorMsg}`
    return addCorsHeaders(Response.json({
      error: `${hint}: ${errorMsg}`
    }, { status: 502 }), req)
  }
}

export async function handleLoadHiveAgentsModel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const modelId = body.model_id || body.modelId
  if (!modelId) {
    return addCorsHeaders(Response.json({ error: "model_id is required" }, { status: 400 }), req)
  }

  let ctx = typeof body.ctx === "number" && body.ctx > 0 ? body.ctx : undefined
  if (!ctx) {
    const modelsCol = await col<ModelDoc>("models")
    const modelEntry = await modelsCol.get(modelId as string)
    // The model's own context_window (BD) is the source of truth for how much
    // context to request when mounting it — never a hardcoded fallback.
    ctx = modelEntry?.doc.context_window || 50000
  }

  const providersCol = await col<ProviderDoc>("providers")
  const providerEntry = await providersCol.get("hiveagents")
  if (!providerEntry) {
    return addCorsHeaders(Response.json({ error: "Provider not found" }, { status: 404 }), req)
  }

  const apiKey = await loadProviderApiKey("hiveagents")
  if (!apiKey) {
    return addCorsHeaders(Response.json({ error: "API key not configured for hiveagents" }, { status: 400 }), req)
  }

  const baseUrl = providerEntry.doc.base_url ?? undefined
  log.info(`[gateway] Loading hiveagents model ${modelId} with ctx=${ctx} via ${baseUrl || "https://llm.hiveagents.io"}`)

  const result = await loadHiveAgentsModel(modelId as string, apiKey, baseUrl, ctx)
  if (!result.success) {
    log.error(`[gateway] Failed to load hiveagents model ${modelId}: ${result.error}`)
    return addCorsHeaders(Response.json({ error: result.error }, { status: 502 }), req)
  }
  const isLoading = (result as any).loading === true
  log.info(`[gateway] hiveagents load request accepted for ${modelId} with ctx=${ctx}${isLoading ? " (timeout/backend still loading)" : ""}`)
  return addCorsHeaders(Response.json({ success: true, loading: isLoading, model_id: modelId, ctx }), req)
}

export async function handleGetHiveAgentsModelStatus(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const providersCol = await col<ProviderDoc>("providers")
  const providerEntry = await providersCol.get("hiveagents")
  if (!providerEntry) {
    return addCorsHeaders(Response.json({ error: "Provider not found" }, { status: 404 }), req)
  }

  const apiKey = await loadProviderApiKey("hiveagents")
  if (!apiKey) {
    return addCorsHeaders(Response.json({ error: "API key not configured for hiveagents" }, { status: 400 }), req)
  }

  const status = await getHiveAgentsModelStatus(apiKey, providerEntry.doc.base_url ?? undefined)
  return addCorsHeaders(Response.json({ success: true, ...status }), req)
}
