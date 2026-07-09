/**
 * Reusable HiveDB collection helpers.
 *
 * These replace the SQL patterns that don't have a direct HiveDB primitive:
 * autoincrement ids (`nextId`), whitelisted partial UPDATEs (`updateDoc`,
 * `updateManyByIndex`), `WHERE field IN (...)` (`findByAny`), and
 * SUM/AVG/GROUP BY (`bumpRollup`).
 */

import { getHiveDb } from "./hivedb";

const MAX_RETRIES = 5;

/** Sentinel for nullable FK-like fields used in equality indexes (`findBy`/`createIndex` reject `null`). */
export const NO_PARENT = "__none__";
/** Sentinel for a broadcast recipient (e.g. `agentBusMessages.to_worker_id`). */
export const BROADCAST = "*";

/** Encode a nullable FK-like value for storage in an indexed field. */
export function toIndexable(value: string | null | undefined): string {
  return value ?? NO_PARENT;
}

/** Decode a value stored via {@link toIndexable} back to its nullable form. */
export function fromIndexable(value: string): string | null {
  return value === NO_PARENT ? null : value;
}

export async function col<T>(name: string) {
  const db = await getHiveDb();
  return db.collection<T>(name);
}

/**
 * Monotonic counter, formatted as a zero-padded string so lexicographic
 * `scan()` order matches numeric order. Retries on optimistic-concurrency
 * conflicts (another writer bumped the same counter concurrently).
 */
export async function nextId(counterName: string): Promise<string> {
  const counters = await col<{ value: number }>("counters");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const cur = await counters.get(counterName);
    const next = (cur?.doc.value ?? 0) + 1;
    try {
      await counters.put(counterName, { value: next }, { expectedVersion: cur?.version ?? 0 });
      return String(next).padStart(15, "0");
    } catch {
      // Version conflict — another writer won the race, retry.
    }
  }
  throw new Error(`nextId: too much contention on counter "${counterName}"`);
}

/**
 * Read-modify-write a document, replacing the whole-document `put()` with
 * whitelisted-field UPDATE semantics. Retries on optimistic-concurrency
 * conflicts.
 */
export async function updateDoc<T extends object>(
  collection: string,
  id: string,
  patch: Partial<T>
): Promise<T> {
  const c = await col<T>(collection);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = await c.get(id);
    if (!existing) throw new Error(`${collection}/${id} not found`);
    const merged = { ...existing.doc, ...patch };
    try {
      await c.put(id, merged, { expectedVersion: existing.version });
      return merged;
    } catch {
      // Version conflict — retry with a fresh read.
    }
  }
  throw new Error(`updateDoc: too much contention on ${collection}/${id}`);
}

/**
 * Apply the same patch to every document whose indexed `field` equals
 * `value` — replaces `UPDATE x SET ... WHERE fk = ?`. Requires a prior
 * `createIndex(field)` on the collection.
 */
export async function updateManyByIndex<T extends object>(
  collection: string,
  field: string,
  value: string | number | boolean,
  patch: Partial<T>
): Promise<number> {
  const c = await col<T>(collection);
  const rows = await c.findBy(field, value);
  for (const r of rows) await updateDoc<T>(collection, r.id, patch);
  return rows.length;
}

/**
 * Fetch documents whose indexed `field` matches any of `values` — emulates
 * `WHERE field IN (...)`. Requires a prior `createIndex(field)`.
 */
export async function findByAny<T>(
  collection: string,
  field: string,
  values: Array<string | number | boolean>
): Promise<Array<{ id: string; version: number; doc: T }>> {
  const c = await col<T>(collection);
  const uniq = [...new Set(values)];
  const chunks = await Promise.all(uniq.map((v) => c.findBy(field, v)));
  return chunks.flat();
}

/**
 * Increment numeric fields on a rollup/counter document — replaces
 * SUM/AVG/GROUP BY. `nested` additionally bumps a per-key breakdown (e.g.
 * `byProvider[provider]`) inside the same document. Creates the document on
 * first use. Retries on optimistic-concurrency conflicts.
 */
export async function bumpRollup(
  collection: string,
  id: string,
  delta: Record<string, number>,
  nested?: { field: string; key: string }
): Promise<void> {
  const c = await col<Record<string, any>>(collection);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = await c.get(id);
    const doc: Record<string, any> = existing ? { ...existing.doc } : {};
    for (const [k, v] of Object.entries(delta)) doc[k] = (doc[k] ?? 0) + v;
    if (nested) {
      doc[nested.field] = { ...(doc[nested.field] ?? {}) };
      doc[nested.field][nested.key] = { ...(doc[nested.field][nested.key] ?? {}) };
      for (const [k, v] of Object.entries(delta)) {
        doc[nested.field][nested.key][k] = (doc[nested.field][nested.key][k] ?? 0) + v;
      }
    }
    try {
      await c.put(id, doc, { expectedVersion: existing?.version ?? 0 });
      return;
    } catch {
      // Version conflict — retry with a fresh read.
    }
  }
  throw new Error(`bumpRollup: too much contention on ${collection}/${id}`);
}
