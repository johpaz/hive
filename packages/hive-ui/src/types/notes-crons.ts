export interface ScratchpadNote {
    id: number;
    thread_id: string;
    key: string;
    value: string;
    source: string | null;
    created_at: number;
    updated_at: number;
}

export interface CronJob {
    id: string;
    name: string;
    cron_expression: string;
    task_type: string;
    task_config?: string;
    enabled: boolean | number;
    user_id: string;
    notify_channel_id?: string;
    max_runs?: number | null;
    expires_at?: number | null;
    last_run?: number | null;
    next_run?: number | null;
    created_at: number;
}

export interface CronChannel {
    id: string;
    type: string;
    active: boolean;
    recommended: boolean;
}
