import { describe, expect, test } from "bun:test";
import { WebChatChannel } from "../packages/core/src/channels/webchat";
import { SessionManager } from "../packages/core/src/gateway/session";
import { CanvasManager, WebSocketState } from "../packages/core/src/canvas/canvas-manager";

function fakeSocket() {
  return {
    readyState: WebSocketState.OPEN,
    sent: [] as string[],
    send(data: string | ArrayBuffer | Uint8Array) {
      this.sent.push(String(data));
      return true;
    },
    close() {},
    data: { sessionId: "same-user", peerId: "same-user", authenticatedAt: Date.now() },
  };
}

describe("WebChat connection ownership", () => {
  test("an old socket closing cannot unregister its replacement", async () => {
    const channel = new WebChatChannel({ enabled: true, dmPolicy: "open", allowFrom: [] });
    const oldSocket = fakeSocket();
    const newSocket = fakeSocket();

    channel.registerConnection(oldSocket as any);
    channel.registerConnection(newSocket as any);
    channel.unregisterConnection("same-user", oldSocket as any);

    expect(channel.hasSession("same-user")).toBe(true);
    await channel.send("same-user", { type: "progress", sessionId: "same-user", content: "hola" });
    expect(newSocket.sent).toHaveLength(1);
  });

  test("session and canvas registries also preserve the replacement", () => {
    const sessions = new SessionManager();
    const canvas = new CanvasManager();
    const oldSocket = fakeSocket();
    const newSocket = fakeSocket();

    sessions.create("same-user", oldSocket as any);
    sessions.create("same-user", newSocket as any);
    canvas.registerSession("canvas:same-user", oldSocket as any);
    canvas.registerSession("canvas:same-user", newSocket as any);

    expect(sessions.deleteIfOwner("same-user", oldSocket as any)).toBe(false);
    canvas.unregisterSession("canvas:same-user", oldSocket as any);

    expect(sessions.get("same-user")?.ws).toBe(newSocket as any);
    expect(canvas.isSessionConnected("canvas:same-user")).toBe(true);
    canvas.clearAll();
  });
});
