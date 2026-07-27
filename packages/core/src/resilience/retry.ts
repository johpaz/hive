/**
 * Generic retry-with-backoff helper for transient failures (LLM provider
 * calls, network/tool errors). Complements CircuitBreaker (circuit-breaker.ts),
 * which sits one layer out and trips on sustained failure rates — this module
 * only decides whether a single call should be retried and how long to wait.
 */

import { logger } from "../utils/logger";

const log = logger.child("retry");

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
};

/** Exponential backoff with full jitter, capped at policy.maxDelayMs. */
export function computeRetryDelay(attempt: number, policy: RetryPolicy, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, policy.maxDelayMs);
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt));
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/**
 * HTTP-status-aware transient classifier: 408/429/5xx/network/timeout are
 * retryable, 400/401/403/404 (and anything else) are terminal. Looks for a
 * `status`/`statusCode` property (most provider SDKs set one) or common
 * network/timeout error names/messages as a fallback.
 */
export function isRetryableError(err: unknown): boolean {
  const status = extractStatus(err);
  if (status !== undefined) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? String(err);
  if (name === "AbortError") return false;
  if (/timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|fetch failed/i.test(`${name} ${message}`)) {
    return true;
  }
  return false;
}

function extractStatus(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } };
  return e?.status ?? e?.statusCode ?? e?.response?.status;
}

/** Extract a `Retry-After` value (seconds or HTTP-date) if the error/response carries one. */
function extractRetryAfterMs(err: unknown): number | undefined {
  const headers = (err as { headers?: Record<string, string>; response?: { headers?: Record<string, string> } })?.headers
    ?? (err as { response?: { headers?: Record<string, string> } })?.response?.headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(raw);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
}

/**
 * Run `fn`, retrying on transient failure per `policy`. `isRetryable`
 * defaults to {@link isRetryableError}; pass a custom classifier for
 * domain-specific errors (e.g. job executors).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  isRetryable: (err: unknown) => boolean = isRetryableError
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === policy.maxAttempts - 1 || !isRetryable(err)) throw err;
      const delay = computeRetryDelay(attempt, policy, extractRetryAfterMs(err));
      log.warn(`[withRetry] Attempt ${attempt + 1}/${policy.maxAttempts} failed (${(err as Error).message}); retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
