import { createHash } from "node:crypto";
import { col } from "../storage/hive";
import type { NarrationEventDoc } from "../storage/collections";
import { logger } from "../utils/logger";

const log = logger.child("narration");

export type NarrationDelivery = (event: NarrationEventDoc) => Promise<void>;
const STATE_KEY = Symbol.for("hive.narration.delivery");
type NarrationState = { delivery: NarrationDelivery | null };

function state(): NarrationState {
  const root = globalThis as any;
  root[STATE_KEY] ??= { delivery: null };
  return root[STATE_KEY];
}

export function setNarrationDelivery(next: NarrationDelivery | null): void {
  state().delivery = next;
  log.info(`Delivery adapter ${next ? "registered" : "cleared"}`);
}

function eventId(turnId: string, dedupeKey: string): string {
  return createHash("sha256").update(`${turnId}\0${dedupeKey}`).digest("hex");
}

export async function publishNarration(input: {
  turnId: string;
  threadId: string;
  channel?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  kind: NarrationEventDoc["kind"];
  status: NarrationEventDoc["status"];
  label: string;
  detail?: string | null;
  dedupeKey: string;
}): Promise<NarrationEventDoc> {
  const id = eventId(input.turnId, input.dedupeKey);
  const events = await col<NarrationEventDoc>("narrationEvents");
  const existing = await events.get(id);
  if (existing) return existing.doc;

  const event: NarrationEventDoc = {
    id,
    turn_id: input.turnId,
    thread_id: input.threadId,
    channel: input.channel ?? "",
    user_id: input.userId ?? "",
    session_id: input.sessionId ?? "",
    agent_id: input.agentId ?? "",
    agent_name: input.agentName ?? "",
    kind: input.kind,
    status: input.status,
    label: input.label,
    detail: input.detail ?? null,
    dedupe_key: input.dedupeKey,
    created_at: Date.now(),
  };

  try {
    await events.put(id, event, { expectedVersion: 0 });
  } catch {
    const raced = await events.get(id);
    if (raced) return raced.doc;
    throw new Error(`Could not persist narration event ${id}`);
  }
  log.info(`Persisted ${event.kind} for turn=${event.turn_id} agent=${event.agent_id || "coordinator"}`);

  const delivery = state().delivery;
  if (delivery) {
    try {
      await delivery(event);
      log.info(`Delivered ${event.kind} for turn=${event.turn_id} channel=${event.channel || "none"}`);
    } catch (error) {
      log.warn(`Delivery failed for narration ${id}: ${(error as Error).message}`);
    }
  }
  return event;
}
