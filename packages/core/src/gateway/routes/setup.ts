import { writeFileSync, mkdirSync } from "node:fs"
import { getDb } from "../../storage/sqlite"
import { SEED_DATA } from "../../storage/seed"
import {
  initOnboardingDb,
  saveUserProfile,
  saveAgentConfig,
  saveProviderConfig,
  activateChannel,
  saveVoiceConfig,
  activateEthics,
} from "../../storage/onboarding"
import { getHiveDir } from "../../config/loader"
import type { Config } from "../../config/loader"

export function isSetupMode(): boolean {
  try {
    const count = (getDb().query("SELECT COUNT(*) as count FROM users").get() as { count: number }).count
    return count === 0
  } catch {
    return true
  }
}

export function handleSetupProviders(
  addCorsHeaders: (response: Response, request: Request) => Response,
  req: Request
): Response {
  // Build provider+model list directly from SEED_DATA so it's always in sync
  // with what the CLI onboarding shows, regardless of DB state.
  const llmModelsByProvider = new Map<string, { id: string; name: string }[]>()

  for (const model of SEED_DATA.models) {
    if (model.modelType !== "llm") continue
    if (!llmModelsByProvider.has(model.providerId)) {
      llmModelsByProvider.set(model.providerId, [])
    }
    llmModelsByProvider.get(model.providerId)!.push({ id: model.id, name: model.name })
  }

  const result = SEED_DATA.providers
    .filter(p => llmModelsByProvider.has(p.id) || p.id === "ollama")
    .map(p => ({
      id: p.id,
      name: p.name,
      models: llmModelsByProvider.get(p.id) ?? [],
    }))

  return addCorsHeaders(Response.json(result), req)
}

export function handleSetupEthics(
  addCorsHeaders: (response: Response, request: Request) => Response,
  req: Request
): Response {
  try {
    const db = getDb()
    const ethics = db.query(`
      SELECT id, name, description, content, is_default, active FROM ethics ORDER BY id
    `).all() as Array<{
      id: string; name: string; description: string | null;
      content: string; is_default: number; active: number;
    }>

    return addCorsHeaders(Response.json(
      ethics.map(e => ({
        id: e.id,
        name: e.name,
        description: e.description,
        content: e.content,
        isDefault: e.is_default === 1,
        active: e.active === 1,
      }))
    ), req)
  } catch (error) {
    return addCorsHeaders(
      Response.json({ error: (error as Error).message }, { status: 500 }),
      req
    )
  }
}

export async function handleSetupStatus(): Promise<Response> {
  const setupMode = isSetupMode()
  return Response.json({
    configured: !setupMode,
    setupMode,
  })
}

export async function handleVerifyProvider(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { provider, apiKey, model } = body

  if (!provider || !apiKey) {
    return Response.json({
      success: false,
      error: "Provider and API key are required",
    }, { status: 400 })
  }

  try {
    let testUrl: string | null = null
    let testBody: unknown = null
    let headers: Record<string, string> = {}

    const testMessages = [{ role: "user" as const, content: "Say 'ok' if you can read this." }]

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
      testUrl = "https://api.anthropic.com/v1/messages"
      testBody = {
        model: model || "claude-sonnet-4-6",
        max_tokens: 10,
        messages: testMessages,
      }
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      }
    } else if (provider === "openai") {
      testUrl = "https://api.openai.com/v1/chat/completions"
      testBody = {
        model: model || "gpt-4o-mini",
        max_tokens: 10,
        messages: testMessages,
      }
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      }
    } else if (provider === "gemini") {
      testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.5-flash"}:generateContent?key=${apiKey}`
      testBody = {
        contents: [{ parts: [{ text: "Say ok" }] }],
      }
      headers = { "Content-Type": "application/json" }
    } else if (provider === "groq") {
      testUrl = "https://api.groq.com/openai/v1/chat/completions"
      testBody = {
        model: model || "llama-3.3-70b-versatile",
        max_tokens: 10,
        messages: testMessages,
      }
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      }
    } else if (provider === "openrouter") {
      testUrl = "https://openrouter.ai/api/v1/chat/completions"
      testBody = {
        model: model || "meta-llama/llama-3.3-70b-instruct",
        max_tokens: 10,
        messages: testMessages,
      }
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      }
    } else if (provider === "mistral") {
      testUrl = "https://api.mistral.ai/v1/chat/completions"
      testBody = {
        model: model || "mistral-small-latest",
        max_tokens: 10,
        messages: testMessages,
      }
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      }
    } else if (provider === "deepseek") {
      testUrl = "https://api.deepseek.com/v1/chat/completions"
      testBody = {
        model: model || "deepseek-chat",
        max_tokens: 10,
        messages: testMessages,
      }
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      }
    } else if (provider === "kimi") {
      testUrl = "https://api.moonshot.cn/v1/chat/completions"
      testBody = {
        model: model || "moonshot-v1-8k",
        max_tokens: 10,
        messages: testMessages,
      }
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      }
    }

    if (!testUrl) {
      return Response.json({
        success: false,
        error: "Unsupported provider",
      }, { status: 400 })
    }

    const response = await fetch(testUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(testBody),
      signal: AbortSignal.timeout(10000),
    })

    return Response.json({
      success: response.ok,
      error: response.ok ? null : `API error: ${response.status}`,
    })
  } catch (error) {
    return Response.json({
      success: false,
      error: `Connection error: ${(error as Error).message}`,
    })
  }
}

export async function handleCompleteSetup(
  req: Request,
  config: Config,
  addCorsHeaders: (response: Response, request: Request) => Response
): Promise<Response> {
  if (!isSetupMode()) {
    return addCorsHeaders(Response.json({
      success: false,
      error: "Setup already completed. Use config endpoints to modify settings.",
    }, { status: 400 }), req)
  }

  const body = await req.json().catch(() => ({}))

  try {
    initOnboardingDb()

    // Let DB auto-generate userId via randomblob(16) — same as CLI onboarding
    const userId = saveUserProfile({
      userName: body.userName || "User",
      userLanguage: body.userLanguage || "es",
      userTimezone: body.userTimezone || "UTC",
      userOccupation: body.userOccupation || "",
      userNotes: body.userNotes || "",
    })

    // Let DB auto-generate agentId — same as CLI onboarding
    const agentId = saveAgentConfig({
      userId,
      agentName: body.agentName || "Bee",
      description: body.agentDescription || "",
      tone: "friendly",
      providerId: body.provider || "",
      modelId: body.model || "",
    })

    if (body.provider && body.apiKey) {
      await saveProviderConfig({
        userId,
        provider: body.provider,
        model: body.model,
        apiKey: body.apiKey,
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

    if (body.voiceEnabled) {
      await saveVoiceConfig({
        userId,
        channelId: "webchat",
        voiceEnabled: true,
        sttProvider: body.sttProvider || "groq-whisper",
        ttsProvider: body.ttsProvider || "elevenlabs",
      })
    }

    // Activar ethics — usar las seleccionadas por el usuario, o "default" si no viene nada
    if (body.ethicsRules && typeof body.ethicsRules === "object") {
      for (const [ethicsId, enabled] of Object.entries(body.ethicsRules as Record<string, boolean>)) {
        if (enabled) activateEthics(userId, ethicsId)
      }
    } else {
      activateEthics(userId, "default")
    }

    // Use the userId as the auth token — stable, DB-generated, known only to the user.
    // Write ~/.hive/.env so the token survives restarts (loadEnv reads it at boot).
    const authToken = userId
    const hiveDir = getHiveDir()
    const envContent = [
      "# Hive configuration — auto-generated during setup",
      `HIVE_HOST=${process.env.HIVE_HOST || "0.0.0.0"}`,
      `HIVE_PORT=${process.env.HIVE_PORT || "18790"}`,
      `HIVE_LOG_LEVEL=${process.env.HIVE_LOG_LEVEL || "info"}`,
      `HIVE_AUTH_TOKEN=${authToken}`,
      "",
    ].join("\n")
    mkdirSync(hiveDir, { recursive: true })
    writeFileSync(`${hiveDir}/.env`, envContent, { mode: 0o600 })
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
