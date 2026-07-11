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
import type { JobDoc, TaskDoc, AgentRunDoc } from "../storage/collections";
import { runAgent, runAgentIsolated } from "../agent/agent-loop";
import { createRun, completeRun, failRun, interruptRun, getRun, reclaimRun, bumpTurn, startLeaseRenewal, stopLeaseRenewal } from "../agent/run-store";
import { getDurableQueue } from "./durable-queue";
import { sendToUserChannel } from "./channel-notify";
import { verifyGoal } from "../agent/goal-runner";
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
// Multi-turn orchestration: run a turn → verify the goal → continue with the
// verifier's feedback until the goal is met or the budget runs out. The goal
// AgentRun row (job.run_id) is the orchestrator record: goal_attempts,
// turns_used and tokens_used accumulate across turns and the budget is HARD.
// Turns are plain (non-durable) runs on the same thread — a mid-turn crash
// re-runs the current attempt; conversation history preserves prior progress.

const goalRunExecutor: JobExecutor = async (job, signal) => {
  const payload = JSON.parse(job.payload_json);
  const agentId = payload.agentId as string;
  const threadId = payload.threadId as string;
  const goal = payload.goal as string;
  const checkTool = (payload.goal_check_tool as string | null) ?? null;
  const budget = (payload.budget ?? {}) as { maxIterations?: number; maxTurns?: number; maxTokens?: number };
  const maxIterationsPerTurn = budget.maxIterations ?? 20;
  const maxTurns = budget.maxTurns ?? 10;
  const maxTokens = budget.maxTokens ?? 200_000;
  const maxAttempts = (payload.maxAttempts as number | undefined) ?? 5;
  const goalRunId = job.run_id;

  log.info(`[goal_run] Job ${job.id} → agent=${agentId} goal="${goal}" maxAttempts=${maxAttempts}`);

  const goalRun = await getRun(goalRunId);
  if (!goalRun) return { ok: false, error: `Goal run ${goalRunId} not found` };
  const channel = goalRun.channel;
  const notifyUserId = goalRun.user_id;

  const notify = async (text: string) => {
    if (channel && notifyUserId) {
      await sendToUserChannel(channel, notifyUserId, text).catch(() => {});
    }
  };

  await reclaimRun(goalRunId).catch(() => {});
  startLeaseRenewal(goalRunId);

  try {
    let attempts = goalRun.goal_attempts ?? 0;
    let lastContent = "";
    let lastReason = "";

    for (;;) {
      if (signal.aborted) {
        await interruptRun(goalRunId, "Goal run aborted").catch(() => {});
        return { ok: false, error: "Aborted" };
      }

      // HARD budget check against the accumulated goal run row
      const current = await getRun(goalRunId);
      const turnsUsed = current?.turns_used ?? 0;
      const tokensUsed = current?.tokens_used ?? 0;
      if (attempts >= maxAttempts || turnsUsed >= maxTurns || tokensUsed >= maxTokens) {
        const summary = `intentos ${attempts}/${maxAttempts}, turnos ${turnsUsed}/${maxTurns}, tokens ${tokensUsed}/${maxTokens}`;
        await failRun(goalRunId, `Goal not met — budget exhausted (${summary}). ${lastReason}`.trim());
        await notify(`❌ Meta no cumplida: "${goal}". Presupuesto agotado (${summary}).${lastReason ? ` Última razón: ${lastReason}` : ""}`);
        return { ok: false, error: `Goal budget exhausted (${summary})` };
      }

      const turnMessage = attempts === 0
        ? `Meta: ${goal}\n\nTrabajá hasta cumplir esta meta. Explicá el resultado al terminar.`
        : `La meta aún no se verificó como cumplida.\nMeta: "${goal}"\nRazón del verificador: ${lastReason}\nPresupuesto restante: ${maxAttempts - attempts} intento(s), ${maxTurns - turnsUsed} turno(s).\nContinuá trabajando para cumplirla.`;

      // One turn (non-durable: the goal row carries the durable state)
      let turnTokens = 0;
      let turnContent = "";
      for await (const chunk of runAgent({
        agentId,
        userMessage: turnMessage,
        threadId,
        signal,
        mcpManager,
        budget: { maxIterations: maxIterationsPerTurn },
      })) {
        const msgs = (chunk as any).agent?.messages;
        if (msgs?.[0]?.content) turnContent = msgs[0].content;
        const usage = (chunk as any).usage;
        if (usage) turnTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
      }

      attempts++;
      lastContent = turnContent || lastContent;
      await bumpTurn(goalRunId, turnTokens).catch(() => {});
      await updateDoc<AgentRunDoc>("agentRuns", goalRunId, {
        goal_attempts: attempts,
        updated_at: Date.now(),
      } as Partial<AgentRunDoc>).catch(() => {});

      // Verify: deterministic tool when configured, LLM verifier otherwise
      const providerCfg = await resolveGoalProviderCfg(agentId);
      const verdict = await verifyGoal(goal, checkTool, [
        { role: "user", content: `Meta: ${goal}` },
        { role: "assistant", content: turnContent || "(sin respuesta)" },
      ], providerCfg);

      if (verdict.met) {
        await completeRun(goalRunId, lastContent);
        await notify(`✅ Meta cumplida: "${goal}". ${verdict.reason}`);
        log.info(`[goal_run] Goal met after ${attempts} attempt(s): ${verdict.reason}`);
        return { ok: true, result: { met: true, attempts, reason: verdict.reason, content: lastContent } };
      }

      lastReason = verdict.reason;
      log.info(`[goal_run] Attempt ${attempts}/${maxAttempts} not met: ${verdict.reason}`);
    }
  } catch (err) {
    await failRun(goalRunId, (err as Error).message).catch(() => {});
    return { ok: false, error: (err as Error).message };
  } finally {
    stopLeaseRenewal(goalRunId);
  }
};

async function resolveGoalProviderCfg(agentId: string) {
  const { fromIndexable } = await import("../storage/hive");
  const { resolveProviderConfig, getDefaultLLM } = await import("../agent/llm-client");
  const agentsCol = await col<{ provider_id?: string | null; model_id?: string | null }>("agents");
  const entry = await agentsCol.get(agentId);
  let providerId = entry ? fromIndexable(entry.doc.provider_id ?? null) : null;
  let modelId = entry ? fromIndexable(entry.doc.model_id ?? null) : null;
  if (!providerId || !modelId) {
    const dflt = await getDefaultLLM();
    providerId = providerId || dflt?.provider || "";
    modelId = modelId || dflt?.model || "";
  }
  return resolveProviderConfig(providerId, modelId);
}

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