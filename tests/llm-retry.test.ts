/**
 * Tests for resilience/retry.ts — isRetryableError classification and
 * withRetry's backoff/retry-after behavior, plus llm-client.ts's callLLM
 * wiring (retries a 429 then succeeds; never retries after abort).
 */

import { describe, test, expect } from "bun:test";
import { isRetryableError, withRetry, computeRetryDelay, type RetryPolicy } from "../packages/core/src/resilience/retry";
import { describeProviderFailure } from "../packages/core/src/agent/llm-client";

describe("resilience/retry: isRetryableError", () => {
  test("classifies HTTP status codes", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 408 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 404 })).toBe(false);
  });

  test("reads status from a nested response object", () => {
    expect(isRetryableError({ response: { status: 429 } })).toBe(true);
    expect(isRetryableError({ response: { status: 403 } })).toBe(false);
  });

  test("classifies network/timeout errors by name/message when no status is present", () => {
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError({ name: "TimeoutError", message: "Request timed out" })).toBe(true);
    expect(isRetryableError({ message: "ECONNRESET" })).toBe(true);
    expect(isRetryableError({ name: "AbortError", message: "The operation was aborted" })).toBe(false);
  });

  test("unclassifiable errors default to non-retryable", () => {
    expect(isRetryableError(new Error("invalid API key"))).toBe(false);
  });
});

describe("resilience/retry: computeRetryDelay", () => {
  test("honors an explicit Retry-After over the computed backoff", () => {
    const policy: RetryPolicy = { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 30_000 };
    expect(computeRetryDelay(0, policy, 5000)).toBe(5000);
    expect(computeRetryDelay(0, policy, 60_000)).toBe(30_000); // still capped
  });
});

describe("resilience/retry: withRetry", () => {
  const FAST_POLICY: RetryPolicy = { maxAttempts: 3, initialDelayMs: 1, backoffMultiplier: 1, maxDelayMs: 5 };

  test("retries a transient failure then returns the eventual success", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw { status: 429, message: "rate limited" };
      return "ok";
    }, FAST_POLICY);

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  test("stops retrying once maxAttempts is reached and throws the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw { status: 500, message: "always fails" };
      }, FAST_POLICY)
    ).rejects.toThrow("always fails");
    expect(calls).toBe(FAST_POLICY.maxAttempts);
  });

  test("does not retry a non-retryable (terminal) error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw { status: 401, message: "unauthorized" };
      }, FAST_POLICY)
    ).rejects.toThrow("unauthorized");
    expect(calls).toBe(1);
  });

  test("a custom isRetryable classifier overrides the default", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error("domain-specific transient");
        return "recovered";
      },
      FAST_POLICY,
      (err) => (err as Error).message === "domain-specific transient"
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });
});

/**
 * Un error de proveedor termina en la pantalla del usuario, así que tiene que
 * decirle qué pasó y qué hacer. "429 status code (no body)" —el texto crudo del
 * SDK— llegó tal cual al chat: no nombra el rate limit ni sugiere nada.
 */
describe("llm-client: mensajes de falla del proveedor", () => {
  test("un 429 explica que es límite de cuota y qué hacer", () => {
    const msg = describeProviderFailure(new Error("429 status code (no body)"), 429, "nvidia", "z-ai/glm-5.2");
    expect(msg).toContain("limitando las peticiones");
    expect(msg).toContain("Ajustes → Proveedores");
    expect(msg).not.toContain("no body");
  });

  test("un 401/403 apunta a la API key, no al modelo", () => {
    for (const status of [401, 403]) {
      const msg = describeProviderFailure(new Error("Unauthorized"), status, "nvidia", "z-ai/glm-5.2");
      expect(msg).toContain("API key");
      expect(msg).toContain("z-ai/glm-5.2");
    }
  });

  test("un 404 sigue diciendo que el modelo ya no existe", () => {
    const msg = describeProviderFailure(new Error("Not Found"), 404, "nvidia", "moonshotai/kimi-k2.6");
    expect(msg).toContain("ya no existe");
    expect(msg).toContain("moonshotai/kimi-k2.6");
  });

  test("un status sin mapeo conserva el mensaje original en vez de inventar una causa", () => {
    const msg = describeProviderFailure(new Error("socket hang up"), 502, "nvidia", "z-ai/glm-5.2");
    expect(msg).toBe("socket hang up");
  });
});
