/**
 * DurableLaneQueue — persistent work queue backed by the `jobQueue` HiveDB
 * collection.
 *
 * Guarantees:
 * - FIFO + priority per lane (same semantics as LaneQueue)
 * - 1 concurrent running job per lane
 * - maxGlobalConcurrency across all lanes (default 4)
 * - JobDoc persists every status transition → survives crashes
 * - Expired leases (crashed worker) are reclaimed or interrupted on next dispatch
 *
 * The live LaneQueue instance is used as the in-memory dispatch layer:
 * DurableLaneQueue wraps it so that the existing per-session serial behavior
 * is preserved, while all queue state is mirrored to the DB.
 */

import { logger } from "../utils/logger";
import {
  createJob,
  claimJob,
  completeJob,
  failJob,
  failJobOrRetry,
  cancelJob,
  reclaimOrInterrupt,
  findPendingJobsByLane,
  findAllPendingJobs,
  findExpiredLeases,
  getJob,
  loadJobRetryPolicy,
  DEFAULT_JOB_RETRY_POLICY,
  type JobRetryPolicy,
} from "./job-store";
import type { JobDoc } from "../storage/collections";
import { getBootId } from "../storage/boot-id";

const log = logger.child("durable-queue");

const LEASE_CHECK_INTERVAL_MS = 10_000;
const DEFAULT_MAX_GLOBAL_CONCURRENCY = 4;
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000;

export type JobType = JobDoc["type"];

export interface JobPayload {
  [key: string]: unknown;
}

export interface JobExecutorResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Logical failures default to retryable; set false for terminal errors (validation, not-found) that a retry can't fix. Ignored when ok=true. */
  retryable?: boolean;
  /** Stable failure code for observability/tooling, e.g. {code:"PROVIDER_TIMEOUT"}. */
  failureSignature?: string;
}

export interface JobLiveCallbacks {
  onToken?: (token: string) => void;
  onStep?: (step: unknown) => Promise<void>;
  /** Sends an already-serialized frame to the live socket (webchat turns). */
  sendRaw?: (payload: string) => void;
}

export type JobExecutor = (
  job: JobDoc,
  signal: AbortSignal,
  callbacks?: JobLiveCallbacks
) => Promise<JobExecutorResult>;

const executors = new Map<JobType, JobExecutor>();

export function registerExecutor(type: JobType, executor: JobExecutor): void {
  executors.set(type, executor);
  log.info(`[registerExecutor] Registered executor for type=${type}`);
}

export interface JobTerminalOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Fires exactly once when a job of `type` reaches a terminal state (completed, or failed with no retries left) — never on a retryable failure that gets requeued. */
export type JobTerminalHook = (job: JobDoc, outcome: JobTerminalOutcome) => void | Promise<void>;

const terminalHooks = new Map<JobType, JobTerminalHook>();

/** Register a side-effect to run once a job type finishes for good. Kept decoupled from executors so this module doesn't need to import webchat-turn.ts (circular: webchat-turn.ts already imports durable-queue.ts for enqueueChatTurn). */
export function registerTerminalHook(type: JobType, hook: JobTerminalHook): void {
  terminalHooks.set(type, hook);
}

async function runTerminalHook(job: JobDoc, outcome: JobTerminalOutcome): Promise<void> {
  const hook = terminalHooks.get(job.type);
  if (!hook) return;
  try {
    await hook(job, outcome);
  } catch (err) {
    log.warn(`[runTerminalHook] Hook for type=${job.type} failed: ${(err as Error).message}`);
  }
}

export class DurableLaneQueue {
  private maxGlobalConcurrency: number;
  private taskTimeoutMs: number;
  private jobRetryPolicy: JobRetryPolicy;
  private runningCount = 0;
  private runningAborts = new Map<string, { lane: string; controller: AbortController }>();
  private dispatchTimers = new Map<string, ReturnType<typeof setInterval>>();
  private leaseCheckTimer: ReturnType<typeof setInterval> | null = null;
  private bootId: string;

  constructor(options: {
    maxGlobalConcurrency?: number;
    taskTimeoutMs?: number;
    jobRetryPolicy?: JobRetryPolicy;
  } = {}) {
    this.maxGlobalConcurrency = options.maxGlobalConcurrency ?? DEFAULT_MAX_GLOBAL_CONCURRENCY;
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.jobRetryPolicy = options.jobRetryPolicy ?? DEFAULT_JOB_RETRY_POLICY;
    this.bootId = getBootId();
  }

  /**
   * Enqueue a durable job. Returns the JobDoc.
   * Callers should use `enqueue` instead of the in-memory `laneQueue.enqueue`
   * for any work that must survive crashes.
   */
  async enqueue(input: {
    lane: string;
    type: JobType;
    payload: JobPayload;
    run_id: string;
    priority?: number;
    max_attempts?: number;
    not_before?: number;
    /** Client-supplied dedup key: a repeated key returns the existing job instead of creating a new one. */
    idempotency_key?: string | null;
    callbacks?: JobLiveCallbacks;
  }): Promise<JobDoc> {
    const job = await createJob({
      lane: input.lane,
      type: input.type,
      payload: { ...input.payload, _callbacks: !!input.callbacks },
      run_id: input.run_id,
      priority: input.priority,
      max_attempts: input.max_attempts,
      not_before: input.not_before,
      idempotency_key: input.idempotency_key,
    });

    // Stash live callbacks in memory (not serializable)
    if (input.callbacks) {
      liveCallbacks.set(job.id, input.callbacks);
    }

    this.scheduleDispatch(input.lane);
    return job;
  }

  /**
   * Cancel a job by id (pending or running). A running job also gets its
   * AbortSignal fired so the executor stops streaming/working.
   */
  async cancel(jobId: string): Promise<boolean> {
    const running = this.runningAborts.get(jobId);
    if (running) running.controller.abort();
    return cancelJob(jobId);
  }

  /**
   * Cancel all pending and running jobs in a lane.
   */
  async cancelLane(lane: string): Promise<number> {
    let count = 0;
    for (const [jobId, entry] of this.runningAborts) {
      if (entry.lane === lane) {
        entry.controller.abort();
        if (await cancelJob(jobId)) count++;
      }
    }
    const pending = await findPendingJobsByLane(lane, 100);
    for (const job of pending) {
      if (await cancelJob(job.id)) count++;
    }
    return count;
  }

  /**
   * Start the lease expiry checker and dispatch any jobs left pending by a
   * previous boot. Called once during boot.
   */
  start(): void {
    if (this.leaseCheckTimer) return;
    this.leaseCheckTimer = setInterval(() => this.runMaintenanceTick(), LEASE_CHECK_INTERVAL_MS);
    log.info(`[start] Maintenance tick running every ${LEASE_CHECK_INTERVAL_MS}ms`);
    // Without this, jobs reclaimed to "pending" by reconcileOnBoot (or enqueued
    // right before a crash) would sit until a new enqueue touched their lane.
    this.dispatchPendingLanes().catch((err) => {
      log.error(`[start] Failed to dispatch pending lanes: ${(err as Error).message}`);
    });
  }

  /**
   * Periodic tick: reclaim crashed jobs (expired leases) AND re-dispatch
   * lanes with jobs whose `not_before` (e.g. a backoff delay from
   * `failJobOrRetry`) has now elapsed. `dispatchPendingLanes` is safe to call
   * repeatedly — `scheduleDispatch` debounces per lane and a lane with
   * nothing due is a cheap no-op.
   */
  private async runMaintenanceTick(): Promise<void> {
    await this.checkExpiredLeases();
    await this.dispatchPendingLanes().catch((err) => {
      log.error(`[runMaintenanceTick] Failed to dispatch pending lanes: ${(err as Error).message}`);
    });
  }

  private async dispatchPendingLanes(): Promise<void> {
    const pending = await findAllPendingJobs();
    const lanes = new Set(pending.map((j) => j.lane));
    for (const lane of lanes) this.scheduleDispatch(lane);
    if (lanes.size > 0) {
      log.info(`[dispatchPendingLanes] Re-dispatching ${pending.length} pending job(s) across ${lanes.size} lane(s)`);
    }
  }

  stop(): void {
    if (this.leaseCheckTimer) {
      clearInterval(this.leaseCheckTimer);
      this.leaseCheckTimer = null;
    }
    for (const [, timer] of this.dispatchTimers) clearInterval(timer);
    this.dispatchTimers.clear();
  }

  /**
   * Schedule dispatch for a lane (debounced — coalesce rapid enqueues).
   */
  private scheduleDispatch(lane: string): void {
    if (this.dispatchTimers.has(lane)) return;
    const timer = setTimeout(() => {
      this.dispatchTimers.delete(lane);
      this.dispatchLane(lane).catch((err) => {
        log.error(`[scheduleDispatch] Error dispatching lane ${lane}: ${(err as Error).message}`);
      });
    }, 0);
    this.dispatchTimers.set(lane, timer);
  }

  /**
   * Dispatch pending jobs for a single lane, respecting global concurrency.
   */
  private async dispatchLane(lane: string): Promise<void> {
    for (;;) {
      const pending = await findPendingJobsByLane(lane, 1);
      if (pending.length === 0) break;

      const job = pending[0];
      // Interactive chat turns bypass the global cap: a busy batch of
      // workers/goals must not make the webchat stop responding.
      if (job.type !== "chat_turn" && this.runningCount >= this.maxGlobalConcurrency) break;

      const claimed = await claimJob(job.id, this.bootId);
      if (!claimed) continue; // someone else won the claim — re-read the lane

      this.runningCount++;
      this.executeJob(claimed, lane).catch((err) => {
        log.error(`[dispatchLane] Unhandled error in job ${claimed.id}: ${(err as Error).message}`);
      });

      // Only 1 running per lane — break after dispatching
      break;
    }
  }

  /**
   * Execute a claimed job: look up executor, run with timeout + abort,
   * persist result.
   */
  private async executeJob(job: JobDoc, lane: string): Promise<void> {
    const abortController = new AbortController();
    this.runningAborts.set(job.id, { lane, controller: abortController });
    const timeoutId = setTimeout(() => abortController.abort(), this.taskTimeoutMs);

    let leasedHere = true;
    const leaseRenewer = setInterval(async () => {
      if (leasedHere) {
        const { renewLease } = await import("./job-store");
        await renewLease(job.id, this.bootId).catch(() => {});
      }
    }, 30_000);

    try {
      const executor = executors.get(job.type);
      if (!executor) {
        await failJob(job.id, `No executor registered for type=${job.type}`, this.bootId);
        log.error(`[executeJob] No executor for type=${job.type} (job ${job.id})`);
        return;
      }

      const callbacks = liveCallbacks.get(job.id);
      const result = await executor(job, abortController.signal, callbacks);
      liveCallbacks.delete(job.id);

      if (result.ok) {
        await completeJob(job.id, result.result ?? null, this.bootId);
        await runTerminalHook(job, { ok: true, result: result.result });
      } else {
        const error = result.error ?? "Unknown error";
        // chat_turn is user-facing — never auto-retry a logical failure, the
        // user just sees the error and can re-ask.
        if (job.type !== "chat_turn" && result.retryable !== false) {
          const updated = await failJobOrRetry(job.id, error, this.bootId, this.jobRetryPolicy);
          if (updated?.status === "failed") await runTerminalHook(job, { ok: false, error });
        } else {
          await failJob(job.id, error, this.bootId);
          await runTerminalHook(job, { ok: false, error });
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        await cancelJob(job.id);
      } else {
        const error = (err as Error).message;
        if (job.type !== "chat_turn") {
          const updated = await failJobOrRetry(job.id, error, this.bootId, this.jobRetryPolicy);
          if (updated?.status === "failed") await runTerminalHook(job, { ok: false, error });
        } else {
          await failJob(job.id, error, this.bootId);
          await runTerminalHook(job, { ok: false, error });
        }
      }
    } finally {
      clearTimeout(timeoutId);
      clearInterval(leaseRenewer);
      leasedHere = false;
      this.runningAborts.delete(job.id);
      this.runningCount--;
      // Try to dispatch next job in this lane
      this.scheduleDispatch(lane);
    }
  }

  /**
   * Periodically check for jobs with expired leases (crashed workers).
   */
  private async checkExpiredLeases(): Promise<void> {
    try {
      const expired = await findExpiredLeases();
      for (const job of expired) {
        const result = await reclaimOrInterrupt(job.id);
        if (result?.status === "pending") {
          this.scheduleDispatch(job.lane);
        }
      }
    } catch (err) {
      log.warn(`[checkExpiredLeases] Error: ${(err as Error).message}`);
    }
  }

  getRunningCount(): number {
    return this.runningCount;
  }

  getMaxGlobalConcurrency(): number {
    return this.maxGlobalConcurrency;
  }

  getJobRetryPolicy(): JobRetryPolicy {
    return this.jobRetryPolicy;
  }
}

// Live callback stash — not serializable, kept in memory only
const liveCallbacks = new Map<string, JobLiveCallbacks>();

// Singleton
let _durableQueue: DurableLaneQueue | null = null;

export function getDurableQueue(): DurableLaneQueue {
  if (!_durableQueue) {
    _durableQueue = new DurableLaneQueue();
  }
  return _durableQueue;
}

export function initDurableQueue(options?: {
  maxGlobalConcurrency?: number;
  taskTimeoutMs?: number;
  jobRetryPolicy?: JobRetryPolicy;
}): DurableLaneQueue {
  _durableQueue = new DurableLaneQueue(options);
  _durableQueue.start();
  return _durableQueue;
}