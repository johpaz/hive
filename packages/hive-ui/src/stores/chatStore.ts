import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Message } from "@/types";

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  currentSteps: string[];
  streamingMessageId: string | null;
  connectionWarning: string | null;
  addMessage: (message: Message) => void;
  addMessages: (messages: Message[]) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setMessages: (messages: Message[]) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  addStep: (step: string) => void;
  clearSteps: () => void;
  setStreamingMessageId: (id: string | null) => void;
  setConnectionWarning: (warning: string | null) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      isLoading: false,
      currentSteps: [],
      streamingMessageId: null,
      connectionWarning: null,

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
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          ),
        })),
      setMessages: (messages) => set({ messages }),
      clearMessages: () => set({ messages: [], currentSteps: [], streamingMessageId: null }),
      setLoading: (loading) => set({ isLoading: loading }),
      addStep: (step) =>
        set((state) => ({
          currentSteps: [...state.currentSteps.slice(-4), step],
        })),
      clearSteps: () => set({ currentSteps: [] }),
      setStreamingMessageId: (id) => set({ streamingMessageId: id }),
      setConnectionWarning: (warning) => set({ connectionWarning: warning }),
    }),
    {
      name: "hive-chat-storage",
      partialize: (state) => ({
        messages: state.messages.slice(-15),
      }),
    }
  )
);