/**
 * job-store — durable persistence + lease/claim for the jobQueue collection.
 *
 * All claim transitions use OCC (expectedVersion). The "claim pending→running"
 * path guarantees only one process wins the race for the same job.
 */

import { col, nextId, updateDoc } from "../storage/hive";
import type { JobDoc } from "../storage/collections";
import { getBootId } from "../storage/boot-id";
import { logger } from "../utils/logger";

const log = logger.child("job-store");

const LEASE_DURATION_MS = 30 * 60 * 1000;
const MAX_RETRIES = 5;

export async function createJob(input: {
  lane: string;
  type: JobDoc["type"];
  payload: unknown;
  run_id: string;
  priority?: number;
  max_attempts?: number;
  not_before?: number;
}): Promise<JobDoc> {
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
      lease_expires_at: now + LEASE_DURATION_MS,
      started_at: doc.started_at ?? now,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      log.info(`[claimJob] Job ${jobId} claimed by boot ${bootId}`);
      return updated;
    } catch {
      // OCC conflict — retry
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
      lease_expires_at: Date.now() + LEASE_DURATION_MS,
    };
    try {
      await c.put(jobId, updated, { expectedVersion: entry.version });
      return true;
    } catch {
      // OCC conflict — retry
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
    }
  }
  log.warn(`[failJob] Too much contention on job ${jobId}`);
}

/**
 * Re-enqueue a job whose lease has expired back to pending, bumping its
 * attempt count (already bumped at claim time). If attempts >= max_attempts,
 * marks it as failed instead.
 */
export async function reclaimOrInterrupt(jobId: string): Promise<JobDoc | null> {
  const c = await col<JobDoc>("jobQueue");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await c.get(jobId);
    if (!entry) return null;
    const doc = entry.doc;
    if (doc.status !== "running") return null;
    if (doc.lease_expires_at === null || doc.lease_expires_at > Date.now()) return null;

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