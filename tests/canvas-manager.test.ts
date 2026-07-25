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
});
