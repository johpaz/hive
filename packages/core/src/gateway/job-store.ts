/**
 * job-store — durable persistence + lease/claim for the jobQueue collection.
 *
 * All claim transitions use OCC (expectedVersion). The "claim pending→running"
 * path guarantees only one process wins the race for the same job.
 */

import { col, nextId, updateDoc, toIndexable } from "../storage/hive";
import type { JobDoc } from "../storage/collections";
import { getBootId } from "../storage/boot-id";
import { logger } from "../utils/logger";
import { loadConfig } from "../config/loader";

const log = logger.child("job-store");

const MAX_RETRIES = 5;

function jobLeaseDurationMs(): number {
  return loadConfig().harness?.jobLeaseMs ?? 30 * 60 * 1000;
}

export interface JobRetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
  jitter: number;
}

export const DEFAULT_JOB_RETRY_POLICY: JobRetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 5 * 60 * 1000,
  jitter: 0.2,
};

export function loadJobRetryPolicy(): JobRetryPolicy {
  const cfg = loadConfig().harness?.jobRetry;
  return {
    maxRetries: cfg?.maxRetries ?? DEFAULT_JOB_RETRY_POLICY.maxRetries,
    initialDelayMs: cfg?.initialDelayMs ?? DEFAULT_JOB_RETRY_POLICY.initialDelayMs,
    backoffMultiplier: cfg?.backoffMultiplier ?? DEFAULT_JOB_RETRY_POLICY.backoffMultiplier,
    maxDelayMs: cfg?.maxDelayMs ?? DEFAULT_JOB_RETRY_POLICY.maxDelayMs,
    jitter: cfg?.jitter ?? DEFAULT_JOB_RETRY_POLICY.jitter,
  };
}

/** Exponential backoff with full jitter, capped at policy.maxDelayMs. */
export function computeBackoffDelay(retryCount: number, policy: JobRetryPolicy): number {
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * Math.pow(policy.backoffMultiplier, retryCount));
  const jitterAmount = base * policy.jitter * Math.random();
  return Math.round(base + jitterAmount);
}

/** Small randomized delay between OCC-conflict retries to reduce thundering-herd contention. */
function occRetryDelay(attempt: number): Promise<void> {
  const ms = 5 * (attempt + 1) + Math.random() * 10;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findByIdempotencyKey(key: string): Promise<JobDoc | null> {
  const c = await col<JobDoc>("jobQueue");
  const entries = await c.findBy("idempotency_key", key);
  return entries.length > 0 ? entries[0].doc : null;
}

export async function createJob(input: {
  lane: string;
  type: JobDoc["type"];
  payload: unknown;
  run_id: string;
  priority?: number;
  max_attempts?: number;
  not_before?: number;
  /** Client-supplied dedup key: a repeated key returns the existing job instead of creating a new one. */
  idempotency_key?: string | null;
}): Promise<JobDoc> {
  if (input.idempotency_key) {
    const existing = await findByIdempotencyKey(input.idempotency_key);
    if (existing) {
      log.info(`[createJob] Idempotent hit for key=${input.idempotency_key} → job ${existing.id}`);
      return existing;
    }
  }

  const id = await nextId("jobQueue");
  const now = Date.now();
  const doc: JobDoc = {
    id,
    lane: input.lane,
    type: input.type,
    status: "pending",
    priority: input.priority ?? 0,
    payload_json: JSON.stringify(input.payload),
    run_id: input.run_id,
    attempts: 0,
    max_attempts: input.max_attempts ?? 2,
    not_before: input.not_before ?? now,
    boot_id: null,
    lease_expires_at: null,
    result_json: null,
    error: null,
    created_at: now,
    started_at: null,
    finished_at: null,
    retry_count: 0,
    last_error: null,
    idempotency_key: toIndexable(input.idempotency_key ?? null),
  };
  const c = await col<JobDoc>("jobQueue");
  await c.put(id, doc, { expectedVersion: 0 });
  log.info(`[createJob] Job ${id} created (lane=${input.lane} type=${input.type})`);
  return doc;
}

/**
 * Atomically claim a pending job: transitions status pending→running only if
 * the version hasn't changed since the read. Returns the claimed doc or null
 * if another writer won the race.
 */
export async function claimJob(jobId: string, bootId: string = getBootId()): Promise<JobDoc | null> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return null;
    const doc = entry.doc;
    if (doc.status !== "pending") return null;
    if (doc.not_before > Date.now()) return null;

    const now = Date.now();
    const updated: JobDoc = {
      ...doc,
      status: "running",
      attempts: doc.attempts + 1,
      boot_id: bootId,
      lease_expires_at: now + jobLeaseDurationMs(),
      started_at: doc.started_at ?? now,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      log.info(`[claimJob] Job ${jobId} claimed by boot ${bootId}`);
      return updated;
    } catch {
      // OCC conflict — retry
      await occRetryDelay(attempt);
    }
  }
  log.warn(`[claimJob] Too much contention on job ${jobId}`);
  return null;
}

/**
 * Renew the lease on a running job to prevent it from being reclaimed by
 * another process. Uses OCC.
 */
export async function renewLease(jobId: string, bootId: string = getBootId()): Promise<boolean> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return false;
    const doc = entry.doc;
    if (doc.status !== "running") return false;
    if (doc.boot_id !== bootId) return false;

    const updated: JobDoc = {
      ...doc,
      lease_expires_at: Date.now() + jobLeaseDurationMs(),
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      return true;
    } catch {
      // OCC conflict — retry
      await occRetryDelay(attempt);
    }
  }
  log.warn(`[renewLease] Too much contention on job ${jobId}`);
  return false;
}

export async function completeJob(jobId: string, result: unknown, bootId: string = getBootId()): Promise<void> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return;
    const doc = entry.doc;
    if (doc.status !== "running") return;
    if (doc.boot_id !== bootId) return;

    const updated: JobDoc = {
      ...doc,
      status: "completed",
      result_json: JSON.stringify(result),
      error: null,
      finished_at: Date.now(),
      boot_id: null,
      lease_expires_at: null,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      log.info(`[completeJob] Job ${jobId} completed`);
      return;
    } catch {
      // OCC conflict — retry
      await occRetryDelay(attempt);
    }
  }
  log.warn(`[completeJob] Too much contention on job ${jobId}`);
}

export async function failJob(jobId: string, error: string, bootId: string = getBootId()): Promise<void> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return;
    const doc = entry.doc;
    if (doc.status !== "running") return;
    if (doc.boot_id !== bootId) return;

    const updated: JobDoc = {
      ...doc,
      status: "failed",
      error,
      last_error: error,
      finished_at: Date.now(),
      boot_id: null,
      lease_expires_at: null,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      log.info(`[failJob] Job ${jobId} failed: ${error}`);
      return;
    } catch {
      // OCC conflict — retry
      await occRetryDelay(attempt);
    }
  }
  log.warn(`[failJob] Too much contention on job ${jobId}`);
}

/**
 * Fail a job that returned a LOGICAL failure ({ok:false}), retrying with
 * exponential backoff + jitter up to `policy.maxRetries` before giving up.
 * Distinct from `attempts`/`reclaimOrInterrupt`, which only handle crash /
 * lease-expiry recovery. `chat_turn` jobs must never be routed here (caller's
 * responsibility) — a user-facing turn should not silently retry later.
 */
export async function failJobOrRetry(
  jobId: string,
  error: string,
  bootId: string = getBootId(),
  policy: JobRetryPolicy = DEFAULT_JOB_RETRY_POLICY
): Promise<JobDoc | null> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return null;
    const doc = entry.doc;
    if (doc.status !== "running") return null;
    if (doc.boot_id !== bootId) return null;

    const now = Date.now();
    const retryCount = doc.retry_count ?? 0;

    if (retryCount >= policy.maxRetries) {
      const updated: JobDoc = {
        ...doc,
        status: "failed",
        error,
        last_error: error,
        finished_at: now,
        boot_id: null,
        lease_expires_at: null,
      };
      try {
        await c.put(jobId, updated, { expectedVersion: entry.version });
        log.info(`[failJobOrRetry] Job ${jobId} failed terminally after ${retryCount} retr${retryCount === 1 ? "y" : "ies"}: ${error}`);
        return updated;
      } catch {
        await occRetryDelay(attempt);
        continue;
      }
    }

    const delay = computeBackoffDelay(retryCount, policy);
    const updated: JobDoc = {
      ...doc,
      status: "pending",
      retry_count: retryCount + 1,
      last_error: error,
      not_before: now + delay,
      boot_id: null,
      lease_expires_at: null,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      log.info(`[failJobOrRetry] Job ${jobId} scheduled for retry ${retryCount + 1}/${policy.maxRetries} in ${delay}ms: ${error}`);
      return updated;
    } catch {
      // OCC conflict — retry
      await occRetryDelay(attempt);
    }
  }
  log.warn(`[failJobOrRetry] Too much contention on job ${jobId}`);
  return null;
}

/**
 * Re-enqueue a job whose lease has expired back to pending, bumping its
 * attempt count (already bumped at claim time). If attempts >= max_attempts,
 * marks it as interrupted instead.
 *
 * `force` skips the lease-expiry check: at boot every "running" row belongs to
 * a dead process (HiveDB is single-process), so waiting out a 30-min lease
 * would only delay recovery.
 */
export async function reclaimOrInterrupt(jobId: string, opts?: { force?: boolean }): Promise<JobDoc | null> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return null;
    const doc = entry.doc;
    if (doc.status !== "running") return null;
    if (!opts?.force && (doc.lease_expires_at === null || doc.lease_expires_at > Date.now())) return null;

    const now = Date.now();
    if (doc.attempts >= doc.max_attempts) {
      const updated: JobDoc = {
        ...doc,
        status: "interrupted",
        error: `Max attempts (${doc.max_attempts}) reached after lease expiry`,
        finished_at: now,
        boot_id: null,
        lease_expires_at: null,
      };
      try {
        await c.put(jobId, updated, { expectedVersion: entry.version });
        log.warn(`[reclaimOrInterrupt] Job ${jobId} interrupted (attempts exhausted)`);
        return updated;
      } catch {
        await occRetryDelay(attempt);
        continue;
      }
    }

    const updated: JobDoc = {
      ...doc,
      status: "pending",
      boot_id: null,
      lease_expires_at: null,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      log.info(`[reclaimOrInterrupt] Job ${jobId} back to pending (attempt ${doc.attempts}/${doc.max_attempts})`);
      return updated;
    } catch {
      // OCC conflict — retry
      await occRetryDelay(attempt);
    }
  }
  log.warn(`[reclaimOrInterrupt] Too much contention on job ${jobId}`);
  return null;
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return false;
    const doc = entry.doc;
    if (doc.status === "completed" || doc.status === "failed" || doc.status === "cancelled") return false;

    const updated: JobDoc = {
      ...doc,
      status: "cancelled",
      finished_at: Date.now(),
      boot_id: null,
      lease_expires_at: null,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      log.info(`[cancelJob] Job ${jobId} cancelled`);
      return true;
    } catch {
      // OCC conflict — retry
      await occRetryDelay(attempt);
    }
  }
  return false;
}

/**
 * Find the next pending job for a given lane, ordered by priority then
 * creation order (id is a zero-padded autoincrement → lexical = FIFO).
 */
export async function findPendingJobsByLane(lane: string, limit = 10): Promise<JobDoc[]> {
  const c = await col<JobDoc>("jobQueue");
  const entries = await c.findBy("lane", lane);
  return entries
    .filter((e) => e.doc.status === "pending" && e.doc.not_before <= Date.now())
    .sort((a, b) => {
      if (b.doc.priority !== a.doc.priority) return b.doc.priority - a.doc.priority;
      return a.doc.id.localeCompare(b.doc.id);
    })
    .slice(0, limit)
    .map((e) => e.doc);
}

/**
 * Scan for jobs whose lease has expired (running + lease_expires_at < now)
 * across the entire collection.
 */
export async function findExpiredLeases(): Promise<JobDoc[]> {
  const c = await col<JobDoc>("jobQueue");
  const entries = await c.findBy("status", "running");
  const now = Date.now();
  return entries
    .filter((e) => e.doc.lease_expires_at !== null && (e.doc.lease_expires_at as number) < now)
    .map((e) => e.doc);
}

/**
 * Find all pending jobs across any lane.
 */
export async function findAllPendingJobs(): Promise<JobDoc[]> {
  const c = await col<JobDoc>("jobQueue");
  const entries = await c.findBy("status", "pending");
  return entries.filter((e) => e.doc.not_before <= Date.now()).map((e) => e.doc);
}

export async function getJob(jobId: string): Promise<JobDoc | null> {
  const c = await col<JobDoc>("jobQueue");
  const entry = await c.get(jobId);
  return entry ? entry.doc : null;
}