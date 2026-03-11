import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";
import type { LLMMessage as Message } from "../agent/llm-client";

export interface ContextGuardResult {
  canProceed: boolean;
  currentTokens: number;
  maxTokens: number;
  utilizationPercent: number;
  needsCompaction: boolean;
}

export class ContextGuard {
  private config: Config;
  private log = logger.child("context-guard");

  constructor(config: Config) {
    this.config = config;
  }

  estimateTokens(messages: Message[]): number {
    let total = 0;

    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4);

      if (msg.name) {
        total += Math.ceil(msg.name.length / 4);
      }

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += Math.ceil(tc.function.name.length / 4);
          total += Math.ceil(tc.function.arguments.length / 4);
        }
      }
    }

    return total;
  }

  check(messages: Message[], systemPrompt?: string): ContextGuardResult {
    const maxTokens = this.config.agent?.context?.maxTokens || 128000;
    const threshold = this.config.agent?.context?.compactionThreshold || 0.8;

    let currentTokens = this.estimateTokens(messages);

    if (systemPrompt) {
      currentTokens += Math.ceil(systemPrompt.length / 4);
    }

    currentTokens += 500;

    const utilizationPercent = currentTokens / maxTokens;
    const needsCompaction = utilizationPercent >= threshold;
    const canProceed = currentTokens < maxTokens * 0.95;

    this.log.debug(`Context check: ${currentTokens}/${maxTokens} tokens (${(utilizationPercent * 100).toFixed(1)}%)`);

    return {
      canProceed,
      currentTokens,
      maxTokens,
      utilizationPercent,
      needsCompaction,
    };
  }

  shouldCompact(messages: Message[], systemPrompt?: string): boolean {
    const result = this.check(messages, systemPrompt);
    return result.needsCompaction;
  }

  getRecommendedAction(messages: Message[], systemPrompt?: string): "proceed" | "compact" | "error" {
    const result = this.check(messages, systemPrompt);

    if (result.utilizationPercent >= 0.95) {
      return "error";
    }

    if (result.needsCompaction) {
      return "compact";
    }

    return "proceed";
  }
}

export function createContextGuard(config: Config): ContextGuard {
  return new ContextGuard(config);
}
