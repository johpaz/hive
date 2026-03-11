import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";
import { hashObject } from "../utils/crypto.ts";

interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  errorMessage?: string;
  timestamp: number;
}

interface StuckLoopState {
  detected: boolean;
  toolName: string;
  count: number;
  lastError?: string;
}

export class StuckLoopDetector {
  private log = logger.child("stuck-loop");
  private history: Map<string, ToolCallRecord[]> = new Map();
  private readonly maxHistoryPerSession = 50;
  private readonly triggerThreshold = 3;

  constructor(_config: Config) {}

  recordToolCall(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    error?: string
  ): void {
    let sessionHistory = this.history.get(sessionId);
    if (!sessionHistory) {
      sessionHistory = [];
      this.history.set(sessionId, sessionHistory);
    }

    const record: ToolCallRecord = {
      toolName,
      argsHash: hashObject(args),
      errorMessage: error,
      timestamp: Date.now(),
    };

    sessionHistory.push(record);

    if (sessionHistory.length > this.maxHistoryPerSession) {
      sessionHistory.shift();
    }

    this.log.debug(`Recorded tool call: ${toolName} for session ${sessionId}`);
  }

  check(sessionId: string): StuckLoopState {
    const sessionHistory = this.history.get(sessionId) ?? [];
    
    if (sessionHistory.length < this.triggerThreshold) {
      return { detected: false, toolName: "", count: 0 };
    }

    const recent = sessionHistory.slice(-10);
    const counts = new Map<string, { count: number; error?: string }>();

    for (const record of recent) {
      const key = `${record.toolName}:${record.argsHash}`;
      const existing = counts.get(key);
      
      if (existing) {
        existing.count++;
        if (record.errorMessage) {
          existing.error = record.errorMessage;
        }
      } else {
        counts.set(key, { count: 1, error: record.errorMessage });
      }
    }

    for (const [key, data] of counts) {
      if (data.count >= this.triggerThreshold && data.error) {
        const toolName = key.split(":")[0] ?? "unknown";
        
        this.log.warn(`Stuck loop detected: ${toolName} called ${data.count} times with same args and error`);
        
        return {
          detected: true,
          toolName,
          count: data.count,
          lastError: data.error,
        };
      }
    }

    return { detected: false, toolName: "", count: 0 };
  }

  getInterventionMessage(state: StuckLoopState): string | null {
    if (!state.detected) return null;

    if (state.count >= this.triggerThreshold + 1) {
      return `CRITICAL: You have called ${state.toolName} ${state.count} times with the same arguments and it keeps failing with: "${state.lastError}". The user has been notified. You MUST try a completely different approach or ask the user for guidance.`;
    }

    return `WARNING: You have called ${state.toolName} ${state.count} times with the same arguments and it keeps failing. You MUST try a completely different approach instead of repeating the same action.`;
  }

  clear(sessionId: string): void {
    this.history.delete(sessionId);
    this.log.debug(`Cleared stuck loop history for session ${sessionId}`);
  }

  prune(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let pruned = 0;

    for (const [sessionId, history] of this.history) {
      const filtered = history.filter(r => now - r.timestamp < maxAgeMs);
      
      if (filtered.length === 0) {
        this.history.delete(sessionId);
        pruned++;
      } else if (filtered.length !== history.length) {
        this.history.set(sessionId, filtered);
      }
    }

    return pruned;
  }
}

export function createStuckLoopDetector(config: Config): StuckLoopDetector {
  return new StuckLoopDetector(config);
}
