/**
 * failure-notify — closes the durable queue's silent-failure gap for the
 * user's own turns (chat_turn, goal_run).
 *
 * durable-queue.ts's terminal-hook mechanism only had one consumer before
 * this: delegation-notify.ts's worker_task hook, which relays a *delegated*
 * task's outcome back to the coordinator's conversation. Nothing told the
 * user when their OWN chat turn or goal run failed for good with no live
 * socket attached (a rehydrated turn after a crash, a job that exhausted its
 * lease via reclaimOrInterrupt, etc.) — the job/run just sat in HiveDB as
 * "failed", logged, and otherwise silent. From the user's side that reads as
 * the system not responding at all, not as an explained error.
 *
 * Unlike delegation-notify.ts, this sends directly via sendToUserChannel
 * instead of enqueueing another synthetic chat turn: the failure already
 * happened inside a turn/goal run, so routing it back through another LLM
 * turn would just risk failing the same way again. A plain, immediate
 * message is the safer default here.
 */

import { logger } from "../utils/logger";
import { registerTerminalHook, type JobTerminalOutcome } from "./durable-queue";
import { sendToUserChannel } from "./channel-notify";
import { resolveContext } from "./resolver";
import { getRun } from "../agent/run-store";
import type { JobDoc } from "../storage/collections";
import type { WebchatTurnPayload } from "./webchat-turn";

const log = logger.child("failure-notify");

async function notifyChatTurnFailure(job: JobDoc, outcome: JobTerminalOutcome): Promise<void> {
  if (outcome.ok) return; // success is delivered by runWebchatTurn itself

  const payload = JSON.parse(job.payload_json) as WebchatTurnPayload;
  const channel = payload.channel ?? "webchat";
  let userId = payload.userId;

  if (!userId) {
    // Live webchat turns ("message"/"audio"/"a2ui") never carry userId in the
    // payload — same resolution runWebchatTurn itself falls back to.
    try {
      const ctx = await resolveContext({ channel: "webchat", channelUserId: payload.sessionId });
      userId = ctx.userId;
    } catch (err) {
      log.warn(`[notifyChatTurnFailure] Could not resolve a recipient for job ${job.id}: ${(err as Error).message}`);
      return;
    }
  }

  await sendToUserChannel(
    channel,
    userId,
    "No pude completar tu solicitud por un error interno. Por favor intentá de nuevo."
  ).catch((err) => log.warn(`[notifyChatTurnFailure] Delivery failed for job ${job.id}: ${(err as Error).message}`));
}

async function notifyGoalRunFailure(job: JobDoc, outcome: JobTerminalOutcome): Promise<void> {
  if (outcome.ok) return; // goalRunExecutor already notifies success/budget-exhausted inline

  const run = await getRun(job.run_id).catch(() => null);
  if (!run?.channel || !run.user_id) return;

  await sendToUserChannel(
    run.channel,
    run.user_id,
    `No pude completar la tarea. Motivo: ${outcome.error ?? "error desconocido"}`
  ).catch((err) => log.warn(`[notifyGoalRunFailure] Delivery failed for job ${job.id}: ${(err as Error).message}`));
}

let initialized = false;

export function initFailureNotify(): void {
  if (initialized) return;
  registerTerminalHook("chat_turn", notifyChatTurnFailure);
  registerTerminalHook("goal_run", notifyGoalRunFailure);
  initialized = true;
  log.info("[initFailureNotify] Registered chat_turn/goal_run terminal hooks");
}
