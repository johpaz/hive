import { writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { col } from "../../storage/hive"
import type { ProviderDoc, ModelDoc, EthicsDoc } from "../../storage/collections"
import {
  initOnboardingDb,
  saveUserProfile,
  saveAgentConfig,
  saveProviderConfig,
  activateChannel,
  activateEthics,
} from "../../storage/onboarding"
import { normalizeUserEmail } from "../../storage/user-email"
import { catalogModelKey, wireModelId } from "../../storage/model-id"
import { getHiveDir } from "../../config/loader"
import type { Config } from "../../config/loader"
import { logger } from "../../utils/logger"

const log = logger.child("setup")

export async function handleSetupProviders(
  addCorsHeaders: (response: Response, request: Request) => Response,
  req: Request
): Promise<Response> {
  // Provider + model list from the DB (seeded at startup). Only text (llm) providers.
  const providersCol = await col<ProviderDoc>("providers")
  const modelsCol = await col<ModelDoc>("models")
  const providers = (await providersCol.scan({})).map(e => e.doc).filter(p => p.category === "llm")
  const models = (await modelsCol.scan({})).map(e => e.doc).filter(m => m.model_type === "llm")

  const llmModelsByProvider = new Map<string, { id: string; name: string; context_window: number }[]>()
  for (const model of models) {
    if (!llmModelsByProvider.has(model.provider_id)) {
      llmModelsByProvider.set(model.provider_id, [])
    }
    llmModelsByProvider.get(model.provider_id)!.push({ id: model.id, name: model.name, context_window: model.context_window })
  }

  const result = providers
    .filter(p => llmModelsByProvider.has(p.id) || p.id === "ollama")
    .map(p => ({
      id: p.id,
      name: p.name,
      models: llmModelsByProvider.get(p.id) ?? [],
    }))

  return addCorsHeaders(Response.json(result), req)
}

export async function handleSetupEthics(
  addCorsHeaders: (response: Response, request: Request) => Response,
  req: Request
): Promise<Response> {
  try {
    const ethicsCol = await col<EthicsDoc>("ethics")
    const ethics = (await ethicsCol.scan({})).map(e => e.doc).sort((a, b) => a.id.localeCompare(b.id))

    return addCorsHeaders(Response.json(
      ethics.map(e => ({
        id: e.id,
        name: e.name,
        description: e.description,
        content: e.content,
        isDefault: e.is_default,
        active: e.active,
      }))
    ), req)
  } catch (error) {
    return addCorsHeaders(
      Response.json({ error: (error as Error).message }, { status: 500 }),
      req
    )
  }
}

/** GET /api/setup/ollama-models — public
 *  Queries the local Ollama instance for installed models.
 *  Used during setup to auto-populate the model selector.
 */
export async function handleSetupOllamaModels(
  addCorsHeaders: (response: Response, request: Request) => Response,
  req: Request
): Promise<Response> {
  const base = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/(v1|api)\/?$/, "")
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      return addCorsHeaders(Response.json({ models: [], error: `Ollama respondió ${res.status}` }), req)
    }
    const data = await res.json() as { models?: Array<{ name: string }> }
    const detected = data.models ?? []

    // Persist detected models into the DB so they can be FK-referenced by agents
    try {
      const modelsCol = await col<ModelDoc>("models")
      for (const m of detected) {
        const key = catalogModelKey("ollama", m.name)
        if (!(await modelsCol.get(key))) {
          await modelsCol.put(key, {
            id: key, name: m.name, provider_id: "ollama", model_type: "llm",
            context_window: 0, capabilities: null, enabled: true, active: false,
            source: "discovered",
            // Local: siempre gratis, no "precio desconocido".
            input_per_1m: 0, output_per_1m: 0,
          }, { expectedVersion: 0 })
        }
      }
    } catch { /* DB may not be initialized yet during early setup — ignore */ }

    const models = detected.map(m => ({ id: m.name, name: m.name }))
    return addCorsHeaders(Response.json({ models }), req)
  } catch {
    return addCorsHeaders(Response.json({ models: [], error: "Ollama no disponible en localhost:11434" }), req)
  }
}

async function isSetupMode(): Promise<boolean> {
  try {
    const usersCol = await col<import("../../storage/collections").UserDoc>("users")
    const userCount = await usersCol.count()
    if (userCount === 0) return true
    // Also require a coordinator agent — setup may have failed mid-way after creating the user
    const agentsCol = await col<import("../../storage/collections").AgentDoc>("agents")
    const coordinatorCount = (await agentsCol.findBy("role", "coordinator")).length
    return coordinatorCount === 0
  } catch {
    return true
  }
}

export async function handleSetupStatus(): Promise<Response> {
  const setupMode = await isSetupMode()
  return Response.json({
    configured: !setupMode,
    setupMode,
  })
}

/**
 * Providers OpenAI-compatibles que no necesitan un branch propio acá: el request
 * es idéntico y sólo cambia el host, que sale de `providers.base_url` en la BD.
 * Si el usuario apunta uno a un proxy propio, la verificación usa ese endpoint y
 * no uno fijo en el código.
 */
const OPENAI_COMPAT_PING = new Set(["z-ai", "minimax", "qwen", "opencode-go"])

/**
 * Providers cuyo GET /models es público (no exige Authorization) — NVIDIA y
 * ModelScope responden 200 con dummy key, así que ese endpoint sólo sirve para
 * descubrir un modelo vivo, no para validar la key. Para eso se prueba una
 * completion real con el primer modelo de ese mismo listado (nunca uno
 * retirado, porque sale del catálogo vivo y no del seed) y se juzga la key por
 * el status de esa respuesta.
 */
const PUBLIC_MODEL_LIST = new Set(["nvidia", "modelscope"])

/** base_url del provider tal como está en la BD. */
async function providerBaseUrl(providerId: string): Promise<string | null> {
  try {
    const providersCol = await col<ProviderDoc>("providers")
    return (await providersCol.get(providerId))?.doc.base_url ?? null
  } catch {
    return null
  }
}

export async function handleVerifyProvider(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { provider } = body
  // Trim: un \n o espacio colgado del copy-paste (típico al pegar desde un
  // .txt o la terminal) es invisible en el input pero hace que `fetch()`
  // explote al armar el header `Authorization: Bearer <key>` — antes de
  // mandar nada, con un error críptico del runtime en vez de un 401 claro.
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : body.apiKey

  if (!provider || !apiKey) {
    return Response.json({
      success: false,
      error: "Provider and API key are required",
    }, { status: 400 })
  }

  try {
    // Verificación por listado de modelos (GET, sin costo) en vez de armar una
    // completion real con un modelo "de prueba" adivinado del catálogo. Ese
    // enfoque anterior fallaba con key válida cuando el modelo elegido estaba
    // retirado (NVIDIA da 410 Gone en modelos de baja) o el provider exigía un
    // parámetro distinto para ese modelo puntual (p.ej. modelos de razonamiento
    // de OpenAI que rechazan `max_tokens`). El dashboard (agregar/editar
    // provider) nunca tuvo este problema porque sólo lista modelos — acá se
    // alinea a lo mismo, y de paso deja de gastar tokens en cada click de
    // "Verificar".
    let testUrl: string | null = null
    let headers: Record<string, string> = {}

    if (provider === "ollama") {
      const ollamaUrl = process.env.OLLAMA_HOST || "http://localhost:11434"
      try {
        const response = await fetch(`${ollamaUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        })
        return Response.json({
          success: response.ok,
          error: response.ok ? null : `Could not connect to Ollama at ${ollamaUrl}`,
        })
      } catch {
        return Response.json({
          success: false,
          error: `Could not connect to Ollama at ${ollamaUrl}`,
        })
      }
    }

    if (provider === "anthropic") {
      testUrl = "https://api.anthropic.com/v1/models"
      headers = {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      }
    } else if (provider === "openai") {
      testUrl = "https://api.openai.com/v1/models"
      headers = { "Authorization": `Bearer ${apiKey}` }
    } else if (provider === "gemini") {
      testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    } else if (provider === "groq") {
      testUrl = "https://api.groq.com/openai/v1/models"
      headers = { "Authorization": `Bearer ${apiKey}` }
    } else if (provider === "openrouter") {
      // /api/v1/models es público y responde 200 sin auth — no sirve para
      // validar la key. /api/v1/key sí la exige.
      testUrl = "https://openrouter.ai/api/v1/key"
      headers = { "Authorization": `Bearer ${apiKey}` }
    } else if (provider === "mistral") {
      testUrl = "https://api.mistral.ai/v1/models"
      headers = { "Authorization": `Bearer ${apiKey}` }
    } else if (provider === "deepseek") {
      testUrl = "https://api.deepseek.com/v1/models"
      headers = { "Authorization": `Bearer ${apiKey}` }
    } else if (provider === "kimi") {
      testUrl = "https://api.moonshot.ai/v1/models"
      headers = { "Authorization": `Bearer ${apiKey}` }
    } else if (PUBLIC_MODEL_LIST.has(provider)) {
      const baseUrl = (await providerBaseUrl(provider))?.replace(/\/+$/, "")
      if (!baseUrl) {
        return Response.json({
          success: false,
          error: `El provider "${provider}" no tiene base_url configurada. Agrégala en su configuración.`,
        })
      }
      // Modelos que ya verificamos manualmente como chat/tool-calling en el
      // seed (storage/seed.ts) — van primero porque son los que más chance
      // tienen de estar habilitados para la cuenta. El listado público de
      // NVIDIA mezcla chat con embeddings/rerank (p.ej. `baai/bge-m3`), que
      // jamás van a responder en /chat/completions sea cual sea la key.
      let curatedModels: string[] = []
      try {
        const modelsCol = await col<ModelDoc>("models")
        curatedModels = (await modelsCol.findBy("provider_id", provider))
          .filter(e => e.doc.model_type === "llm")
          .map(e => wireModelId(provider, e.doc.id))
      } catch { /* DB puede no estar lista en early setup — se sigue con el catálogo vivo */ }

      let liveModels: string[] = []
      try {
        const listRes = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(10000) })
        const listData = await listRes.json() as { data?: Array<{ id: string }> }
        const NON_CHAT = /embed|rerank|bge|colbert|clip|e5-|gte-|whisper|tts|guard/i
        liveModels = (listData.data ?? [])
          .map(m => m.id)
          .filter(id => id && !NON_CHAT.test(id))
      } catch { /* liveModels queda vacío, se sigue con lo curado si hay */ }

      const candidates = [...new Set([...curatedModels, ...liveModels])].slice(0, 6)
      if (candidates.length === 0) {
        return Response.json({
          success: false,
          error: `No se pudo obtener el catálogo de modelos de "${provider}" para probar la key.`,
        })
      }
      // El catálogo público de NVIDIA lista modelos que no siempre están
      // habilitados para la cuenta puntual (404 "Function not found for
      // account" aunque la key sea válida) — se prueban varios candidatos y
      // sólo un 401/403 real se toma como key inválida. Cualquier otro error
      // (404, 410, etc.) pasa al siguiente candidato.
      let lastStatus = 0
      let lastBody = ""
      for (const candidate of candidates) {
        const pingRes = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: candidate,
            max_tokens: 10,
            messages: [{ role: "user", content: "Say 'ok' if you can read this." }],
          }),
          signal: AbortSignal.timeout(10000),
        })
        if (pingRes.ok) return Response.json({ success: true, error: null })
        lastStatus = pingRes.status
        lastBody = (await pingRes.text()).slice(0, 300)
        if (pingRes.status === 401 || pingRes.status === 403) break // key inválida, no tiene sentido seguir probando
        log.warn(`verify-provider ${provider}: modelo=${candidate} status=${pingRes.status} body=${lastBody} — probando siguiente candidato`)
      }
      log.warn(`verify-provider ${provider} falló tras ${candidates.length} candidato(s): último status=${lastStatus} body=${lastBody}`)
      return Response.json({
        success: false,
        error: `API error: ${lastStatus}`,
      })
    } else if (OPENAI_COMPAT_PING.has(provider)) {
      // Resto de providers OpenAI-compatibles: mismo shape de request, sólo
      // cambia el host. Sin esto, verificar su API key devolvía "Unsupported
      // provider" aunque el provider funcionara perfectamente.
      // Host sale de la BD; no hay catálogo fijo acá.
      const baseUrl = (await providerBaseUrl(provider))?.replace(/\/+$/, "")
      if (!baseUrl) {
        return Response.json({
          success: false,
          error: `El provider "${provider}" no tiene base_url configurada. Agrégala en su configuración.`,
        })
      }
      testUrl = `${baseUrl}/models`
      headers = { "Authorization": `Bearer ${apiKey}` }
    }

    if (provider === "hiveagents") {
      const hiveUrl = (process.env.HIVEAGENTS_BASE_URL || "https://llm.hiveagents.io").replace(/\/+$/, "")
      try {
        const response = await fetch(`${hiveUrl}/api/status`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        })
        const invalidKey = response.status === 401 || response.status === 403
        return Response.json({
          success: response.ok,
          error: response.ok
            ? null
            : invalidKey
              ? "Invalid API key for HiveAgents"
              : `HiveAgents backend error: ${response.status}`,
        })
      } catch {
        return Response.json({
          success: false,
          error: `Could not connect to HiveAgents at ${hiveUrl}`,
        })
      }
    }

    if (!testUrl) {
      return Response.json({
        success: false,
        error: "Unsupported provider",
      }, { status: 400 })
    }

    const response = await fetch(testUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      log.warn(`verify-provider ${provider} falló: url=${testUrl} status=${response.status} body=${(await response.text()).slice(0, 300)}`)
    }

    return Response.json({
      success: response.ok,
      error: response.ok ? null : `API error: ${response.status}`,
    })
  } catch (error) {
    const message = (error as Error).message
    log.warn(`verify-provider ${provider} excepción: ${message}`)
    // fetch() rechaza el request antes de mandarlo si el header Authorization
    // trae un carácter inválido (control chars, no-ASCII) — pasa con keys
    // pegadas con basura invisible en el medio, no sólo al final.
    const isHeaderError = /header/i.test(message) && /invalid/i.test(message)
    return Response.json({
      success: false,
      error: isHeaderError
        ? "La API key tiene caracteres inválidos (revisa que no tenga saltos de línea o espacios raros al copiarla)."
        : `Connection error: ${message}`,
    })
  }
}

export async function handleCompleteSetup(
  req: Request,
  config: Config,
  addCorsHeaders: (response: Response, request: Request) => Response
): Promise<Response> {
  if (!(await isSetupMode())) {
    return addCorsHeaders(Response.json({
      success: false,
      error: "Setup already completed. Use config endpoints to modify settings.",
    }, { status: 400 }), req)
  }

  const body = await req.json().catch(() => ({}))
  let userEmail: string
  try {
    userEmail = normalizeUserEmail(body.userEmail)
  } catch (error) {
    return addCorsHeaders(Response.json({
      success: false,
      error: (error as Error).message,
    }, { status: 400 }), req)
  }

  // Re-check after the async boundary — a concurrent request may have
  // completed setup while we were awaiting the request body.
  if (!(await isSetupMode())) {
    return addCorsHeaders(Response.json({
      success: false,
      error: "Setup already completed. Use config endpoints to modify settings.",
    }, { status: 400 }), req)
  }

  try {
    // Clean up any partial setup state (user created but setup didn't finish).
    // This is the only reachable cascade-delete case in the app: an
    // interrupted setup run, before any agent/channel/etc. exists yet, so a
    // simple per-collection cleanup (not a generic cascade engine) is enough.
    try {
      const { col } = await import("../../storage/hive")
      const usersCol = await col<import("../../storage/collections").UserDoc>("users")
      const agentsCol = await col<import("../../storage/collections").AgentDoc>("agents")
      const userCount = await usersCol.count()
      const coordinatorCount = (await agentsCol.findBy("role", "coordinator")).length
      if (userCount > 0 && coordinatorCount === 0) {
        const identitiesCol = await col<import("../../storage/collections").UserIdentityDoc>("userIdentities")
        const progressCol = await col<import("../../storage/collections").OnboardingProgressDoc>("onboardingProgress")
        for (const u of await usersCol.scan({})) {
          const identities = (await identitiesCol.scan({ prefix: `${u.id}:` }))
          for (const i of identities) await identitiesCol.delete(i.id)
          await progressCol.delete(u.id)
          await usersCol.delete(u.id)
        }
      }
    } catch { /* ignore cleanup errors */ }

    await initOnboardingDb()

    // For Ollama: insert the selected model now that providers are seeded
    // (the earlier insert in handleSetupOllamaModels may have failed due to missing FK)
    if (body.provider === "ollama" && body.model) {
      try {
        const { col } = await import("../../storage/hive")
        const modelsCol = await col<import("../../storage/collections").ModelDoc>("models")
        if (!(await modelsCol.get(body.model))) {
          await modelsCol.put(body.model, {
            id: body.model, name: body.model, provider_id: "ollama", model_type: "llm",
            context_window: 0, capabilities: null, enabled: true, active: true,
            source: "discovered",
          }, { expectedVersion: 0 })
        }
      } catch { /* ignore */ }
    }

    // Let DB auto-generate userId via randomblob(16) — same as CLI onboarding
    const userId = await saveUserProfile({
      userName: body.userName || "User",
      userEmail,
      userLanguage: body.userLanguage || "es",
      userTimezone: body.userTimezone || "UTC",
      userOccupation: body.userOccupation || "",
      userNotes: body.userNotes || "",
    })

    // Let DB auto-generate agentId — same as CLI onboarding
    const agentId = await saveAgentConfig({
      userId,
      agentName: body.agentName || "Bee",
      description: body.agentDescription || "",
      tone: body.agentTone || "friendly",
      providerId: body.provider || "",
      modelId: body.model || "",
    })

    if (body.provider && (body.apiKey || body.provider === "ollama")) {
      await saveProviderConfig({
        userId,
        provider: body.provider,
        model: body.model,
        apiKey: body.apiKey || undefined,
      })
    }

    await activateChannel(userId, {
      channelId: "webchat",
      config: {},
    })

    if (body.channels) {
      for (const [channelId, channelData] of Object.entries(body.channels as Record<string, unknown>)) {
        if (channelId !== "webchat" && channelData && typeof channelData === "object" && (channelData as { enabled?: boolean }).enabled) {
          await activateChannel(userId, {
            channelId,
            config: (channelData as { config?: Record<string, unknown> }).config || {},
          })
        }
      }
    }

    // Voice is not part of the setup wizard anymore — it is configured per
    // channel afterwards (PUT /api/channels/:id).

    // Activar ethics — usar las seleccionadas por el usuario, o "default" si no viene nada
    if (body.ethicsRules && typeof body.ethicsRules === "object") {
      for (const [ethicsId, enabled] of Object.entries(body.ethicsRules as Record<string, boolean>)) {
        if (enabled) await activateEthics(userId, ethicsId)
      }
    } else {
      await activateEthics(userId, "default")
    }

    // Use the userId as the auth token — stable, DB-generated, known only to the user.
    // Write ~/.hive/.env so the token survives restarts (loadEnv reads it at boot).
    const authToken = userId
    const hiveDir = getHiveDir()
    const envContent = [
      "# Hive configuration — auto-generated during setup",
      `HIVE_HOST=${process.env.HIVE_HOST || "127.0.0.1"}`,
      `HIVE_PORT=${process.env.HIVE_PORT || "18790"}`,
      `HIVE_LOG_LEVEL=${process.env.HIVE_LOG_LEVEL || "info"}`,
      `HIVE_AUTH_TOKEN=${authToken}`,
      "",
    ].join("\n")
    mkdirSync(hiveDir, { recursive: true })
    writeFileSync(`${hiveDir}/.env`, envContent, { mode: 0o600 })
    writeFileSync(path.join(hiveDir, ".auth_token"), authToken, { mode: 0o600 })
    process.env.HIVE_AUTH_TOKEN = authToken

    // Restart the process so the gateway re-initializes in full mode.
    // Docker (restart: unless-stopped) brings it back up automatically.
    setTimeout(() => process.exit(0), 800)

    return addCorsHeaders(Response.json({
      success: true,
      userId,
      agentId,
      authToken,
      message: "Setup completed successfully",
    }), req)
  } catch (error) {
    return addCorsHeaders(Response.json({
      success: false,
      error: (error as Error).message,
    }, { status: 500 }), req)
  }
}
