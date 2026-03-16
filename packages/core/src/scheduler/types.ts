/**
 * Hive Scheduler - Type Definitions
 * 
 * Type interfaces for the Croner-based scheduling system.
 */

import type { Database } from "bun:sqlite";
import type { Cron } from "croner";

/**
 * Task type: recurring uses cron expression, one_shot uses fire_at
 */
export type TaskType = "recurring" | "one_shot";

/**
 * Task status
 */
export type TaskStatus = "active" | "paused" | "completed" | "failed" | "cancelled";

/**
 * Task run status
 */
export type TaskRunStatus = "running" | "success" | "failed" | "timeout";

/**
 * Scheduled task as stored in SQLite
 */
export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  task_type: TaskType;
  cron_expression: string | null;
  fire_at: string | null;
  timezone: string;
  max_runs: number | null;
  protect: number;
  interval_sec: number | null;
  agent_id: string | null;
  channel: string;
  payload: string; // JSON string
  tool_name: string | null;
  status: TaskStatus;
  run_count: number;
  error_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  completed_at: string | null;
}

/**
 * Task run history record
 */
export interface TaskRun {
  id: string;
  task_id: string;
  status: TaskRunStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  payload_snapshot: string | null;
  agent_response: string | null;
}

/**
 * Input for creating a new scheduled task
 */
export interface CreateTaskInput {
  name: string;
  description?: string;
  task_type: TaskType;
  cron_expression?: string;
  fire_at?: string;
  timezone: string;
  agent_id?: string | null;
  channel?: string;
  payload?: Record<string, unknown>;
  tool_name?: string | null;
  max_runs?: number | null;
  protect?: boolean;
  interval_sec?: number | null;
}

/**
 * Input for updating a scheduled task
 */
export interface UpdateTaskInput {
  name?: string;
  description?: string;
  task_type?: TaskType;
  cron_expression?: string | null;
  fire_at?: string | null;
  timezone?: string;
  agent_id?: string | null;
  channel?: string;
  payload?: Record<string, unknown>;
  tool_name?: string | null;
  max_runs?: number | null;
  protect?: boolean;
  interval_sec?: number | null;
  status?: TaskStatus;
}

/**
 * Scheduler status for a task
 */
export interface TaskSchedulerStatus {
  id: string;
  name: string;
  nextRun: Date | null;
  isBusy: boolean;
  status: TaskStatus;
}

/**
 * Handler function type for executing tasks
 */
export type TaskExecutionHandler = (task: ScheduledTask) => Promise<TaskExecutionResult>;

/**
 * Result of task execution
 */
export interface TaskExecutionResult {
  success: boolean;
  response?: string;
  error?: string;
}

/**
 * Internal job wrapper holding Croner instance and metadata
 */
export interface ScheduledJob {
  task: ScheduledTask;
  cron: Cron;
}

/**
 * Options for Croner job creation
 */
export interface CronerOptions {
  timezone: string;
  protect: boolean;
  catch: boolean | ((error: Error) => void);
  name: string;
  maxRuns?: number;
  interval?: number;
}
