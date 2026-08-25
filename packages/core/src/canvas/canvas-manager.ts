import { logger } from "../utils/logger.ts";
import { eventBus } from "../events/event-bus.ts";

export interface WebSocketLike {
  readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): number | boolean;
  close(code?: number, reason?: string): void;
}

/** Una conexión concreta a una sesión de lienzo. */
export interface CanvasClient {
  /** Código único de esta conexión: dos ventanas del mismo usuario son dos. */
  id: string;
  ws: WebSocketLike;
  /** Última señal de vida, en ms. La refresca el pong del latido. */
  lastSeen: number;
}

export interface A2UISurfaceInfo {
  surfaceId: string;
  catalogId?: string;
  theme?: Record<string, unknown>;
  hasComponents: boolean;
  hasDataModel: boolean;
}

/** Cada cuánto se pregunta si el cliente sigue ahí. */
const PING_MS = 30_000;
/** Latidos sin respuesta que se toleran antes de retirar una conexión. */
const TOLERANCIA_LATIDOS = 3;

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
  /**
   * Clientes por sesión, no *un* cliente por sesión.
   *
   * El identificador de sesión es `canvas:<usuario>`, el mismo para la app de
   * escritorio, para la pestaña del navegador y para cada reconexión. Con un
   * único socket guardado, el que se conectaba después le robaba el sitio al
   * anterior: la ventana perdedora se quedaba con el panel vacío para siempre
   * mientras el servidor anotaba "enviado" sin un solo error.
   *
   * Indexado por el propio socket para que registrarse dos veces —el cliente
   * pide `canvas_subscribe` al conectar y al arrancar la tienda— no cuente como
   * dos clientes.
   */
  private sessions: Map<string, Map<WebSocketLike, CanvasClient>> = new Map();
  /** Todos los clientes por su código, para responder al latido en O(1). */
  private clients: Map<string, CanvasClient> = new Map();
  private nextClientId = 1;
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

    // Un latido que sólo saluda no sirve: éste también entierra. Un socket que
    // se fue sin avisar —la máquina suspendida, la red caída— se queda en
    // estado OPEN por el lado del servidor y seguiría recibiendo superficies
    // que no va a pintar nadie.
    this.heartbeatInterval = setInterval(() => {
      const limite = Date.now() - PING_MS * TOLERANCIA_LATIDOS;
      for (const sessionId of Array.from(this.sessions.keys())) {
        for (const cliente of this.clientesDe(sessionId)) {
          if (cliente.lastSeen < limite) {
            this.log.info(`Canvas client ${cliente.id} sin señales de vida; se retira`);
            this.olvidar(sessionId, cliente);
            continue;
          }
          try {
            cliente.ws.send(JSON.stringify({ type: "canvas:ping", sessionId, connId: cliente.id }));
          } catch {
            this.olvidar(sessionId, cliente);
          }
        }
      }
    }, PING_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** @returns el código de esta conexión, que el cliente usa para el latido. */
  registerSession(sessionId: string, ws: WebSocketLike): string {
    const clientes = this.sessions.get(sessionId) ?? new Map<WebSocketLike, CanvasClient>();
    this.sessions.set(sessionId, clientes);

    const yaEstaba = clientes.get(ws);
    const cliente: CanvasClient = yaEstaba ?? {
      id: `c${this.nextClientId++}`,
      ws,
      lastSeen: Date.now(),
    };
    cliente.lastSeen = Date.now();
    clientes.set(ws, cliente);
    this.clients.set(cliente.id, cliente);
    this.log.info(
      `Canvas session registered: ${sessionId} (cliente ${cliente.id}, ${clientes.size} en esta sesión)`,
    );

    eventBus.emit("tool:completed" as any, {
      toolName: "canvas:session:register",
      result: { sessionId },
      duration: 0,
      success: true,
    });

    // Notify the client that the session is registered
    ws.send(JSON.stringify({ type: "canvas:connected", sessionId, connId: cliente.id }));

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
    return cliente.id;
  }

  /** El cliente sigue ahí: contestó al latido. */
  markAlive(connId: string): void {
    const cliente = this.clients.get(connId);
    if (cliente) cliente.lastSeen = Date.now();
  }

  /** Clientes vivos de una sesión; de paso retira los sockets ya cerrados. */
  private clientesDe(sessionId: string): CanvasClient[] {
    const clientes = this.sessions.get(sessionId);
    if (!clientes) return [];
    const vivos: CanvasClient[] = [];
    for (const cliente of Array.from(clientes.values())) {
      if (cliente.ws.readyState === WebSocketState.OPEN) vivos.push(cliente);
      else this.olvidar(sessionId, cliente);
    }
    return vivos;
  }

  private olvidar(sessionId: string, cliente: CanvasClient): void {
    this.clients.delete(cliente.id);
    const clientes = this.sessions.get(sessionId);
    clientes?.delete(cliente.ws);
    if (clientes && clientes.size === 0) this.sessions.delete(sessionId);
  }

  unregisterSession(sessionId: string, ws?: WebSocketLike): void {
    const clientes = this.sessions.get(sessionId);
    if (!clientes) return;
    // Sin socket concreto se cierra la sesión entera; con él se va sólo esa
    // ventana, y las demás siguen recibiendo.
    if (!ws) {
      for (const cliente of clientes.values()) this.clients.delete(cliente.id);
      this.sessions.delete(sessionId);
      this.log.info(`Canvas session disconnected: ${sessionId}`);
      return;
    }
    const cliente = clientes.get(ws);
    if (!cliente) return;
    this.olvidar(sessionId, cliente);
    this.log.info(
      `Canvas client ${cliente.id} disconnected from ${sessionId} (quedan ${this.sessions.get(sessionId)?.size ?? 0})`,
    );
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

    const clientes = this.clientesDe(sessionId);
    if (clientes.length === 0) {
      const connected = this.getConnectedSessions();
      this.log.warn(`Session ${sessionId} NOT connected for A2UI message. Cached for replay. Available: ${connected.join(", ")}`);
      return;
    }

    // A todas las ventanas de esa sesión: el escritorio y la pestaña del
    // navegador son la misma persona mirando lo mismo desde dos sitios.
    const mensaje = JSON.stringify({ type: messageType, data });
    for (const cliente of clientes) {
      try {
        cliente.ws.send(mensaje);
      } catch {
        this.olvidar(sessionId, cliente);
      }
    }
    this.log.debug(`Sent A2UI message '${messageType}' to ${clientes.length} client(s) of ${sessionId}`);
  }

  isSessionConnected(sessionId: string): boolean {
    return this.clientesDe(sessionId).length > 0;
  }

  getConnectedSessions(): string[] {
    return Array.from(this.sessions.keys()).filter((id) => this.clientesDe(id).length > 0);
  }

  /** Cuántas ventanas miran esta sesión. Para diagnóstico. */
  countClients(sessionId: string): number {
    return this.clientesDe(sessionId).length;
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
    this.clients.clear();
    this.sessions.clear();
    this.a2uiCache.clear();
    this.log.info("Canvas manager cleared");
  }
}

export const canvasManager = new CanvasManager();
