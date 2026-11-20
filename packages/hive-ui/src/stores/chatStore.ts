import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Message } from "@/types";

const CHAT_HISTORY_LIMIT = 40;

/** Por encima de esto un base64 no se guarda en localStorage (cuota ~5 MB): una imagen o audio grande lo llenaba. */
const MAX_PERSISTED_BASE64_CHARS = 200_000;

/**
 * Copia del mensaje apta para localStorage. Los documentos adjuntos nunca llevan
 * su contenido (la tarjeta solo muestra nombre y tipo) y las imágenes o audios
 * enormes tampoco; sin esto, un adjunto de varios MB lanzaba QuotaExceededError
 * dentro de addMessage y el envío se cortaba antes de llegar al servidor.
 */
function paraPersistir(m: Message): Message {
  const copia: any = { ...m };
  if (copia.document?.base64) copia.document = { ...copia.document, base64: undefined };
  if (copia.image?.base64 && copia.image.base64.length > MAX_PERSISTED_BASE64_CHARS) copia.image = { ...copia.image, base64: undefined };
  if (copia.audio?.base64 && copia.audio.base64.length > MAX_PERSISTED_BASE64_CHARS) copia.audio = { ...copia.audio, base64: undefined };
  return copia;
}

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
      // Si la cuota se llena (o el almacenamiento está bloqueado) se pierde la copia
      // local, nunca el envío del mensaje.
      storage: createJSONStorage(() => ({
        getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
        setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* cuota llena o bloqueado */ } },
        removeItem: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
      })),
      partialize: (state) => ({
        messages: state.messages.slice(-CHAT_HISTORY_LIMIT).map(paraPersistir),
      }),
    }
  )
);
