/**
 * HiveDB search database — singleton accessor
 *
 * HiveDB (@johpaz/hive-db) is the embedded Rust engine that replaced the
 * SQLite FTS5 virtual tables for capability search (tools, skills, playbook,
 * MCP tools). It provides Spanish-aware BM25 (accent folding + stemming),
 * lenient query parsing (raw user text never throws), per-field boosts and
 * optional vector search.
 *
 * The index lives next to hive.db under ~/.hive/data/hivedb (or
 * ~/.hive-dev/data/hivedb in dev). Relational data stays in SQLite.
 */

import path from "node:path";
import { HiveDB } from "@johpaz/hive-db";
import { getHiveDir } from "../config/loader.ts";
import { logger } from "../utils/logger";

const log = logger.child("hivedb");

let db: HiveDB | null = null;
let opening: Promise<HiveDB> | null = null;

export function getSearchDbPath(): string {
  // Tests can point the search index at an ephemeral database.
  if (process.env.HIVE_SEARCH_DB_PATH) return process.env.HIVE_SEARCH_DB_PATH;
  return path.join(getHiveDir(), "data", "hivedb");
}

/**
 * Get the shared HiveDB instance, opening it on first use.
 * Concurrent callers share the same open() promise.
 */
export async function getSearchDb(): Promise<HiveDB> {
  if (db) return db;
  if (!opening) {
    const dbPath = getSearchDbPath();
    opening = HiveDB.open(dbPath).then((opened) => {
      db = opened;
      log.info(`[hivedb] Search index opened at ${dbPath}`);
      return opened;
    });
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

export function closeSearchDb(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      log.warn(`[hivedb] Error closing search index: ${(err as Error).message}`);
    }
    db = null;
    opening = null;
  }
}
