import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";

export * from "./pairing.ts";
export * from "./rate-limit.ts";
export * from "./signal.ts";
export * from "./google-chat.ts";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;
  private log = logger.child("rate-limiter");

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.startCleanup();
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now > entry.resetAt) {
      const resetAt = now + this.config.windowMs;
      this.limits.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.config.maxRequests - 1, resetAt };
    }

    if (entry.count >= this.config.maxRequests) {
      this.log.warn(`Rate limit exceeded for ${key}`);
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { 
      allowed: true, 
      remaining: this.config.maxRequests - entry.count, 
      resetAt: entry.resetAt 
    };
  }

  reset(key: string): void {
    this.limits.delete(key);
  }

  private startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.limits) {
        if (now > entry.resetAt) {
          this.limits.delete(key);
        }
      }
    }, this.config.windowMs);
  }
}

export class InputValidator {
  private maxMessageLength: number;
  private maxCommandArgs: number;
  private log = logger.child("validator");

  constructor(options: { maxMessageLength?: number; maxCommandArgs?: number } = {}) {
    this.maxMessageLength = options.maxMessageLength ?? 100000;
    this.maxCommandArgs = options.maxCommandArgs ?? 50;
  }

  validateMessage(content: string): { valid: boolean; error?: string } {
    if (typeof content !== "string") {
      return { valid: false, error: "Message must be a string" };
    }

    if (content.length === 0) {
      return { valid: false, error: "Message cannot be empty" };
    }

    if (content.length > this.maxMessageLength) {
      this.log.warn(`Message too long: ${content.length} > ${this.maxMessageLength}`);
      return { 
        valid: false, 
        error: `Message too long (max ${this.maxMessageLength} characters)` 
      };
    }

    return { valid: true };
  }

  validateCommand(name: string, args: string[]): { valid: boolean; error?: string } {
    if (!name || typeof name !== "string") {
      return { valid: false, error: "Command name is required" };
    }

    if (!/^[a-z0-9_-]+$/.test(name)) {
      return { valid: false, error: "Invalid command name format" };
    }

    if (args.length > this.maxCommandArgs) {
      return { valid: false, error: `Too many arguments (max ${this.maxCommandArgs})` };
    }

    return { valid: true };
  }

  validateSessionId(sessionId: string): { valid: boolean; error?: string } {
    if (!sessionId || typeof sessionId !== "string") {
      return { valid: false, error: "Session ID is required" };
    }

    const pattern = /^agent:[a-z0-9_-]+:[a-z0-9_-]+:(main|dm|group)(?::[a-z0-9_-]+)?$/;
    if (!pattern.test(sessionId)) {
      return { valid: false, error: "Invalid session ID format" };
    }

    return { valid: true };
  }

  sanitizeInput(input: string): string {
    return input
      .replace(/\x00/g, "")
      .replace(/[\x1F\x7F]/g, "")
      .trim();
  }
}

export class AuthManager {
  private config: Config;
  private allowedUsers: Set<string>;
  private log = logger.child("auth");

  constructor(config: Config) {
    this.config = config;
    this.allowedUsers = new Set(config.security?.allowedUsers ?? []);
  }

  isAllowed(peerId: string, channel: string): boolean {
    if (this.allowedUsers.size === 0) {
      return true;
    }

    const channelConfig = this.config.channels?.[channel as keyof typeof this.config.channels];
    if (channelConfig && typeof channelConfig === "object" && "allowFrom" in channelConfig) {
      const allowFrom = (channelConfig as { allowFrom?: string[] }).allowFrom;
      if (allowFrom && allowFrom.length > 0) {
        return allowFrom.includes(peerId);
      }
    }

    return this.allowedUsers.has(peerId);
  }

  addAllowedUser(peerId: string): void {
    this.allowedUsers.add(peerId);
    this.log.info(`Added allowed user: ${peerId}`);
  }

  removeAllowedUser(peerId: string): boolean {
    const removed = this.allowedUsers.delete(peerId);
    if (removed) {
      this.log.info(`Removed allowed user: ${peerId}`);
    }
    return removed;
  }

  listAllowedUsers(): string[] {
    return Array.from(this.allowedUsers);
  }
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  return new RateLimiter(config);
}

export function createInputValidator(options?: {
  maxMessageLength?: number;
  maxCommandArgs?: number;
}): InputValidator {
  return new InputValidator(options);
}

export function createAuthManager(config: Config): AuthManager {
  return new AuthManager(config);
}
