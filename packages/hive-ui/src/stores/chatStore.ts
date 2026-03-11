import { create } from "zustand";
import type { Message } from "@/types";

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  currentSteps: string[];
  addMessage: (message: Message) => void;
  addMessages: (messages: Message[]) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setMessages: (messages: Message[]) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  addStep: (step: string) => void;
  clearSteps: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  currentSteps: [],
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  addMessages: (messages) =>
    set((state) => ({
      messages: [...state.messages, ...messages],
    })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  setMessages: (messages) => set({ messages }),
  clearMessages: () => set({ messages: [] }),
  setLoading: (loading) => set({ isLoading: loading }),
  addStep: (step) =>
    set((state) => ({
      currentSteps: [...state.currentSteps.slice(-4), step], // keep last 5
    })),
  clearSteps: () => set({ currentSteps: [] }),
}));
