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
  cancelJob,
  reclaimOrInterrupt,
  findPendingJobsByLane,
  findExpiredLeases,
  getJob,
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
}

export type JobExecutor = (
  job: JobDoc,
  signal: AbortSignal,
  callbacks?: { onToken?: (token: string) => void; onStep?: (step: unknown) => Promise<void> }
) => Promise<JobExecutorResult>;

const executors = new Map<JobType, JobExecutor>();

export function registerExecutor(type: JobType, executor: JobExecutor): void {
  executors.set(type, executor);
  log.info(`[registerExecutor] Registered executor for type=${type}`);
}

export class DurableLaneQueue {
  private maxGlobalConcurrency: number;
  private taskTimeoutMs: number;
  private runningCount = 0;
  private dispatchTimers = new Map<string, ReturnType<typeof setInterval>>();
  private leaseCheckTimer: ReturnType<typeof setInterval> | null = null;
  private bootId: string;

  constructor(options: {
    maxGlobalConcurrency?: number;
    taskTimeoutMs?: number;
  } = {}) {
    this.maxGlobalConcurrency = options.maxGlobalConcurrency ?? DEFAULT_MAX_GLOBAL_CONCURRENCY;
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
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
    callbacks?: { onToken?: (token: string) => void; onStep?: (step: unknown) => Promise<void> };
  }): Promise<JobDoc> {
    const job = await createJob({
      lane: input.lane,
      type: input.type,
      payload: { ...input.payload, _callbacks: !!input.callbacks },
      run_id: input.run_id,
      priority: input.priority,
      max_attempts: input.max_attempts,
      not_before: input.not_before,
    });

    // Stash live callbacks in memory (not serializable)
    if (input.callbacks) {
      liveCallbacks.set(job.id, input.callbacks);
    }

    this.scheduleDispatch(input.lane);
    return job;
  }

  /**
   * Cancel a job by id (pending or running).
   */
  async cancel(jobId: string): Promise<boolean> {
    return cancelJob(jobId);
  }

  /**
   * Cancel all pending/running jobs in a lane.
   */
  async cancelLane(lane: string): Promise<number> {
    const pending = await findPendingJobsByLane(lane, 100);
    let count = 0;
    for (const job of pending) {
      if (await cancelJob(job.id)) count++;
    }
    return count;
  }

  /**
   * Start the lease expiry checker. Called once during boot.
   */
  start(): void {
    if (this.leaseCheckTimer) return;
    this.leaseCheckTimer = setInterval(() => this.checkExpiredLeases(), LEASE_CHECK_INTERVAL_MS);
    log.info(`[start] Lease checker running every ${LEASE_CHECK_INTERVAL_MS}ms`);
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
    while (this.runningCount < this.maxGlobalConcurrency) {
      const pending = await findPendingJobsByLane(lane, 1);
      if (pending.length === 0) break;

      const job = pending[0];
      const claimed = await claimJob(job.id, this.bootId);
      if (!claimed) continue; // someone else won or not_before

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
      } else {
        await failJob(job.id, result.error ?? "Unknown error", this.bootId);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        await cancelJob(job.id);
      } else {
        await failJob(job.id, (err as Error).message, this.bootId);
      }
    } finally {
      clearTimeout(timeoutId);
      clearInterval(leaseRenewer);
      leasedHere = false;
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
}

// Live callback stash — not serializable, kept in memory only
const liveCallbacks = new Map<string, { onToken?: (token: string) => void; onStep?: (step: unknown) => Promise<void> }>();

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
}): DurableLaneQueue {
  _durableQueue = new DurableLaneQueue(options);
  _durableQueue.start();
  return _durableQueue;
}