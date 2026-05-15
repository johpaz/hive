import { create } from "zustand";

export interface WelcomeData {
  sessionId: string;
  user: {
    id: string;
    name: string;
    language: string;
  } | null;
  agent: {
    id: string;
    name: string;
    provider: string;
    model: string;
  } | null;
  channels: string[];
  voice: {
    enabled: boolean;
    sttProvider: string | null;
    ttsProvider: string | null;
  };
}

interface WelcomeStore {
  isOpen: boolean;
  data: WelcomeData | null;
  show: (data: WelcomeData) => void;
  close: () => void;
}

export const useWelcomeStore = create<WelcomeStore>((set) => ({
  isOpen: false,
  data: null,
  show: (data) => set({ isOpen: true, data }),
  close: () => set({ isOpen: false, data: null }),
}));
