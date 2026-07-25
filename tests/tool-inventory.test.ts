/**
 * The tool inventory has three sources that must agree:
 *
 *  - `createAllTools()`      — the executors that actually exist
 *  - `CORE_TOOL_CATALOG`     — bilingual descriptions (drives BM25 ranking)
 *  - `SEED_DATA.tools`       — the DB rows (drive the tools UI)
 *
 * The search index is built as `CORE_TOOL_CATALOG ∪ seed rows`
 * (tool-selector.ts). Two failure modes follow, and both have shipped before:
 *
 *  - indexed without an executor → the agent discovers a tool and it blows up
 *  - executor without indexing   → working capability nobody can ever find
 *
 * Uses HIVE_DB_PATH=":memory:".
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { createAllTools } from "../packages/core/src/tools/index";
import { CORE_TOOL_CATALOG } from "../packages/core/src/agent/tool-selector";
import { SEED_DATA } from "../packages/core/src/storage/seed";

const executors = new Set(createAllTools({ tools: {} } as never).map((t) => t.name));
const catalog = new Set(CORE_TOOL_CATALOG.map((t) => t.name));
const seeded = new Set(SEED_DATA.tools.map((t) => t.id));
const indexed = new Set([...catalog, ...seeded]);

describe("tool inventory", () => {
  test("nothing is indexed without a working executor", () => {
    const ghosts = [...indexed].filter((name) => !executors.has(name)).sort();
    expect(ghosts).toEqual([]);
  });

  test("every executor is reachable through search_knowledge", () => {
    const invisible = [...executors].filter((name) => !indexed.has(name)).sort();
    expect(invisible).toEqual([]);
  });

  test("every tool carries bilingual keywords for BM25 ranking", () => {
    // A seed row alone gets indexed, but with only its own description; the
    // catalog entry is what supplies the ES/EN synonyms that make it findable.
    const withoutKeywords = [...executors].filter((name) => !catalog.has(name)).sort();
    expect(withoutKeywords).toEqual([]);
  });

  test("seed rows are internally consistent", () => {
    const ids = SEED_DATA.tools.map((t) => t.id);
    expect(ids.length).toBe(new Set(ids).size); // no duplicates
    expect(SEED_DATA.tools.filter((t) => t.id !== t.name)).toEqual([]);
  });

  test("the catalog has no duplicate entries", () => {
    const names = CORE_TOOL_CATALOG.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i).sort();
    expect(dupes).toEqual([]);
  });

  test("the retired projects/DAG tools are gone for good", () => {
    for (const name of ["project_create", "project_status", "task_create", "task_complete"]) {
      expect(executors.has(name)).toBe(false);
      expect(indexed.has(name)).toBe(false);
    }
  });
});
