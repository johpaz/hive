import { create } from "zustand";
import type { CanvasWorkEvent } from "@/stores/canvasStore";

export type Quality = "high" | "low";
export type MotionMode = "calm" | "off";

interface Office3DState {
  selectedAgentId: string | null;
  quality: Quality;
  motion: MotionMode;
  introDone: boolean;
  soundEnabled: boolean;
  activeCue: CanvasWorkEvent | null;
  select: (id: string | null) => void;
  setQuality: (q: Quality) => void;
  setMotion: (motion: MotionMode) => void;
  setIntroDone: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  setActiveCue: (cue: CanvasWorkEvent | null) => void;
}

function initialSoundPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("office3d-sound") === "on";
}

export const useOffice3DStore = create<Office3DState>((set) => ({
  selectedAgentId: null,
  quality: "high",
  motion: "calm",
  introDone: false,
  soundEnabled: initialSoundPreference(),
  activeCue: null,
  select: (id) => set({ selectedAgentId: id }),
  setQuality: (quality) => set({ quality }),
  setMotion: (motion) => set({ motion }),
  setIntroDone: () => set({ introDone: true }),
  setSoundEnabled: (soundEnabled) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("office3d-sound", soundEnabled ? "on" : "off");
    }
    set({ soundEnabled });
  },
  setActiveCue: (activeCue) => set({ activeCue }),
}));
