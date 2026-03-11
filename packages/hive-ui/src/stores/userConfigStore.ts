import { create } from "zustand";
import type { UserConfig } from "@/types";

interface UserConfigState {
  configs: UserConfig[];
  activeConfigId: string | null;
  setConfigs: (configs: UserConfig[]) => void;
  setActiveConfig: (id: string | null) => void;
  updateConfig: (id: string, updates: Partial<UserConfig>) => void;
  addConfig: (config: UserConfig) => void;
  removeConfig: (id: string) => void;
}

export const useUserConfigStore = create<UserConfigState>((set) => ({
  configs: [],
  activeConfigId: null,
  setConfigs: (configs) => set({ configs }),
  setActiveConfig: (id) => set({ activeConfigId: id }),
  updateConfig: (id, updates) =>
    set((s) => ({ configs: s.configs.map((c) => (c.id === id ? { ...c, ...updates } : c)) })),
  addConfig: (config) => set((s) => ({ configs: [...s.configs, config] })),
  removeConfig: (id) => set((s) => ({ configs: s.configs.filter((c) => c.id !== id) })),
}));
