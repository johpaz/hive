import { create } from "zustand";
import type { ConfigSnapshot, SaveStatus, ConfigSection, ConfigValidationError } from "@/types";

interface AgentConfigState {
  activeAgentId: string | null;
  activeSection: ConfigSection;
  saveStatus: SaveStatus;
  snapshots: ConfigSnapshot[];
  validationErrors: ConfigValidationError[];
  unsavedChanges: boolean;
  setActiveAgent: (id: string | null) => void;
  setActiveSection: (section: ConfigSection) => void;
  setSaveStatus: (status: SaveStatus) => void;
  addSnapshot: (snapshot: ConfigSnapshot) => void;
  setValidationErrors: (errors: ConfigValidationError[]) => void;
  setUnsavedChanges: (val: boolean) => void;
}

export const useAgentConfigStore = create<AgentConfigState>((set) => ({
  activeAgentId: null,
  activeSection: "ethics",
  saveStatus: "saved",
  snapshots: [],
  validationErrors: [],
  unsavedChanges: false,
  setActiveAgent: (id) => set({ activeAgentId: id }),
  setActiveSection: (section) => set({ activeSection: section }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  addSnapshot: (snapshot) => set((s) => ({ snapshots: [...s.snapshots, snapshot] })),
  setValidationErrors: (errors) => set({ validationErrors: errors }),
  setUnsavedChanges: (val) => set({ unsavedChanges: val }),
}));
