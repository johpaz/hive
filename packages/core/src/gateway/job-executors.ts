/**
 * Job executors — type → executor registry for the durable queue.
 *
 * Each executor re-runs a job from its payload_json (no closures or live
 * callbacks needed). Live streaming callbacks are passed via the
 * `callbacks` argument from the durable queue's in-memory stash.
 *
 * Executors:
 * - chat_turn: runs the agent loop + streams tokens back to the WS channel
 * - worker_task: runs an isolated worker agent + notifies the bus + channel
 * - project_task: runs a project subtask worker + updates TaskDoc
 */

import { registerExecutor, type JobExecutor } from "./durable-queue";
import { logger } from "../utils/logger";
import { col, updateDoc } from "../storage/hive";
import type { JobDoc, TaskDoc } from "../storage/collections";
import { runAgent, runAgentIsolated } from "../agent/agent-loop";
import { createRun, completeRun, failRun, interruptRun, getRun } from "../agent/run-store";
import { getDurableQueue } from "./durable-queue";
import { sendToUserChannel } from "./channel-notify";
import { runWebchatTurn, type WebchatTurnPayload } from "./webchat-turn";
import { agentBus } from "../events/agent-bus";
import { resolveContext } from "./resolver";
import type { MCPClientManager } from "@johpaz/hive-agents-mcp";

const log = logger.child("job-executors");

let mcpManager: MCPClientManager | null = null;

export function setJobExecutorMCPManager(m: MCPClientManager | null): void {
  mcpManager = m;
}

// ─── chat_turn executor ─────────────────────────────────────────────────────

const chatTurnExecutor: JobExecutor = async (job, signal, callbacks) => {
  const payload = JSON.parse(job.payload_json) as WebchatTurnPayload;

  log.info(`[chat_turn] Job ${job.id} → source=${payload.source} session=${payload.sessionId}`);

  try {
    // Live path: sendRaw streams to the socket exactly like the old LaneQueue
    // closure. Rehydrated path (crash recovery): no callbacks → the turn runs
    // headless and delivers via the user's channel.
    const content = await runWebchatTurn(
      payload,
      callbacks?.sendRaw ? { sendRaw: callbacks.sendRaw } : null,
      signal,
    );
    return { ok: true, result: content };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ─── worker_task executor ───────────────────────────────────────────────────

const workerTaskExecutor: JobExecutor = async (job, signal) => {
  const payload = JSON.parse(job.payload_json);
  const workerId = payload.workerId as string;
  const taskDescription = payload.taskDescription as string;
  const taskName = payload.taskName as string;
  const taskId = payload.taskId as string | undefined;
  const runId = job.run_id;

  log.info(`[worker_task] Job ${job.id} → worker=${workerId} task="${taskName}"`);

  const agentsCol = await col<{ id: string; name: string; enabled: boolean }>("agents");
  const workerEntry = await agentsCol.get(workerId);
  if (!workerEntry) return { ok: false, error: `Worker not found: ${workerId}` };
  if (!workerEntry.doc.enabled) return { ok: false, error: `Worker disabled: ${workerEntry.doc.name}` };

  const workerName = workerEntry.doc.name;
  agentBus.notifyTaskStarted(workerId, workerName, 0, taskName, "");

  // Update TaskDoc → in_progress if we have a taskId
  if (taskId) {
    await updateDoc<TaskDoc>("tasks", taskId, {
      status: "in_progress",
      started_at: Date.now(),
      job_id: job.id,
      run_id: runId,
      updated_at: Date.now(),
    } as Partial<TaskDoc>).catch(() => {});
  }

  try {
    const threadId = `task-${Date.now()}-${workerId}`;
    const result = await runAgentIsolated({
      agentId: workerId,
      taskDescription,
      threadId,
      mcpManager,
    });

    if (signal.aborted) {
      agentBus.notifyTaskFailed(workerId, workerName, 0, taskName, "", "Aborted");
      if (taskId) {
        await updateDoc<TaskDoc>("tasks", taskId, {
          status: "pending",
          updated_at: Date.now(),
        } as Partial<TaskDoc>).catch(() => {});
      }
      return { ok: false, error: "Aborted" };
    }

    agentBus.notifyTaskCompleted(workerId, workerName, 0, taskName, "", result);

    // Update TaskDoc → completed
    if (taskId) {
      await updateDoc<TaskDoc>("tasks", taskId, {
        status: "completed",
        progress: 100,
        result,
        completed_at: Date.now(),
        updated_at: Date.now(),
      } as Partial<TaskDoc>).catch(() => {});
    }

    return { ok: true, result };
  } catch (err) {
    const errorMsg = (err as Error).message;
    agentBus.notifyTaskFailed(workerId, workerName, 0, taskName, "", errorMsg);

    // Update TaskDoc → failed
    if (taskId) {
      await updateDoc<TaskDoc>("tasks", taskId, {
        status: "failed",
        error: errorMsg,
        updated_at: Date.now(),
      } as Partial<TaskDoc>).catch(() => {});
    }

    return { ok: false, error: errorMsg };
  }
};

// ─── project_task executor ──────────────────────────────────────────────────

const projectTaskExecutor: JobExecutor = async (job, signal) => {
  const payload = JSON.parse(job.payload_json);
  const taskId = payload.taskId as string;
  const workerId = payload.workerId as string;
  const taskDescription = payload.taskDescription as string;
  const runId = job.run_id;

  log.info(`[project_task] Job ${job.id} → task=${taskId} worker=${workerId}`);

  // Update TaskDoc → in_progress
  await updateDoc<TaskDoc>("tasks", taskId, {
    status: "in_progress",
    started_at: Date.now(),
    job_id: job.id,
    run_id: runId,
    updated_at: Date.now(),
  } as Partial<TaskDoc>).catch(() => {});

  try {
    const threadId = `project-${taskId}-${Date.now()}`;
    const result = await runAgentIsolated({
      agentId: workerId,
      taskDescription,
      threadId,
      mcpManager,
    });

    if (signal.aborted) {
      await updateDoc<TaskDoc>("tasks", taskId, {
        status: "pending",
        updated_at: Date.now(),
      } as Partial<TaskDoc>).catch(() => {});
      return { ok: false, error: "Aborted" };
    }

    // Update TaskDoc → completed
    await updateDoc<TaskDoc>("tasks", taskId, {
      status: "completed",
      progress: 100,
      result,
      completed_at: Date.now(),
      updated_at: Date.now(),
    } as Partial<TaskDoc>).catch(() => {});

    // Kick the TaskDriver to check for newly-ready tasks
    try {
      const { getTaskDriver } = await import("../scheduler/task-driver");
      await getTaskDriver().kick("project_task:completed");
    } catch { /* non-critical */ }

    return { ok: true, result };
  } catch (err) {
    const errorMsg = (err as Error).message;
    await updateDoc<TaskDoc>("tasks", taskId, {
      status: "failed",
      error: errorMsg,
      updated_at: Date.now(),
    } as Partial<TaskDoc>).catch(() => {});

    // Kick the TaskDriver to check for newly-ready tasks (or blocked dependents)
    try {
      const { getTaskDriver } = await import("../scheduler/task-driver");
      await getTaskDriver().kick("project_task:failed");
    } catch { /* non-critical */ }

    return { ok: false, error: errorMsg };
  }
};

// ─── goal_run executor ──────────────────────────────────────────────────────
// (Phase 3 will flesh this out; for now it's a placeholder that runs the agent loop)

const goalRunExecutor: JobExecutor = async (job, signal) => {
  const payload = JSON.parse(job.payload_json);
  const agentId = payload.agentId as string;
  const threadId = payload.threadId as string;
  const goal = payload.goal as string;
  const runId = job.run_id;

  log.info(`[goal_run] Job ${job.id} → agent=${agentId} goal="${goal}"`);

  try {
    let lastContent = "";
    for await (const chunk of runAgent({
      agentId,
      userMessage: `Goal: ${goal}`,
      threadId,
      signal,
      runId,
      resume: payload.resume ?? false,
      durable: true,
      runKind: "goal",
      goal: { text: goal, checkTool: payload.goal_check_tool },
      budget: payload.budget ?? { maxIterations: 50 },
    })) {
      if (chunk.agent?.messages?.[0]?.content) {
        lastContent = chunk.agent.messages[0].content;
      }
    }
    return { ok: true, result: lastContent };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ─── Register all executors ─────────────────────────────────────────────────

let initialized = false;

export function initJobExecutors(): void {
  if (initialized) return;
  registerExecutor("chat_turn", chatTurnExecutor);
  registerExecutor("worker_task", workerTaskExecutor);
  registerExecutor("project_task", projectTaskExecutor);
  registerExecutor("goal_run", goalRunExecutor);
  initialized = true;
  log.info("[initJobExecutors] All executors registered");
}