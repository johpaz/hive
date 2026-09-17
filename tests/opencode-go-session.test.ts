/**
 * OpenCode Go rechaza con 400 `MissingSessionID` toda petición sin
 * `x-opencode-session` — verificado el 2026-09-10 con una key real: sin el
 * header 400, con él 200. Su documentación pide además que el cliente se
 * identifique con su propio User-Agent en vez del genérico del SDK:
 * https://opencode.ai/docs/go/#where-can-i-use-it
 *
 * Se prueba contra un servidor local para ver los headers que el SDK de OpenAI
 * manda de verdad: un cliente falso no los vería.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenCodeGoProvider } from "../packages/core/src/agent/llm-providers/opencode-go";
import type { LLMCallOptions } from "../packages/core/src/agent/llm-client";

const received: Headers[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      received.push(req.headers);
      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "kimi-k2.6",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });
});

afterAll(() => server.stop(true));

async function headersFor(sessionId?: string): Promise<{ session: string | null; userAgent: string | null }> {
  const before = received.length;
  await new OpenCodeGoProvider().call({
    provider: "opencode-go",
    model: "kimi-k2.6",
    apiKey: "test-key",
    baseUrl: `http://localhost:${server.port}/v1`,
    messages: [{ role: "user", content: "hola" }],
    sessionId,
  } as LLMCallOptions);
  const headers = received[before];
  return { session: headers.get("x-opencode-session"), userAgent: headers.get("user-agent") };
}

describe("OpenCode Go · x-opencode-session", () => {
  test("toda petición lleva la sesión", async () => {
    expect((await headersFor("user-1/webchat/c1")).session).toBeTruthy();
  });

  test("la misma conversación conserva su sesión y otra recibe una distinta", async () => {
    const first = await headersFor("user-1/webchat/c1");
    const again = await headersFor("user-1/webchat/c1");
    const other = await headersFor("user-1/telegram/555");
    expect(again.session).toBe(first.session);
    expect(other.session).toBeTruthy();
    expect(other.session).not.toBe(first.session);
  });

  test("no manda el threadId: lleva usuario, canal y contacto", async () => {
    const { session } = await headersFor("user-1/whatsapp/573001234567");
    expect(session).toBeTruthy();
    expect(session!).not.toContain("573001234567");
    expect(session!).not.toContain("/");
  });

  test("sin conversación (compactación, metas) igual manda una sesión", async () => {
    expect((await headersFor(undefined)).session).toBeTruthy();
  });

  test("se identifica con su propio User-Agent", async () => {
    expect((await headersFor("user-1/webchat/c1")).userAgent).toMatch(/^hive\/\d+\.\d+\.\d+/);
  });
});
