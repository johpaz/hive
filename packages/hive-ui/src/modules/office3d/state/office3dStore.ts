import { create } from "zustand";

export type Quality = "high" | "low";

interface Office3DState {
  selectedAgentId: string | null;
  quality: Quality;
  introDone: boolean;
  select: (id: string | null) => void;
  setQuality: (q: Quality) => void;
  setIntroDone: () => void;
}

export const useOffice3DStore = create<Office3DState>((set) => ({
  selectedAgentId: null,
  quality: "high",
  introDone: false,
  select: (id) => set({ selectedAgentId: id }),
  setQuality: (quality) => set({ quality }),
  setIntroDone: () => set({ introDone: true }),
}));
