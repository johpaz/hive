import { create } from "zustand";
import type { EthicsConfig, EthicsTemplate, EthicsConflict } from "@/types";
import { apiClient } from "@/lib/api";

interface EthicsState {
    isLoading: boolean;
    error: string | null;
    configs: EthicsConfig[];
    conflicts: EthicsConflict[];
    templates: EthicsTemplate[];
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    fetchEthics: () => Promise<string>;
    saveEthics: (content: string) => Promise<string>;
    fetchConfigs: () => Promise<void>;
    fetchConflicts: () => Promise<void>;
    fetchTemplates: () => Promise<void>;
    updateConfig: (id: string, updates: Partial<EthicsConfig>) => void;
    addConfig: (config: Omit<EthicsConfig, "id" | "createdAt" | "updatedAt" | "version">) => void;
    removeConfig: (id: string) => void;
}

export const useEthicsStore = create<EthicsState>((set, get) => ({
    isLoading: false,
    error: null,
    configs: [],
    conflicts: [],
    templates: [],

    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error }),

    fetchEthics: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await apiClient<{ ethics: any[] }>("/api/ethics");
            const ethicsList = data.ethics || [];
            // For now, return the content of the default one or the first one
            const activeEthics = ethicsList.find((e: any) => e.active) || ethicsList[0];
            set({ configs: ethicsList, isLoading: false });
            return activeEthics?.content || "";
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : "Failed to fetch ethics"
            });
            throw error;
        }
    },

    saveEthics: async (content: string): Promise<string> => {
        set({ isLoading: true, error: null });
        try {
            const state = get();
            const activeEthics = state.configs.find((e: any) => e.active) || state.configs[0];
            let data: any;

            if (activeEthics) {
                data = await apiClient<{ message?: string; error?: string }>(`/api/ethics/${activeEthics.id}`, {
                    method: "PUT",
                    body: { content },
                });
            } else {
                data = await apiClient<{ message?: string; error?: string; id: string }>("/api/ethics", {
                    method: "POST",
                    body: { name: "Default", content, active: true },
                });
            }
            set({ isLoading: false });
            return data.message || "Guardado correctamente";
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : "Failed to save ethics"
            });
            throw error;
        }
    },

    fetchConfigs: async () => {
        set({ isLoading: true, error: null });
        try {
            const configs = await apiClient<EthicsConfig[]>("/api/workspace/ethics/configs");
            set({ configs, isLoading: false });
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : "Failed to fetch configs"
            });
        }
    },

    fetchConflicts: async () => {
        set({ isLoading: true, error: null });
        try {
            const conflicts = await apiClient<EthicsConflict[]>("/api/workspace/ethics/conflicts");
            set({ conflicts, isLoading: false });
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : "Failed to fetch conflicts"
            });
        }
    },

    fetchTemplates: async () => {
        set({ isLoading: true, error: null });
        try {
            const templates = await apiClient<EthicsTemplate[]>("/api/workspace/ethics/templates");
            set({ templates, isLoading: false });
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : "Failed to fetch templates"
            });
        }
    },

    updateConfig: (id: string, updates: Partial<EthicsConfig>) => {
        set((state) => ({
            configs: state.configs.map((c) =>
                c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString(), version: c.version + 1 } : c
            )
        }));
    },

    addConfig: (config: Omit<EthicsConfig, "id" | "createdAt" | "updatedAt" | "version">) => {
        const newConfig: EthicsConfig = {
            ...config,
            id: crypto.randomUUID(),
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        set((state) => ({ configs: [...state.configs, newConfig] }));
    },

    removeConfig: (id: string) => {
        set((state) => ({ configs: state.configs.filter((c) => c.id !== id) }));
    },
}));
