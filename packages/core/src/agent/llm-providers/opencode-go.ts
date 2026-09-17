import { createHash, randomUUID } from "node:crypto"
import pkg from "../../../../../package.json"
import { OpenAICompatBase } from "./openai-compat-base"
import type { LLMCallOptions } from "../llm-client"

/**
 * OpenCode Go rechaza con 400 `MissingSessionID` toda petición sin
 * `x-opencode-session` (verificado 2026-09-10 con una key real: sin el header
 * 400, con él 200). Su documentación pide además que el cliente se identifique
 * con su propio User-Agent en vez del genérico del SDK:
 * https://opencode.ai/docs/go/#where-can-i-use-it
 */
const USER_AGENT = `hive/${pkg.version}`

/** Sesión de respaldo para llamadas sin conversación (compactación, metas). */
const PROCESS_SESSION = randomUUID()

/**
 * La sesión tiene que ser estable por conversación —OpenCode la usa para rutear
 * y cachear el prompt—, pero el threadId lleva usuario, canal y contacto: a
 * OpenCode sólo le llega un hash.
 */
function sessionHeader(sessionId: string | undefined): string {
  if (!sessionId) return PROCESS_SESSION
  return createHash("sha256").update(`hive:${sessionId}`).digest("hex").slice(0, 32)
}

export class OpenCodeGoProvider extends OpenAICompatBase {
  static readonly secretKey = "OPENCODE_GO_API_KEY"

  constructor() {
    super("opencode-go")
  }

  protected async resolveOpenAIClient(apiKey: string, baseURL: string | undefined, options?: LLMCallOptions): Promise<any> {
    const { default: OpenAI } = await import("openai")
    return new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: {
        "x-opencode-session": sessionHeader(options?.sessionId),
        "User-Agent": USER_AGENT,
      },
    })
  }
}
