import { useEffect, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useWebSocketStore } from "@/stores/useWebSocketStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useUserStore } from "@/stores/userStore";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { useChatStreaming } from "@/hooks/useChatStreaming";
import { useNarration } from "@/hooks/useNarration";
import { ChatHistory } from "@/modules/chat/ChatHistory";
import { ChatInput, type ChatAttachment } from "@/modules/chat/ChatInput";
import { apiClient } from "@/lib/api";
import { generateId } from "@/lib/utils";
import { Bot, Volume2, VolumeX, AlertCircle, RefreshCw } from "lucide-react";

const WEBCHAT_HISTORY_LIMIT = 40;

export function WebChatPage() {
  const agentId = "main";
  const { messages, addMessage, setMessages, isLoading, currentSteps, streamingMessageId, connectionWarning, setConnectionWarning } = useChatStore();
  const { status, send, subscribe } = useWebSocket();
  const { currentUser, fetchUser } = useUserStore();
  const agents = useGlobalConfigStore((s) => s.agents);
  const fetchAgents = useGlobalConfigStore((s) => s.fetchAgents);
  const sessionId = currentUser?.id || "default";
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
        const response = await apiClient<{ messages: any[] }>(
          `/api/chat/history?sessionId=${sessionId}&limit=${WEBCHAT_HISTORY_LIMIT}`
        );
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
    (content: string, options?: { audio?: string, attachments?: ChatAttachment[] }) => {
      const messageId = generateId();
      narration.stop();

      const audioBase64 = options?.audio;
      const attachments = options?.attachments;

      // Prepare local message for store
      const newMessage: any = {
        id: messageId,
        conversationId: sessionId,
        type: "user" as const,
        content,
        agentId,
        timestamp: new Date().toISOString(),
      };

      if (audioBase64) {
        newMessage.audio = { base64: audioBase64, mimeType: "audio/webm" };
      }

      if (attachments && attachments.length > 0) {
        // For local storage, we can store multiple, but for the gateway we'll pick the first image and first document
        // matching the backend's current single-item structure.
        const firstImage = attachments.find(a => a.type === "image");
        const firstDoc = attachments.find(a => a.type === "document");

        if (firstImage) newMessage.image = { base64: firstImage.base64, mimeType: firstImage.mimeType, caption: firstImage.fileName };
        if (firstDoc) newMessage.document = { base64: firstDoc.base64, mimeType: firstDoc.mimeType, fileName: firstDoc.fileName };
      }

      addMessage(newMessage);

      useChatStore.getState().setLoading(true);
      resetStreamingRef();

      if (isConnected) {
        if (audioBase64) {
          send({ type: "audio", audio: audioBase64, sessionId, timestamp: new Date().toISOString() });
        } else {
          const payload: any = { type: "message", content, sessionId, timestamp: new Date().toISOString() };
          if (attachments && attachments.length > 0) {
            const firstImage = attachments.find(a => a.type === "image");
            const firstDoc = attachments.find(a => a.type === "document");
            if (firstImage) payload.image = { base64: firstImage.base64, mimeType: firstImage.mimeType, caption: firstImage.fileName };
            if (firstDoc) payload.document = { base64: firstDoc.base64, mimeType: firstDoc.mimeType, fileName: firstDoc.fileName };
          }
          send(payload);
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
    <div className="flex-1 flex flex-col w-full min-h-0 bg-transparent overflow-hidden">
      {/* ── Minimal Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 z-10 bg-transparent border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white font-manrope tracking-tight">{agentName}</span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? "bg-emerald-500" : isConnecting ? "bg-amber-500 animate-pulse" : "bg-slate-400"
              }`}
            />
            <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
              {isConnected ? "Conectado" : isConnecting ? "Conectando" : "Desconectado"}
            </span>
          </div>
        </div>

        <button
          onClick={narration.toggle}
          className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${
            narration.isEnabled
              ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
              : "text-white/40 hover:text-white/70 hover:bg-white/5"
          }`}
          title={narration.isEnabled ? "Desactivar narracion" : "Activar narracion"}
        >
          {narration.isEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </div>
      {/* ── Connection Warning ────────────────────────────────────────── */}
      {connectionWarning && !isConnected && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 border-b border-rose-100 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
          <span className="text-xs text-rose-600 flex-1 font-medium">{connectionWarning}</span>
          <button
            onClick={() => {
              const { connect } = useWebSocketStore.getState();
              if (currentUser?.id) connect(currentUser.id);
            }}
            className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-800 transition-colors uppercase tracking-wider"
          >
            <RefreshCw className="h-3 w-3" />
            Reintentar
          </button>
        </div>
      )}

      {/* ── Narration Active Indicator ─────────────────────────────────── */}
      {narration.isSpeaking && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 shrink-0">
          <div className="flex gap-0.5">
            <span className="h-1.5 w-0.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="h-1.5 w-0.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-0.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[10px] text-blue-400 font-medium font-manrope">Narrando{narration.currentText ? `: ${narration.currentText}...` : "..."}</span>
          <button onClick={narration.stop} className="text-[10px] text-blue-500 hover:text-blue-300 ml-auto font-bold uppercase tracking-wider">
            Detener
          </button>
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────── */}
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

      {/* ── Input ─────────────────────────────────────────────────────── */}
      <ChatInput
        onSendMessage={handleSendMessage}
        onStop={() => {
          if (isConnected) send({ type: "stop", sessionId });
        }}
        disabled={!isConnected && !isConnecting}
        isStreaming={isLoading}
      />
    </div>
  );
}
