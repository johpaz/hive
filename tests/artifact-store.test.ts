process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifact,
  expireArtifacts,
  inspectArtifact,
} from "../packages/core/src/artifacts/store";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";

let root = "";

beforeEach(() => {
  closeHiveDb();
  root = mkdtempSync(join(tmpdir(), "hive-artifacts-"));
});

afterEach(() => closeHiveDb());

describe("managed artifacts", () => {
  test("persists bytes and exposes verifiable metadata without returning content", async () => {
    const bytes = Buffer.from("fake-image-content");
    const artifact = await createArtifact({
      bytes,
      mimeType: "image/png",
      kind: "browser_screenshot",
      userId: "user-1",
      runId: "run-1",
      taskId: "task-1",
      rootDir: root,
      width: 1280,
      height: 720,
    });

    expect(artifact.status).toBe("active");
    expect(artifact.size).toBe(bytes.length);
    expect(existsSync(artifact.path)).toBe(true);

    const inspected = await inspectArtifact(artifact.id, { userId: "user-1" });
    expect(inspected.ok).toBe(true);
    expect(inspected.sha256_matches).toBe(true);
    expect(inspected).not.toHaveProperty("bytes");
    expect(inspected).not.toHaveProperty("base64");
  });

  test("deletes expired binaries after seven days but retains expired metadata", async () => {
    const now = Date.now();
    const artifact = await createArtifact({
      bytes: Buffer.from("expired"),
      mimeType: "image/jpeg",
      kind: "browser_screenshot",
      userId: "user-1",
      rootDir: root,
      now: now - 8 * 24 * 60 * 60 * 1000,
    });
    writeFileSync(artifact.path, "expired");

    const result = await expireArtifacts(now);
    expect(result.expired).toBe(1);
    expect(existsSync(artifact.path)).toBe(false);

    const inspected = await inspectArtifact(artifact.id, { userId: "user-1" });
    expect(inspected.ok).toBe(false);
    expect(inspected.status).toBe("expired");
    expect(inspected.expired_at).toBeNumber();
  });
});
