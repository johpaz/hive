/**
 * Benchmark: Skills Loading on HiveDB
 *
 * Re-runs the measurements from the old "YAML vs SQLite - Skills Loading"
 * benchmark (docs/inferencia.md, 2026-04-22), but against the current
 * storage engine (HiveDB: redb + tantivy BM25 + hnsw) instead of SQLite.
 *
 * Runs against a fresh HiveDB instance seeded with the real bundled skill
 * catalog (same seed path a real gateway boot uses), so the numbers reflect
 * the actual current engine, not synthetic data. Defaults to :memory:;
 * pass HIVE_DB_PATH to benchmark a real on-disk instance instead (closer to
 * production conditions).
 *
 * Usage: bun run scripts/bench-skills-hivedb.ts
 *        HIVE_DB_PATH=/tmp/bench-hivedb bun run scripts/bench-skills-hivedb.ts
 */

process.env.HIVE_DB_PATH ??= ":memory:";

import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import {
  getAllSkillsFromDB,
  getSkillByName,
  getMinimalSkills,
} from "../packages/core/src/agent/skill-selector";
import { searchCapabilities } from "../packages/core/src/agent/capability-search";
import { estimateTokens } from "../packages/core/src/utils/toon";

function fmtMs(ms: number): string {
  return `${ms.toFixed(2)}ms`;
}

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  return { result, ms };
}

async function timeAvg<T>(fn: () => Promise<T>, runs: number): Promise<{ result: T; avgMs: number; minMs: number; maxMs: number }> {
  let result!: T;
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = await time(fn);
    result = t.result;
    samples.push(t.ms);
  }
  return {
    result,
    avgMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

async function main() {
  console.log("🐝 Hive Benchmark — Skills Loading on HiveDB\n");
  console.log(`Fecha: ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Motor: @johpaz/hive-db (redb + tantivy BM25 + hnsw), instancia: ${process.env.HIVE_DB_PATH}\n`);

  closeHiveDb();
  resetBootId();

  const boot = await time(() => ensureHiveDb());
  console.log(`Boot + seed completo (ensureHiveDb, incluye ~73 tools + skills + models + playbook): ${fmtMs(boot.ms)}\n`);

  const allSkills = await getAllSkillsFromDB();
  console.log(`Skills activas en catálogo: ${allSkills.length}\n`);

  const RUNS = 20;

  // ── Load 1 skill ──────────────────────────────────────────────────────
  const oneSkillName = allSkills[0]?.name;
  const loadOne = await timeAvg(() => getSkillByName(oneSkillName), RUNS);

  // ── Load all skills ───────────────────────────────────────────────────
  const loadAll = await timeAvg(() => getAllSkillsFromDB(), RUNS);

  // ── Minimal skills (always-loaded set) ────────────────────────────────
  const loadMinimal = await timeAvg(() => getMinimalSkills(), RUNS);

  // ── BM25 discovery (capability-search, type=skill) ────────────────────
  const query = "buscar en la web y guardar el resultado";
  const discovery = await timeAvg(
    () => searchCapabilities(query, { types: ["skill"], k: 10 }),
    RUNS
  );

  console.log("## Tiempos (promedio de", RUNS, "corridas, en caliente)\n");
  console.log(`| Operación | Promedio | Min | Max |`);
  console.log(`|-----------|----------|-----|-----|`);
  console.log(`| getSkillByName() — 1 skill | ${fmtMs(loadOne.avgMs)} | ${fmtMs(loadOne.minMs)} | ${fmtMs(loadOne.maxMs)} |`);
  console.log(`| getAllSkillsFromDB() — ${allSkills.length} skills | ${fmtMs(loadAll.avgMs)} | ${fmtMs(loadAll.minMs)} | ${fmtMs(loadAll.maxMs)} |`);
  console.log(`| getMinimalSkills() — ${loadMinimal.result.length} skills | ${fmtMs(loadMinimal.avgMs)} | ${fmtMs(loadMinimal.minMs)} | ${fmtMs(loadMinimal.maxMs)} |`);
  console.log(`| searchCapabilities() BM25, k=10 | ${fmtMs(discovery.avgMs)} | ${fmtMs(discovery.minMs)} | ${fmtMs(discovery.maxMs)} |`);

  // ── Tokens ─────────────────────────────────────────────────────────────
  const allTokens = allSkills.reduce((sum, s) => sum + estimateTokens(s.body), 0);
  const minimalTokens = loadMinimal.result.reduce((sum, s) => sum + estimateTokens(s.body), 0);
  const minimalMetaTokens = loadMinimal.result.reduce((sum, s) => sum + estimateTokens(s.name + " " + s.description), 0);

  console.log(`\n## Tokens\n`);
  console.log(`| Métrica | Tokens |`);
  console.log(`|---------|--------|`);
  console.log(`| ${allSkills.length} skills (catálogo completo, body incluido) | ${allTokens.toLocaleString()} |`);
  console.log(`| ${loadMinimal.result.length} skills mínimas (body completo) | ${minimalTokens.toLocaleString()} |`);
  console.log(`| ${loadMinimal.result.length} skills mínimas (solo metadata: nombre+descripción) | ${minimalMetaTokens.toLocaleString()} |`);

  closeHiveDb();
  console.log("\n✅ Benchmark completado.");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
