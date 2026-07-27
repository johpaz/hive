/**
 * Unit tests for the HiveDB collection helpers (storage/hive.ts) and the
 * bootstrap entry point (storage/bootstrap.ts). Uses an in-memory database
 * (HIVE_DB_PATH=":memory:") so no state persists between runs.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col, nextId, updateDoc, updateManyByIndex, findByAny, bumpRollup } from "../packages/core/src/storage/hive";
import { ensureHiveDb, isBootstrapped } from "../packages/core/src/storage/bootstrap";
import {
  acknowledgeNotification,
  createNotification,
  listPendingNotifications,
} from "../packages/core/src/gateway/notification-inbox";

beforeEach(() => {
  closeHiveDb();
});

describe("storage/hive.ts helpers", () => {
  test("nextId produces a monotonically increasing, lexicographically sortable sequence", async () => {
    const a = await nextId("test-counter");
    const b = await nextId("test-counter");
    const c = await nextId("test-counter");
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(a).toBe("000000000000001");
    expect(c).toBe("000000000000003");
  });

  test("nextId keeps separate counters independent", async () => {
    const a1 = await nextId("counter-a");
    const b1 = await nextId("counter-b");
    const a2 = await nextId("counter-a");
    expect(a1).toBe("000000000000001");
    expect(b1).toBe("000000000000001");
    expect(a2).toBe("000000000000002");
  });

  test("updateDoc merges a patch into an existing document", async () => {
    const c = await col<{ name: string; active: boolean }>("widgets");
    await c.put("w1", { name: "Widget", active: false });
    const updated = await updateDoc<{ name: string; active: boolean }>("widgets", "w1", { active: true });
    expect(updated).toEqual({ name: "Widget", active: true });
    const fromDb = await c.get("w1");
    expect(fromDb?.doc).toEqual({ name: "Widget", active: true });
  });

  test("updateDoc throws for a missing document", async () => {
    await expect(updateDoc("widgets", "missing", { active: true })).rejects.toThrow("not found");
  });

  test("updateManyByIndex patches every doc matching an indexed field", async () => {
    const c = await col<{ provider_id: string; active: boolean }>("models_test");
    await c.createIndex("provider_id");
    await c.put("m1", { provider_id: "openai", active: true });
    await c.put("m2", { provider_id: "openai", active: true });
    await c.put("m3", { provider_id: "anthropic", active: true });

    const count = await updateManyByIndex<{ provider_id: string; active: boolean }>(
      "models_test", "provider_id", "openai", { active: false }
    );
    expect(count).toBe(2);
    expect((await c.get("m1"))?.doc.active).toBe(false);
    expect((await c.get("m2"))?.doc.active).toBe(false);
    expect((await c.get("m3"))?.doc.active).toBe(true);
  });

  test("findByAny emulates WHERE field IN (...)", async () => {
    const c = await col<{ agent_id: string }>("bus_test");
    await c.createIndex("agent_id");
    await c.put("msg1", { agent_id: "a1" });
    await c.put("msg2", { agent_id: "a2" });
    await c.put("msg3", { agent_id: "a3" });

    const rows = await findByAny<{ agent_id: string }>("bus_test", "agent_id", ["a1", "a3", "a3"]);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["msg1", "msg3"]);
  });

  test("bumpRollup accumulates deltas and nested breakdowns across calls", async () => {
    await bumpRollup("usageRollups_test", "hour:2026-07-08T10", { inputTokens: 100, costUsd: 0.5 }, { field: "byProvider", key: "openai" });
    await bumpRollup("usageRollups_test", "hour:2026-07-08T10", { inputTokens: 50, costUsd: 0.2 }, { field: "byProvider", key: "openai" });
    await bumpRollup("usageRollups_test", "hour:2026-07-08T10", { inputTokens: 10, costUsd: 0.1 }, { field: "byProvider", key: "anthropic" });

    const c = await col<any>("usageRollups_test");
    const doc = (await c.get("hour:2026-07-08T10"))?.doc;
    expect(doc.inputTokens).toBe(160);
    expect(doc.costUsd).toBeCloseTo(0.8);
    expect(doc.byProvider.openai.inputTokens).toBe(150);
    expect(doc.byProvider.anthropic.inputTokens).toBe(10);
  });
});

describe("durable WebChat notification inbox", () => {
  test("keeps a notification pending until its owner acknowledges it", async () => {
    const notifications = await col("notifications");
    await notifications.createIndex("user_id");
    const notification = await createNotification({
      userId: "user-a",
      channel: "webchat",
      message: "Trabajo terminado",
    });

    expect(await listPendingNotifications("user-a", "webchat")).toHaveLength(1);
    expect(await acknowledgeNotification(notification.id, "user-b")).toBe(false);
    expect(await listPendingNotifications("user-a", "webchat")).toHaveLength(1);

    expect(await acknowledgeNotification(notification.id, "user-a")).toBe(true);
    expect(await listPendingNotifications("user-a", "webchat")).toHaveLength(0);
  });
});

describe("storage/bootstrap.ts", () => {
  test("ensureHiveDb is idempotent and marks bootstrapped", async () => {
    expect(isBootstrapped()).toBe(false);
    await ensureHiveDb();
    expect(isBootstrapped()).toBe(true);
    await ensureHiveDb(); // second call must not throw (idempotent indexes + schemaVersion put)

    const meta = await col<{ value: number }>("meta");
    const version = await meta.get("schemaVersion");
    expect(version?.doc.value).toBe(1);
  });
});
