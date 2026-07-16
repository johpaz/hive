/**
 * Reflector tests: local trace-batch analysis, plus the G9 causalLog path
 * where per-tool insights (failure count, avg latency) come from HiveDB's
 * whole-history toolStats() instead of just the current batch of traces.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb, getHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, nextId } from "../packages/core/src/storage/hive";
import type { TraceDoc, ReflectionDoc } from "../packages/core/src/storage/collections";
import { runReflector } from "../packages/core/src/agent/reflector";

async function seedTrace(overrides: Partial<TraceDoc>) {
  const tracesCol = await col<TraceDoc>("traces");
  const id = await nextId("traces");
  await tracesCol.put(id, {
    id,
    thread_id: "thread-1",
    agent_id: "agent-1",
    agent_name: "Agent 1",
    tool_used: null,
    input_summary: "input",
    output_summary: "output",
    success: true,
    error_message: null,
    duration_ms: null,
    tokens_used: null,
    created_at: Date.now(),
    ...overrides,
  });
  return id;
}

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
  delete process.env.HIVE_CAUSAL_LOG;
});

describe("reflector: local trace-batch analysis (causalLog disabled)", () => {
  test("failure_pattern insight uses the batch-local failure count", async () => {
    for (let i = 0; i < 4; i++) {
      await seedTrace({ tool_used: "flaky_tool", success: false });
    }
    for (let i = 0; i < 6; i++) {
      await seedTrace({ tool_used: "ok_tool", success: true });
    }

    await runReflector();

    const reflectionsCol = await col<ReflectionDoc>("reflections");
    const all = await reflectionsCol.scan({});
    const failureInsight = all.find((e) => e.doc.insight_type === "failure_pattern");
    expect(failureInsight).toBeDefined();
    expect(failureInsight!.doc.description).toContain("flaky_tool");
    expect(failureInsight!.doc.description).toContain("4 times");
  });
});

describe("reflector: G9 causal event log (causalLog enabled)", () => {
  test("failure_pattern insight uses toolStats().errors from the whole event log, not just this batch", async () => {
    process.env.HIVE_CAUSAL_LOG = "true";
    const db = await getHiveDb();

    // 6 historical ToolCall errors for "flaky_tool" — more than the 4 failures
    // present in this batch of traces.
    for (let i = 0; i < 6; i++) {
      await db.append({
        agentId: "agent-1",
        streamId: "stream-history",
        kind: "ToolCall",
        payload: JSON.stringify({ tool: "flaky_tool", outcome: { Err: `boom-${i}` } }),
      });
    }

    for (let i = 0; i < 4; i++) {
      await seedTrace({ tool_used: "flaky_tool", success: false });
    }
    for (let i = 0; i < 6; i++) {
      await seedTrace({ tool_used: "ok_tool", success: true });
    }

    await runReflector();

    const reflectionsCol = await col<ReflectionDoc>("reflections");
    const all = await reflectionsCol.scan({});
    const failureInsight = all.find((e) => e.doc.insight_type === "failure_pattern");
    expect(failureInsight).toBeDefined();
    // 6 from the event log's full history, not 4 from this batch alone
    expect(failureInsight!.doc.description).toContain("6 times");
  });

  test("optimization (slow tool) insight uses toolStats().totalLatencyMs/invocations", async () => {
    process.env.HIVE_CAUSAL_LOG = "true";
    const db = await getHiveDb();

    // 3 historical ToolCall events for "slow_tool" with a high average latency
    // (12000ms), distinct from the batch's own (lower) durations.
    for (let i = 0; i < 3; i++) {
      await db.append({
        agentId: "agent-1",
        streamId: "stream-history",
        kind: "ToolCall",
        payload: JSON.stringify({ tool: "slow_tool", latency_ms: 12000, outcome: "Ok" }),
      });
    }

    for (let i = 0; i < 3; i++) {
      await seedTrace({ tool_used: "slow_tool", success: true, duration_ms: 6000 });
    }
    for (let i = 0; i < 7; i++) {
      await seedTrace({ tool_used: "ok_tool", success: true });
    }

    await runReflector();

    const reflectionsCol = await col<ReflectionDoc>("reflections");
    const all = await reflectionsCol.scan({});
    const slowInsight = all.find(
      (e) => e.doc.insight_type === "optimization" && e.doc.description.includes("slow_tool")
    );
    expect(slowInsight).toBeDefined();
    // avg from toolStats (12000ms), not from the batch's own durations (6000ms)
    expect(slowInsight!.doc.description).toContain("12000ms");
  });
});
