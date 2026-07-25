process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  publishNarration,
  setNarrationDelivery,
} from "../packages/core/src/events/narration";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";
import type { NarrationEventDoc } from "../packages/core/src/storage/collections";

beforeEach(() => closeHiveDb());
afterEach(() => {
  setNarrationDelivery(null);
  closeHiveDb();
});

describe("channel-independent narration", () => {
  test("persists before delivery and deduplicates important events", async () => {
    const delivered: string[] = [];
    setNarrationDelivery(async (event) => {
      const persisted = await (await col<NarrationEventDoc>("narrationEvents")).get(event.id);
      expect(persisted?.doc.id).toBe(event.id);
      delivered.push(`${event.channel}:${event.label}`);
    });

    const input = {
      turnId: "turn-1",
      threadId: "thread-1",
      channel: "telegram",
      userId: "user-1",
      sessionId: "chat-1",
      agentId: "worker-a",
      agentName: "Agente A",
      kind: "tool_call" as const,
      status: "running" as const,
      label: "Agente A llamó api_request",
      dedupeKey: "tool:1:api_request",
    };
    const first = await publishNarration(input);
    const second = await publishNarration(input);

    expect(second.id).toBe(first.id);
    expect(delivered).toEqual(["telegram:Agente A llamó api_request"]);
    expect(await (await col<NarrationEventDoc>("narrationEvents")).count()).toBe(1);
  });
});
