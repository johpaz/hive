/**
 * Tests for gateway/failure-notify.ts — the terminal hooks that make sure a
 * failed chat_turn/goal_run always reaches the user instead of dying
 * silently in HiveDB (see durable-queue.ts's registerTerminalHook/
 * runTerminalHook, previously only wired up for worker_task).
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { JobDoc } from "../packages/core/src/storage/collections";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { createJob, claimJob, reclaimOrInterrupt } from "../packages/core/src/gateway/job-store";
import { runTerminalHook } from "../packages/core/src/gateway/durable-queue";
import { setChannelSendFn } from "../packages/core/src/gateway/channel-notify";
import { initFailureNotify } from "../packages/core/src/gateway/failure-notify";
import { createRun } from "../packages/core/src/agent/run-store";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
  initFailureNotify();
});

afterEach(() => {
  closeHiveDb();
});

describe("failure-notify: chat_turn terminal hook", () => {
  test("notifies the user's channel when a chat_turn job fails for good", async () => {
    const sent: Array<{ channel: string; sessionId: string; message: string }> = [];
    setChannelSendFn(async (channel, sessionId, message) => {
      sent.push({ channel, sessionId, message });
    });

    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: { source: "message", sessionId: "user-42", content: "hola", userId: "user-42", channel: "telegram" },
      run_id: "r1",
    });

    await runTerminalHook(job, { ok: false, error: "boom" });

    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe("telegram");
    expect(sent[0].message).toContain("No pude completar");
  });

  test("does nothing when the outcome is ok (success already delivered elsewhere)", async () => {
    const sent: unknown[] = [];
    setChannelSendFn(async () => { sent.push(1); });

    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: { source: "message", sessionId: "user-42", content: "hola", userId: "user-42", channel: "telegram" },
      run_id: "r1",
    });

    await runTerminalHook(job, { ok: true, result: "done" });
    expect(sent.length).toBe(0);
  });
});

describe("failure-notify: goal_run terminal hook", () => {
  test("notifies the run's channel/user when a goal_run job fails for good", async () => {
    const sent: Array<{ channel: string; sessionId: string; message: string }> = [];
    setChannelSendFn(async (channel, sessionId, message) => {
      sent.push({ channel, sessionId, message });
    });

    const run = await createRun({
      thread_id: "thread-1",
      agent_id: "bee",
      user_id: "user-7",
      channel: "slack",
      kind: "goal",
      max_iterations: 10,
    });

    const job = await createJob({
      lane: "goal:1",
      type: "goal_run",
      payload: { agentId: "bee", threadId: "thread-1", goal: "ship it" },
      run_id: run.id,
    });

    await runTerminalHook(job, { ok: false, error: "budget exhausted" });

    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe("slack");
    expect(sent[0].message).toContain("budget exhausted");
  });
});

describe("failure-notify: reclaimOrInterrupt fires the terminal hook (closes Hueco #3)", () => {
  test("interrupting a chat_turn job after lease expiry still notifies the user", async () => {
    const sent: Array<{ channel: string; sessionId: string; message: string }> = [];
    setChannelSendFn(async (channel, sessionId, message) => {
      sent.push({ channel, sessionId, message });
    });

    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: { source: "message", sessionId: "user-99", content: "hola", userId: "user-99", channel: "discord" },
      run_id: "r1",
      max_attempts: 1,
    });
    await claimJob(job.id, "boot-A");

    // Simulate a dead lease with attempts already exhausted.
    const c = await col<JobDoc>("jobQueue");
    const entry = await c.get(job.id);
    await c.put(job.id, { ...entry!.doc, lease_expires_at: Date.now() - 1000 }, { expectedVersion: entry!.version });

    const result = await reclaimOrInterrupt(job.id);
    expect(result!.status).toBe("interrupted");

    // reclaimOrInterrupt fires the hook asynchronously inline (awaited) before
    // returning — no need to wait for a microtask here.
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe("discord");
  });
});
