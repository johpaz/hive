/**
 * NVIDIA NIM mantiene el razonamiento apagado salvo que se lo pidan por
 * `chat_template_kwargs`, con una clave distinta por familia de modelo.
 *
 * Verificado en vivo contra integrate.api.nvidia.com el 2026-08-15:
 * `z-ai/glm-5.2` sin kwargs devuelve deltas con `role`/`content` y cero
 * `reasoning_content`; con `enable_thinking` devuelve el razonamiento. Estos
 * tests fijan qué se manda a cada familia — el contrato que hace que la app
 * pueda mostrar el razonamiento.
 */

import { describe, expect, test } from "bun:test";
import { NvidiaProvider } from "../packages/core/src/agent/llm-providers/nvidia";
import type { LLMCallOptions } from "../packages/core/src/agent/llm-client";

class ProbeProvider extends NvidiaProvider {
  build(model: string, thinking: boolean, body: Record<string, unknown> = {}) {
    const options = { model, thinking: { enabled: thinking } } as LLMCallOptions;
    return (this as unknown as { modifyRequestBody(b: any, o: LLMCallOptions): any }).modifyRequestBody(
      { model, messages: [], ...body },
      options,
    );
  }
}

const provider = new ProbeProvider();

describe("NVIDIA NIM thinking", () => {
  test("enciende el razonamiento de GLM con enable_thinking", () => {
    expect(provider.build("z-ai/glm-5.2", true).chat_template_kwargs).toEqual({
      enable_thinking: true,
      clear_thinking: false,
    });
  });

  test("cada familia recibe su propio interruptor", () => {
    expect(provider.build("minimaxai/minimax-m3", true).chat_template_kwargs).toEqual({ thinking_mode: "enabled" });
    expect(provider.build("moonshotai/kimi-k2.6", true).chat_template_kwargs).toEqual({ thinking: true });
    expect(provider.build("qwen/qwen3-next-80b", true).chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  test("no le manda kwargs a familias que no los necesitan", () => {
    // Nemotron 3 ya emite reasoning_content por su cuenta (verificado en vivo);
    // mandarle una clave que su plantilla no espera solo agrega riesgo.
    expect(provider.build("nvidia/nemotron-3-super-120b-a12b", true).chat_template_kwargs).toBeUndefined();
  });

  test("respeta que el llamador pida no pensar", () => {
    expect(provider.build("z-ai/glm-5.2", false).chat_template_kwargs).toBeUndefined();
  });

  test("no pisa kwargs que ya venían en el body", () => {
    const body = provider.build("z-ai/glm-5.2", true, { chat_template_kwargs: { custom: 1 } });
    expect(body.chat_template_kwargs).toEqual({ custom: 1, enable_thinking: true, clear_thinking: false });
  });

  test("deja el resto del body intacto", () => {
    const body = provider.build("z-ai/glm-5.2", true, { temperature: 0.3, max_tokens: 1000 });
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(1000);
    expect(body.messages).toEqual([]);
  });
});

/**
 * El reintento que quita `chat_template_kwargs` existe para plantillas que no
 * reconocen la clave. La primera versión reintentaba ante cualquier status y
 * falló en producción contra un 429: gastó una segunda petición contra el
 * mismo límite que acababa de rechazar la primera, y apagó el razonamiento
 * sin motivo. Estos tests fijan el alcance.
 */
class FakeClientProvider extends NvidiaProvider {
  requests: any[] = [];
  constructor(private readonly failures: Array<{ status: number } | null>) { super(); }

  protected async resolveOpenAIClient(): Promise<any> {
    let attempt = 0;
    return {
      chat: {
        completions: {
          create: async (body: any) => {
            this.requests.push(body);
            const failure = this.failures[attempt++];
            if (failure) {
              const err: any = new Error(`HTTP ${failure.status}`);
              err.status = failure.status;
              throw err;
            }
            return {
              choices: [{ message: { content: "391" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 3 },
            };
          },
        },
      },
    };
  }
}

const callOptions = {
  provider: "nvidia",
  model: "z-ai/glm-5.2",
  apiKey: "test-key",
  messages: [{ role: "user" as const, content: "17 x 23" }],
  thinking: { enabled: true },
} as LLMCallOptions;

describe("reintento sin chat_template_kwargs", () => {
  test("un 429 se propaga sin gastar una segunda petición", async () => {
    const provider = new FakeClientProvider([{ status: 429 }]);
    await expect(provider.call(callOptions)).rejects.toThrow("HTTP 429");
    expect(provider.requests.length).toBe(1);
  });

  test("un 400 sí reintenta, y sin los kwargs", async () => {
    const provider = new FakeClientProvider([{ status: 400 }, null]);
    const res = await provider.call(callOptions);
    expect(res.content).toBe("391");
    expect(provider.requests.length).toBe(2);
    expect(provider.requests[0].chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });
    expect(provider.requests[1].chat_template_kwargs).toBeUndefined();
  });

  test("sin error, una sola petición y con el razonamiento pedido", async () => {
    const provider = new FakeClientProvider([null]);
    await provider.call(callOptions);
    expect(provider.requests.length).toBe(1);
    expect(provider.requests[0].chat_template_kwargs).toBeDefined();
  });
});
