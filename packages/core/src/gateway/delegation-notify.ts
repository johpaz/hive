/**
 * delegation-notify — closes the loop on `task_delegate(mode:"async")`.
 *
 * Before this, an async-delegated worker_task was fire-and-forget: nothing
 * told the user (or the coordinator) when the delegated agent finished. This
 * registers a terminal hook (durable-queue.ts) that, on completion or final
 * failure, enqueues a synthetic chat turn in the ORIGINATING conversation's
 * lane so the coordinator can relay the outcome — reusing the exact delivery
 * path already used for crash-recovered turns (webchat-turn.ts's
 * `sendToUserChannel` fallback when no live socket is attached).
 */

import { logger } from "../utils/logger";
import { registerTerminalHook, type JobTerminalOutcome } from "./durable-queue";
import { enqueueChatTurn } from "./webchat-turn";
import type { JobDoc } from "../storage/collections";
import {
  recordDelegationOutcome,
  setDelegationSummaryEnqueuer,
} from "./delegation-groups";

const log = logger.child("delegation-notify");

interface WorkerTaskPayload {
  originThreadId?: string | null;
  taskName?: string;
  workerId?: string;
  taskId?: string;
  turnId?: string | null;
}

/** Inverts enqueueChatTurn's `thread_id = webchat:${sessionId}` (or raw sessionId for "api") mapping (webchat-turn.ts:438). */
function deriveSessionId(originThreadId: string): string {
  const prefix = "webchat:";
  return originThreadId.startsWith(prefix) ? originThreadId.slice(prefix.length) : originThreadId;
}

function summarize(value: unknown, maxLen = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

async function notifyWorkerTaskOutcome(job: JobDoc, outcome: JobTerminalOutcome): Promise<void> {
  const payload = JSON.parse(job.payload_json) as WorkerTaskPayload;
  if (payload.turnId && payload.taskId) {
    await recordDelegationOutcome({
      turnId: payload.turnId,
      taskId: payload.taskId,
      jobId: job.id,
      workerId: payload.workerId ?? "",
      taskName: payload.taskName ?? "tarea delegada",
      ok: outcome.ok,
      result: outcome.result,
      error: outcome.error ?? null,
    });
    return;
  }
  if (!payload.originThreadId) return; // sync delegation or no coordinator conversation to report back to

  const sessionId = deriveSessionId(payload.originThreadId);
  const taskName = payload.taskName || "la tarea delegada";

  // No manual framing here — persisted with source:"task_complete" and framed
  // at serialization time by formatInternalEvent (conversation-store.ts).
  const content = outcome.ok
    ? `El agente completó la tarea "${taskName}". Resultado: ${summarize(outcome.result)}`
    : `El agente NO pudo completar la tarea "${taskName}". Motivo: ${summarize(outcome.error ?? "error desconocido")}`;

  try {
    await enqueueChatTurn({
      lane: sessionId,
      payload: { source: "task_complete", sessionId, content },
    });
    log.info(`[notifyWorkerTaskOutcome] Enqueued task_complete notice for session ${sessionId} (job ${job.id}, ok=${outcome.ok})`);
  } catch (err) {
    log.warn(`[notifyWorkerTaskOutcome] Failed to enqueue completion notice: ${(err as Error).message}`);
  }
}

let initialized = false;

export function initDelegationNotify(): void {
  if (initialized) return;
  registerTerminalHook("worker_task", notifyWorkerTaskOutcome);
  setDelegationSummaryEnqueuer(async (group, content, idempotencyKey) => {
    const sessionId = group.session_id || deriveSessionId(group.thread_id);
    return enqueueChatTurn({
      lane: sessionId,
      payload: {
        source: "delegation_summary",
        sessionId,
        content,
        rawContent: content,
        userId: group.user_id,
        agentId: group.coordinator_agent_id,
        channel: group.channel,
      },
      idempotencyKey,
    });
  });
  initialized = true;
  log.info("[initDelegationNotify] Registered worker_task terminal hook");
}
