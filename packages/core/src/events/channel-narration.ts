// ─── Narration delivery policy for messaging channels ─────────────────────────
// WebChat renders narration as ephemeral, collapsible "process" widgets. A
// messaging channel (WhatsApp, Telegram, Slack, Discord) has no such surface:
// every narration event becomes a permanent chat message. Without a filter a
// single turn with a few tools and two delegated workers produces dozens of
// messages before the actual answer — noise for the user and a rate-limit /
// ban risk on WhatsApp. This module decides what reaches those channels.

import { col } from "../storage/hive";
import type { ChannelDoc, NarrationEventDoc } from "../storage/collections";
import { logger } from "../utils/logger";

const log = logger.child("narration:channel");

/** `off` = silent, `milestones` = delegation lifecycle only, `all` = + per-tool steps. */
export type NarrationMode = "off" | "milestones" | "all";

export const DEFAULT_NARRATION_MODE: NarrationMode = "milestones";

/** Legacy `step_delivery_mode` values predate this feature — map them forward. */
function coerceMode(raw: string | null | undefined): NarrationMode {
  switch (raw) {
    case "off":
    case "milestones":
    case "all":
      return raw;
    // "new_messages" was the original (never-read) default.
    case "new_messages":
      return DEFAULT_NARRATION_MODE;
    default:
      return DEFAULT_NARRATION_MODE;
  }
}

/** High-level events: what the user actually cares about seeing in a chat. */
const MILESTONE_KINDS = new Set<NarrationEventDoc["kind"]>([
  "delegated",
  "worker_started",
  "verified",
  "failed",
  "group_ready",
]);

const KIND_PREFIX: Record<NarrationEventDoc["kind"], string> = {
  delegated: "📋",
  worker_started: "▶️",
  tool_call: "⚙️",
  tool_result: "⚠️",
  verified: "✅",
  failed: "❌",
  group_ready: "📝",
};

const DETAIL_MAX_CHARS = 200;

// ─── Mode lookup (cached) ─────────────────────────────────────────────────────
// Resolved per channel *type* because narration events only carry the type, not
// the account id. Short TTL so a settings change takes effect without a restart.

const MODE_CACHE_TTL_MS = 30_000;
const modeCache = new Map<string, { mode: NarrationMode; expiresAt: number }>();

export function invalidateNarrationModeCache(channelType?: string): void {
  if (channelType) modeCache.delete(channelType);
  else modeCache.clear();
}

export async function resolveNarrationMode(channelType: string): Promise<NarrationMode> {
  const cached = modeCache.get(channelType);
  if (cached && cached.expiresAt > Date.now()) return cached.mode;

  let mode = DEFAULT_NARRATION_MODE;
  try {
    const channels = await col<ChannelDoc>("channels");
    const row = (await channels.scan({})).find((e) => e.doc.type === channelType);
    mode = coerceMode(row?.doc.step_delivery_mode);
  } catch (error) {
    log.debug(`Could not resolve narration mode for ${channelType}: ${(error as Error).message}`);
  }

  modeCache.set(channelType, { mode, expiresAt: Date.now() + MODE_CACHE_TTL_MS });
  return mode;
}

// ─── Filtering ────────────────────────────────────────────────────────────────

export function shouldDeliverToChannel(event: NarrationEventDoc, mode: NarrationMode): boolean {
  if (mode === "off") return false;
  if (MILESTONE_KINDS.has(event.kind)) return true;
  if (mode !== "all") return false;
  // Even in `all`, a successful tool_result only restates the tool_call that
  // preceded it. Errors are the part worth surfacing.
  if (event.kind === "tool_result") return event.status === "error";
  return true;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Collapses whitespace and trims — raw error details carry stacks and paths. */
function compactDetail(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  if (flat.length <= DETAIL_MAX_CHARS) return flat;
  return `${flat.slice(0, DETAIL_MAX_CHARS - 1)}…`;
}

export function formatNarrationForChannel(event: NarrationEventDoc): string {
  const prefix = KIND_PREFIX[event.kind] ?? "•";
  const detail = event.detail ? compactDetail(event.detail) : "";
  return detail ? `${prefix} ${event.label}\n${detail}` : `${prefix} ${event.label}`;
}

// ─── Ordered, off-critical-path delivery ──────────────────────────────────────
// `publishNarration` awaits the delivery adapter, so sending inline would put a
// round-trip to the channel's servers inside the agent loop for every event.
// Each conversation gets its own promise chain: the agent loop is never blocked,
// and messages still arrive in the order they were produced.

const sendQueues = new Map<string, Promise<void>>();

export function enqueueChannelNarration(
  key: string,
  send: () => Promise<void>,
): void {
  const previous = sendQueues.get(key) ?? Promise.resolve();
  const next = previous
    .then(send)
    .catch((error: Error) => {
      log.warn(`Narration delivery failed for ${key}: ${error.message}`);
    })
    .finally(() => {
      // Drop the entry once this send is the last one queued, so the map does
      // not grow with one retained promise per conversation seen.
      if (sendQueues.get(key) === next) sendQueues.delete(key);
    });
  sendQueues.set(key, next);
}

/**
 * Resolves once the narration queued for one conversation has been sent. Call
 * before sending a turn's final answer so it cannot overtake pending progress
 * messages, which would show the user the outcome before the steps.
 */
export async function awaitChannelNarration(key: string): Promise<void> {
  await (sendQueues.get(key) ?? Promise.resolve());
}

/** Test/shutdown helper: resolves once every queued narration has been sent. */
export async function flushChannelNarration(): Promise<void> {
  await Promise.allSettled([...sendQueues.values()]);
}
