import { EventEmitter } from "events";
import { logger } from "../utils/logger";

export interface EventMap {
  "message:received": {
    channel: string;
    userId: string;
    content: string;
    timestamp: number;
    sessionId: string;
  };
  "message:sent": {
    channel: string;
    userId: string;
    content: string;
    messageId: string;
    sessionId: string;
  };
  "agent:thinking": {
    agentId: string;
    sessionId: string;
    stage: "planning" | "executing" | "responding";
  };
  "agent:response": {
    agentId: string;
    sessionId: string;
    content: string;
    toolsUsed: string[];
    duration: number;
  };
  "tool:executing": {
    toolName: string;
    args: Record<string, unknown>;
    sessionId: string;
  };
  "tool:completed": {
    toolName: string;
    result: unknown;
    duration: number;
    success: boolean;
  };
  "tool:error": {
    toolName: string;
    error: Error;
    args: Record<string, unknown>;
  };
  "error": {
    source: string;
    error: Error;
    context: Record<string, unknown>;
    recoverable: boolean;
  };
  "session:started": {
    sessionId: string;
    agentId: string;
    channel: string;
    userId: string;
  };
  "session:ended": {
    sessionId: string;
    duration: number;
    messageCount: number;
    reason: "completed" | "cancelled" | "error" | "timeout";
  };
  "mcp:connected": {
    serverName: string;
    toolsCount: number;
    resourcesCount: number;
  };
  "mcp:disconnected": {
    serverName: string;
    reason: string;
  };
  "mcp:error": {
    serverName: string;
    error: Error;
  };
  "channel:started": {
    channel: string;
    accountId: string;
  };
  "channel:stopped": {
    channel: string;
    accountId: string;
    reason: string;
  };
  "gateway:started": {
    host: string;
    port: number;
  };
  "gateway:stopped": {
    reason: string;
  };
  "pairing:requested": {
    channel: string;
    userId: string;
    code: string;
    expiresAt: number;
  };
  "pairing:approved": {
    channel: string;
    userId: string;
  };
  "pairing:rejected": {
    channel: string;
    userId: string;
    reason: string;
  };
  "pairing:expired": {
    code: string;
    channel: string;
    userId: string;
  };
}

export type EventKey = keyof EventMap;

export interface EventHandler<K extends EventKey> {
  (data: EventMap[K]): void | Promise<void>;
}

class TypedEventBusImpl {
  private emitter = new EventEmitter();
  private logPrefix = "[events]";

  emit<K extends EventKey>(event: K, data: EventMap[K]): void {
    const enrichedData = {
      ...data,
      _eventId: crypto.randomUUID(),
      _timestamp: Date.now(),
      _event: event,
    } as EventMap[K] & { _eventId: string; _timestamp: number; _event: string };

    this.emitter.emit(event, enrichedData);

    if (process.env.DEBUG_EVENTS === "true") {
      logger.debug(`${this.logPrefix} emitted: ${event}`, { data });
    }
  }

  on<K extends EventKey>(event: K, handler: EventHandler<K>): () => void {
    this.emitter.on(event, handler);
    return () => this.off(event, handler);
  }

  once<K extends EventKey>(event: K, handler: EventHandler<K>): void {
    this.emitter.once(event, handler);
  }

  off<K extends EventKey>(event: K, handler: EventHandler<K>): void {
    this.emitter.off(event, handler);
  }

  removeAllListeners<K extends EventKey>(event?: K): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  listenerCount<K extends EventKey>(event: K): number {
    return this.emitter.listenerCount(event);
  }
}

export const eventBus = new TypedEventBusImpl();

export type TypedEventBus = typeof eventBus;
