import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiClient } from "@/lib/api";

/**
 * Las conversaciones de la web.
 *
 * Antes no había ninguna: todos los canales compartían un único hilo por usuario,
 * así que el chat no tenía nada que listar ni forma de empezar de cero. Cada
 * conversación es un hilo del backend y su `id` es opaco — se manda de vuelta tal
 * cual (por WebSocket al escribir, por query al pedir el historial).
 */

export interface Conversation {
  id: string;
  title: string | null;
  channel: string;
  peerKind: "direct" | "group";
  messageCount: number;
  lastMessageAt: number;
  createdAt: number;
}

interface ConversationsState {
  conversations: Conversation[];
  /** Conversación abierta. null hasta que se cargue la lista por primera vez. */
  activeId: string | null;
  isLoading: boolean;
  error: string | null;

  fetchConversations: () => Promise<void>;
  createConversation: () => Promise<string | null>;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

function byMostRecent(a: Conversation, b: Conversation): number {
  return b.lastMessageAt - a.lastMessageAt;
}

export const useConversationsStore = create<ConversationsState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      isLoading: false,
      error: null,

      fetchConversations: async () => {
        set({ isLoading: true, error: null });
        try {
          const { conversations } = await apiClient<{ conversations: Conversation[] }>(
            "/api/conversations?channel=webchat",
            { showError: false }
          );
          const list = [...(conversations ?? [])].sort(byMostRecent);
          const { activeId } = get();
          // La activa guardada puede haberse borrado desde otra pestaña.
          const stillThere = activeId && list.some((c) => c.id === activeId);
          set({
            conversations: list,
            activeId: stillThere ? activeId : (list[0]?.id ?? null),
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false, error: (error as Error).message });
        }
      },

      createConversation: async () => {
        try {
          const { conversation } = await apiClient<{ conversation: Conversation }>(
            "/api/conversations",
            { method: "POST", body: {}, showError: false }
          );
          set((state) => ({
            conversations: [conversation, ...state.conversations],
            activeId: conversation.id,
          }));
          return conversation.id;
        } catch (error) {
          set({ error: (error as Error).message });
          return null;
        }
      },

      selectConversation: (id) => set({ activeId: id }),

      renameConversation: async (id, title) => {
        // Optimista: el nombre es del usuario, no hay nada que confirmar.
        set((state) => ({
          conversations: state.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
        }));
        await apiClient("/api/conversations", {
          method: "PATCH",
          body: { threadId: id, title },
          showError: false,
        }).catch(() => get().fetchConversations());
      },

      deleteConversation: async (id) => {
        await apiClient(`/api/conversations?threadId=${encodeURIComponent(id)}`, {
          method: "DELETE",
          showError: false,
        });
        set((state) => {
          const conversations = state.conversations.filter((c) => c.id !== id);
          return {
            conversations,
            activeId: state.activeId === id ? (conversations[0]?.id ?? null) : state.activeId,
          };
        });
      },
    }),
    {
      name: "hive-conversations",
      // Sólo la conversación abierta sobrevive a la recarga; la lista se vuelve a
      // pedir siempre, para no mostrar títulos viejos de otra pestaña o dispositivo.
      partialize: (state) => ({ activeId: state.activeId }),
    }
  )
);
