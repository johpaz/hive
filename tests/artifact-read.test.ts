/**
 * Tests for tools/web/artifact-read.ts — the way back into content that
 * mcp-result-normalizer.ts moved out of the context window.
 *
 * The incident: an email MCP server returned 245 KB of Gmail JSON, the
 * normalizer stored it as an artifact and handed the model an `artifact_ref`
 * with a 500-char preview. Nothing could read that reference back —
 * artifact_inspect returns metadata only — so the agent burned its iterations
 * on `find` and `env` and the turn died on "The model returned an empty
 * synthesis". The last test here is that exact round trip.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { createArtifact } from "../packages/core/src/artifacts/store";
import { artifactReadTool } from "../packages/core/src/tools/web/artifact-read";
import { normalizeMcpResult } from "../packages/core/src/agent/mcp-result-normalizer";

let hiveHome = "";

beforeEach(async () => {
  closeHiveDb();
  hiveHome = mkdtempSync(join(tmpdir(), "hive-artifact-read-"));
  process.env.HIVE_HOME = hiveHome;
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
  delete process.env.HIVE_HOME;
});

const asUser = (userId = "user-1") => ({ configurable: { user_id: userId } });

async function textArtifact(text: string, userId = "user-1") {
  return createArtifact({
    bytes: Buffer.from(text, "utf-8"),
    mimeType: "text/plain",
    kind: "mcp_text_result",
    userId,
  });
}

describe("artifact_read: slicing", () => {
  test("pages through content with offset/limit and reports the end", async () => {
    const artifact = await textArtifact("abcdefghij".repeat(10)); // 100 chars

    const first = await artifactReadTool.execute!({ artifactId: artifact.id, limit: 60 }, asUser()) as any;
    expect(first.ok).toBe(true);
    expect(first.total_chars).toBe(100);
    expect(first.content.length).toBe(60);
    expect(first.eof).toBe(false);
    expect(first.next_offset).toBe(60);

    const second = await artifactReadTool.execute!(
      { artifactId: artifact.id, offset: first.next_offset, limit: 60 },
      asUser(),
    ) as any;
    expect(second.content.length).toBe(40);
    expect(second.eof).toBe(true);
    expect(second.next_offset).toBeNull();
    expect(first.content + second.content).toBe("abcdefghij".repeat(10));
  });

  test("caps limit so one call can never flood the context window", async () => {
    const artifact = await textArtifact("y".repeat(200_000));
    const result = await artifactReadTool.execute!({ artifactId: artifact.id, limit: 999_999 }, asUser()) as any;
    expect(result.returned_chars).toBe(50_000);
    expect(result.eof).toBe(false);
  });
});

describe("artifact_read: search", () => {
  test("returns excerpts around each match instead of the whole payload", async () => {
    const filler = "z".repeat(5_000);
    const artifact = await textArtifact(`${filler}ASUNTO IMPORTANTE${filler}ASUNTO IMPORTANTE${filler}`);

    const result = await artifactReadTool.execute!(
      { artifactId: artifact.id, search: "asunto importante" },
      asUser(),
    ) as any;

    expect(result.ok).toBe(true);
    expect(result.total_matches).toBe(2);
    expect(result.matches.length).toBe(2);
    expect(result.matches[0].excerpt).toContain("ASUNTO IMPORTANTE");
    expect(result.matches[0].offset).toBe(5_000);
    // Excerpts, not the payload: two 600-char windows out of 15 KB.
    expect(JSON.stringify(result).length).toBeLessThan(3_000);
  });

  test("stops at the total character budget when the window is wide", async () => {
    // 8 matches, each with 10 KB of surrounding filler: a full 8 KB window on
    // every one would return 64 KB — more than the artifact was hidden to save.
    const artifact = await textArtifact(`${"w".repeat(10_000)}CLAVE`.repeat(8));

    const result = await artifactReadTool.execute!(
      { artifactId: artifact.id, search: "CLAVE", context: 8_000 },
      asUser(),
    ) as any;

    expect(result.total_matches).toBe(8);
    expect(result.returned_matches).toBeLessThan(8);
    expect(result.truncated).toBe(true);
    const returnedChars = result.matches.reduce((sum: number, m: any) => sum + m.excerpt.length, 0);
    expect(returnedChars).toBeLessThanOrEqual(40_000);
  });

  test("reports how many matches were left out", async () => {
    const artifact = await textArtifact("hit ".repeat(50));
    const result = await artifactReadTool.execute!({ artifactId: artifact.id, search: "hit" }, asUser()) as any;
    expect(result.returned_matches).toBe(10);
    expect(result.total_matches).toBe(50);
    expect(result.truncated).toBe(true);
  });
});

describe("artifact_read: refusals", () => {
  test("refuses binary artifacts and points at artifact_inspect", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const artifact = await createArtifact({ bytes: png, mimeType: "image/png", kind: "browser_screenshot", userId: "user-1" });

    const result = await artifactReadTool.execute!({ artifactId: artifact.id }, asUser()) as any;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("artifact_inspect");
  });

  test("does not hand one user's artifact to another", async () => {
    const artifact = await textArtifact("datos privados", "owner");
    const result = await artifactReadTool.execute!({ artifactId: artifact.id }, asUser("intruder")) as any;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Artifact not accessible");
  });

  test("reports a missing artifact instead of throwing", async () => {
    const result = await artifactReadTool.execute!({ artifactId: "does-not-exist" }, asUser()) as any;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Artifact not found");
  });
});

describe("oversized MCP result round trip", () => {
  test("an artifact_ref the model receives can be opened and searched", async () => {
    const emails = Array.from({ length: 40 }, (_, i) => ({
      id: `msg-${i}`,
      threadId: `thread-${i}`,
      labelIds: ["INBOX"],
      headers: { received: "Received: by ".padEnd(2_000, "x"), subject: `Subject: correo ${i}` },
    }));
    const payload = JSON.stringify(emails);
    expect(payload.length).toBeGreaterThan(20_000);

    const normalized = (await normalizeMcpResult([{ type: "text", text: payload }], { userId: "user-1" })) as any[];
    const ref = normalized[0];
    expect(ref.type).toBe("artifact_ref");
    // The shape hints are what let the model aim a search instead of paging blind.
    expect(ref.json_items).toBe(40);
    expect(ref.json_item_keys).toContain("threadId");
    expect(ref.hint).toContain("artifact_read");

    const found = await artifactReadTool.execute!(
      { artifactId: ref.artifact_id, search: "correo 37" },
      asUser(),
    ) as any;
    expect(found.ok).toBe(true);
    expect(found.total_matches).toBe(1);
    expect(found.matches[0].excerpt).toContain("Subject: correo 37");

    // The default window lands on the subject but not on the record's id — a
    // 2 KB `received` header sits between them. Widening it reaches the id
    // without pulling the other 39 messages into the context.
    const wider = await artifactReadTool.execute!(
      { artifactId: ref.artifact_id, search: "correo 37", context: 8_000 },
      asUser(),
    ) as any;
    expect(wider.matches[0].excerpt).toContain("msg-37");
    expect(wider.matches[0].excerpt.length).toBeLessThan(payload.length / 4);
  });
});
