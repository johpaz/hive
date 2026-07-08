/**
 * Scratchpad — integration tests
 *
 * Covers the first table migrated off SQLite onto a HiveDB document
 * collection: packages/core/src/agent/conversation-store.ts's scratchpad
 * functions on top of @johpaz/hive-db.
 *
 * Uses an in-memory index (HIVE_SEARCH_DB_PATH=":memory:") so no state
 * touches ~/.hive.
 */

process.env.HIVE_SEARCH_DB_PATH = ":memory:";

import { describe, test, expect, afterAll } from "bun:test";
import {
  saveScratchpadNote,
  getScratchpad,
  deleteScratchpadNote,
  listAllScratchpadNotes,
} from "../packages/core/src/agent/conversation-store";
import { closeSearchDb } from "../packages/core/src/storage/hivedb";

afterAll(() => {
  closeSearchDb();
});

describe("scratchpad (HiveDB collection)", () => {
  test("save then get round-trips a note", async () => {
    await saveScratchpadNote("t1", "greeting", "hola mundo", "agent");
    const notes = await getScratchpad("t1");
    expect(notes).toEqual([{ key: "greeting", value: "hola mundo" }]);
  });

  test("saving the same key again updates the value, not appends", async () => {
    await saveScratchpadNote("t2", "k", "v1");
    await saveScratchpadNote("t2", "k", "v2");
    const notes = await getScratchpad("t2");
    expect(notes).toEqual([{ key: "k", value: "v2" }]);
  });

  test("notes are scoped per thread", async () => {
    await saveScratchpadNote("t3", "a", "1");
    await saveScratchpadNote("t4", "b", "2");
    expect(await getScratchpad("t3")).toEqual([{ key: "a", value: "1" }]);
    expect(await getScratchpad("t4")).toEqual([{ key: "b", value: "2" }]);
  });

  test("most recently updated note comes first", async () => {
    await saveScratchpadNote("t5", "first", "1");
    await saveScratchpadNote("t5", "second", "2");
    const notes = await getScratchpad("t5");
    expect(notes.map((n) => n.key)).toEqual(["second", "first"]);
  });

  test("delete removes only the targeted note", async () => {
    await saveScratchpadNote("t6", "keep", "x");
    await saveScratchpadNote("t6", "gone", "y");
    await deleteScratchpadNote("t6", "gone");
    expect(await getScratchpad("t6")).toEqual([{ key: "keep", value: "x" }]);
  });

  test("unknown thread returns an empty list", async () => {
    expect(await getScratchpad("does-not-exist")).toEqual([]);
  });

  test("listAllScratchpadNotes spans every thread, most recent first, respecting limit", async () => {
    await saveScratchpadNote("global-a", "k", "v");
    await saveScratchpadNote("global-b", "k", "v");
    const all = await listAllScratchpadNotes(1);
    expect(all.length).toBe(1);
    expect(all[0].thread_id).toBe("global-b");
    expect(all[0].id).toBe("global-b:k");
  });
});
