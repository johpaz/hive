/**
 * reconcileOnBoot — centralized repair of rows left in inconsistent states
 * by a previous crash/kill.
 *
 * Currently repairs:
 * - taskRuns: running → timeout  (moved from server.ts inline)
 * - meetingSessions: active (orphaned) → stopped
 * - agentRuns: running + expired lease → interrupted (chat) or mark for re-enqueue
 * - jobQueue: running + expired lease → pending (reclaim) or interrupted
 *
 * This is called early in the boot sequence, before the scheduler and
 * durable queue are activated.
 */

import { col, updateDoc } from "./hive";
import type { TaskRunDoc, MeetingSessionDoc, AgentRunDoc, JobDoc, TaskDoc } from "./collections";
import { logger } from "../utils/logger";
import { reclaimOrInterrupt } from "../gateway/job-store";
import { interruptRun } from "../agent/run-store";
import { sendToUserChannel } from "../gateway/channel-notify";

const log = logger.child("reconcile");

export interface ReconcileResult {
  bootId: string;
  taskRunsTimedOut: number;
  meetingsStopped: number;
  runsInterrupted: number;
  runsReEnqueueable: number;
  jobsReclaimed: number;
  jobsInterrupted: number;
  tasksRequeued: number;
  tasksFailed: number;
}

export async function reconcileOnBoot(bootId: string): Promise<ReconcileResult> {
  log.info(`[reconcileOnBoot] Starting with boot_id=${bootId}`);
  const result: ReconcileResult = {
    bootId,
    taskRunsTimedOut: 0,
    meetingsStopped: 0,
    runsInterrupted: 0,
    runsReEnqueueable: 0,
    jobsReclaimed: 0,
    jobsInterrupted: 0,
    tasksRequeued: 0,
    tasksFailed: 0,
  };

  // 1. taskRuns: running → timeout (moved from server.ts:211-220)
  try {
    const taskRunsCol = await col<TaskRunDoc>("taskRuns");
    const orphanedRuns = (await taskRunsCol.scan({})).filter((e) => e.doc.status === "running");
    for (const run of orphanedRuns) {
      await taskRunsCol.put(
        run.id,
        { ...run.doc, status: "timeout", finished_at: new Date().toISOString() },
        { expectedVersion: run.version }
      );
      result.taskRunsTimedOut++;
    }
    if (result.taskRunsTimedOut > 0) {
      log.info(`[reconcileOnBoot] ${result.taskRunsTimedOut} orphaned taskRuns → timeout`);
    }
  } catch (err) {
    log.warn(`[reconcileOnBoot] Failed to repair taskRuns: ${(err as Error).message}`);
  }

  // 2. meetingSessions: active (orphaned) → stopped
  try {
    const meetingsCol = await col<MeetingSessionDoc>("meetingSessions");
    const activeMeetings = await meetingsCol.findBy("status", "active");
    for (const m of activeMeetings) {
      await meetingsCol.put(
        m.id,
        { ...m.doc, status: "stopped", stopped_at: Date.now() },
        { expectedVersion: m.version }
      );
      result.meetingsStopped++;
    }
    if (result.meetingsStopped > 0) {
      log.info(`[reconcileOnBoot] ${result.meetingsStopped} orphaned meetings → stopped`);
    }
  } catch (err) {
    log.warn(`[reconcileOnBoot] Failed to repair meetings: ${(err as Error).message}`);
  }

  // 3. agentRuns: running + expired lease → interrupted or re-enqueueable
  try {
    const agentRunsCol = await col<AgentRunDoc>("agentRuns");
    const runningRuns = await agentRunsCol.findBy("status", "running");
    const now = Date.now();
    for (const entry of runningRuns) {
      const run = entry.doc;
      if (run.lease_expires_at >= now) continue;

      if (run.kind === "chat") {
        await interruptRun(run.id, "Process restarted while chat turn was in flight");
        result.runsInterrupted++;
        try {
          if (run.channel && run.user_id) {
            await sendToUserChannel(run.channel, run.user_id, "Se interrumpió un turno en progreso por un reinicio del proceso.");
          }
        } catch {
          // non-critical
        }
      } else {
        await interruptRun(run.id, "Process restarted — job will be re-enqueued if durable");
        result.runsReEnqueueable++;
      }
    }
    if (result.runsInterrupted > 0 || result.runsReEnqueueable > 0) {
      log.info(
        `[reconcileOnBoot] ${result.runsInterrupted} chat runs interrupted, ${result.runsReEnqueueable} durable runs flagged for re-enqueue`
      );
    }
  } catch (err) {
    log.warn(`[reconcileOnBoot] Failed to repair agentRuns: ${(err as Error).message}`);
  }

  // 4. jobQueue: running + expired lease → reclaim (pending) or interrupted
  try {
    const jobsCol = await col<JobDoc>("jobQueue");
    const runningJobs = await jobsCol.findBy("status", "running");
    const now2 = Date.now();
    for (const entry of runningJobs) {
      const job = entry.doc;
      if (job.lease_expires_at === null || job.lease_expires_at >= now2) continue;
      const result_doc = await reclaimOrInterrupt(job.id);
      if (result_doc?.status === "pending") result.jobsReclaimed++;
      else if (result_doc?.status === "interrupted") result.jobsInterrupted++;
    }
    if (result.jobsReclaimed > 0 || result.jobsInterrupted > 0) {
      log.info(
        `[reconcileOnBoot] ${result.jobsReclaimed} jobs reclaimed to pending, ${result.jobsInterrupted} jobs interrupted (attempts exhausted)`
      );
    }
  } catch (err) {
    log.warn(`[reconcileOnBoot] Failed to repair jobQueue: ${(err as Error).message}`);
  }

  // 5. tasks: in_progress without a live job → pending (attempts+1) or failed
  try {
    const tasksCol = await col<TaskDoc>("tasks");
    const inProgress = await tasksCol.findBy("status", "in_progress");
    const { getJob } = await import("../gateway/job-store");
    for (const entry of inProgress) {
      const task = entry.doc;
      let hasLiveJob = false;
      if (task.job_id) {
        const job = await getJob(task.job_id);
        if (job && job.status === "running") {
          hasLiveJob = true;
        }
      }
      if (!hasLiveJob) {
        const attempts = (task.attempts ?? 0) + 1;
        if (attempts >= 2) {
          await tasksCol.put(entry.id, {
            ...task,
            status: "failed",
            error: "Max attempts reached after process restart",
            attempts,
            updated_at: Date.now(),
          }, { expectedVersion: entry.version });
          result.tasksFailed++;
        } else {
          await tasksCol.put(entry.id, {
            ...task,
            status: "pending",
            attempts,
            updated_at: Date.now(),
          }, { expectedVersion: entry.version });
          result.tasksRequeued++;
        }
      }
    }
    if (result.tasksRequeued > 0 || result.tasksFailed > 0) {
      log.info(`[reconcileOnBoot] ${result.tasksRequeued} tasks requeued, ${result.tasksFailed} tasks failed (attempts exhausted)`);
    }
  } catch (err) {
    log.warn(`[reconcileOnBoot] Failed to repair tasks: ${(err as Error).message}`);
  }

  // 6. Retention cap: keep only the most recent 500 agentRuns and 500 jobs per thread/run
  const RETENTION_LIMIT = 500;
  try {
    const agentRunsCol = await col<AgentRunDoc>("agentRuns");
    const allRuns = await agentRunsCol.scan({});
    const runsByThread = new Map<string, typeof allRuns>();
    for (const entry of allRuns) {
      const threadId = entry.doc.thread_id ?? entry.doc.agent_id ?? "_default";
      const list = runsByThread.get(threadId) ?? [];
      list.push(entry);
      runsByThread.set(threadId, list);
    }
    let runsPruned = 0;
    for (const [, runs] of runsByThread) {
      if (runs.length <= RETENTION_LIMIT) continue;
      const sorted = runs.sort((a, b) => (b.doc.created_at ?? 0) - (a.doc.created_at ?? 0));
      for (const entry of sorted.slice(RETENTION_LIMIT)) {
        await agentRunsCol.delete(entry.id);
        runsPruned++;
      }
    }
    if (runsPruned > 0) {
      log.info(`[reconcileOnBoot] Retention: pruned ${runsPruned} old agentRuns (cap=${RETENTION_LIMIT}/thread)`);
    }

    const jobsCol = await col<JobDoc>("jobQueue");
    const allJobs = await jobsCol.scan({});
    const jobsByRun = new Map<string, typeof allJobs>();
    for (const entry of allJobs) {
      const runId = entry.doc.run_id ?? "_default";
      const list = jobsByRun.get(runId) ?? [];
      list.push(entry);
      jobsByRun.set(runId, list);
    }
    let jobsPruned = 0;
    for (const [, jobs] of jobsByRun) {
      if (jobs.length <= RETENTION_LIMIT) continue;
      const sorted = jobs.sort((a, b) => (b.doc.created_at ?? 0) - (a.doc.created_at ?? 0));
      for (const entry of sorted.slice(RETENTION_LIMIT)) {
        await jobsCol.delete(entry.id);
        jobsPruned++;
      }
    }
    if (jobsPruned > 0) {
      log.info(`[reconcileOnBoot] Retention: pruned ${jobsPruned} old jobs (cap=${RETENTION_LIMIT}/run)`);
    }
  } catch (err) {
    log.warn(`[reconcileOnBoot] Failed to enforce retention cap: ${(err as Error).message}`);
  }

  log.info(`[reconcileOnBoot] Done`, result);
  return result;
}