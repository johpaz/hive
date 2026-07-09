/**
 * HiveDB — singleton accessor
 *
 * HiveDB (@johpaz/hive-db) is the embedded Rust engine (redb + tantivy BM25 +
 * hnsw_rs) that is the sole data store for Hive: capability search (tools,
 * skills, playbook, MCP tools) via its BM25/hybrid index, and every other
 * piece of relational-shaped data (users, agents, providers, models,
 * conversations, cron, projects, ACE/playbook, ...) via its document
 * collections (`db.collection<T>(name)`).
 *
 * The database lives at ~/.hive/data/hivedb (or ~/.hive-dev/data/hivedb in
 * dev).
 */

import path from "node:path";
import { HiveDB } from "@johpaz/hive-db";
import { getHiveDir } from "../config/loader.ts";
import { logger } from "../utils/logger";

const log = logger.child("hivedb");

let db: HiveDB | null = null;
let opening: Promise<HiveDB> | null = null;

export function getHiveDbPath(): string {
  // Tests can point the database at an ephemeral (":memory:") instance.
  if (process.env.HIVE_DB_PATH) return process.env.HIVE_DB_PATH;
  return path.join(getHiveDir(), "data", "hivedb");
}

/**
 * Get the shared HiveDB instance, opening it on first use.
 * Concurrent callers share the same open() promise.
 */
export async function getHiveDb(): Promise<HiveDB> {
  if (db) return db;
  if (!opening) {
    const dbPath = getHiveDbPath();
    opening = HiveDB.open(dbPath).then((opened) => {
      db = opened;
      log.info(`[hivedb] Opened at ${dbPath}`);
      return opened;
    });
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

export function closeHiveDb(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      log.warn(`[hivedb] Error closing database: ${(err as Error).message}`);
    }
    db = null;
    opening = null;
  }
}
