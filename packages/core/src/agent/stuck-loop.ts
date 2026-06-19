import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";
import { hashObject } from "../utils/crypto.ts";

interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  errorMessage?: string;
  timestamp: number;
}

interface ProgressRecord {
  hash: string;
  timestamp: number;
}

export interface StuckLoopState {
  detected: boolean;
  toolName: string;
  count: number;
  lastError?: string;
  kind: "loop" | "stall";
}

export class StuckLoopDetector {
  private log = logger.child("stuck-loop");
  private history: Map<string, ToolCallRecord[]> = new Map();
  private progressHistory: Map<string, ProgressRecord[]> = new Map();
  private readonly maxHistoryPerSession = 50;
  private readonly triggerThreshold = 3;
  private readonly progressThreshold = 3;

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
      return { detected: false, toolName: "", count: 0, kind: "loop" };
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
          kind: "loop",
        };
      }
    }

    return { detected: false, toolName: "", count: 0, kind: "loop" };
  }

  /**
   * Record a progress snapshot hash. Use this to detect when the agent is not
   * advancing even though no tool errors are occurring.
   */
  recordProgress(sessionId: string, progressHash: string): void {
    let sessionProgress = this.progressHistory.get(sessionId);
    if (!sessionProgress) {
      sessionProgress = [];
      this.progressHistory.set(sessionId, sessionProgress);
    }

    sessionProgress.push({ hash: progressHash, timestamp: Date.now() });

    if (sessionProgress.length > this.maxHistoryPerSession) {
      sessionProgress.shift();
    }

    this.log.debug(`Recorded progress hash for session ${sessionId}: ${progressHash}`);
  }

  /**
   * Detect lack of progress when the same hash appears repeatedly.
   */
  checkProgress(sessionId: string, threshold?: number): StuckLoopState {
    const sessionProgress = this.progressHistory.get(sessionId) ?? [];
    const required = threshold ?? this.progressThreshold;

    if (sessionProgress.length < required) {
      return { detected: false, toolName: "", count: 0, kind: "stall" };
    }

    const recent = sessionProgress.slice(-required);
    const firstHash = recent[0]?.hash;
    const allSame = recent.every((r) => r.hash === firstHash);

    if (allSame && firstHash) {
      this.log.warn(`Stall detected: no progress for ${required} checks (hash ${firstHash})`);
      return {
        detected: true,
        toolName: "NO_PROGRESS",
        count: required,
        kind: "stall",
      };
    }

    return { detected: false, toolName: "", count: 0, kind: "stall" };
  }

  clear(sessionId: string): void {
    this.history.delete(sessionId);
    this.progressHistory.delete(sessionId);
    this.log.debug(`Cleared stuck loop history for session ${sessionId}`);
  }

  prune(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let pruned = 0;

    for (const [sessionId, history] of this.history) {
      const filtered = history.filter((r) => now - r.timestamp < maxAgeMs);

      if (filtered.length === 0) {
        this.history.delete(sessionId);
        pruned++;
      } else if (filtered.length !== history.length) {
        this.history.set(sessionId, filtered);
      }
    }

    for (const [sessionId, history] of this.progressHistory) {
      const filtered = history.filter((r) => now - r.timestamp < maxAgeMs);

      if (filtered.length === 0) {
        this.progressHistory.delete(sessionId);
        pruned++;
      } else if (filtered.length !== history.length) {
        this.progressHistory.set(sessionId, filtered);
      }
    }

    return pruned;
  }
}

export function createStuckLoopDetector(config: Config): StuckLoopDetector {
  return new StuckLoopDetector(config);
}

/**
 * Build a human-readable intervention message for the model.
 */
export function getInterventionMessage(state: StuckLoopState): string {
  if (!state.detected) return "";

  if (state.kind === "stall") {
    return `WARNING: Has estado sin avanzar durante ${state.count} ciclos consecutivos. Revisa tu plan, intenta una herramienta diferente o pide aclaración al usuario en lugar de repetir la misma secuencia.`;
  }

  if (state.count >= 4) {
    return `CRITICAL: Has llamado ${state.toolName} ${state.count} veces con los mismos argumentos y sigue fallando con: "${state.lastError}". El usuario será notificado. Debes cambiar completamente de estrategia o pedir ayuda.`;
  }

  return `WARNING: Has llamado ${state.toolName} ${state.count} veces con los mismos argumentos y sigue fallando. Debes probar un enfoque diferente en lugar de repetir la misma acción.`;
}
