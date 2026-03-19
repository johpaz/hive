import { randomUUID } from "node:crypto"
import { getDb } from "../../storage/sqlite"
import {
  initOnboardingDb,
  saveUserProfile,
  saveProviderConfig,
  activateChannel,
  saveVoiceConfig,
  activateEthics,
} from "../../storage/onboarding"
import type { Config } from "../../config/loader"

export function isSetupMode(): boolean {
  try {
    const count = (getDb().query("SELECT COUNT(*) as count FROM users").get() as { count: number }).count
    return count === 0
  } catch {
    return true
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
      try {
        const response = await fetch("http://localhost:11434/api/tags", {
          signal: AbortSignal.timeout(5000),
        })
        return Response.json({
          success: response.ok,
          error: response.ok ? null : "Could not connect to Ollama",
        })
      } catch {
        return Response.json({
          success: false,
          error: "Could not connect to Ollama at http://localhost:11434",
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

    const userId = `user_${randomUUID().split("-")[0]}`
    const agentId = `agent_${randomUUID().split("-")[0]}`
    const channelUserId = randomUUID()

    saveUserProfile({
      userId,
      userName: body.userName || "User",
      userLanguage: body.userLanguage || "es",
      userTimezone: body.userTimezone || "UTC",
      userOccupation: body.userOccupation || "",
      userNotes: body.userNotes || "",
      agentName: body.agentName || "Bee",
      agentId,
      agentDescription: body.agentDescription || "",
      agentTone: "friendly",
      channelUserId,
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
      channelUserId,
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

    // Activar ethics por defecto
    activateEthics(userId, "default")

    const authToken = randomUUID().replace(/-/g, "")

    process.env.HIVE_AUTH_TOKEN = authToken
    // Note: userId and agentId are now resolved from database, not environment variables
    // These assignments are kept for backward compatibility but are no longer used

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
