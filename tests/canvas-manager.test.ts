import { describe, it, expect, beforeEach, vi } from "bun:test";
import { CanvasManager, WebSocketState, type WebSocketLike } from "../packages/core/src/canvas/canvas-manager.ts";

describe("CanvasManager", () => {
  let manager: CanvasManager;

  const createMockWebSocket = (): WebSocketLike & { messages: string[] } => {
    const messages: string[] = [];
    const handlers: Map<string, (data: unknown) => void> = new Map();

    return {
      readyState: WebSocketState.OPEN,
      send: (data: string) => {
        messages.push(data);
        return true;
      },
      on: (event: string, callback: (data: unknown) => void) => {
        handlers.set(event, callback);
      },
      close: () => { },
      messages,
    } as unknown as WebSocketLike & { messages: string[] };
  };

  beforeEach(() => {
    manager = new CanvasManager();
  });

  describe("registerSession", () => {
    it("should register a session", () => {
      const ws = createMockWebSocket();
      manager.registerSession("session-1", ws);

      expect(manager.isSessionConnected("session-1")).toBe(true);
    });

    it("should track session stats", () => {
      const ws = createMockWebSocket();
      manager.registerSession("session-1", ws);

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(1);
      expect(stats.activeSessions).toBe(1);
    });
  });

  describe("render", () => {
    it("should send render message to session", async () => {
      const ws = createMockWebSocket();
      manager.registerSession("session-1", ws);

      const component = {
        id: "btn-1",
        type: "button" as const,
        props: { label: "Click me" },
      };

      await manager.render("session-1", component);

      expect(ws.messages.length).toBe(1);
      const msg = JSON.parse(ws.messages[0]!);
      expect(msg.type).toBe("canvas:render");
      expect(msg.payload.component.id).toBe("btn-1");
    });

    it("should throw for disconnected session", async () => {
      await expect(manager.render("unknown", { id: "x", type: "button", props: {} })).rejects.toThrow(
        "Session not connected"
      );
    });
  });

  describe("update", () => {
    it("should send update message to session", async () => {
      const ws = createMockWebSocket();
      manager.registerSession("session-1", ws);

      const component = {
        id: "btn-1",
        type: "button" as const,
        props: { label: "Updated" },
      };

      await manager.update("session-1", component);

      expect(ws.messages.length).toBe(1);
      const msg = JSON.parse(ws.messages[0]!);
      expect(msg.type).toBe("canvas:update");
    });
  });

  describe("clear", () => {
    it("should send clear message to session", async () => {
      const ws = createMockWebSocket();
      manager.registerSession("session-1", ws);

      await manager.clear("session-1");

      expect(ws.messages.length).toBe(1);
      const msg = JSON.parse(ws.messages[0]!);
      expect(msg.type).toBe("canvas:clear");
    });
  });

  describe("waitForInteraction", () => {
    it("should resolve when interaction is received", async () => {
      const ws = createMockWebSocket();
      manager.registerSession("session-1", ws);

      const component = { id: "form-1", type: "form" as const, props: {} };
      await manager.render("session-1", component);

      const interactionPromise = manager.waitForInteraction("session-1", "form-1", 5000);

      manager.handleInteraction("session-1", "form-1", { name: "John" });

      const result = await interactionPromise;
      expect(result).toEqual({ name: "John" });
    });
  });

  describe("getStats", () => {
    it("should return correct stats", () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      manager.registerSession("session-1", ws1);
      manager.registerSession("session-2", ws2);

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2);
    });
  });

  describe("getConnectedSessions", () => {
    it("should list connected sessions", () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      manager.registerSession("session-1", ws1);
      manager.registerSession("session-2", ws2);

      const sessions = manager.getConnectedSessions();
      expect(sessions).toContain("session-1");
      expect(sessions).toContain("session-2");
    });
  });

  describe("clearAll", () => {
    it("should clear all sessions and pending interactions", () => {
      const ws = createMockWebSocket();
      manager.registerSession("session-1", ws);

      manager.clearAll();

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(0);
    });
  });
});
