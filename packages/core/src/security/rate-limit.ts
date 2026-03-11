import { logger } from "../utils/logger.ts";

export interface TokenBucketConfig {
  maxTokens: number;
  refillRate: number;
  refillIntervalMs?: number;
}

export interface TokenBucket {
  tokens: number;
  lastUpdate: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface TokenBucketStats {
  totalBuckets: number;
  activeBuckets: number;
  totalTokensAvailable: number;
}

export class TokenBucketRateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private config: Required<TokenBucketConfig>;
  private log = logger.child("token-bucket-limiter");

  constructor(config: TokenBucketConfig) {
    this.config = {
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
      refillIntervalMs: config.refillIntervalMs ?? 1000,
    };

    this.startCleanup();
  }

  canProceed(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens,
        lastUpdate: now,
      };
      this.buckets.set(key, bucket);
    }

    const elapsed = now - bucket.lastUpdate;
    const tokensToAdd = (elapsed / this.config.refillIntervalMs) * this.config.refillRate;
    bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastUpdate = now;

    if (bucket.tokens >= 1) {
      bucket.tokens--;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }

    const retryAfterMs = Math.ceil(
      ((1 - bucket.tokens) / this.config.refillRate) * this.config.refillIntervalMs
    );

    this.log.debug(`Rate limit hit for ${key}, retry after ${retryAfterMs}ms`);

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  consume(key: string, tokens: number = 1): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens,
        lastUpdate: now,
      };
      this.buckets.set(key, bucket);
    }

    const elapsed = now - bucket.lastUpdate;
    const tokensToAdd = (elapsed / this.config.refillIntervalMs) * this.config.refillRate;
    bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastUpdate = now;

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }

    const retryAfterMs = Math.ceil(
      ((tokens - bucket.tokens) / this.config.refillRate) * this.config.refillIntervalMs
    );

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  peek(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.config.maxTokens;

    const now = Date.now();
    const elapsed = now - bucket.lastUpdate;
    const tokensToAdd = (elapsed / this.config.refillIntervalMs) * this.config.refillRate;

    return Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
  }

  refill(key: string, tokens?: number): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;

    bucket.tokens = Math.min(
      this.config.maxTokens,
      bucket.tokens + (tokens ?? this.config.maxTokens)
    );
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
    this.log.info("All rate limit buckets cleared");
  }

  getStats(): TokenBucketStats {
    let totalTokens = 0;
    let activeBuckets = 0;
    const now = Date.now();

    for (const bucket of this.buckets.values()) {
      const elapsed = now - bucket.lastUpdate;
      const tokens = Math.min(
        this.config.maxTokens,
        bucket.tokens + (elapsed / this.config.refillIntervalMs) * this.config.refillRate
      );

      if (tokens < this.config.maxTokens) {
        activeBuckets++;
      }
      totalTokens += tokens;
    }

    return {
      totalBuckets: this.buckets.size,
      activeBuckets,
      totalTokensAvailable: Math.floor(totalTokens),
    };
  }

  private startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        const elapsed = now - bucket.lastUpdate;
        const fullTokens =
          bucket.tokens + (elapsed / this.config.refillIntervalMs) * this.config.refillRate;

        if (fullTokens >= this.config.maxTokens) {
          this.buckets.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }
}

export interface SlidingWindowConfig {
  windowMs: number;
  maxRequests: number;
}

export interface SlidingWindowEntry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private windows: Map<string, SlidingWindowEntry> = new Map();
  private config: SlidingWindowConfig;
  private log = logger.child("sliding-window-limiter");

  constructor(config: SlidingWindowConfig) {
    this.config = config;
    this.startCleanup();
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= this.config.maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + this.config.windowMs - now;

      this.log.debug(`Sliding window limit hit for ${key}`);

      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    entry.timestamps.push(now);

    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.timestamps.length,
      retryAfterMs: 0,
    };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  resetAll(): void {
    this.windows.clear();
  }

  private startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const windowStart = now - this.config.windowMs;

      for (const [key, entry] of this.windows) {
        entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
        if (entry.timestamps.length === 0) {
          this.windows.delete(key);
        }
      }
    }, 60 * 1000);
  }
}

export function createTokenBucketLimiter(config: TokenBucketConfig): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter(config);
}

export function createSlidingWindowLimiter(config: SlidingWindowConfig): SlidingWindowRateLimiter {
  return new SlidingWindowRateLimiter(config);
}
