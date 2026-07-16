/**
 * Track B feasibility proof: HiveDB's subscribe()/events() (wrapped by
 * watchCausalEvents()) actually works for hive's use case — forward
 * delivery, pattern filtering, and clean shutdown — and explicitly proves
 * the "no historical replay" constraint documented in causal-events.ts
 * (subscribe()/events() are a pure in-process pub/sub, not a durable read
 * of the log — see hiveBD's reactive.rs).
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb, getHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { watchCausalEvents } from "../packages/core/src/storage/causal-events";
import type { CausalEvent } from "../packages/core/src/storage/causal-events";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("causal-events: watchCausalEvents()", () => {
  test("delivers only events matching the pattern, forward, in order", async () => {
    const stream = await watchCausalEvents({ agentId: "agent-x" });
    const db = await getHiveDb();

    await db.append({
      agentId: "agent-x",
      streamId: "s1",
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "agent-x", intent: "one" }),
    });
    await db.append({
      agentId: "agent-other",
      streamId: "s2",
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "agent-other", intent: "should be filtered out" }),
    });
    await db.append({
      agentId: "agent-x",
      streamId: "s1",
      kind: "StateTransition",
      payload: JSON.stringify({ description: "three" }),
    });

    const received: CausalEvent[] = [];
    const iterator = stream[Symbol.asyncIterator]();
    received.push((await iterator.next()).value!);
    received.push((await iterator.next()).value!);
    stream.close();

    expect(received.length).toBe(2);
    expect(received.every((e) => e.agentId === "agent-x")).toBe(true);
    expect(received.map((e) => e.kindTag)).toEqual(["IntentLogged", "StateTransition"]);
  });

  test("has no historical replay: events appended before subscribing are never delivered", async () => {
    const db = await getHiveDb();
    await db.append({
      agentId: "agent-y",
      streamId: "s1",
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "agent-y", intent: "pre-existing, must not be delivered" }),
    });

    // Subscribe AFTER the append above.
    const stream = await watchCausalEvents({ agentId: "agent-y" });
    const iterator = stream[Symbol.asyncIterator]();

    const raceResult = await Promise.race([
      iterator.next().then((r) => ({ type: "event" as const, value: r.value })),
      new Promise<{ type: "timeout" }>((resolve) => setTimeout(() => resolve({ type: "timeout" }), 200)),
    ]);
    expect(raceResult.type).toBe("timeout");

    // Prove the stream itself still works for a genuinely new event —
    // distinguishes "no replay" from "the stream is just broken".
    await db.append({
      agentId: "agent-y",
      streamId: "s1",
      kind: "StateTransition",
      payload: JSON.stringify({ description: "post-subscribe, must be delivered" }),
    });
    const { value: event } = await iterator.next();
    expect(event?.kindTag).toBe("StateTransition");

    stream.close();
  });

  test("close() ends the for-await loop cleanly and doesn't block a subsequent closeHiveDb()", async () => {
    const stream = await watchCausalEvents({ agentId: "agent-z" });
    const db = await getHiveDb();
    await db.append({
      agentId: "agent-z",
      streamId: "s1",
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "agent-z", intent: "one" }),
    });

    const collected: CausalEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
      stream.close();
    }

    expect(collected.length).toBe(1);
    // afterEach's closeHiveDb() must not hang/throw with this subscription
    // closed-but-not-drained — implicitly verified by the test completing.
  });
});
