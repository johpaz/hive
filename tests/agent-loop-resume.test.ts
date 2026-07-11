/**
 * Test: agent-loop resume from checkpoint.
 *
 * Simulates: LLM fake → 2 round-trips → abort → re-launch with resume →
 * messages + iteration count continue, tool en vuelo appears [interrupted].
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId, getBootId } from "../packages/core/src/storage/boot-id";
import { createRun, checkpoint, getRun, completeRun } from "../packages/core/src/agent/run-store";
import type { RunCheckpointState } from "../packages/core/src/agent/run-store";
import { deserializeCheckpoint } from "../packages/core/src/agent/run-store";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("agent-loop resume: checkpoint + interrupted tool", () => {
  test("checkpoint saves state, resume restores messages + synthetic [interrupted] tool msg", async () => {
    // 1. Create a run and simulate 2 round-trips
    const run = await createRun({
      thread_id: "thread-resume-1",
      agent_id: "agent-resume-1",
      user_id: "user-1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 20,
    });

    // Simulate state after 2 round-trips
    const state: RunCheckpointState = {
      version: 1,
      messages: [
        { role: "system", content: "You are an agent" },
        { role: "user", content: "What time is it?" },
        { role: "assistant", content: null, tool_calls: [{ id: "tc1", type: "function", function: { name: "memory_write", arguments: "{}" } }] },
        { role: "tool", content: "Memory saved.", tool_call_id: "tc1" },
        { role: "assistant", content: "Let me check the time", tool_calls: [{ id: "tc2", type: "function", function: { name: "cli_exec", arguments: '{"command":"date"}' } }] },
      ],
      iterations: 2,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      lastToolSignature: "cli_exec:{}", // continuing from mid-tool
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: [],
      systemPromptSkillSections: [],
    };

    // 2. Checkpoint with pending tool call (simulates crash mid-tool)
    const pendingToolCalls = [
      { id: "tc2", type: "function", function: { name: "cli_exec", arguments: '{"command":"date"}' } },
    ];
    await checkpoint(run.id, state, pendingToolCalls);

    // 3. Verify checkpoint persisted
    const saved = await getRun(run.id);
    expect(saved).not.toBeNull();
    expect(saved!.iterations_used).toBe(2);
    expect(saved!.tokens_used).toBe(1500);
    expect(saved!.pending_tool_calls_json).not.toBeNull();

    // 4. Simulate resume: deserialize checkpoint + inject [interrupted] msg
    const restored = deserializeCheckpoint(saved!);
    expect(restored).not.toBeNull();
    expect(restored!.iterations).toBe(2);
    expect(restored!.totalInputTokens).toBe(1000);
    expect(restored!.messages.length).toBe(5);

    const pending = JSON.parse(saved!.pending_tool_calls_json!);
    expect(pending[0].function.name).toBe("cli_exec");

    // Inject synthetic [interrupted] tool message
    const interruptedMsg = {
      role: "tool" as const,
      content: "[interrupted] El proceso se reinició mientras esta herramienta corría. El resultado no está disponible — decidí si reintentar o continuar sin él.",
      tool_call_id: "tc2",
    };
    const resumedMessages = [...restored!.messages, interruptedMsg];
    expect(resumedMessages.length).toBe(6);
    expect(resumedMessages[5].role).toBe("tool");
    expect(resumedMessages[5].content).toContain("[interrupted]");
  });

  test("complete run clears checkpoint state", async () => {
    const run = await createRun({
      thread_id: "thread-resume-2",
      agent_id: "agent-resume-2",
      user_id: "user-1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    const state: RunCheckpointState = {
      version: 1,
      messages: [{ role: "user", content: "hello" }],
      iterations: 1,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      lastToolSignature: "",
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: [],
      systemPromptSkillSections: [],
    };
    await checkpoint(run.id, state);
    await completeRun(run.id);

    const final = await getRun(run.id);
    expect(final!.status).toBe("completed");
    expect(final!.state_json).toBe("");
    expect(final!.pending_tool_calls_json).toBeNull();
  });

  test("run with no checkpoint returns null from deserializeCheckpoint", async () => {
    const run = await createRun({
      thread_id: "thread-resume-3",
      agent_id: "agent-resume-3",
      user_id: "user-1",
      channel: "webchat",
      kind: "chat",
      max_iterations: 10,
    });

    const empty = await getRun(run.id);
    expect(empty!.state_json).toBe("");
    const restored = deserializeCheckpoint(empty!);
    expect(restored).toBeNull();
  });
});