/**
 * Hive Local LLM — Cliente interno
 * Usado por los agentes y skills para generar texto vía WebSocket
 */

export interface GenerateOptions {
  prompt: string
  model?: "e2b_iq3" | "e4b_iq3" | "e2b_q8" | "e4b_q8"
  imagePath?: string
  audioPath?: string
  nPredict?: number
  timeout?: number
}

function getBaseURL(): string {
  if (typeof globalThis !== "undefined" && "window" in globalThis) {
    const win = (globalThis as any).window
    const protocol = win.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${win.location.host}`
  }
  return process.env.HIVE_LOCAL_WS_URL ?? "ws://localhost:3000"
}

const BASE_URL = getBaseURL()
const WS_URL = `${BASE_URL}/ws/llm`

/** Verifica si el servidor local está disponible */
export async function isLocalLLMAvailable(): Promise<boolean> {
  try {
    const httpUrl = BASE_URL.replace(/^ws/, "http")
    const res = await fetch(`${httpUrl}/api/llm/status`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Genera texto vía WebSocket con streaming */
export async function* generateLocal(options: GenerateOptions): AsyncGenerator<string> {
  const ws = new WebSocket(WS_URL)

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error("No se pudo conectar a hive-local"))
  })

  ws.send(JSON.stringify({
    type: "generate",
    prompt: options.prompt,
    model: options.model ?? "e2b_iq3",
    imagePath: options.imagePath,
    audioPath: options.audioPath,
    nPredict: options.nPredict ?? 512,
  }))

  const timeout = options.timeout ?? 60_000
  const timeoutId = setTimeout(() => ws.close(1000, "timeout"), timeout)

  try {
    while (true) {
      const message = await new Promise<string>((resolve, reject) => {
        ws.onmessage = (event) => resolve(event.data as string)
        ws.onerror = () => reject(new Error("WebSocket error"))
        ws.onclose = () => reject(new Error("WebSocket cerrado"))
      })

      const data = JSON.parse(message)

      if (data.type === "token") {
        yield data.text
      } else if (data.type === "done") {
        break
      } else if (data.type === "error") {
        throw new Error(data.message)
      }
    }
  } finally {
    clearTimeout(timeoutId)
    if (ws.readyState === WebSocket.OPEN) {
      ws.close()
    }
  }
}

/** Genera texto completo (no streaming, retorna string) */
export async function generateLocalComplete(options: GenerateOptions): Promise<string> {
  const tokens: string[] = []
  for await (const token of generateLocal(options)) {
    tokens.push(token)
  }
  return tokens.join(" ")
}
