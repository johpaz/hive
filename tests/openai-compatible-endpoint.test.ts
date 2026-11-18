import { describe, expect, test } from "bun:test"
import { OpenAIProvider } from "../packages/core/src/agent/llm-providers/openai"
import type { LLMCallOptions } from "../packages/core/src/agent/llm-client"

// Real SDK requests against a loopback server; no external account or API key.
async function withEndpoint(
  fetch: (request: Request) => Response | Promise<Response>,
  run: (options: LLMCallOptions) => Promise<void>,
) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  try {
    await run({
      provider: "openai", model: "openai/fixture-model", apiKey: "fixture-key",
      baseUrl: `http://127.0.0.1:${server.port}/custom/v1`,
      messages: [{ role: "user", content: "Consulta el clima de Bogotá" }],
      signal: AbortSignal.timeout(5000),
    })
  } finally {
    await server.stop(true)
  }
}

const completion = () => Response.json({
  id: "fixture", object: "chat.completion", created: 0, model: "fixture-model",
  choices: [{ index: 0, message: { role: "assistant", content: "Hace sol" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
})

const sse = (chunks: unknown[]) => new Response(
  chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } },
)
const chunkBase = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model" }

describe("OpenAI-compatible endpoint", () => {
  test("uses the custom URL and Bearer key and maps ordinary response usage", async () => {
    const requests: { path: string; method: string; auth: string | null; body: any }[] = []
    await withEndpoint(async request => {
      requests.push({ path: new URL(request.url).pathname, method: request.method,
        auth: request.headers.get("authorization"), body: await request.json() })
      return completion()
    }, async options => {
      const response = await new OpenAIProvider().call(options)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        path: "/custom/v1/chat/completions", method: "POST", auth: "Bearer fixture-key",
        body: { model: "fixture-model", messages: options.messages },
      })
      expect(requests[0].body.stream).toBeUndefined()
      expect(response.content).toBe("Hace sol")
      expect(response.stop_reason).toBe("stop")
      expect(response.usage).toEqual({ input_tokens: 12, output_tokens: 3 })
    })
  })

  test("assembles streamed tool arguments and sends the tool result on continuation", async () => {
    const bodies: any[] = []
    await withEndpoint(async request => {
      bodies.push(await request.json())
      if (bodies.length > 1) return completion()
      return sse([
        { ...chunkBase, choices: [{ index: 0, delta: { role: "assistant", content: "Consultando", tool_calls: [
          { index: 0, id: "call_weather", type: "function", function: { name: "weather", arguments: '{"city":' } },
        ] }, finish_reason: null }] },
        { ...chunkBase, choices: [{ index: 0, delta: { tool_calls: [
          { index: 0, function: { arguments: '"Bogotá"}' } },
        ] }, finish_reason: null }] },
        { ...chunkBase, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        { ...chunkBase, choices: [], usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 } },
      ])
    }, async options => {
      const provider = new OpenAIProvider()
      const tokens: string[] = []
      const tools: NonNullable<LLMCallOptions["tools"]> = [{ type: "function", function: {
        name: "weather", description: "Consulta el clima",
        parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      } }]
      const first = await provider.call({ ...options, tools, onToken: token => { tokens.push(token) } })
      expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true }, tools, tool_choice: "auto" })
      expect(tokens).toEqual(["Consultando"])
      expect(first.content).toBe("Consultando")
      expect(first.stop_reason).toBe("tool_calls")
      expect(first.tool_calls).toEqual([{ id: "call_weather", type: "function",
        function: { name: "weather", arguments: '{"city":"Bogotá"}' } }])
      expect(first.usage).toEqual({ input_tokens: 20, output_tokens: 7 })

      // The caller executes the tool; the provider serializes the next turn.
      const messages: LLMCallOptions["messages"] = [
        ...options.messages,
        { role: "assistant", content: first.content, tool_calls: first.tool_calls },
        { role: "tool", tool_call_id: "call_weather", content: '{"condition":"sunny"}' },
      ]
      const second = await provider.call({ ...options, tools, messages })
      expect(bodies).toHaveLength(2)
      expect(bodies[1].messages).toEqual(messages)
      expect(second.content).toBe("Hace sol")
      expect(second.stop_reason).toBe("stop")
    })
  })

  for (const streaming of [false, true]) {
    test(`propagates HTTP 401 without retry (${streaming ? "streaming" : "ordinary"})`, async () => {
      const authHeaders: (string | null)[] = []
      await withEndpoint(request => {
        authHeaders.push(request.headers.get("authorization"))
        return Response.json({ error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 })
      }, async options => {
        await expect(new OpenAIProvider().call({
          ...options, apiKey: "invalid-fixture-key", onToken: streaming ? () => {} : undefined,
        })).rejects.toMatchObject({ status: 401, code: "invalid_api_key" })
        expect(authHeaders).toEqual(["Bearer invalid-fixture-key"])
      })
    })
  }
})
