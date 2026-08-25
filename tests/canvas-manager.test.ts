import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  CanvasManager,
  WebSocketState,
  type WebSocketLike,
} from "../packages/core/src/canvas/canvas-manager.ts";

describe("A2UI session manager", () => {
  let manager: CanvasManager;

  const createMockWebSocket = (): WebSocketLike & { messages: string[] } => {
    const messages: string[] = [];
    return {
      readyState: WebSocketState.OPEN,
      send: (data: string) => {
        messages.push(data);
        return true;
      },
      close: () => {},
      messages,
    };
  };

  beforeEach(() => {
    manager = new CanvasManager();
  });

  afterEach(() => {
    manager.clearAll();
  });

  it("registers visual sessions and reports connection stats", () => {
    const ws = createMockWebSocket();
    manager.registerSession("session-1", ws);

    expect(manager.isSessionConnected("session-1")).toBe(true);
    expect(manager.getStats()).toEqual({ totalSessions: 1, activeSessions: 1 });
  });

  it("sends A2UI messages to a connected session", async () => {
    const ws = createMockWebSocket();
    manager.registerSession("session-1", ws);

    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", {
      surfaceId: "profile",
      catalogId: "basic",
    });

    expect(JSON.parse(ws.messages.at(-1)!)).toEqual({
      type: "a2ui:createSurface",
      data: { surfaceId: "profile", catalogId: "basic" },
    });
  });

  it("replays cached A2UI structure and data to late clients", async () => {
    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", {
      surfaceId: "profile",
      catalogId: "basic",
    });
    await manager.sendA2UIMessage("session-1", "a2ui:updateComponents", {
      surfaceId: "profile",
      components: [{ id: "root", component: "Text", text: "Perfil" }],
    });
    await manager.sendA2UIMessage("session-1", "a2ui:updateDataModel", {
      surfaceId: "profile",
      value: { name: "Ana" },
    });

    const ws = createMockWebSocket();
    manager.registerSession("session-1", ws);
    const messages = ws.messages.map((message) => JSON.parse(message));

    expect(messages.some((message) => message.type === "a2ui:createSurface")).toBe(true);
    expect(messages.some((message) => message.type === "a2ui:updateComponents")).toBe(true);
    expect(messages.some((message) => message.type === "a2ui:updateDataModel")).toBe(true);
  });

  it("does not replay deleted surfaces", async () => {
    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", {
      surfaceId: "temporary",
      catalogId: "basic",
    });
    await manager.sendA2UIMessage("session-1", "a2ui:deleteSurface", {
      surfaceId: "temporary",
    });

    const ws = createMockWebSocket();
    manager.registerSession("session-1", ws);

    expect(
      ws.messages
        .map((message) => JSON.parse(message))
        .some((message) => message.type === "a2ui:createSurface"),
    ).toBe(false);
  });

  it("keeps surface discovery and replay isolated per session", async () => {
    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", {
      surfaceId: "private-1",
      catalogId: "basic",
    });

    expect(manager.getA2UISurfaces("session-1")).toEqual([{
      surfaceId: "private-1",
      catalogId: "basic",
      theme: undefined,
      hasComponents: false,
      hasDataModel: false,
    }]);
    expect(manager.getA2UISurfaces("session-2")).toEqual([]);

    const otherSession = createMockWebSocket();
    manager.registerSession("session-2", otherSession);
    expect(otherSession.messages.some((message) => message.includes("private-1"))).toBe(false);
  });

  it("clears sessions and replay state", async () => {
    const ws = createMockWebSocket();
    manager.registerSession("session-1", ws);
    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", {
      surfaceId: "profile",
      catalogId: "basic",
    });

    manager.clearAll();

    expect(manager.getStats()).toEqual({ totalSessions: 0, activeSessions: 0 });
  });

  it("entrega a todas las ventanas de la misma sesión", async () => {
    // La regresión: el identificador es `canvas:<usuario>`, igual para la app
    // de escritorio y para la pestaña del navegador. Con un solo socket
    // guardado, la que se conectaba después le robaba el sitio a la otra y el
    // panel de la perdedora se quedaba vacío para siempre, sin un solo error.
    const escritorio = createMockWebSocket();
    const navegador = createMockWebSocket();
    manager.registerSession("session-1", escritorio);
    manager.registerSession("session-1", navegador);

    expect(manager.countClients("session-1")).toBe(2);

    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", { surfaceId: "saludo" });

    for (const ws of [escritorio, navegador]) {
      expect(ws.messages.some((m) => m.includes("a2ui:createSurface"))).toBe(true);
    }
  });

  it("suscribirse dos veces con el mismo socket no cuenta como dos ventanas", () => {
    // El cliente pide `canvas_subscribe` al abrir el socket y otra vez al
    // arrancar su tienda; son el mismo cliente.
    const ws = createMockWebSocket();
    const primero = manager.registerSession("session-1", ws);
    const segundo = manager.registerSession("session-1", ws);

    expect(primero).toBe(segundo);
    expect(manager.countClients("session-1")).toBe(1);
  });

  it("cerrar una ventana no deja sordas a las demás", async () => {
    const escritorio = createMockWebSocket();
    const navegador = createMockWebSocket();
    manager.registerSession("session-1", escritorio);
    manager.registerSession("session-1", navegador);

    manager.unregisterSession("session-1", navegador);
    expect(manager.countClients("session-1")).toBe(1);
    expect(manager.isSessionConnected("session-1")).toBe(true);

    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", { surfaceId: "saludo" });
    expect(escritorio.messages.some((m) => m.includes("a2ui:createSurface"))).toBe(true);
  });

  it("retira sola una ventana cuyo socket ya está cerrado", async () => {
    const viva = createMockWebSocket();
    const muerta = createMockWebSocket();
    manager.registerSession("session-1", viva);
    manager.registerSession("session-1", muerta);

    muerta.readyState = WebSocketState.CLOSED;
    expect(manager.countClients("session-1")).toBe(1);

    await manager.sendA2UIMessage("session-1", "a2ui:createSurface", { surfaceId: "saludo" });
    expect(muerta.messages.some((m) => m.includes("a2ui:createSurface"))).toBe(false);
    expect(viva.messages.some((m) => m.includes("a2ui:createSurface"))).toBe(true);
  });

  it("cada ventana recibe un código propio, y el latido lo devuelve", () => {
    const a = createMockWebSocket();
    const b = createMockWebSocket();
    const codigoA = manager.registerSession("session-1", a);
    const codigoB = manager.registerSession("session-1", b);

    expect(codigoA).not.toBe(codigoB);
    // El servidor se lo dice a cada una al registrarla: es lo que devolverán
    // en el pong para demostrar que siguen ahí.
    expect(a.messages.some((m) => m.includes(`"connId":"${codigoA}"`))).toBe(true);
    expect(b.messages.some((m) => m.includes(`"connId":"${codigoB}"`))).toBe(true);
    manager.markAlive(codigoA);
  });
});
