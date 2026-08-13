/**
 * Tests for agent/mcp-result-normalizer.ts — the fix for the incident where
 * an MCP image-generation tool ("nano banana") returned a base64 image block
 * that got serialized whole into the LLM context, filling it and hanging the
 * agent. Verifies binary/oversized content blocks get materialized as
 * artifacts (artifacts/store.ts) instead of ever reaching formatToolResult
 * as raw base64.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ArtifactDoc } from "../packages/core/src/storage/collections";
import { normalizeMcpResult } from "../packages/core/src/agent/mcp-result-normalizer";
import { formatToolResult } from "../packages/core/src/utils/toon";

let hiveHome = "";

beforeEach(async () => {
  closeHiveDb();
  hiveHome = mkdtempSync(join(tmpdir(), "hive-mcp-normalizer-"));
  process.env.HIVE_HOME = hiveHome;
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
  delete process.env.HIVE_HOME;
});

// A tiny real PNG (1x1 transparent pixel) so detectedMime() sniffing succeeds.
const PNG_1PX_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("normalizeMcpResult: image blocks", () => {
  test("materializes an image content block as an artifact_ref, never inline base64", async () => {
    const raw = [
      { type: "text", text: "Here is your generated image:" },
      { type: "image", data: PNG_1PX_BASE64, mimeType: "image/png" },
    ];

    const normalized = (await normalizeMcpResult(raw, { userId: "user-1", runId: "run-1", taskId: "task-1" })) as unknown[];

    expect(normalized.length).toBe(2);
    expect(normalized[0]).toEqual({ type: "text", text: "Here is your generated image:" });

    const ref = normalized[1] as Record<string, unknown>;
    expect(ref.type).toBe("artifact_ref");
    expect(ref.mime_type).toBe("image/png");
    expect(typeof ref.artifact_id).toBe("string");
    expect(ref).not.toHaveProperty("data");

    // The artifact actually landed on disk and in HiveDB.
    const artifacts = await col<ArtifactDoc>("artifacts");
    const entry = await artifacts.get(ref.artifact_id as string);
    expect(entry).not.toBeNull();
    expect(entry!.doc.user_id).toBe("user-1");
    expect(entry!.doc.run_id).toBe("run-1");
    expect(existsSync(entry!.doc.path)).toBe(true);

    // The exact guarantee the incident needed: what actually goes to the LLM
    // (formatToolResult's TOON/JSON encoding) must not contain the base64 blob.
    const llmString = formatToolResult(normalized, "claude-sonnet");
    expect(llmString).not.toContain(PNG_1PX_BASE64);
    expect(llmString.length).toBeLessThan(500);
  });

  test("materializes a resource block's base64 blob the same way", async () => {
    const raw = [
      { type: "resource", resource: { uri: "mcp://gen/1", mimeType: "image/png", blob: PNG_1PX_BASE64 } },
    ];

    const normalized = (await normalizeMcpResult(raw, { userId: "user-1" })) as unknown[];
    const ref = normalized[0] as Record<string, unknown>;
    expect(ref.type).toBe("artifact_ref");
    expect(ref.mime_type).toBe("image/png");
  });

  test("without a user_id, omits the binary instead of creating an artifact or leaking base64", async () => {
    const raw = [{ type: "image", data: PNG_1PX_BASE64, mimeType: "image/png" }];

    const normalized = (await normalizeMcpResult(raw, {})) as unknown[];
    const block = normalized[0] as Record<string, unknown>;
    expect(block.type).toBe("artifact_omitted");

    const llmString = formatToolResult(normalized, "claude-sonnet");
    expect(llmString).not.toContain(PNG_1PX_BASE64);
  });
});

describe("normalizeMcpResult: oversized text blocks", () => {
  test("materializes text over the inline threshold as a text artifact with a short preview", async () => {
    const bigText = "x".repeat(25_000);
    const raw = [{ type: "text", text: bigText }];

    const normalized = (await normalizeMcpResult(raw, { userId: "user-1" })) as unknown[];
    const ref = normalized[0] as Record<string, unknown>;
    expect(ref.type).toBe("artifact_ref");
    expect(ref.mime_type).toBe("text/plain");
    expect((ref.preview as string).length).toBeLessThan(600);

    const llmString = formatToolResult(normalized, "claude-sonnet");
    expect(llmString.length).toBeLessThan(1000);
  });

  test("leaves small text blocks untouched", async () => {
    const raw = [{ type: "text", text: "short result" }];
    const normalized = await normalizeMcpResult(raw, { userId: "user-1" });
    expect(normalized).toEqual([{ type: "text", text: "short result" }]);
  });
});

describe("normalizeMcpResult: passthrough", () => {
  test("non-array content passes through unchanged (no regression for non-standard MCP results)", async () => {
    const raw = { ok: true, value: 42 };
    const normalized = await normalizeMcpResult(raw, { userId: "user-1" });
    expect(normalized).toEqual(raw);
  });

  test("resource_link blocks pass through unchanged (already lightweight)", async () => {
    const raw = [{ type: "resource_link", uri: "mcp://foo/bar", mimeType: "image/png" }];
    const normalized = await normalizeMcpResult(raw, { userId: "user-1" });
    expect(normalized).toEqual(raw);
  });
});
