import { EventEmitter } from "events";
import { logger } from "../utils/logger.ts";
import { eventBus } from "../events/event-bus.ts";

export interface WebSocketLike {
  readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): number | boolean;
  close(code?: number, reason?: string): void;
}

export const WebSocketState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

export interface CanvasComponent {
  id: string;
  type: "button" | "form" | "chart" | "table" | "markdown" | "text" | "image" | "card" | "progress" | "list" | "confirm";
  props: Record<string, unknown>;
  span?: "full" | "half";
}

export interface CanvasMessage {
  type: "canvas:render" | "canvas:update" | "canvas:clear" | "canvas:interact" | "canvas:connected" | "canvas:snapshot";
  sessionId: string;
  componentId?: string;
  component?: CanvasComponent;
  action?: string;
  data?: unknown;
}

export interface InteractionEvent {
  sessionId: string;
  componentId: string;
  action: string;
  data: unknown;
}

interface PendingInteraction {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface A2UISurfaceCache {
  createData: Record<string, unknown>;
  components?: unknown[];
  dataModel?: Record<string, unknown>;
}

export class CanvasManager extends EventEmitter {
  private sessions: Map<string, WebSocketLike> = new Map();
  private pendingInteractions: Map<string, PendingInteraction> = new Map();
  private componentCache: Map<string, CanvasComponent[]> = new Map();
  private a2uiCache: Map<string, A2UISurfaceCache> = new Map();
  private log = logger.child("canvas");
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
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

    // Replay any cached A2UI surfaces so late-connecting clients get current state
    for (const [surfaceId, cache] of this.a2uiCache) {
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

  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.cleanupPendingInteractions(sessionId);
    this.log.info(`Canvas session disconnected: ${sessionId}`);
  }

  handleMessage(sessionId: string, data: unknown): void {
    try {
      const msg = JSON.parse(data as string);

      this.log.debug(`Received message from session ${sessionId}: ${msg.type}`);

      // === HANDSHAKE INICIAL ===
      if (msg.type === "canvas:handshake") {
        this.log.debug(`Handshake received from ${sessionId}`, msg);
        const ws = this.sessions.get(sessionId);

        // Confirmar handshake
        if (ws && ws.readyState === WebSocketState.OPEN) {
          ws.send(JSON.stringify({
            type: "canvas:handshake:ack",
            sessionId,
            serverSessionId: sessionId,
            timestamp: Date.now()
          }));
        }
        return;
      }

      // === HEARTBEAT: PING DEL CLIENTE ===
      if (msg.type === "canvas:ping") {
        const ws = this.sessions.get(sessionId);
        if (ws && ws.readyState === WebSocketState.OPEN) {
          ws.send(JSON.stringify({ type: "canvas:pong", sessionId }));
        }
        return;
      }

      // === PONG DEL CLIENTE (opcional) ===
      if (msg.type === "canvas:pong") {
        // El cliente respondió al ping del servidor - conexión viva
        this.log.debug(`Pong received from ${sessionId}`);
        return;
      }

      if (msg.type === "canvas:interact") {
        const { componentId, action, data: interactionData } = msg.payload || msg;

        if (componentId) {
          this.resolveInteraction(sessionId, componentId, interactionData);
        }

        this.emit("interaction", {
          sessionId,
          componentId,
          action,
          data: interactionData,
        } as InteractionEvent);
      } else if (msg.type === "canvas:get_cached") {
        const components = this.getSessionComponents(sessionId);
        const ws = this.sessions.get(sessionId);

        this.log.info(`Sending ${components.length} cached components to session ${sessionId}`);

        if (ws && ws.readyState === WebSocketState.OPEN) {
          for (const component of components) {
            ws.send(JSON.stringify({
              type: "canvas:render",
              sessionId,
              component
            }));
          }
        }
      }
    } catch (error) {
      this.log.error(`Invalid canvas message: ${(error as Error).message}`);
    }
  }

  private resolveInteraction(sessionId: string, componentId: string, data: unknown): void {
    const key = `${sessionId}:${componentId}`;
    const pending = this.pendingInteractions.get(key);

    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingInteractions.delete(key);

      // Remove from cache so it doesn't reappear in the next snapshot
      const cached = this.componentCache.get(sessionId);
      if (cached) {
        this.componentCache.set(sessionId, cached.filter(c => c.id !== componentId));
      }

      pending.resolve(data);
    }
  }

  async render(sessionId: string, component: CanvasComponent): Promise<void> {
    // Always cache the component for later retrieval
    const cached = this.componentCache.get(sessionId) || [];
    const existingIdx = cached.findIndex(c => c.id === component.id);
    if (existingIdx >= 0) {
      cached[existingIdx] = component;
    } else {
      cached.push(component);
    }
    this.componentCache.set(sessionId, cached);

    const ws = this.sessions.get(sessionId);

    if (!ws || ws.readyState !== WebSocketState.OPEN) {
      // Session not connected, but we cached the component
      this.log.debug(`Session ${sessionId} NOT connected. Available: ${this.getConnectedSessions().join(", ")}`);
      return;
    }

    const message: CanvasMessage = {
      type: "canvas:render",
      sessionId,
      component,
    };

    this.log.debug(`Sending render to session ${sessionId}: ${component.id}`);
    ws.send(JSON.stringify(message));
    this.log.debug(`Rendered component ${component.id} to session ${sessionId}`);
  }

  async update(sessionId: string, component: CanvasComponent): Promise<void> {
    const ws = this.sessions.get(sessionId);

    if (!ws || ws.readyState !== WebSocketState.OPEN) {
      throw new Error(`Session not connected: ${sessionId}`);
    }

    const message: CanvasMessage = {
      type: "canvas:update",
      sessionId,
      component,
    };

    ws.send(JSON.stringify(message));
    this.log.debug(`Updated component ${component.id} in session ${sessionId}`);
  }

  async clear(sessionId: string): Promise<void> {
    const ws = this.sessions.get(sessionId);

    if (!ws || ws.readyState !== WebSocketState.OPEN) {
      throw new Error(`Session not connected: ${sessionId}`);
    }

    const message: CanvasMessage = {
      type: "canvas:clear",
      sessionId,
    };

    ws.send(JSON.stringify(message));
    this.log.debug(`Cleared canvas for session ${sessionId}`);
  }

  async sendA2UIMessage(sessionId: string, messageType: string, data: Record<string, unknown>): Promise<void> {
    // Update A2UI cache so late-connecting clients can receive current state
    const surfaceId = data.surfaceId as string | undefined;
    if (surfaceId) {
      if (messageType === "a2ui:createSurface") {
        this.a2uiCache.set(surfaceId, { createData: data });
      } else if (messageType === "a2ui:updateComponents") {
        const cached = this.a2uiCache.get(surfaceId);
        if (cached) cached.components = data.components as unknown[];
      } else if (messageType === "a2ui:updateDataModel") {
        const cached = this.a2uiCache.get(surfaceId);
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
        this.a2uiCache.delete(surfaceId);
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

  async waitForInteraction(
    sessionId: string,
    componentId: string,
    timeout = 300000
  ): Promise<unknown> {
    const key = `${sessionId}:${componentId}`;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingInteractions.delete(key);
        reject(new Error(`Interaction timeout for ${componentId}`));
      }, timeout);

      this.pendingInteractions.set(key, { resolve, reject, timeoutId });
    });
  }

  handleInteraction(sessionId: string, componentId: string, data: unknown): void {
    this.resolveInteraction(sessionId, componentId, data);
  }

  getSessionComponents(sessionId: string): CanvasComponent[] {
    return this.componentCache.get(sessionId) || [];
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

  getStats(): { totalSessions: number; activeSessions: number; pendingInteractions: number } {
    return {
      totalSessions: this.sessions.size,
      activeSessions: this.getConnectedSessions().length,
      pendingInteractions: this.pendingInteractions.size,
    };
  }

  private cleanupPendingInteractions(sessionId: string): void {
    for (const [key, pending] of this.pendingInteractions) {
      if (key.startsWith(`${sessionId}:`)) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error(`Session disconnected: ${sessionId}`));
        this.pendingInteractions.delete(key);
      }
    }
  }

  clearAll(): void {
    this.stopHeartbeat();

    for (const pending of this.pendingInteractions.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Canvas manager cleared"));
    }

    this.pendingInteractions.clear();
    this.sessions.clear();
    this.log.info("Canvas manager cleared");
  }
}

export const canvasManager = new CanvasManager();
