import { logger } from "../utils/logger.ts";
import { eventBus } from "../events/event-bus.ts";

export interface WebSocketLike {
  readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): number | boolean;
  close(code?: number, reason?: string): void;
}

export interface A2UISurfaceInfo {
  surfaceId: string;
  catalogId?: string;
  theme?: Record<string, unknown>;
  hasComponents: boolean;
  hasDataModel: boolean;
}

export const WebSocketState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

interface A2UISurfaceCache {
  createData: Record<string, unknown>;
  components?: unknown[];
  dataModel?: Record<string, unknown>;
}

export class CanvasManager {
  private sessions: Map<string, WebSocketLike> = new Map();
  // Surfaces belong to a canvas session. Keeping this scoped prevents a
  // desktop reconnect (or another user) from receiving a surface addressed
  // to a different session and makes surface discovery deterministic.
  private a2uiCache: Map<string, Map<string, A2UISurfaceCache>> = new Map();
  private log = logger.child("canvas");
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    // Enviar ping a todas las sesiones cada 30 segundos
    this.heartbeatInterval = setInterval(() => {
      for (const [sessionId, ws] of this.sessions) {
        if (ws.readyState === WebSocketState.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "canvas:ping", sessionId }));
            this.log.debug(`Heartbeat sent to ${sessionId}`);
          } catch (e) {
            this.log.error(`Failed to send heartbeat to ${sessionId}`);
          }
        }
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  registerSession(sessionId: string, ws: WebSocketLike): void {
    this.sessions.set(sessionId, ws);
    this.log.info(`Canvas session registered: ${sessionId}`);

    eventBus.emit("tool:completed" as any, {
      toolName: "canvas:session:register",
      result: { sessionId },
      duration: 0,
      success: true,
    });

    // Notify the client that the session is registered
    ws.send(JSON.stringify({ type: "canvas:connected", sessionId }));

    // Replay cached A2UI surfaces for this session so late-connecting clients
    // get current state without leaking another session's surfaces.
    const sessionSurfaces = this.a2uiCache.get(sessionId) ?? new Map();
    this.a2uiCache.set(sessionId, sessionSurfaces);
    for (const [surfaceId, cache] of sessionSurfaces) {
      try {
        ws.send(JSON.stringify({ type: "a2ui:createSurface", data: cache.createData }));
        if (cache.components && cache.components.length > 0) {
          ws.send(JSON.stringify({ type: "a2ui:updateComponents", data: { surfaceId, components: cache.components } }));
        }
        if (cache.dataModel && Object.keys(cache.dataModel).length > 0) {
          ws.send(JSON.stringify({ type: "a2ui:updateDataModel", data: { surfaceId, path: undefined, value: cache.dataModel } }));
        }
        this.log.debug(`Replayed A2UI surface '${surfaceId}' to session ${sessionId}`);
      } catch (e) {
        this.log.warn(`Failed to replay A2UI surface '${surfaceId}' to ${sessionId}`);
      }
    }
  }

  unregisterSession(sessionId: string, ws?: WebSocketLike): void {
    if (ws && this.sessions.get(sessionId) !== ws) return;
    this.sessions.delete(sessionId);
    this.log.info(`Canvas session disconnected: ${sessionId}`);
  }

  async sendA2UIMessage(sessionId: string, messageType: string, data: Record<string, unknown>): Promise<void> {
    // Update A2UI cache so late-connecting clients can receive current state
    const surfaceId = data.surfaceId as string | undefined;
    if (surfaceId) {
      const sessionSurfaces = this.a2uiCache.get(sessionId) ?? new Map<string, A2UISurfaceCache>();
      this.a2uiCache.set(sessionId, sessionSurfaces);
      if (messageType === "a2ui:createSurface") {
        sessionSurfaces.set(surfaceId, { createData: data });
      } else if (messageType === "a2ui:updateComponents") {
        const cached = sessionSurfaces.get(surfaceId);
        if (cached) cached.components = data.components as unknown[];
      } else if (messageType === "a2ui:updateDataModel") {
        const cached = sessionSurfaces.get(surfaceId);
        if (cached) {
          const path = data.path as string | undefined;
          const value = data.value as Record<string, unknown>;
          if (!path || path === "/") {
            cached.dataModel = value;
          } else {
            cached.dataModel = cached.dataModel ?? {};
            // Store the full model snapshot when possible; partial paths accumulate
            const key = path.replace(/^\//, "").split("/")[0];
            if (key) cached.dataModel[key] = value;
          }
        }
      } else if (messageType === "a2ui:deleteSurface") {
        sessionSurfaces.delete(surfaceId);
      }
    }

    const ws = this.sessions.get(sessionId);

    if (!ws || ws.readyState !== WebSocketState.OPEN) {
      const connected = this.getConnectedSessions();
      this.log.warn(`Session ${sessionId} NOT connected for A2UI message. Cached for replay. Available: ${connected.join(", ")}`);
      return;
    }

    ws.send(JSON.stringify({ type: messageType, data }));
    this.log.debug(`Sent A2UI message '${messageType}' to session ${sessionId}`);
  }

  isSessionConnected(sessionId: string): boolean {
    const ws = this.sessions.get(sessionId);
    return ws !== undefined && ws.readyState === WebSocketState.OPEN;
  }

  getConnectedSessions(): string[] {
    return Array.from(this.sessions.entries())
      .filter(([_, ws]) => ws.readyState === WebSocketState.OPEN)
      .map(([id]) => id);
  }

  getStats(): { totalSessions: number; activeSessions: number } {
    return {
      totalSessions: this.sessions.size,
      activeSessions: this.getConnectedSessions().length,
    };
  }

  getA2UISurfaces(sessionId: string): A2UISurfaceInfo[] {
    const surfaces = this.a2uiCache.get(sessionId);
    if (!surfaces) return [];

    return Array.from(surfaces.entries()).map(([surfaceId, cache]) => ({
      surfaceId,
      catalogId: cache.createData.catalogId as string | undefined,
      theme: cache.createData.theme as Record<string, unknown> | undefined,
      hasComponents: Boolean(cache.components?.length),
      hasDataModel: Boolean(cache.dataModel && Object.keys(cache.dataModel).length > 0),
    }));
  }

  clearAll(): void {
    this.stopHeartbeat();
    this.sessions.clear();
    this.a2uiCache.clear();
    this.log.info("Canvas manager cleared");
  }
}

export const canvasManager = new CanvasManager();
