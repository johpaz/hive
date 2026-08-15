/**
 * artifact_read — reads back the content an artifact_ref points at.
 *
 * mcp-result-normalizer.ts keeps oversized MCP text results out of the context
 * window: the model gets `{ type: "artifact_ref", artifact_id, size, preview }`
 * with a blind 500-char preview. That is the right call for the context, but
 * without a way to read the artifact back it left the agent stuck — it would
 * call artifact_inspect (metadata only), find no content, and burn its
 * iterations until the turn died on an empty synthesis. This is the way back in.
 *
 * Slicing is by characters, not lines: the case this was built for is a single
 * 245 KB JSON line from a Gmail MCP server, where line-based paging returns
 * everything or nothing. `search` exists for the same reason — jumping straight
 * to the three relevant messages beats paging through 245 KB in 20 KB chunks.
 */

import type { Tool } from "../types";
import { readArtifactText } from "../../artifacts/store";

const DEFAULT_LIMIT = 20_000;
const MAX_LIMIT = 50_000;
const MAX_MATCHES = 10;
const DEFAULT_MATCH_CONTEXT = 600;
const MAX_MATCH_CONTEXT = 8_000;
/**
 * What a search may return in total. Capping the per-match window alone would
 * be the wrong knob: a record whose fields are 2 KB of mail headers needs a
 * wide window to show its id, while ten such windows would put back into the
 * context exactly what the artifact was created to keep out.
 */
const MAX_SEARCH_CHARS = 40_000;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function findMatches(text: string, query: string, context: number): Array<{ offset: number; excerpt: string }> {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: Array<{ offset: number; excerpt: string }> = [];
  const half = Math.floor(context / 2);
  let from = 0;

  let used = 0;

  while (matches.length < MAX_MATCHES) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const start = Math.max(0, at - half);
    const end = Math.min(text.length, at + needle.length + half);
    const excerpt = text.slice(start, end);
    // The first match always comes back, however wide it is — returning zero
    // results for a query that did match would be the worst possible answer.
    if (matches.length > 0 && used + excerpt.length > MAX_SEARCH_CHARS) break;
    matches.push({ offset: at, excerpt });
    used += excerpt.length;
    from = at + needle.length;
  }

  return matches;
}

function countMatches(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let total = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return total;
    total++;
    from = at + needle.length;
  }
}

export const artifactReadTool: Tool = {
  name: "artifact_read",
  description:
    "Read the text content of a managed artifact in slices, or search inside it. Use this on any artifact_ref a tool returned instead of guessing from its preview. Spanish: leer artefacto, ver contenido del artefacto, abrir resultado grande, buscar dentro del artefacto",
  parameters: {
    type: "object",
    properties: {
      artifactId: {
        type: "string",
        description: "Managed artifact identifier (the artifact_id of an artifact_ref).",
      },
      offset: {
        type: "number",
        description: "Character position to start reading from (default: 0). Use next_offset from the previous call to continue.",
      },
      limit: {
        type: "number",
        description: `Characters to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT}).`,
      },
      search: {
        type: "string",
        description: "Return excerpts around each case-insensitive match instead of a contiguous slice. Far cheaper than paging a large artifact.",
      },
      context: {
        type: "number",
        description: `Characters of surrounding text per match (default: ${DEFAULT_MATCH_CONTEXT}, max: ${MAX_MATCH_CONTEXT}). Widen it when records carry long fields and the excerpt cuts off the data you need.`,
      },
    },
    required: ["artifactId"],
  },
  execute: async (params, config) => {
    const artifactId = String(params.artifactId ?? "").trim();
    if (!artifactId) return { ok: false, error: "artifactId is required" };

    const userId = config?.configurable?.user_id as string | undefined;
    const result = await readArtifactText(artifactId, { userId });
    if (!result.ok || !result.artifact) {
      return { ok: false, artifact_id: artifactId, error: result.error, status: result.status };
    }

    const artifact = result.artifact;
    const text = result.text ?? "";
    const search = typeof params.search === "string" ? params.search.trim() : "";

    if (search) {
      const context = clampNumber(params.context, DEFAULT_MATCH_CONTEXT, 40, MAX_MATCH_CONTEXT);
      const matches = findMatches(text, search, context);
      // Always the real count, never the number returned: collection stops at
      // MAX_MATCHES or at the character budget, and an agent told "4 matches"
      // when there are 8 stops looking.
      const total = countMatches(text, search);
      return {
        ok: true,
        artifact_id: artifact.id,
        mime_type: artifact.mime_type,
        total_chars: text.length,
        query: search,
        total_matches: total,
        returned_matches: matches.length,
        truncated: total > matches.length,
        context,
        matches,
      };
    }

    const offset = clampNumber(params.offset, 0, 0, Math.max(0, text.length));
    const limit = clampNumber(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const content = text.slice(offset, offset + limit);
    const nextOffset = offset + content.length;
    const eof = nextOffset >= text.length;

    return {
      ok: true,
      artifact_id: artifact.id,
      mime_type: artifact.mime_type,
      kind: artifact.kind,
      total_chars: text.length,
      offset,
      returned_chars: content.length,
      next_offset: eof ? null : nextOffset,
      eof,
      content,
    };
  },
};
