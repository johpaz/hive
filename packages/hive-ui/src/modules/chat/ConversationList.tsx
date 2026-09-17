import { useState, useRef, useEffect } from "react";
import { MessageSquarePlus, MoreHorizontal, Pencil, Trash2, Check, X } from "lucide-react";
import { useConversationsStore, type Conversation } from "@/stores/conversationsStore";

/**
 * Panel lateral con las conversaciones de la web.
 *
 * Cada una es un hilo propio: lo que se hable en una no entra en el contexto de
 * las demás, ni en el de los canales (Telegram, WhatsApp…), que tienen los suyos.
 */

interface ConversationListProps {
  onSelect?: (id: string) => void;
}

function tituloDe(conversation: Conversation): string {
  // El backend lo deriva del primer mensaje; hasta entonces no hay nada que poner.
  return conversation.title?.trim() || "Conversación nueva";
}

function fechaCorta(timestamp: number): string {
  const fecha = new Date(timestamp);
  const hoy = new Date();
  const mismoDia = fecha.toDateString() === hoy.toDateString();
  return mismoDia
    ? fecha.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : fecha.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export function ConversationList({ onSelect }: ConversationListProps) {
  const { conversations, activeId, createConversation, selectConversation, renameConversation, deleteConversation } =
    useConversationsStore();
  const [menuAbierto, setMenuAbierto] = useState<string | null>(null);
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renombrando) inputRef.current?.focus();
  }, [renombrando]);

  const abrir = (id: string) => {
    if (id === activeId) return;
    selectConversation(id);
    onSelect?.(id);
  };

  const nueva = async () => {
    const id = await createConversation();
    if (id) onSelect?.(id);
  };

  const confirmarRenombre = async (id: string) => {
    const titulo = borrador.trim();
    setRenombrando(null);
    if (titulo) await renameConversation(id, titulo);
  };

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-white/5 bg-transparent">
      <div className="p-3">
        <button
          type="button"
          onClick={nueva}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span className="text-xs font-semibold font-manrope">Nueva conversación</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {conversations.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-white/30">Todavía no hay conversaciones.</p>
        )}

        {conversations.map((conversation) => {
          const activa = conversation.id === activeId;
          const editando = renombrando === conversation.id;

          return (
            <div
              key={conversation.id}
              className={`group relative rounded-lg transition-colors ${
                activa ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              {editando ? (
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <input
                    ref={inputRef}
                    value={borrador}
                    onChange={(e) => setBorrador(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmarRenombre(conversation.id);
                      if (e.key === "Escape") setRenombrando(null);
                    }}
                    className="flex-1 min-w-0 bg-transparent border-b border-white/20 text-xs text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => confirmarRenombre(conversation.id)}
                    className="text-white/50 hover:text-emerald-400"
                    aria-label="Guardar nombre"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenombrando(null)}
                    className="text-white/50 hover:text-white"
                    aria-label="Cancelar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => abrir(conversation.id)}
                    className="w-full text-left px-3 py-2 pr-8"
                  >
                    <span
                      className={`block truncate text-xs font-medium font-manrope ${
                        activa ? "text-white" : "text-white/60"
                      }`}
                    >
                      {tituloDe(conversation)}
                    </span>
                    <span className="block text-[10px] text-white/25 mt-0.5">
                      {fechaCorta(conversation.lastMessageAt)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuAbierto(menuAbierto === conversation.id ? null : conversation.id)}
                    className="absolute right-1.5 top-2 h-6 w-6 rounded flex items-center justify-center text-white/30 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10 transition-all"
                    aria-label="Opciones de la conversación"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </>
              )}

              {menuAbierto === conversation.id && !editando && (
                <div className="absolute right-1 top-8 z-20 w-36 rounded-lg border border-white/10 bg-[#12141a] shadow-xl py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setBorrador(conversation.title ?? "");
                      setRenombrando(conversation.id);
                      setMenuAbierto(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    <Pencil className="h-3 w-3" />
                    Renombrar
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuAbierto(null);
                      await deleteConversation(conversation.id);
                      // Tras borrar, el store deja activa la siguiente de la lista.
                      const siguiente = useConversationsStore.getState().activeId;
                      if (siguiente) onSelect?.(siguiente);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" />
                    Borrar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
