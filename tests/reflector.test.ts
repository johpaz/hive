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

describe("reflector: G9 causal-thread evaluation (evaluateHarness)", () => {
  test("a stream with a repeated tool-call failure produces root_cause and learning_proposal insights", async () => {
    process.env.HIVE_CAUSAL_LOG = "true";
    const db = await getHiveDb();

    // Build a realistic causal thread: Intent -> Decision -> 3x ToolCall Err
    // (same tool + message), mirroring exactly what agent-loop.ts emits and
    // matching the 3-repetition threshold hiveBD's errorLoop detector requires.
    const streamId = "stream-rootcause-1";
    const intentSeq = await db.append({
      agentId: "agent-1",
      streamId,
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "agent-1", intent: "deploy the checkout service" }),
    });
    const decisionSeq = await db.append({
      agentId: "agent-1",
      streamId,
      kind: "StateTransition",
      payload: JSON.stringify({ description: "Calling flaky_tool" }),
      causation: intentSeq,
    });
    for (let i = 0; i < 3; i++) {
      await db.append({
        agentId: "agent-1",
        streamId,
        kind: "ToolCall",
        payload: JSON.stringify({ tool: "flaky_tool", outcome: { Err: "boom" } }),
        causation: decisionSeq,
      });
    }

    await seedTrace({
      tool_used: "flaky_tool",
      success: false,
      causal_stream_id: streamId,
      input_summary: "deploy the checkout service",
    });
    for (let i = 0; i < 9; i++) {
      await seedTrace({ tool_used: "ok_tool", success: true });
    }

    await runReflector();

    const reflectionsCol = await col<ReflectionDoc>("reflections");
    const all = await reflectionsCol.scan({});

    const rootCause = all.find((e) => e.doc.insight_type === "root_cause");
    expect(rootCause).toBeDefined();
    expect(rootCause!.doc.description).toContain("flaky_tool");

    const proposal = all.find((e) => e.doc.insight_type === "learning_proposal");
    expect(proposal).toBeDefined();
    expect(proposal!.doc.description.toLowerCase()).toContain("flaky_tool");
    expect(proposal!.doc.confidence).toBeGreaterThanOrEqual(0.5);

    // The mapped playbook categories from curator.ts (root_cause -> error_avoidance,
    // learning_proposal -> response_quality) confirm the insights flowed all the
    // way through to the playbook, not just into the reflections collection.
    const playbookCol = await col<import("../packages/core/src/storage/collections").PlaybookDoc>("playbook");
    const playbook = await playbookCol.scan({});
    expect(playbook.some((e) => e.doc.source_reflection_id === rootCause!.id && e.doc.category === "error_avoidance")).toBe(true);
    expect(playbook.some((e) => e.doc.source_reflection_id === proposal!.id && e.doc.category === "response_quality")).toBe(true);
  });

  test("a stream with no failures produces no root_cause or learning_proposal insights", async () => {
    process.env.HIVE_CAUSAL_LOG = "true";
    const db = await getHiveDb();

    const streamId = "stream-clean-1";
    const intentSeq = await db.append({
      agentId: "agent-1",
      streamId,
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "agent-1", intent: "read a file" }),
    });
    await db.append({
      agentId: "agent-1",
      streamId,
      kind: "StateTransition",
      payload: JSON.stringify({ description: "Calling read_file" }),
      causation: intentSeq,
    });

    await seedTrace({ tool_used: "read_file", success: true, causal_stream_id: streamId });
    for (let i = 0; i < 9; i++) {
      await seedTrace({ tool_used: "ok_tool", success: true });
    }

    await runReflector();

    const reflectionsCol = await col<ReflectionDoc>("reflections");
    const all = await reflectionsCol.scan({});
    expect(all.some((e) => e.doc.insight_type === "root_cause")).toBe(false);
    expect(all.some((e) => e.doc.insight_type === "learning_proposal")).toBe(false);
  });
});
