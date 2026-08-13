/**
 * mcp-result-normalizer — keeps large/binary MCP tool results out of the LLM
 * context window.
 *
 * `MCPClientManager.callTool()` (packages/mcp/src/manager.ts) returns the raw
 * `content` array from the MCP SDK's CallToolResult. Per the MCP spec that
 * array can contain `image`/`audio` blocks (base64 `data`) or `resource`
 * blocks (base64 `blob`) alongside plain `text` blocks. Nothing downstream
 * (agent-loop.ts's formatToolResult) inspects those blocks — a base64 image
 * would be serialized whole into a `role:"tool"` message and sent to the
 * model, which is exactly what filled the context window and hung the agent
 * in the incident this module fixes.
 *
 * This mirrors the pattern already used by browser-screenshot.ts: binary
 * content gets persisted via createArtifact() (artifacts/store.ts) and the
 * model only ever sees a lightweight { type: "artifact_ref", ... } reference.
 */

import { createArtifact } from "../artifacts/store";
import { logger } from "../utils/logger";

const log = logger.child("mcp-result-normalizer");

/** Blocks longer than this (in chars) get materialized as a text artifact instead of inlined. Override via HIVE_MCP_INLINE_MAX_CHARS. */
const MCP_INLINE_MAX_CHARS = Number(process.env.HIVE_MCP_INLINE_MAX_CHARS) || 20_000;

export interface McpNormalizeContext {
  userId?: string;
  runId?: string | null;
  taskId?: string | null;
}

type McpContentBlock = Record<string, unknown> & { type?: unknown };

function isBinaryBlock(block: McpContentBlock): block is McpContentBlock & { type: "image" | "audio"; data: string; mimeType: string } {
  return (block.type === "image" || block.type === "audio") && typeof block.data === "string";
}

function isBlobResourceBlock(block: McpContentBlock): block is McpContentBlock & { type: "resource"; resource: { blob: string; mimeType?: string; uri?: string } } {
  if (block.type !== "resource") return false;
  const resource = block.resource as Record<string, unknown> | undefined;
  return !!resource && typeof resource.blob === "string";
}

function isOversizedTextBlock(block: McpContentBlock): block is McpContentBlock & { type: "text"; text: string } {
  return block.type === "text" && typeof block.text === "string" && block.text.length > MCP_INLINE_MAX_CHARS;
}

async function materializeBinary(
  bytesBase64: string,
  mimeType: string,
  kind: string,
  ctx: McpNormalizeContext,
): Promise<Record<string, unknown>> {
  if (!ctx.userId) {
    // Without a user_id we can't set ownership on the artifact (inspectArtifact
    // would reject any read against it later) — never let raw base64 through,
    // just describe what was omitted.
    const approxBytes = Math.floor((bytesBase64.length * 3) / 4);
    log.warn(`[materializeBinary] No user_id in tool context — omitting ${mimeType} block (${approxBytes} bytes) instead of creating an artifact`);
    return { type: "artifact_omitted", mime_type: mimeType, approx_size: approxBytes, reason: "no user_id in tool context" };
  }

  const bytes = Buffer.from(bytesBase64, "base64");
  const artifact = await createArtifact({
    bytes,
    mimeType,
    kind,
    userId: ctx.userId,
    runId: ctx.runId ?? null,
    taskId: ctx.taskId ?? null,
  });
  log.info(`[materializeBinary] Stored ${kind} as artifact ${artifact.id} (${artifact.size} bytes, ${artifact.mime_type})`);
  return {
    type: "artifact_ref",
    artifact_id: artifact.id,
    mime_type: artifact.mime_type,
    size: artifact.size,
    sha256: artifact.sha256,
    expires_at: artifact.expires_at,
  };
}

async function materializeText(text: string, ctx: McpNormalizeContext): Promise<Record<string, unknown>> {
  if (!ctx.userId) {
    log.warn(`[materializeText] No user_id in tool context — truncating oversized text block (${text.length} chars) instead of creating an artifact`);
    return { type: "text", text: `${text.slice(0, 500)}… [truncated: ${text.length} chars total, no user_id to persist full text as artifact]` };
  }

  const artifact = await createArtifact({
    bytes: Buffer.from(text, "utf-8"),
    mimeType: "text/plain",
    kind: "mcp_text_result",
    userId: ctx.userId,
    runId: ctx.runId ?? null,
    taskId: ctx.taskId ?? null,
  });
  log.info(`[materializeText] Stored oversized text result as artifact ${artifact.id} (${artifact.size} bytes)`);
  return {
    type: "artifact_ref",
    artifact_id: artifact.id,
    mime_type: "text/plain",
    size: artifact.size,
    preview: text.length > 500 ? `${text.slice(0, 500)}…` : text,
  };
}

/**
 * Normalizes a raw MCP CallToolResult.content array: binary blocks (image,
 * audio, resource-with-blob) become { type: "artifact_ref", ... }, oversized
 * text blocks are persisted the same way with a short preview kept inline,
 * everything else (text, resource_link) passes through unchanged.
 *
 * Never pre-stringifies — returns JS values so formatToolResult (toon.ts)
 * keeps doing the actual TOON/JSON encoding, same contract context-compiler.ts
 * already documents for MCP tool executors.
 */
export async function normalizeMcpResult(content: unknown, ctx: McpNormalizeContext): Promise<unknown> {
  if (!Array.isArray(content)) return content;

  const out: unknown[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") {
      out.push(raw);
      continue;
    }
    const block = raw as McpContentBlock;
    try {
      if (isBinaryBlock(block)) {
        out.push(await materializeBinary(block.data, block.mimeType, "mcp_result", ctx));
        continue;
      }
      if (isBlobResourceBlock(block)) {
        const mimeType = block.resource.mimeType || "application/octet-stream";
        out.push(await materializeBinary(block.resource.blob, mimeType, "mcp_result", ctx));
        continue;
      }
      if (isOversizedTextBlock(block)) {
        out.push(await materializeText(block.text, ctx));
        continue;
      }
    } catch (err) {
      log.error(`[normalizeMcpResult] Failed to materialize block (type=${String(block.type)}): ${(err as Error).message}`);
      out.push({ type: "artifact_error", mime_type: (block as { mimeType?: string }).mimeType, error: (err as Error).message });
      continue;
    }
    out.push(block);
  }
  return out;
}
