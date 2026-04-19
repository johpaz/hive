export interface ScratchpadNote {
    id: number;
    thread_id: string;
    key: string;
    value: string;
    source: string | null;
    created_at: number;
    updated_at: number;
}

// ── Scheduler types (cron API) ─────────────────────────────────────────────

export type TaskType = 'recurring' | 'one_shot';
export type TaskStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type TaskRunStatus = 'running' | 'success' | 'failed' | 'timeout';

export interface ScheduledTask {
    id: string;
    name: string;
    task: string;
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
    start_at: string | null;
    stop_at: string | null;
    dom_and_dow: number;
}

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

export interface CronChannel {
    id: string;
    type: string;
    active: boolean;
    recommended: boolean;
}
