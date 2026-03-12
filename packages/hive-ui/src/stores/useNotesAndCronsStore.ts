import { create } from 'zustand';
import { apiClient } from '../lib/api';
import type { ScratchpadNote, CronJob, CronChannel } from '../types/notes-crons';

interface CronChannelsResponse {
    channels: CronChannel[];
    recommended: string;
    userPreference: string;
}

interface NotesAndCronsState {
    notes: ScratchpadNote[];
    cronJobs: CronJob[];
    cronChannels: CronChannel[];
    cronRecommended: string;
    cronUserPreference: string;
    isLoading: boolean;
    error: string | null;
    fetchNotes: () => Promise<void>;
    fetchCronJobs: () => Promise<void>;
    fetchCronChannels: () => Promise<void>;
    toggleCronJobActive: (id: string, enabled: boolean) => Promise<void>;
    saveCronChannelPreference: (channelId: string) => Promise<void>;
}

export const useNotesAndCronsStore = create<NotesAndCronsState>((set) => ({
    notes: [],
    cronJobs: [],
    cronChannels: [],
    cronRecommended: 'webchat',
    cronUserPreference: 'auto',
    isLoading: false,
    error: null,

    fetchNotes: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await apiClient<{ notes: ScratchpadNote[] }>('/api/notes');
            set({ notes: data.notes, isLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, isLoading: false });
        }
    },

    fetchCronJobs: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await apiClient<{ cronJobs: CronJob[] } | CronJob[]>('/api/cron-jobs');
            console.log("[CronStore] fetchCronJobs - API Response:", data);
            let jobs: CronJob[] = [];
            if (Array.isArray(data)) {
                jobs = data;
                console.log("[CronStore] Response es array directo:", jobs.length, "jobs");
            } else if ('cronJobs' in data) {
                jobs = (data as { cronJobs: CronJob[] }).cronJobs;
                console.log("[CronStore] Response tiene propiedad 'cronJobs':", jobs.length, "jobs");
            } else if ('jobs' in data) {
                jobs = (data as any).jobs;
                console.log("[CronStore] Response tiene propiedad 'jobs':", jobs.length, "jobs");
            } else {
                console.warn("[CronStore] Formato de respuesta desconocido:", data);
            }
            set({ cronJobs: jobs, isLoading: false });
        } catch (err) {
            console.error("[CronStore] Error en fetchCronJobs:", err);
            set({ error: (err as Error).message, isLoading: false, cronJobs: [] });
        }
    },

    fetchCronChannels: async () => {
        try {
            const data = await apiClient<{ channels: string[] | CronChannel[] }>('/api/cron-jobs/channels');
            console.log("[CronStore] fetchCronChannels - API Response:", data);
            
            // El backend retorna array de strings o array de objetos CronChannel
            let channels: CronChannel[] = [];
            if (Array.isArray(data.channels)) {
                channels = data.channels.map(ch => {
                    if (typeof ch === 'string') {
                        // Convertir string a objeto CronChannel
                        return {
                            id: ch,
                            type: ch,
                            active: true,
                            recommended: ch === 'webchat' || ch === 'telegram',
                        } as CronChannel;
                    }
                    return ch as CronChannel;
                });
                console.log("[CronStore] CronChannels convertidos:", channels.length, "canales");
            }
            
            set({
                cronChannels: channels,
                cronRecommended: 'webchat',
                cronUserPreference: 'auto',
            });
        } catch (err) {
            console.error("[CronStore] Error en fetchCronChannels:", err);
            set({ error: (err as Error).message });
        }
    },

    toggleCronJobActive: async (id: string, enabled: boolean) => {
        try {
            await apiClient(`/api/cron-jobs/${id}/toggle`, {
                method: 'PATCH',
                body: { enabled: enabled ? 1 : 0 }
            });
            set((state) => ({
                cronJobs: state.cronJobs.map((j) => (j.id === id ? { ...j, enabled: enabled ? 1 : 0 } : j)),
            }));
        } catch (err) {
            set({ error: (err as Error).message });
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
