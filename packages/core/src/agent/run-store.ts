/**
 * run-store — persistent checkpoint + lease for agentRuns.
 *
 * An AgentRun tracks the lifecycle of a single agent-loop invocation
 * (chat turn, worker task, goal run). Its checkpoint (state_json) allows
 * resuming after a crash: messages, iteration count, token totals and
 * pending tool calls are persisted after every round-trip.
 *
 * All write operations use OCC (expectedVersion). Only the owning loop
 * should write to a run; single-writer pattern keeps contention minimal.
 */

import { col, updateDoc, nextId } from "../storage/hive";
import type { AgentRunDoc } from "../storage/collections";
import { getBootId } from "../storage/boot-id";
import { logger } from "../utils/logger";
import type { LLMMessage } from "./llm-client";

const log = logger.child("run-store");

const LEASE_RENEW_INTERVAL_MS = 30_000;
const LEASE_DURATION_MS = 2 * 60 * 1000;
const MAX_STATE_BYTES = 1_500_000;
const MAX_RETRIES = 5;

export interface RunCheckpointState {
  version: 1
  messages: LLMMessage[]
  iterations: number
  totalInputTokens: number
  totalOutputTokens: number
  lastToolSignature: string
  consecutiveRepeat: number
  idleIterations: number
  injectedToolNames: string[]
  systemPromptSkillSections: string[]
}

export interface CreateRunInput {
  thread_id: string
  agent_id: string
  user_id: string
  channel: string | null
  kind: AgentRunDoc["kind"]
  max_iterations: number
  max_turns?: number | null
  max_tokens?: number | null
  goal?: string | null
  goal_check_tool?: string | null
  resume_policy?: AgentRunDoc["resume_policy"]
}

export async function createRun(input: CreateRunInput): Promise<AgentRunDoc> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = Date.now();
  const bootId = getBootId();
  const doc: AgentRunDoc = {
    id,
    thread_id: input.thread_id,
    agent_id: input.agent_id,
    user_id: input.user_id,
    channel: input.channel,
    kind: input.kind,
    status: "running",
    iterations_used: 0,
    max_iterations: input.max_iterations,
    turns_used: 0,
    max_turns: input.max_turns ?? null,
    tokens_used: 0,
    max_tokens: input.max_tokens ?? null,
    goal: input.goal ?? null,
    goal_check_tool: input.goal_check_tool ?? null,
    goal_attempts: 0,
    state_json: "",
    state_bytes: 0,
    pending_tool_calls_json: null,
    checkpointed_at: now,
    boot_id: bootId,
    lease_expires_at: now + LEASE_DURATION_MS,
    resume_policy: input.resume_policy ?? "resume",
    error: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };
  const c = await col<AgentRunDoc>("agentRuns");
  await c.put(id, doc, { expectedVersion: 0 });
  log.info(`[createRun] Run ${id} created (agent=${input.agent_id} kind=${input.kind})`);
  return doc;
}

/**
 * Save a checkpoint to the run: serialize messages, trim state if too big.
 * Uses updateDoc (OCC retry x5).
 */
export async function checkpoint(
  runId: string,
  state: RunCheckpointState,
  pendingToolCalls?: unknown[] | null
): Promise<AgentRunDoc> {
  const serialized = serializeCheckpoint(state);
  let stateJson = serialized.json;
  let stateBytes = serialized.bytes;

  if (stateBytes > MAX_STATE_BYTES) {
    stateJson = truncateState(state);
    stateBytes = new TextEncoder().encode(stateJson).length;
  }

  const patch: Partial<AgentRunDoc> = {
    state_json: stateJson,
    state_bytes: stateBytes,
    pending_tool_calls_json: pendingToolCalls ? JSON.stringify(pendingToolCalls) : null,
    checkpointed_at: Date.now(),
    iterations_used: state.iterations,
    tokens_used: state.totalInputTokens + state.totalOutputTokens,
    lease_expires_at: Date.now() + LEASE_DURATION_MS,
    boot_id: getBootId(),
    updated_at: Date.now(),
  };

  return updateDoc<AgentRunDoc>("agentRuns", runId, patch);
}

/**
 * Bump turns_used and update lease.
 */
export async function bumpTurn(runId: string, tokensDelta: number): Promise<AgentRunDoc> {
  const existing = await getRun(runId);
  if (!existing) throw new Error(`Run ${runId} not found`);
  return updateDoc<AgentRunDoc>("agentRuns", runId, {
    turns_used: existing.turns_used + 1,
    tokens_used: existing.tokens_used + tokensDelta,
    lease_expires_at: Date.now() + LEASE_DURATION_MS,
    updated_at: Date.now(),
  });
}

export async function completeRun(runId: string, finalContent?: string): Promise<void> {
  const now = Date.now();
  await updateDoc<AgentRunDoc>("agentRuns", runId, {
    status: "completed",
    state_json: "",
    state_bytes: 0,
    pending_tool_calls_json: null,
    lease_expires_at: now,
    finished_at: now,
    updated_at: now,
  } as Partial<AgentRunDoc>);
  log.info(`[completeRun] Run ${runId} completed`);
}

export async function failRun(runId: string, error: string): Promise<void> {
  const now = Date.now();
  await updateDoc<AgentRunDoc>("agentRuns", runId, {
    status: "failed",
    error,
    lease_expires_at: now,
    finished_at: now,
    updated_at: now,
    state_json: "",
    state_bytes: 0,
    pending_tool_calls_json: null,
  });
  log.warn(`[failRun] Run ${runId} failed: ${error}`);
}

export async function interruptRun(runId: string, reason: string): Promise<void> {
  const now = Date.now();
  await updateDoc<AgentRunDoc>("agentRuns", runId, {
    status: "interrupted",
    error: reason,
    lease_expires_at: now,
    finished_at: now,
    updated_at: now,
  });
  log.warn(`[interruptRun] Run ${runId} interrupted: ${reason}`);
}

export async function getRun(runId: string): Promise<AgentRunDoc | null> {
  const c = await col<AgentRunDoc>("agentRuns");
  const entry = await c.get(runId);
  return entry ? entry.doc : null;
}

export async function findRunsByStatus(status: AgentRunDoc["status"]): Promise<AgentRunDoc[]> {
  const c = await col<AgentRunDoc>("agentRuns");
  const entries = await c.findBy("status", status);
  return entries.map((e) => e.doc);
}

export async function findRunsByThread(threadId: string): Promise<AgentRunDoc[]> {
  const c = await col<AgentRunDoc>("agentRuns");
  const entries = await c.findBy("thread_id", threadId);
  return entries.map((e) => e.doc);
}

/**
 * Find runs whose lease has expired (status=running + lease_expires_at < now).
 */
export async function findExpiredRuns(): Promise<AgentRunDoc[]> {
  const running = await findRunsByStatus("running");
  const now = Date.now();
  return running.filter((r) => r.lease_expires_at < now);
}

/**
 * Deserialize a checkpoint back into RunCheckpointState, or null if the
 * run has no checkpoint (empty state_json — chat runs that never promoted
 * to durable).
 */
export function deserializeCheckpoint(run: AgentRunDoc): RunCheckpointState | null {
  if (!run.state_json) return null;
  try {
    const raw = JSON.parse(run.state_json);
    if (raw.version !== 1) return null;
    return raw as RunCheckpointState;
  } catch {
    log.warn(`[deserializeCheckpoint] Failed to parse state_json for run ${run.id}`);
    return null;
  }
}

// ─── internals ─────────────────────────────────────────────────────────────

function serializeCheckpoint(state: RunCheckpointState): { json: string; bytes: number } {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json).length;
  return { json, bytes };
}

/**
 * Truncate state to fit under MAX_STATE_BYTES by replacing old tool
 * messages with a placeholder, keeping the system prompt and the last
 * N messages intact.
 */
function truncateState(state: RunCheckpointState): string {
  const messages = [...state.messages];
  const keepLastN = 8;
  const cutoff = messages.length - keepLastN;

  for (let i = 0; i < cutoff; i++) {
    const msg = messages[i];
    if (msg.role === "tool" && typeof msg.content === "string") {
      messages[i] = {
        ...msg,
        content: msg.content.length > 200
          ? `[Truncated: ${msg.content.substring(0, 200)}...]`
          : msg.content,
      };
    }
    if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.length > 500) {
      messages[i] = {
        ...msg,
        content: msg.content.substring(0, 500) + "[...]",
      };
    }
  }

  // Replace base64 images with placeholder
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (Array.isArray(msg.content)) {
      messages[i] = {
        ...msg,
        content: (msg.content as any[]).map((part) =>
          part.type === "image_url" || part.type === "image" ? "[imagen omitida]" : part
        ),
      };
    }
  }

  const truncated: RunCheckpointState = {
    ...state,
    messages,
  };
  return JSON.stringify(truncated);
}

// ─── Lease renewal timer ────────────────────────────────────────────────────

const leaseTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

export function startLeaseRenewal(runId: string): void {
  if (leaseTimers.has(runId)) return;
  const timer = setInterval(async () => {
    try {
      const run = await getRun(runId);
      if (!run || run.status !== "running") {
        stopLeaseRenewal(runId);
        return;
      }
      await updateDoc<AgentRunDoc>("agentRuns", runId, {
        lease_expires_at: Date.now() + LEASE_DURATION_MS,
        updated_at: Date.now(),
      } as Partial<AgentRunDoc>);
    } catch (err) {
      log.warn(`[startLeaseRenewal] Failed to renew lease for ${runId}: ${(err as Error).message}`);
    }
  }, LEASE_RENEW_INTERVAL_MS);
  leaseTimers.set(runId, timer);
}

export function stopLeaseRenewal(runId: string): void {
  const timer = leaseTimers.get(runId);
  if (timer) {
    clearInterval(timer);
    leaseTimers.delete(runId);
  }
}

export function stopAllLeaseRenewals(): void {
  for (const [, timer] of leaseTimers) clearInterval(timer);
  leaseTimers.clear();
}