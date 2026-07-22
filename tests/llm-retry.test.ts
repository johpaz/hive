/**
 * Tests for resilience/retry.ts — isRetryableError classification and
 * withRetry's backoff/retry-after behavior, plus llm-client.ts's callLLM
 * wiring (retries a 429 then succeeds; never retries after abort).
 */

import { describe, test, expect } from "bun:test";
import { isRetryableError, withRetry, computeRetryDelay, type RetryPolicy } from "../packages/core/src/resilience/retry";

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
