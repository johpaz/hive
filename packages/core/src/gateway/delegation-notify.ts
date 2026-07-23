/**
 * delegation-notify — closes the loop on `task_delegate(mode:"async")`.
 *
 * Before this, an async-delegated worker_task was fire-and-forget: nothing
 * told the user (or the coordinator) when the specialist finished. This
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

const log = logger.child("delegation-notify");

interface WorkerTaskPayload {
  originThreadId?: string | null;
  taskName?: string;
  workerId?: string;
  specialistId?: string;
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
  if (!payload.originThreadId) return; // sync delegation or no coordinator conversation to report back to

  const sessionId = deriveSessionId(payload.originThreadId);
  const taskName = payload.taskName || "la tarea delegada";

  const outcomeLine = outcome.ok
    ? `El especialista completó la tarea "${taskName}". Resultado: ${summarize(outcome.result)}`
    : `El especialista NO pudo completar la tarea "${taskName}". Motivo: ${summarize(outcome.error ?? "error desconocido")}`;

  const content = `[Sistema] ${outcomeLine}\n\nEsto es una actualización automática, no un mensaje del usuario. Comunicaselo de forma natural y breve; agregá contexto o próximos pasos si corresponde.`;

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
  initialized = true;
  log.info("[initDelegationNotify] Registered worker_task terminal hook");
}
