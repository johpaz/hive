import { create } from 'zustand';
import { apiClient } from '../lib/api';
import type { ScratchpadNote, ScheduledTask, TaskRun, CronChannel } from '../types/notes-crons';

interface NotesAndCronsState {
    // Notes
    notes: ScratchpadNote[];

    // Scheduled tasks (cron /api/cron system)
    scheduledTasks: ScheduledTask[];
    taskHistory: Record<string, TaskRun[]>; // taskId → runs

    // Channel preference (global setting)
    cronChannels: CronChannel[];
    cronRecommended: string;
    cronUserPreference: string;

    // UI state
    isLoading: boolean;
    error: string | null;

    // Actions — notes
    fetchNotes: () => Promise<void>;

    // Actions — scheduled tasks
    fetchScheduledTasks: (status?: string) => Promise<void>;
    pauseTask: (id: string) => Promise<void>;
    resumeTask: (id: string) => Promise<void>;
    deleteTask: (id: string) => Promise<void>;
    triggerTask: (id: string) => Promise<void>;
    fetchTaskHistory: (id: string, limit?: number) => Promise<void>;

    // Actions — channel preference
    fetchCronChannels: () => Promise<void>;
    saveCronChannelPreference: (channelId: string) => Promise<void>;
}

export const useNotesAndCronsStore = create<NotesAndCronsState>((set, get) => ({
    notes: [],
    scheduledTasks: [],
    taskHistory: {},
    cronChannels: [],
    cronRecommended: 'webchat',
    cronUserPreference: 'auto',
    isLoading: false,
    error: null,

    // ── Notes ──────────────────────────────────────────────────────────────────

    fetchNotes: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await apiClient<{ notes: ScratchpadNote[] }>('/api/notes');
            set({ notes: data.notes, isLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, isLoading: false });
        }
    },

    // ── Scheduled tasks ────────────────────────────────────────────────────────

    fetchScheduledTasks: async (status?: string) => {
        set({ isLoading: true, error: null });
        try {
            const path = status
                ? `/api/cron?status=${status}`
                : '/api/cron';
            const data = await apiClient<{ tasks: ScheduledTask[]; count: number }>(path);
            set({ scheduledTasks: data.tasks ?? [], isLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, isLoading: false, scheduledTasks: [] });
        }
    },

    pauseTask: async (id: string) => {
        try {
            await apiClient(`/api/cron/${id}/pause`, { method: 'POST' });
            set((state) => ({
                scheduledTasks: state.scheduledTasks.map((t) =>
                    t.id === id ? { ...t, status: 'paused' as const } : t
                ),
            }));
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },

    resumeTask: async (id: string) => {
        try {
            await apiClient(`/api/cron/${id}/resume`, { method: 'POST' });
            set((state) => ({
                scheduledTasks: state.scheduledTasks.map((t) =>
                    t.id === id ? { ...t, status: 'active' as const } : t
                ),
            }));
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },

    deleteTask: async (id: string) => {
        try {
            await apiClient(`/api/cron/${id}`, { method: 'DELETE' });
            set((state) => ({
                scheduledTasks: state.scheduledTasks.filter((t) => t.id !== id),
            }));
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },

    triggerTask: async (id: string) => {
        try {
            await apiClient(`/api/cron/${id}/trigger`, { method: 'POST' });
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },

    fetchTaskHistory: async (id: string, limit = 10) => {
        try {
            const data = await apiClient<{ history: TaskRun[]; count: number }>(
                `/api/cron/${id}/history?limit=${limit}`
            );
            set((state) => ({
                taskHistory: { ...state.taskHistory, [id]: data.history ?? [] },
            }));
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },

    // ── Channel preference ──────────────────────────────────────────────────────

    fetchCronChannels: async () => {
        try {
            const data = await apiClient<{ channels: string[] | CronChannel[]; preference?: string }>('/api/cron/channels');
            let channels: CronChannel[] = [];
            if (Array.isArray(data.channels)) {
                channels = data.channels.map((ch) => {
                    if (typeof ch === 'string') {
                        return { id: ch, type: ch, active: true, recommended: ch === 'webchat' || ch === 'telegram' };
                    }
                    return ch as CronChannel;
                });
            }
            set({ cronChannels: channels, cronRecommended: 'webchat', cronUserPreference: data.preference ?? 'auto' });
        } catch {
            // Non-critical — ignore if endpoint is unavailable
        }
    },

    saveCronChannelPreference: async (channelId: string) => {
        try {
            await apiClient('/api/user/settings', {
                method: 'PATCH',
                body: { preferred_cron_channel: channelId },
            });
            set({ cronUserPreference: channelId });
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },
}));
