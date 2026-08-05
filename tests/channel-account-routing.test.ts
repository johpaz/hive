process.env.HIVE_DB_PATH = ":memory:";

import { describe, expect, test } from "bun:test";
import { ChannelManager } from "../packages/core/src/channels/manager";
import type { IChannel, IncomingMessage, MessageHandler, OutboundMessage } from "../packages/core/src/channels/base";
import type { Config } from "../packages/core/src/config/loader";

/** Minimal channel double: records what it was asked to send and can emit inbound messages. */
class FakeChannel implements IChannel {
  name = "whatsapp";
  config = { enabled: true, dmPolicy: "open" as const, allowFrom: [] };
  sent: Array<{ sessionId: string; content?: string }> = [];
  typing: string[] = [];
  private handler?: MessageHandler;

  constructor(public accountId: string) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  isRunning(): boolean { return true; }
  onMessage(handler: MessageHandler): void { this.handler = handler; }
  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    this.sent.push({ sessionId, content: message.content });
  }
  async startTyping(sessionId: string): Promise<void> { this.typing.push(sessionId); }

  /** Simulates an inbound message arriving on this account. */
  async receive(sessionId: string): Promise<void> {
    await this.handler?.({
      sessionId, channel: "whatsapp", accountId: this.accountId,
      peerId: sessionId, peerKind: "direct", content: "hola",
    } as IncomingMessage);
  }
}

function managerWith(...accounts: string[]): { manager: ChannelManager; channels: FakeChannel[] } {
  const manager = new ChannelManager({} as Config);
  const channels = accounts.map((id) => new FakeChannel(id));
  channels.forEach((channel) => {
    (manager as any).registerChannel(`whatsapp:${channel.accountId}`, channel);
  });
  return { manager, channels };
}

describe("multi-account routing", () => {
  test("replies go out through the account that received the message", async () => {
    const { manager, channels } = managerWith("acc-a", "acc-b");
    const [first, second] = channels as [FakeChannel, FakeChannel];

    // The peer talks to the *second* account — the one a name-only lookup misses.
    await second.receive("573001112233");
    await manager.send("whatsapp", "573001112233", { content: "respuesta" });

    expect(second.sent).toEqual([{ sessionId: "573001112233", content: "respuesta" }]);
    expect(first.sent).toEqual([]);
  });

  test("typing indicators follow the same account", async () => {
    const { manager, channels } = managerWith("acc-a", "acc-b");
    const [first, second] = channels as [FakeChannel, FakeChannel];

    await second.receive("573001112233");
    await manager.startTyping("whatsapp", "573001112233");

    expect(second.typing).toEqual(["573001112233"]);
    expect(first.typing).toEqual([]);
  });

  test("an explicit account overrides the recorded one", async () => {
    const { manager, channels } = managerWith("acc-a", "acc-b");
    const [first, second] = channels as [FakeChannel, FakeChannel];

    await second.receive("573001112233");
    await manager.send("whatsapp", "573001112233", { content: "forzado" }, "acc-a");

    expect(first.sent).toHaveLength(1);
    expect(second.sent).toEqual([]);
  });

  test("an unknown explicit account fails instead of using another one", async () => {
    const { manager, channels } = managerWith("acc-a", "acc-b");

    await expect(
      manager.send("whatsapp", "573001112233", { content: "x" }, "acc-missing")
    ).rejects.toThrow("Channel not found: whatsapp");
    expect(channels.every((c) => c.sent.length === 0)).toBe(true);
  });

  test("an unseen session still routes through the single connected account", async () => {
    const { manager, channels } = managerWith("acc-only");

    await manager.send("whatsapp", "573009998877", { content: "notificación" });

    expect(channels[0]!.sent).toHaveLength(1);
  });

  test("removing an account releases its sessions to the remaining one", async () => {
    const { manager, channels } = managerWith("acc-a", "acc-b");
    const [first, second] = channels as [FakeChannel, FakeChannel];

    await second.receive("573001112233");
    await manager.removeChannel("whatsapp", "acc-b");
    await manager.send("whatsapp", "573001112233", { content: "tras eliminar" });

    expect(first.sent).toHaveLength(1);
    expect(second.sent).toEqual([]);
  });

  test("each account keeps its own peers apart", async () => {
    const { manager, channels } = managerWith("acc-a", "acc-b");
    const [first, second] = channels as [FakeChannel, FakeChannel];

    await first.receive("111");
    await second.receive("222");
    await manager.send("whatsapp", "111", { content: "para A" });
    await manager.send("whatsapp", "222", { content: "para B" });

    expect(first.sent).toEqual([{ sessionId: "111", content: "para A" }]);
    expect(second.sent).toEqual([{ sessionId: "222", content: "para B" }]);
  });
});
