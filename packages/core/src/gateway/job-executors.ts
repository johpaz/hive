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
 * - goal_run: multi-turn orchestration until the goal verifies or budget ends
 */

import { registerExecutor, type JobExecutor } from "./durable-queue";
import { logger } from "../utils/logger";
import { col, updateDoc } from "../storage/hive";
import { isRetryableError } from "../resilience/retry";
import type { JobDoc, TaskDoc, AgentRunDoc, AgentDoc } from "../storage/collections";
import { runAgent, runAgentIsolated, runAgentIsolatedDetailed } from "../agent/agent-loop";
import { createRun, completeRun, failRun, interruptRun, getRun, reclaimRun, bumpTurn, startLeaseRenewal, stopLeaseRenewal, deserializeAcceptance, deserializeEpoch } from "../agent/run-store";
import { getDurableQueue } from "./durable-queue";
import { sendToUserChannel } from "./channel-notify";
import { verifyGoal } from "../agent/goal-runner";
import { buildProofPacket } from "../agent/proof-packet";
import { verifyAgentDelivery } from "../agent/acceptance-verifier";
import { prepareDelegation, type PreparedDelegation } from "../agent/delegation-runtime";
import { runWebchatTurn, type WebchatTurnPayload } from "./webchat-turn";
import { agentBus } from "../events/agent-bus";
import { resolveContext } from "./resolver";
import type { MCPClientManager } from "@johpaz/hive-agents-mcp";
import { publishNarration } from "../events/narration";
import {
  emitDelegationStarted,
  emitDelegationFinished,
  emitVerificationStarted,
  emitVerificationFinished,
  emitWorkEvent,
} from "../canvas/emitter";
import { VERIFIER_AGENT_ID } from "../agent/acceptance-verifier";

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
  const acceptance = (payload.acceptance ?? null) as import("../agent/run-store").AcceptanceCriterion[] | null;
  const runId = job.run_id;
  const turnId = payload.turnId as string | undefined;
  const parentAgentId = (payload.parentAgentId as string | undefined) ?? "";
  const originThreadId = payload.originThreadId as string | undefined;
  const originChannel = payload.originChannel as string | undefined;
  const originUserId = payload.userId as string | undefined;
  const originSessionId = payload.originSessionId as string | undefined;

  log.info(`[worker_task] Job ${job.id} → worker=${workerId} task="${taskName}"`);

  const agentsCol = await col<AgentDoc>("agents");
  const workerEntry = await agentsCol.get(workerId);
  if (!workerEntry) return { ok: false, error: `Worker not found: ${workerId}`, retryable: false };
  if (!workerEntry.doc.enabled) return { ok: false, error: `Worker disabled: ${workerEntry.doc.name}`, retryable: false };

  const workerName = workerEntry.doc.name;
  const isCatalogAgent = workerEntry.doc.source === "catalog";
  agentBus.notifyTaskStarted(workerId, workerName, 0, taskName, "");
  const delegationRef = taskId ?? job.id;
  emitDelegationStarted({ workerId, parentAgentId, taskRef: delegationRef, taskName });
  if (turnId && originThreadId) {
    await publishNarration({
      turnId,
      threadId: originThreadId,
      channel: originChannel,
      userId: originUserId,
      sessionId: originSessionId,
      agentId: workerId,
      agentName: workerName,
      kind: "worker_started",
      status: "running",
      label: `${workerName} inició “${taskName}”`,
      dedupeKey: `worker_started:${taskId ?? job.id}`,
    });
  }

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

  let prepared: PreparedDelegation | null = null;
  try {
    prepared = await prepareDelegation(workerId, {
      workspace: payload.workspace ?? workerEntry.doc.workspace ?? null,
      parentProviderId: payload.parentProviderId ?? null,
      parentModelId: payload.parentModelId ?? null,
      mcpManager,
    });
    // Resume from the checkpoint on a re-claimed job (payload can't know this)
    const run = runId ? await getRun(runId) : null;
    const resume = !!run?.state_json;
    const threadId = run?.thread_id || `task-${Date.now()}-${workerId}`;

    const execution = await runAgentIsolatedDetailed({
      agentId: workerId,
      taskDescription,
      threadId,
      mcpManager,
      runId,
      resume,
      durable: !!runId,
      signal,
      turnId,
      taskId,
      userId: originUserId,
      channel: originChannel,
      sessionId: originSessionId,
    });
    const result = execution.content;

    if (signal.aborted) {
      agentBus.notifyTaskFailed(workerId, workerName, 0, taskName, "", "Aborted");
      emitWorkEvent({
        phase: "aborted",
        taskRef: delegationRef,
        taskName,
        actorId: workerId,
        targetId: parentAgentId || null,
        detail: "Trabajo interrumpido",
      });
      if (taskId) {
        await updateDoc<TaskDoc>("tasks", taskId, {
          status: "pending",
          updated_at: Date.now(),
        } as Partial<TaskDoc>).catch(() => {});
      }
      return { ok: false, error: "Aborted", retryable: false };
    }

    const finishedRun = runId ? await getRun(runId) : null;
    if (turnId && originThreadId) {
      await publishNarration({
        turnId,
        threadId: originThreadId,
        channel: originChannel,
        userId: originUserId,
        sessionId: originSessionId,
        agentId: workerId,
        agentName: workerName,
        kind: "verifying",
        status: "running",
        label: `El verificador está revisando la entrega de ${workerName}`,
        dedupeKey: `verifying:${taskId ?? job.id}`,
      });
    }
    emitVerificationStarted({ verifierId: VERIFIER_AGENT_ID, workerId, taskRef: delegationRef, taskName });
    const verification = await verifyAgentDelivery({
      runId,
      taskId,
      executorAgentId: workerId,
      objective: taskDescription,
      acceptance: acceptance ?? (finishedRun ? deserializeAcceptance(finishedRun) : null),
      delivery: result,
      evidence: [result, ...execution.toolEvidence],
      executorEpoch: finishedRun ? deserializeEpoch(finishedRun) : null,
      mcpServerIds: prepared.mcpServerIds,
      mcpManager,
    });
    const verdict = JSON.parse(verification.verdict_json);
    emitVerificationFinished({ verifierId: VERIFIER_AGENT_ID, taskRef: delegationRef });
    if (verification.status !== "verified") {
      emitWorkEvent({
        phase: "review_failed",
        taskRef: delegationRef,
        taskName,
        actorId: VERIFIER_AGENT_ID,
        targetId: workerId,
        detail: verdict.summary || "La entrega no superó la verificación",
      });
      if (turnId && originThreadId) {
        await publishNarration({
          turnId,
          threadId: originThreadId,
          channel: originChannel,
          userId: originUserId,
          sessionId: originSessionId,
          agentId: workerId,
          agentName: workerName,
          kind: "failed",
          status: "error",
          label: `El verificador no aprobó la entrega de ${workerName}`,
          detail: verdict.summary || "Falta evidencia independiente.",
          dedupeKey: `verification_failed:${taskId ?? job.id}`,
        });
      }
      if (taskId) {
        await updateDoc<TaskDoc>("tasks", taskId, {
          status: "blocked",
          error: verdict.summary || "Independent verification did not authorize success.",
          updated_at: Date.now(),
        } as Partial<TaskDoc>).catch(() => {});
      }
      return {
        ok: false,
        error: verdict.summary || "Independent verification did not authorize success.",
        retryable: false,
      };
    }
    emitWorkEvent({
      phase: "review_passed",
      taskRef: delegationRef,
      taskName,
      actorId: VERIFIER_AGENT_ID,
      targetId: workerId,
    });
    if (turnId && originThreadId) {
      await publishNarration({
        turnId,
        threadId: originThreadId,
        channel: originChannel,
        userId: originUserId,
        sessionId: originSessionId,
        agentId: workerId,
        agentName: workerName,
        kind: "verified",
        status: "done",
        label: `El verificador aprobó la entrega de ${workerName}`,
        detail: `verification_id=${verification.id}`,
        dedupeKey: `verified:${taskId ?? job.id}`,
      });
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

    await buildProofPacket({
      runId,
      agentId: workerId,
      intendedOutcome: taskDescription,
      met: true,
      checksRun: acceptance?.map((criterion) => criterion.checkTool ?? "acceptance_verifier") ?? ["acceptance_verifier"],
      evidence: [result, ...execution.toolEvidence],
      epoch: finishedRun ? deserializeEpoch(finishedRun) : null,
      verificationId: verification.id,
      catalogAgentId: isCatalogAgent ? workerId : null,
    });

    emitWorkEvent({
      phase: "completed",
      taskRef: delegationRef,
      taskName,
      actorId: workerId,
      targetId: parentAgentId || null,
    });

    return {
      ok: true,
      result: {
        content: result,
        evidence: execution.toolEvidence,
        verification_id: verification.id,
      },
    };
  } catch (err) {
    const errorMsg = (err as Error).message;
    agentBus.notifyTaskFailed(workerId, workerName, 0, taskName, "", errorMsg);
    emitWorkEvent({
      phase: signal.aborted ? "aborted" : "failed",
      taskRef: delegationRef,
      taskName,
      actorId: workerId,
      targetId: parentAgentId || null,
      detail: signal.aborted ? "Trabajo interrumpido" : errorMsg,
    });
    if (turnId && originThreadId) {
      await publishNarration({
        turnId,
        threadId: originThreadId,
        channel: originChannel,
        userId: originUserId,
        sessionId: originSessionId,
        agentId: workerId,
        agentName: workerName,
        kind: "failed",
        status: "error",
        label: `${workerName} no pudo completar “${taskName}”`,
        detail: errorMsg,
        dedupeKey: `worker_failed:${taskId ?? job.id}`,
      });
    }

    // Update TaskDoc → failed
    if (taskId) {
      await updateDoc<TaskDoc>("tasks", taskId, {
        status: "failed",
        error: errorMsg,
        updated_at: Date.now(),
      } as Partial<TaskDoc>).catch(() => {});
    }

    return { ok: false, error: errorMsg, retryable: isRetryableError(err) };
  } finally {
    // Idempotente: cubre también el caso en que verifyAgentDelivery lance
    emitVerificationFinished({ verifierId: VERIFIER_AGENT_ID, taskRef: delegationRef });
    emitDelegationFinished({ workerId, taskRef: delegationRef });
    await prepared?.release();
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

  const acceptance = deserializeAcceptance(goalRun);
  const epoch = deserializeEpoch(goalRun);

  await reclaimRun(goalRunId).catch(() => {});
  startLeaseRenewal(goalRunId);

  try {
    let attempts = goalRun.goal_attempts ?? 0;
    let lastContent = "";
    let lastReason = "";

    for (;;) {
      if (signal.aborted) {
        await interruptRun(goalRunId, "Goal run aborted").catch(() => {});
        return { ok: false, error: "Aborted", retryable: false };
      }

      // HARD budget check against the accumulated goal run row
      const current = await getRun(goalRunId);
      const turnsUsed = current?.turns_used ?? 0;
      const tokensUsed = current?.tokens_used ?? 0;
      if (attempts >= maxAttempts || turnsUsed >= maxTurns || tokensUsed >= maxTokens) {
        const summary = `intentos ${attempts}/${maxAttempts}, turnos ${turnsUsed}/${maxTurns}, tokens ${tokensUsed}/${maxTokens}`;
        await failRun(goalRunId, `Goal not met — budget exhausted (${summary}). ${lastReason}`.trim());
        await notify(`❌ Meta no cumplida: "${goal}". Presupuesto agotado (${summary}).${lastReason ? ` Última razón: ${lastReason}` : ""}`);
        await buildProofPacket({
          runId: goalRunId,
          agentId,
          intendedOutcome: goal,
          met: false,
          checksRun: acceptance ? acceptance.map((a) => a.checkTool ?? "llm_verifier") : [checkTool ?? "llm_verifier"],
          evidence: [lastReason || "budget exhausted before verification succeeded"],
          knownLimits: `Budget exhausted: ${summary}`,
          epoch,
        }).catch(() => {});
        return { ok: false, error: `Goal budget exhausted (${summary})`, retryable: false };
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
      // (or one check per acceptance criterion when the run has them)
      const providerCfg = await resolveGoalProviderCfg(agentId);
      const verdict = await verifyGoal(goal, checkTool, [
        { role: "user", content: `Meta: ${goal}` },
        { role: "assistant", content: turnContent || "(sin respuesta)" },
      ], providerCfg, acceptance);

      if (verdict.met) {
        const independent = await verifyAgentDelivery({
          runId: goalRunId,
          executorAgentId: agentId,
          objective: goal,
          acceptance,
          delivery: lastContent,
          evidence: [verdict.reason],
          executorEpoch: epoch,
          mcpManager,
        });
        if (independent.status !== "verified") {
          const independentVerdict = JSON.parse(independent.verdict_json);
          lastReason = independentVerdict.summary || "La verificación independiente no autorizó el éxito.";
          log.info(`[goal_run] Independent verifier rejected attempt ${attempts}: ${lastReason}`);
          continue;
        }
        await completeRun(goalRunId, lastContent);
        await notify(`✅ Meta cumplida: "${goal}". ${verdict.reason}`);
        log.info(`[goal_run] Goal met after ${attempts} attempt(s): ${verdict.reason}`);
        await buildProofPacket({
          runId: goalRunId,
          agentId,
          intendedOutcome: goal,
          met: true,
          acceptanceResults: verdict.acceptanceResults,
          checksRun: acceptance ? acceptance.map((a) => a.checkTool ?? "llm_verifier") : [checkTool ?? "llm_verifier"],
          evidence: [verdict.reason, lastContent].filter(Boolean),
          epoch,
          verificationId: independent.id,
          catalogAgentId: null,
        });
        return { ok: true, result: { met: true, attempts, reason: verdict.reason, content: lastContent } };
      }

      lastReason = verdict.reason;
      log.info(`[goal_run] Attempt ${attempts}/${maxAttempts} not met: ${verdict.reason}`);
    }
  } catch (err) {
    await failRun(goalRunId, (err as Error).message).catch(() => {});
    return { ok: false, error: (err as Error).message, retryable: isRetryableError(err) };
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
  registerExecutor("goal_run", goalRunExecutor);
  initialized = true;
  log.info("[initJobExecutors] All executors registered");
}
