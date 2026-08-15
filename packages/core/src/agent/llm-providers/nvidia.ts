import { OpenAICompatBase } from "./openai-compat-base"
import type { LLMCallOptions } from "../llm-client"

/**
 * NIM mantiene el razonamiento APAGADO por defecto en su endpoint compatible
 * con OpenAI, y el interruptor no es el `reasoning_effort` de OpenAI sino
 * `chat_template_kwargs`, con una clave distinta por familia de modelo.
 *
 * Verificado en vivo contra integrate.api.nvidia.com (2026-08-15):
 * `z-ai/glm-5.2` no emite un solo `reasoning_content` sin esto — el delta trae
 * únicamente `role` y `content` — y sí lo emite con `enable_thinking`. Por eso
 * la app no mostraba razonamiento con los modelos de NVIDIA: no llegaba.
 *
 * Las familias que no están acá se dejan en paz a propósito. Nemotron 3 ya
 * emite `reasoning_content` sin ningún kwarg (también verificado), y mandarle
 * una clave que su plantilla no acepta es justamente lo que rompe la llamada.
 */
const THINKING_KWARGS: Array<{ pattern: RegExp; kwargs: Record<string, unknown> }> = [
  // Verificado con z-ai/glm-5.2.
  { pattern: /glm/i, kwargs: { enable_thinking: true, clear_thinking: false } },
  // Verificado con minimaxai/minimax-m3.
  { pattern: /minimax/i, kwargs: { thinking_mode: "enabled" } },
  // Documentado por NVIDIA, sin verificar: moonshotai/kimi-k2.6 responde 404
  // en la cuenta con la que se probó. Si la plantilla lo rechaza, el reintento
  // de openai-compat-base repite la llamada sin kwargs.
  { pattern: /kimi|deepseek/i, kwargs: { thinking: true } },
  { pattern: /qwen|qwq/i, kwargs: { enable_thinking: true } },
]

export class NvidiaProvider extends OpenAICompatBase {
  constructor() { super("nvidia") }

  protected modifyRequestBody(body: any, options: LLMCallOptions): any {
    if (!options.thinking?.enabled) return body

    const match = THINKING_KWARGS.find(({ pattern }) => pattern.test(options.model))
    if (!match) return body

    return {
      ...body,
      chat_template_kwargs: { ...(body.chat_template_kwargs ?? {}), ...match.kwargs },
    }
  }
}
