/**
 * Integration probe for parallel background delegation.
 *
 * This exercises the real DurableLaneQueue, AgentBus, Canvas emitter and
 * delegation terminal hook. The worker body is deterministic so timing and
 * observability assertions do not depend on a paid/external LLM.
 *
 * It validates the corrected delivery contract:
 * - independent task lanes overlap;
 * - worker/tool activity reaches AgentBus, Canvas and durable narration;
 * - both terminal workers join into exactly one coordinator synthesis turn.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agentBus } from "../packages/core/src/events/agent-bus";
import {
  DurableLaneQueue,
  registerExecutor,
  type JobExecutorResult,
} from "../packages/core/src/gateway/durable-queue";
import { initDelegationNotify } from "../packages/core/src/gateway/delegation-notify";
import { getJob } from "../packages/core/src/gateway/job-store";
import {
  emitCanvas,
  subscribeCanvas,
  unsubscribeCanvas,
} from "../packages/core/src/canvas/emitter";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";
import type { JobDoc } from "../packages/core/src/storage/collections";
import {
  registerDelegatedTask,
  sealDelegationGroup,
  setDelegationSummaryEnqueuer,
} from "../packages/core/src/gateway/delegation-groups";
import {
  publishNarration,
  setNarrationDelivery,
} from "../packages/core/src/events/narration";

interface TimelineEvent {
  at: number;
  source: "executor" | "agent_bus" | "canvas" | "narration";
  event: string;
  workerId?: string;
  toolName?: string;
}

let queue: DurableLaneQueue | null = null;

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("parallel delegation probe timed out");
}

beforeEach(async () => {
  closeHiveDb();
  agentBus.removeAllListeners();
  await ensureHiveDb();
});

afterEach(() => {
  queue?.stop();
  queue = null;
  agentBus.removeAllListeners();
  setNarrationDelivery(null);
  setDelegationSummaryEnqueuer(null);
  closeHiveDb();
});

describe("parallel background delegation observability", () => {
  test("two task lanes overlap and join into one coordinator turn", async () => {
    const timeline: TimelineEvent[] = [];
    let running = 0;
    let peakRunning = 0;

    const canvasSubscriber = {
      send(payload: string) {
        const message = JSON.parse(payload);
        if (message.type !== "canvas:node_update") return;
        const status = message.data?.changes?.status;
        timeline.push({
          at: Date.now(),
          source: "canvas",
          event: status,
          workerId: message.data?.nodeId,
          toolName: message.data?.changes?.currentTool,
        });
      },
    };
    subscribeCanvas(canvasSubscriber);

    const unsubs = [
      agentBus.subscribe("worker:task_started", (event) => {
        timeline.push({
          at: Date.now(),
          source: "agent_bus",
          event: "worker_started",
          workerId: event.workerId,
        });
      }),
      agentBus.subscribe("worker:task_completed", (event) => {
        timeline.push({
          at: Date.now(),
          source: "agent_bus",
          event: "worker_completed",
          workerId: event.workerId,
        });
      }),
    ];

    registerExecutor("worker_task", async (job): Promise<JobExecutorResult> => {
      const payload = JSON.parse(job.payload_json) as {
        workerId: string;
        workerName: string;
        toolName: string;
        taskName: string;
      };

      running++;
      peakRunning = Math.max(peakRunning, running);
      timeline.push({
        at: Date.now(),
        source: "executor",
        event: "started",
        workerId: payload.workerId,
      });
      agentBus.notifyTaskStarted(
        payload.workerId,
        payload.workerName,
        0,
        payload.taskName,
        "",
      );
      emitCanvas("canvas:node_update", {
        nodeId: payload.workerId,
        changes: { status: "tool_call", currentTool: payload.toolName },
      });
      await publishNarration({
        turnId: "turn-parallel",
        threadId: "webchat:parallel-observability",
        channel: "webchat",
        userId: "user",
        sessionId: "parallel-observability",
        agentId: payload.workerId,
        agentName: payload.workerName,
        kind: "tool_call",
        status: "running",
        label: `${payload.workerName} llamó ${payload.toolName}`,
        dedupeKey: `tool:${payload.workerId}:${payload.toolName}`,
      });

      // Both workers must remain active long enough for their intervals to overlap.
      await Bun.sleep(150);

      emitCanvas("canvas:node_update", {
        nodeId: payload.workerId,
        changes: { status: "idle", currentTool: null },
      });
      agentBus.notifyTaskCompleted(
        payload.workerId,
        payload.workerName,
        0,
        payload.taskName,
        "",
        `${payload.workerName} result`,
      );
      timeline.push({
        at: Date.now(),
        source: "executor",
        event: "completed",
        workerId: payload.workerId,
      });
      running--;
      return { ok: true, result: `${payload.workerName} result` };
    });

    initDelegationNotify();
    queue = new DurableLaneQueue({ maxGlobalConcurrency: 2 });
    registerExecutor("chat_turn", async () => ({ ok: true, result: "single summary" }));
    setNarrationDelivery(async (event) => {
      timeline.push({
        at: Date.now(),
        source: "narration",
        event: event.kind,
        workerId: event.agent_id,
      });
    });
    setDelegationSummaryEnqueuer(async (group, content, key) => queue!.enqueue({
      lane: group.session_id,
      type: "chat_turn",
      run_id: "summary-run",
      payload: { source: "delegation_summary", content },
      idempotency_key: key,
    }));

    const originThreadId = "webchat:parallel-observability";
    await Promise.all([
      registerDelegatedTask({
        turnId: "turn-parallel",
        taskId: "task-a",
        threadId: originThreadId,
        channel: "webchat",
        userId: "user",
        sessionId: "parallel-observability",
        coordinatorAgentId: "coordinator",
      }),
      registerDelegatedTask({
        turnId: "turn-parallel",
        taskId: "task-b",
        threadId: originThreadId,
        channel: "webchat",
        userId: "user",
        sessionId: "parallel-observability",
        coordinatorAgentId: "coordinator",
      }),
    ]);
    const jobs = await Promise.all([
      queue.enqueue({
        lane: "task:agent-a",
        type: "worker_task",
        run_id: "run-agent-a",
        payload: {
          workerId: "agent-a",
          workerName: "Agente A",
          toolName: "web_search",
          taskName: "Investigar A",
          originThreadId,
          turnId: "turn-parallel",
          taskId: "task-a",
        },
      }),
      queue.enqueue({
        lane: "task:agent-b",
        type: "worker_task",
        run_id: "run-agent-b",
        payload: {
          workerId: "agent-b",
          workerName: "Agente B",
          toolName: "fs_read",
          taskName: "Investigar B",
          originThreadId,
          turnId: "turn-parallel",
          taskId: "task-b",
        },
      }),
    ]);
    await sealDelegationGroup("turn-parallel");

    await waitFor(async () => {
      const states = await Promise.all(jobs.map((job) => getJob(job.id)));
      return states.every((job) => job?.status === "completed");
    });

    await waitFor(async () => {
      const all = await (await col<JobDoc>("jobQueue")).scan({});
      return all.filter((entry) => entry.doc.type === "chat_turn").length === 1;
    });

    const queued = (await (await col<JobDoc>("jobQueue")).scan({}))
      .map((entry) => entry.doc)
      .filter((job) => job.type === "chat_turn")
      .map((job) => ({
        lane: job.lane,
        payload: JSON.parse(job.payload_json),
      }));

    // Real queue concurrency: both executor bodies were active simultaneously.
    expect(peakRunning).toBe(2);

    // Both worker identities and their concrete tools are observable on Canvas.
    expect(timeline).toContainEqual(expect.objectContaining({
      source: "canvas",
      event: "tool_call",
      workerId: "agent-a",
      toolName: "web_search",
    }));
    expect(timeline).toContainEqual(expect.objectContaining({
      source: "canvas",
      event: "tool_call",
      workerId: "agent-b",
      toolName: "fs_read",
    }));

    // Both outcomes are joined into one idempotent coordinator synthesis.
    expect(queued).toHaveLength(1);
    expect(queued.every((notice) => notice.lane === "parallel-observability")).toBe(true);
    expect(queued.every((notice) => notice.payload.source === "delegation_summary")).toBe(true);
    expect(queued[0]?.payload.content).toContain("Agente A result");
    expect(queued[0]?.payload.content).toContain("Agente B result");

    expect(timeline.filter((event) => event.source === "narration").length).toBeGreaterThanOrEqual(2);

    console.info("PARALLEL_DELEGATION_PROBE", JSON.stringify({
      peakRunning,
      workerTools: timeline
        .filter((event) => event.source === "canvas" && event.event === "tool_call")
        .map(({ workerId, toolName }) => ({ workerId, toolName })),
      coordinatorCompletionTurns: queued.length,
      generalWorkerNarrationEvents: timeline.filter((event) => event.source === "narration").length,
    }));

    unsubs.forEach((unsubscribe) => unsubscribe());
    unsubscribeCanvas(canvasSubscriber);
  });
});
