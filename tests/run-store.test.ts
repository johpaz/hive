/**
 * Tests for agent/run-store.ts — AgentRun lifecycle, checkpoint, lease.
 * Uses HIVE_DB_PATH=":memory:" so no state persists between runs.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { AgentRunDoc } from "../packages/core/src/storage/collections";
import {
  createRun,
  checkpoint,
  completeRun,
  failRun,
  interruptRun,
  getRun,
  findRunsByStatus,
  findExpiredRuns,
  deserializeCheckpoint,
  type RunCheckpointState,
} from "../packages/core/src/agent/run-store";
import { getBootId, resetBootId } from "../packages/core/src/storage/boot-id";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("run-store: createRun", () => {
  test("creates a running run with correct defaults", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    expect(run.thread_id).toBe("thread1");
    expect(run.agent_id).toBe("agent1");
    expect(run.kind).toBe("chat");
    expect(run.status).toBe("running");
    expect(run.iterations_used).toBe(0);
    expect(run.max_iterations).toBe(10);
    expect(run.max_turns).toBeNull();
    expect(run.max_tokens).toBeNull();
    expect(run.goal).toBeNull();
    expect(run.resume_policy).toBe("resume");
    expect(run.error).toBeNull();
    expect(run.lease_expires_at).toBeGreaterThan(Date.now());
    expect(run.boot_id).toBe(getBootId());
  });

  test("creates with goal and budget overrides", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: null,
      kind: "goal",
      max_iterations: 50,
      max_turns: 5,
      max_tokens: 100_000,
      goal: "build feature X",
      goal_check_tool: "verify_feature",
      resume_policy: "discard",
    });

    expect(run.kind).toBe("goal");
    expect(run.max_turns).toBe(5);
    expect(run.max_tokens).toBe(100_000);
    expect(run.goal).toBe("build feature X");
    expect(run.goal_check_tool).toBe("verify_feature");
    expect(run.resume_policy).toBe("discard");
  });
});

describe("run-store: checkpoint", () => {
  test("saves and deserializes checkpoint state", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    const state: RunCheckpointState = {
      version: 1,
      messages: [
        { role: "system", content: "You are an agent" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
      iterations: 3,
      totalInputTokens: 500,
      totalOutputTokens: 200,
      lastToolSignature: "",
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: ["search_knowledge"],
      systemPromptSkillSections: ["## Skill: coding"],
    };

    await checkpoint(run.id, state);

    const saved = await getRun(run.id);
    expect(saved).not.toBeNull();
    expect(saved!.iterations_used).toBe(3);
    expect(saved!.tokens_used).toBe(700);

    const deserialized = deserializeCheckpoint(saved!);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.iterations).toBe(3);
    expect(deserialized!.totalInputTokens).toBe(500);
    expect(deserialized!.totalOutputTokens).toBe(200);
    expect(deserialized!.messages.length).toBe(3);
    expect(deserialized!.injectedToolNames).toEqual(["search_knowledge"]);
  });

  test("normalizes a stray trailing system message (pre-source checkpoint) to a wrapped user turn", async () => {
    const run = await createRun({
      thread_id: "thread-stray-system",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    // Checkpoints written before `source` existed could carry a second
    // system message — the compaction summary or a delegation notice —
    // after the real system prompt at index 0.
    const state: RunCheckpointState = {
      version: 1,
      messages: [
        { role: "system", content: "You are an agent" },
        { role: "user", content: "Hello" },
        { role: "system", content: "[Conversation Summary]: resumen previo" },
      ],
      iterations: 1,
      totalInputTokens: 10,
      totalOutputTokens: 10,
      lastToolSignature: "",
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: [],
      systemPromptSkillSections: [],
    };

    await checkpoint(run.id, state);
    const saved = await getRun(run.id);
    const deserialized = deserializeCheckpoint(saved!);

    expect(deserialized).not.toBeNull();
    // index 0 stays the real system prompt.
    expect(deserialized!.messages[0].role).toBe("system");
    expect(deserialized!.messages[0].content).toBe("You are an agent");
    // the stray one is rewritten as a wrapped user turn, not dropped.
    expect(deserialized!.messages[2].role).toBe("user");
    expect(deserialized!.messages[2].content).toContain('<hive:internal_event source="legacy_internal">');
    expect(deserialized!.messages[2].content).toContain("resumen previo");
    // exactly one system message survives.
    expect(deserialized!.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  test("truncates large tool results to stay under MAX_STATE_BYTES", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    const bigContent = "x".repeat(200_000);
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: "user" as const, content: `msg ${i}` });
      messages.push({ role: "tool" as const, content: bigContent, tool_call_id: `tc_${i}` });
    }
    const state: RunCheckpointState = {
      version: 1,
      messages,
      iterations: 5,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      lastToolSignature: "",
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: [],
      systemPromptSkillSections: [],
    };

    await checkpoint(run.id, state);

    const saved = await getRun(run.id);
    expect(saved!.state_bytes).toBeLessThanOrEqual(1_500_000);
  });

  test("saves pending_tool_calls_json", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    const state: RunCheckpointState = {
      version: 1,
      messages: [{ role: "user", content: "test" }],
      iterations: 2,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      lastToolSignature: "",
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: [],
      systemPromptSkillSections: [],
    };

    const pending = [
      { id: "tc1", function: { name: "memory_write", arguments: "{}" } },
    ];

    await checkpoint(run.id, state, pending);

    const saved = await getRun(run.id);
    expect(saved!.pending_tool_calls_json).not.toBeNull();
    const parsed = JSON.parse(saved!.pending_tool_calls_json!);
    expect(parsed[0].function.name).toBe("memory_write");
  });
});

describe("run-store: lifecycle transitions", () => {
  test("completeRun sets status to completed and clears checkpoint", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    await completeRun(run.id);

    const saved = await getRun(run.id);
    expect(saved!.status).toBe("completed");
    expect(saved!.state_json).toBe("");
    expect(saved!.state_bytes).toBe(0);
    expect(saved!.pending_tool_calls_json).toBeNull();
    expect(saved!.finished_at).not.toBeNull();
  });

  test("failRun sets error message", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "worker",
      max_iterations: 10,
    });

    await failRun(run.id, "Something went wrong");

    const saved = await getRun(run.id);
    expect(saved!.status).toBe("failed");
    expect(saved!.error).toBe("Something went wrong");
  });

  test("interruptRun sets interrupted status", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    await interruptRun(run.id, "Process restarted");

    const saved = await getRun(run.id);
    expect(saved!.status).toBe("interrupted");
    expect(saved!.error).toContain("Process restarted");
  });
});

describe("run-store: lease expiry", () => {
  test("findExpiredRuns returns runs with expired lease", async () => {
    const run = await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    // Force lease expiry by setting lease_expires_at to past
    const c = await col<AgentRunDoc>("agentRuns");
    await c.put(run.id, { ...run, lease_expires_at: Date.now() - 1000 }, { expectedVersion: 1 });

    const expired = await findExpiredRuns();
    expect(expired.length).toBe(1);
    expect(expired[0].id).toBe(run.id);
  });

  test("findExpiredRuns skips runs with active lease", async () => {
    await createRun({
      thread_id: "thread1",
      agent_id: "agent1",
      user_id: "user1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    const expired = await findExpiredRuns();
    expect(expired.length).toBe(0);
  });
});

describe("run-store: findRunsByStatus", () => {
  test("finds runs by status index", async () => {
    const run1 = await createRun({ thread_id: "t1", agent_id: "a1", user_id: "u1", channel: null, kind: "chat", max_iterations: 10 });
    const run2 = await createRun({ thread_id: "t2", agent_id: "a2", user_id: "u1", channel: null, kind: "worker", max_iterations: 10 });

    await completeRun(run1.id);
    await failRun(run2.id, "err");

    const completed = await findRunsByStatus("completed");
    const failed = await findRunsByStatus("failed");
    const running = await findRunsByStatus("running");

    expect(completed.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(running.length).toBe(0);
  });
});