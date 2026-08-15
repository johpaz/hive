import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import { getHiveDir } from "../config/loader";
import { col, updateDoc } from "../storage/hive";
import type { ArtifactDoc } from "../storage/collections";

const ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "bin";
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function detectedMime(bytes: Uint8Array, fallback: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return fallback;
}

export async function createArtifact(input: {
  bytes: Uint8Array;
  mimeType: string;
  kind: string;
  userId: string;
  runId?: string | null;
  taskId?: string | null;
  rootDir?: string;
  width?: number | null;
  height?: number | null;
  now?: number;
}): Promise<ArtifactDoc> {
  const now = input.now ?? Date.now();
  const id = randomUUID();
  const root = input.rootDir ?? getHiveDir();
  const mimeType = detectedMime(input.bytes, input.mimeType);
  const day = new Date(now).toISOString().slice(0, 10);
  const dir = join(root, "artifacts", day);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.${extensionFor(mimeType)}`);
  writeFileSync(path, input.bytes, { flag: "wx" });

  const doc: ArtifactDoc = {
    id,
    run_id: input.runId ?? null,
    task_id: input.taskId ?? null,
    user_id: input.userId,
    kind: input.kind,
    path,
    mime_type: mimeType,
    size: input.bytes.byteLength,
    sha256: hash(input.bytes),
    width: input.width ?? null,
    height: input.height ?? null,
    status: "active",
    created_at: now,
    expires_at: now + ARTIFACT_RETENTION_MS,
    expired_at: null,
  };

  try {
    const artifacts = await col<ArtifactDoc>("artifacts");
    await artifacts.put(id, doc, { expectedVersion: 0 });
    return doc;
  } catch (error) {
    try { unlinkSync(path); } catch { /* best effort rollback */ }
    throw error;
  }
}

/**
 * Reads an artifact's bytes straight off disk — for server-side consumers
 * that don't need an HTTP round trip (routes/artifacts.ts is for the
 * browser; channels/*.ts send()s use this directly to build a Telegram/
 * Discord/Slack/WhatsApp photo attachment from the same file).
 */
export async function readArtifactBytes(
  artifactId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const artifacts = await col<ArtifactDoc>("artifacts");
  const entry = await artifacts.get(artifactId);
  if (!entry || entry.doc.status !== "active") return null;
  if (!existsSync(entry.doc.path)) return null;
  return { bytes: readFileSync(entry.doc.path), mimeType: entry.doc.mime_type };
}

/** Beyond this an artifact stops being something an agent can read into a context window. */
const MAX_TEXT_ARTIFACT_BYTES = 25 * 1024 * 1024;

function looksBinary(mimeType: string, bytes: Buffer): boolean {
  if (/^(image|audio|video)\//.test(mimeType)) return true;
  if (mimeType === "application/octet-stream") return true;
  // A NUL byte in the first KB is the classic "this is not text" tell — a
  // mislabelled text/plain artifact would otherwise decode to garbage.
  return bytes.subarray(0, 1024).includes(0x00);
}

export type ArtifactTextResult = {
  ok: boolean;
  text?: string;
  artifact?: ArtifactDoc;
  error?: string;
  status?: string;
};

/**
 * Decodes a text artifact for in-process consumers that need its *content*,
 * not just its metadata (inspectArtifact) or its raw bytes (readArtifactBytes).
 *
 * This exists because mcp-result-normalizer.ts moves oversized MCP text results
 * out of the context window and hands the model an `artifact_ref` instead. Until
 * this, nothing could read that reference back: the agent held a receipt it
 * could not cash, burned its iterations guessing, and the turn died on an empty
 * synthesis. Ownership and status checks mirror inspectArtifact's.
 */
export async function readArtifactText(
  artifactId: string,
  options: { userId?: string } = {},
): Promise<ArtifactTextResult> {
  const artifacts = await col<ArtifactDoc>("artifacts");
  const entry = await artifacts.get(artifactId);
  if (!entry) return { ok: false, error: "Artifact not found" };
  const artifact = entry.doc;

  if (options.userId && artifact.user_id && artifact.user_id !== options.userId) {
    return { ok: false, error: "Artifact not accessible" };
  }
  if (artifact.status !== "active") {
    return { ok: false, error: "Artifact binary has expired", status: artifact.status };
  }
  if (!existsSync(artifact.path)) {
    return { ok: false, error: "Artifact binary is missing", status: "missing" };
  }
  if (artifact.size > MAX_TEXT_ARTIFACT_BYTES) {
    return {
      ok: false,
      error: `Artifact is too large to read as text (${artifact.size} bytes, limit ${MAX_TEXT_ARTIFACT_BYTES})`,
    };
  }

  const bytes = readFileSync(artifact.path);
  if (looksBinary(detectedMime(bytes, artifact.mime_type), bytes)) {
    return {
      ok: false,
      error: `Artifact is binary (${detectedMime(bytes, artifact.mime_type)}) — use artifact_inspect for its metadata`,
    };
  }

  return { ok: true, text: bytes.toString("utf-8"), artifact };
}

export async function inspectArtifact(
  artifactId: string,
  options: { userId?: string } = {},
): Promise<Record<string, unknown>> {
  const artifacts = await col<ArtifactDoc>("artifacts");
  const entry = await artifacts.get(artifactId);
  if (!entry) return { ok: false, artifact_id: artifactId, error: "Artifact not found" };
  const artifact = entry.doc;
  if (options.userId && artifact.user_id && artifact.user_id !== options.userId) {
    return { ok: false, artifact_id: artifactId, error: "Artifact not accessible" };
  }
  if (artifact.status !== "active") {
    return {
      ok: false,
      artifact_id: artifactId,
      status: artifact.status,
      expired_at: artifact.expired_at,
      error: "Artifact binary has expired",
    };
  }
  if (!existsSync(artifact.path)) {
    return {
      ok: false,
      artifact_id: artifactId,
      status: "missing",
      error: "Artifact binary is missing",
    };
  }

  const bytes = readFileSync(artifact.path);
  const actualHash = hash(bytes);
  const stat = statSync(artifact.path);
  return {
    ok: actualHash === artifact.sha256 && stat.size === artifact.size,
    artifact_id: artifact.id,
    kind: artifact.kind,
    mime_type: detectedMime(bytes, artifact.mime_type),
    extension: extname(artifact.path),
    size: stat.size,
    expected_size: artifact.size,
    sha256: actualHash,
    sha256_matches: actualHash === artifact.sha256,
    width: artifact.width,
    height: artifact.height,
    created_at: artifact.created_at,
    expires_at: artifact.expires_at,
    status: artifact.status,
  };
}

export async function expireArtifacts(now = Date.now()): Promise<{ expired: number }> {
  const artifacts = await col<ArtifactDoc>("artifacts");
  const rows = await artifacts.scan({});
  let expired = 0;
  for (const row of rows) {
    if (row.doc.status !== "active" || row.doc.expires_at > now) continue;
    try {
      if (existsSync(row.doc.path)) unlinkSync(row.doc.path);
    } catch {
      continue;
    }
    await updateDoc<ArtifactDoc>("artifacts", row.id, {
      status: "expired",
      expired_at: now,
    });
    expired++;
  }
  return { expired };
}
