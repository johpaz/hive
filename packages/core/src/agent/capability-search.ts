/**
 * Capability Search — shared HiveDB search layer
 *
 * Single entry point for searching Hive's capability catalogs (native tools,
 * skills, playbook rules, MCP tools): one HiveDB index for all four, with the
 * catalog discriminated by the `type` field rather than by separate tables.
 *
 * Document convention (one index, type discrimination via filters):
 * - id:   `tool:${name}` | `skill:${id}` | `playbook:${rowid}` | `mcp:${id}` | `agent:${id}`
 * - name: tool/skill name or rule head        (BM25 boost 4.0)
 * - tags: category + triggers + keywords      (BM25 boost 3.0)
 * - body: description / rule text / content   (BM25 boost 2.0)
 * - filters: { type: "tool"|"skill"|"playbook"|"mcp" }
 *            plus { server_id } on MCP docs for per-server hot-reload.
 *
 * Score semantics: text-only queries return raw BM25 (positive, higher is
 * better). Never compare against an absolute floor — BM25 magnitude depends
 * on corpus and document length. Use applyRelativeCutoff() instead.
 */

import type { IndexDoc } from "@johpaz/hive-db";
import { getHiveDb } from "../storage/hivedb";
import { logger } from "../utils/logger";

const log = logger.child("capability-search");

export type CapabilityType = "tool" | "skill" | "playbook" | "mcp" | "agent";

export interface CapabilityHit {
  /** Namespaced id, e.g. "tool:web_search" */
  id: string;
  type: CapabilityType;
  /** Id without the type prefix, e.g. "web_search" */
  rawId: string;
  /** Raw BM25 score: positive, higher = more relevant */
  score: number;
}

export interface CapabilityDoc {
  type: CapabilityType;
  /** Id within the type namespace (tool name, skill id, playbook rowid, mcp id) */
  rawId: string;
  name?: string;
  body?: string;
  tags?: string;
  /** Extra filters besides `type` (e.g. { server_id } for MCP docs) */
  extraFilters?: Array<{ field: string; value: string }>;
}

const TYPE_PREFIXES: CapabilityType[] = ["tool", "skill", "playbook", "mcp", "agent"];

function splitId(id: string): { type: CapabilityType; rawId: string } | null {
  const sep = id.indexOf(":");
  if (sep === -1) return null;
  const type = id.slice(0, sep) as CapabilityType;
  if (!TYPE_PREFIXES.includes(type)) return null;
  return { type, rawId: id.slice(sep + 1) };
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchCapabilitiesOptions {
  /** Restrict to these types. Omit or empty = all types. */
  types?: CapabilityType[];
  /** Maximum hits to return (default 10). */
  k?: number;
  /** Per-field BM25 boosts (engine defaults: name 4, tags 3, body 2). */
  boosts?: { name?: number; body?: number; tags?: number };
}

/**
 * Search the capability index with raw user text. The engine parses leniently
 * (accents, quotes, operators and punctuation never throw) and applies
 * Spanish stemming + accent folding, so callers must NOT pre-sanitize.
 */
export async function searchCapabilities(
  query: string,
  opts: SearchCapabilitiesOptions = {}
): Promise<CapabilityHit[]> {
  const k = opts.k ?? 10;
  const types = opts.types?.length ? opts.types : undefined;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const startTime = performance.now();
  const db = await getHiveDb();

  // Filters are AND-ed by the engine, so multi-type search runs one query per
  // type; the single-type and all-types cases are one engine call.
  const queries = types
    ? types.map((t) => ({
        type: t,
        filters: [{ field: "type", value: t }],
      }))
    : [{ type: undefined, filters: undefined }];

  const merged = new Map<string, CapabilityHit>();
  for (const q of queries) {
    const hits = await db.queryHybrid({
      text: trimmed,
      k,
      filters: q.filters,
      boosts: opts.boosts,
    });
    for (const hit of hits) {
      const parsed = splitId(hit.id);
      if (!parsed) continue;
      const existing = merged.get(hit.id);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.id, {
          id: hit.id,
          type: parsed.type,
          rawId: parsed.rawId,
          score: hit.score,
        });
      }
    }
  }

  const results = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const timing = performance.now() - startTime;
  log.debug(
    `[capability-search] "${trimmed.substring(0, 60)}" → ${results.length} hits in ${timing.toFixed(1)}ms`
  );
  return results;
}

/**
 * Keep only hits scoring at least `ratio` of the top hit. This replaces the
 * old absolute negative-bm25 thresholds: relevance is relative to the best
 * match, never an absolute floor.
 */
export function applyRelativeCutoff(
  hits: CapabilityHit[],
  ratio = 0.3
): CapabilityHit[] {
  if (hits.length === 0) return hits;
  const top = hits[0].score;
  if (top <= 0) return [];
  return hits.filter((h) => h.score >= ratio * top);
}

// ─── Sync helpers ────────────────────────────────────────────────────────────

/**
 * Replace all documents of a type: deletes existing docs carrying the type
 * filter, then batch-upserts the new set under a single index commit.
 */
export async function replaceCapabilityDocs(
  type: CapabilityType,
  docs: CapabilityDoc[]
): Promise<void> {
  const db = await getHiveDb();
  await db.deleteByFilter({ field: "type", value: type });
  if (docs.length === 0) return;
  await db.upsertBatch(docs.map(toIndexDoc));
}

/** Upsert documents without clearing the rest of their type. */
export async function upsertCapabilityDocs(docs: CapabilityDoc[]): Promise<void> {
  if (docs.length === 0) return;
  const db = await getHiveDb();
  await db.upsertBatch(docs.map(toIndexDoc));
}

/** Delete every MCP doc belonging to a server (hot-reload/disconnect). */
export async function deleteCapabilitiesByServer(serverId: string): Promise<void> {
  const db = await getHiveDb();
  await db.deleteByFilter({ field: "server_id", value: serverId });
}

function toIndexDoc(doc: CapabilityDoc): IndexDoc {
  return {
    id: `${doc.type}:${doc.rawId}`,
    name: doc.name,
    body: doc.body,
    tags: doc.tags,
    filters: [
      { field: "type", value: doc.type },
      ...(doc.extraFilters ?? []),
    ],
  };
}
