/**
 * Un stream OpenAI-compatible solo reporta tokens si se le pide
 * `stream_options.include_usage`, y los manda en un último chunk con
 * `choices: []`. Hive no lo pedía y además saltaba ese chunk: todas las
 * llamadas a NVIDIA quedaban en 0 tokens y su costo nunca llegaba al dashboard.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { NvidiaProvider } from "../packages/core/src/agent/llm-providers/nvidia"
import type { LLMCallOptions } from "../packages/core/src/agent/llm-client"

const sse = (chunks: unknown[]) => new Response(
  chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } },
)
const base = { id: "c", object: "chat.completion.chunk", created: 0, model: "m" }

let rejectStreamOptions = false
const bodies: any[] = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json()
      bodies.push(body)
      if (rejectStreamOptions && body.stream_options) {
        return Response.json({ error: { message: "Unrecognized request argument: stream_options" } }, { status: 400 })
      }
      const chunks: unknown[] = [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "hola" }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]
      if (body.stream_options?.include_usage) {
        chunks.push({ ...base, choices: [], usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 } })
      }
      return sse(chunks)
    },
  })
})
afterAll(() => server.stop(true))

const call = () => new NvidiaProvider().call({
  provider: "nvidia", model: "moonshotai/kimi-k3", apiKey: "k",
  baseUrl: `http://localhost:${server.port}/v1`,
  messages: [{ role: "user", content: "hola" }],
  onToken: () => {},
} as LLMCallOptions)

describe("streaming usage", () => {
  test("asks for usage and reads it from the choice-less final chunk", async () => {
    rejectStreamOptions = false
    const response = await call()
    expect(bodies.at(-1).stream_options).toEqual({ include_usage: true })
    expect(response.content).toBe("hola")
    expect(response.usage).toMatchObject({ input_tokens: 1234, output_tokens: 56 })
  })

  test("a server that rejects stream_options still answers, without usage", async () => {
    rejectStreamOptions = true
    const before = bodies.length
    const response = await call()
    expect(bodies.length - before).toBe(2)
    expect(bodies.at(-1).stream_options).toBeUndefined()
    expect(response.content).toBe("hola")
  })
})
