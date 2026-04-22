import { useEffect, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useWebSocketStore } from "@/stores/useWebSocketStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useUserStore } from "@/stores/userStore";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { useChatStreaming } from "@/hooks/useChatStreaming";
import { useNarration } from "@/hooks/useNarration";
import { ChatHistory } from "./ChatHistory";
import { ChatInput } from "./ChatInput";
import { apiClient } from "@/lib/api";
import { generateId } from "@/lib/utils";
import { Bot, Volume2, VolumeX, AlertCircle, RefreshCw } from "lucide-react";

interface ChatContainerProps {
  agentId?: string;
  sessionId?: string;
}

export function ChatContainer({ agentId = "agent_id", sessionId = "user_id" }: ChatContainerProps) {
  const { messages, addMessage, setMessages, isLoading, currentSteps, streamingMessageId, connectionWarning, setConnectionWarning } = useChatStore();
  const { status, send, subscribe } = useWebSocket();
  const { currentUser, fetchUser } = useUserStore();
  const agents = useGlobalConfigStore((s) => s.agents);
  const fetchAgents = useGlobalConfigStore((s) => s.fetchAgents);
  const { handleStreamingChunk, handleAudioMessage, handleProgress, handleTyping, resetStreamingRef } = useChatStreaming(agentId, sessionId);
  const narration = useNarration();

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  const coordinator = agents.find((a) => a.role === "coordinator" && a.enabled);
  const agentName = coordinator?.name ?? "Coordinador";

  useEffect(() => {
    if (!currentUser) fetchUser();
    if (agents.length === 0) fetchAgents();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const fetchHistory = async () => {
      try {
        const response = await apiClient<{ messages: any[] }>(`/api/chat/history?sessionId=${sessionId}&limit=15`);
        if (response.messages) {
          const formattedMessages = response.messages
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .map((m: any) => ({
              id: m.id,
              conversationId: m.session_id || m.thread_id,
              type: (m.role === "user" ? "user" : "agent") as any,
              content: m.content,
              agentId,
              timestamp: m.created_at,
            }));
          setMessages(formattedMessages);
        }
      } catch (error) {
        console.error("Failed to fetch chat history:", error);
      }
    };
    fetchHistory();
  }, [sessionId, agentId, setMessages]);

  useEffect(() => {
    const unsubMsg = subscribe("message", handleStreamingChunk);
    const unsubResp = subscribe("response", handleStreamingChunk);
    const unsubAudio = subscribe("audio", handleAudioMessage);
    const unsubProgress = subscribe("progress", handleProgress);
    const unsubTyping = subscribe("typing", handleTyping);
    return () => {
      unsubMsg();
      unsubResp();
      unsubAudio();
      unsubProgress();
      unsubTyping();
    };
  }, [subscribe, handleStreamingChunk, handleAudioMessage, handleProgress, handleTyping]);

  useEffect(() => {
    if (isConnected) {
      setConnectionWarning(null);
    } else if (!isConnecting) {
      setConnectionWarning("Conexion perdida. Reconectando...");
    }
  }, [isConnected, isConnecting, setConnectionWarning]);

  const handleSendMessage = useCallback(
    (content: string, audioBase64?: string) => {
      const messageId = generateId();
      narration.stop();

      if (audioBase64) {
        addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "user" as const,
          content,
          agentId,
          timestamp: new Date().toISOString(),
          audio: { base64: audioBase64, mimeType: "audio/webm" },
        });
      } else {
        addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "user" as const,
          content,
          agentId,
          timestamp: new Date().toISOString(),
        });
      }

      useChatStore.getState().setLoading(true);
      resetStreamingRef();

      if (isConnected) {
        if (audioBase64) {
          send({ type: "audio", audio: audioBase64, sessionId, timestamp: new Date().toISOString() });
        } else {
          send({ type: "message", content, sessionId, timestamp: new Date().toISOString() });
        }
      } else {
        addMessage({
          id: generateId(),
          conversationId: sessionId,
          type: "error" as const,
          content: "No se pudo conectar al agente. Verifica que el gateway este funcionando.",
          timestamp: new Date().toISOString(),
        });
        useChatStore.getState().setLoading(false);
      }
    },
    [isConnected, sessionId, agentId, addMessage, send, narration, resetStreamingRef]
  );

  const handleNarrateMessage = useCallback(
    (text: string) => {
      if (narration.isSpeaking) {
        narration.stop();
      } else {
        narration.narrate(text);
      }
    },
    [narration]
  );

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* ── Minimal Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0 border-b border-white/5 bg-zinc-950/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="h-8 w-8 rounded-lg bg-zinc-900 border border-cyan-500/20 flex items-center justify-center">
              <Bot className="h-4 w-4 text-cyan-400" />
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-zinc-950 ${
                isConnected ? "bg-emerald-500" : isConnecting ? "bg-yellow-500 animate-pulse" : "bg-zinc-600"
              }`}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-200">{agentName}</span>
            <span
              className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                isConnected
                  ? "text-emerald-400 bg-emerald-500/10"
                  : isConnecting
                    ? "text-yellow-400 bg-yellow-500/10 animate-pulse"
                    : "text-zinc-500 bg-zinc-800"
              }`}
            >
              {isConnected ? "en linea" : isConnecting ? "conectando" : "desconectado"}
            </span>
          </div>
        </div>

        <button
          onClick={narration.toggle}
          className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
            narration.isEnabled
              ? "bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 border border-cyan-500/30"
              : "bg-zinc-900 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 border border-white/5"
          }`}
          title={narration.isEnabled ? "Desactivar narracion" : "Activar narracion"}
        >
          {narration.isEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </div>

      {/* ── Connection Warning ────────────────────────────────────────── */}
      {connectionWarning && !isConnected && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300 flex-1">{connectionWarning}</span>
          <button
            onClick={() => {
              const { connect } = useWebSocketStore.getState();
              if (currentUser?.id) connect(currentUser.id);
            }}
            className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Reintentar
          </button>
        </div>
      )}

      {/* ── Narration Active Indicator ─────────────────────────────────── */}
      {narration.isSpeaking && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-cyan-500/10 border-b border-cyan-500/20 shrink-0">
          <div className="flex gap-0.5">
            <span className="h-2 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="h-2 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="h-2 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[10px] text-cyan-400 font-medium">Narrando{narration.currentText ? `: ${narration.currentText}...` : "..."}</span>
          <button onClick={narration.stop} className="text-[10px] text-cyan-500 hover:text-cyan-300 ml-auto">
            Detener
          </button>
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <ChatHistory
          messages={messages}
          isLoading={isLoading}
          currentSteps={currentSteps}
          streamingMessageId={streamingMessageId}
          userName={currentUser?.name ?? "Usuario"}
          agentName={agentName}
          onSuggestionClick={handleSendMessage}
          onNarrateMessage={narration.isEnabled ? handleNarrateMessage : undefined}
        />
      </div>

      {/* ── Input ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-zinc-950">
        <ChatInput
          onSendMessage={handleSendMessage}
          disabled={!isConnected && !isConnecting}
          isStreaming={isLoading}
        />
      </div>
    </div>
  );
}