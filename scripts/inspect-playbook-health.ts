/**
 * Playbook health inspection — zero LLM quota cost (pure DB reads), safe to
 * run repeatedly, including against a live DB while a real user is chatting
 * via `hive dev:keep`.
 *
 * Designed directly against the bug class already found and fixed this
 * session (commit 6be330f): curator.ts only reinforces an existing rule when
 * its first-60-chars prefix matches exactly, so a per-run identifier
 * embedded in rule text (like a causalStreamId) makes every occurrence mint
 * a brand new rule instead of reinforcing one. The detectors below are
 * regression canaries for exactly that class of bug, generalized.
 *
 * Usage:
 *   HIVE_HOME="$HOME/.hive-dev" HIVE_DEV=true bun run scripts/inspect-playbook-health.ts [--json]
 */

import { col } from "../packages/core/src/storage/hive";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import type { PlaybookDoc, ReflectionDoc } from "../packages/core/src/storage/collections";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");

  const playbookCol = await col<PlaybookDoc>("playbook");
  const reflectionsCol = await col<ReflectionDoc>("reflections");

  const allRules = (await playbookCol.scan({})).map((e) => e.doc);
  const allReflections = (await reflectionsCol.scan({})).map((e) => e.doc);

  const activeRules = allRules.filter((r) => r.active);
  const inactiveRules = allRules.filter((r) => !r.active);

  // ── Category breakdown ─────────────────────────────────────────────────
  const byCategory: Record<string, number> = {};
  for (const r of allRules) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

  // ── Reinforcement health ───────────────────────────────────────────────
  const helpfulCounts = activeRules.map((r) => r.helpful_count);
  const stuckAtOne = helpfulCounts.filter((c) => c === 1).length;

  // ── Duplicate-prefix detector (regression canary) ──────────────────────
  const byPrefix = new Map<string, PlaybookDoc[]>();
  for (const r of activeRules) {
    const prefix = r.rule.substring(0, 60);
    const group = byPrefix.get(prefix) ?? [];
    group.push(r);
    byPrefix.set(prefix, group);
  }
  const duplicateGroups = [...byPrefix.entries()].filter(([, group]) => group.length > 1);

  // ── Leaked-identifier detector (generalizes the streamId-leak bug) ─────
  const leakedIdentifierRules = allRules.filter((r) => UUID_RE.test(r.rule));

  // ── Growth rate by day ──────────────────────────────────────────────────
  const byDay: Record<string, number> = {};
  for (const r of allRules) {
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  // ── Reflections → playbook conversion + G9-specific insight counts ─────
  const reflectionsByType: Record<string, number> = {};
  for (const r of allReflections) reflectionsByType[r.insight_type] = (reflectionsByType[r.insight_type] ?? 0) + 1;
  const g9InsightCount = (reflectionsByType["root_cause"] ?? 0) + (reflectionsByType["learning_proposal"] ?? 0);
  const legacyInsightCount = allReflections.length - g9InsightCount;

  const report = {
    rules: {
      total: allRules.length,
      active: activeRules.length,
      inactive: inactiveRules.length,
      byCategory,
    },
    reinforcement: {
      medianHelpfulCount: median(helpfulCounts),
      meanHelpfulCount: helpfulCounts.length ? helpfulCounts.reduce((a, b) => a + b, 0) / helpfulCounts.length : 0,
      stuckAtOneCount: stuckAtOne,
      stuckAtOnePct: activeRules.length ? Math.round((stuckAtOne / activeRules.length) * 100) : 0,
    },
    duplicatePrefixGroups: duplicateGroups.map(([prefix, group]) => ({
      prefix,
      count: group.length,
      ids: group.map((r) => r.id),
    })),
    leakedIdentifierRules: leakedIdentifierRules.map((r) => ({ id: r.id, rule: r.rule.slice(0, 100) })),
    growthByDay: byDay,
    reflections: {
      total: allReflections.length,
      byType: reflectionsByType,
      g9InsightCount,
      legacyInsightCount,
      conversionRatio: allReflections.length ? Math.round((allRules.length / allReflections.length) * 100) / 100 : 0,
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\n=== Playbook health report ===\n");
    console.log(`Reglas: ${report.rules.total} total (${report.rules.active} activas, ${report.rules.inactive} inactivas)`);
    console.table(report.rules.byCategory);

    console.log("\n--- Reforzamiento ---");
    console.log(`helpful_count: mediana=${report.reinforcement.medianHelpfulCount}, media=${report.reinforcement.meanHelpfulCount.toFixed(2)}`);
    console.log(`Reglas con helpful_count=1 (nunca reforzadas): ${report.reinforcement.stuckAtOneCount} (${report.reinforcement.stuckAtOnePct}%)`);

    console.log("\n--- Regresión: prefijos duplicados (debería ser 0) ---");
    if (duplicateGroups.length === 0) {
      console.log("✅ Ninguno.");
    } else {
      console.log(`⚠️  ${duplicateGroups.length} grupo(s) con reglas duplicadas por prefijo:`);
      for (const g of report.duplicatePrefixGroups) console.log(`  "${g.prefix}" x${g.count} → ${g.ids.join(", ")}`);
    }

    console.log("\n--- Regresión: identificadores filtrados en texto de reglas (debería ser 0) ---");
    if (leakedIdentifierRules.length === 0) {
      console.log("✅ Ninguno.");
    } else {
      console.log(`⚠️  ${leakedIdentifierRules.length} regla(s) con un UUID en el texto:`);
      for (const r of report.leakedIdentifierRules) console.log(`  [${r.id}] ${r.rule}`);
    }

    console.log("\n--- Crecimiento por día ---");
    console.table(report.growthByDay);

    console.log("\n--- Reflections ---");
    console.log(`Total: ${report.reflections.total} (G9: ${report.reflections.g9InsightCount}, previos: ${report.reflections.legacyInsightCount})`);
    console.table(report.reflections.byType);
    console.log(`Ratio reglas/reflections: ${report.reflections.conversionRatio}`);
  }

  closeHiveDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("inspect-playbook-health failed:", err);
  process.exit(1);
});
