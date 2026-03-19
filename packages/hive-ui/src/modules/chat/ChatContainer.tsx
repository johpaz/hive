import { useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useUserStore } from "@/stores/userStore";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { ChatHistory } from "./ChatHistory";
import { ChatInput } from "./ChatInput";
import { apiClient } from "@/lib/api";
import { generateId } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface ChatContainerProps {
  agentId?: string;
  sessionId?: string;
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function ChatContainer({ agentId = "agent_id", sessionId = "user_id" }: ChatContainerProps) {
  const { messages, addMessage, setMessages, isLoading, setLoading, currentSteps, addStep, clearSteps } = useChatStore();
  const { status, send, subscribe } = useWebSocket();
  const { currentUser, fetchUser } = useUserStore();
  const agents = useGlobalConfigStore(s => s.agents);
  const fetchAgents = useGlobalConfigStore(s => s.fetchAgents);

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  const coordinator = agents.find(a => a.role === 'coordinator' && a.enabled);
  const agentName = coordinator?.name ?? "Coordinador";
  const userName = currentUser?.name ?? "Usuario";

  // Load user and agents if needed
  useEffect(() => {
    if (!currentUser) fetchUser();
    if (agents.length === 0) fetchAgents();
  }, []);

  // Load history
  useEffect(() => {
    if (!sessionId) return;
    const fetchHistory = async () => {
      try {
        const response = await apiClient<{ messages: any[] }>(`/api/chat/history?sessionId=${sessionId}`);
        if (response.messages) {
          const formattedMessages = response.messages.map((m: any) => ({
            id: m.id,
            conversationId: m.session_id,
            type: (m.role === "user" ? "user" : "agent") as any,
            content: m.content,
            agentId: agentId,
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

  // Subscribe to messages/responses/steps
  useEffect(() => {
    const handleMessage = (data: any) => {
      const messageId = data.id || "agent-streaming-id";
      const { messages, addMessage, updateMessage, setLoading, clearSteps } = useChatStore.getState();
      const existingMessage = messages.find(m => m.id === messageId);

      // Handle streaming chunks
      if (data.isChunk && existingMessage) {
        // Append chunk to existing message
        updateMessage(messageId, {
          content: (existingMessage.content || "") + data.content,
          timestamp: data.timestamp || existingMessage.timestamp,
        });
      } else if (data.isChunk && !existingMessage) {
        // First chunk - create new message
        addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "agent" as const,
          content: data.content || "",
          agentId: agentId,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      } else if (existingMessage) {
        // Replace content (non-chunk update)
        updateMessage(messageId, {
          content: data.content || existingMessage.content,
          timestamp: data.timestamp || existingMessage.timestamp,
        });
      } else {
        // New message (non-streaming)
        addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "agent" as const,
          content: data.content || data.message || JSON.stringify(data),
          agentId: agentId,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      }

      // Finalize when not a chunk
      if (!data.isChunk) {
        clearSteps();
        setLoading(false);
      }
    };

    const handleAudioMessage = (data: any) => {
      const messageId = data.id || generateId();
      const { addMessage, setLoading, clearSteps } = useChatStore.getState();

      addMessage({
        id: messageId,
        conversationId: sessionId,
        type: "agent" as const,
        content: data.content || "",
        agentId: agentId,
        timestamp: data.timestamp || new Date().toISOString(),
        audio: data.audio ? { base64: data.audio, mimeType: data.mimeType } : undefined,
      });

      clearSteps();
      setLoading(false);
    };

    const handleProgress = (data: any) => {
      if (data.content) {
        useChatStore.getState().addStep(data.content);
      }
    };

    const handleTyping = (data: any) => {
      const { setLoading, clearSteps } = useChatStore.getState();
      if (data.isTyping === false) {
        clearSteps();
        setLoading(false);
      }
    };

    const unsubMsg = subscribe("message", handleMessage);
    const unsubResp = subscribe("response", handleMessage);
    const unsubAudio = subscribe("audio", handleAudioMessage);
    const unsubProgress = subscribe("progress", handleProgress);
    const unsubTyping = subscribe("typing", handleTyping);
    return () => { unsubMsg(); unsubResp(); unsubAudio(); unsubProgress(); unsubTyping(); };
  }, [subscribe, sessionId, agentId, addMessage, setLoading]);

  const handleSendMessage = (content: string, audioBase64?: string) => {
    const messageId = generateId();
    
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
    
    setLoading(true);

    if (isConnected) {
      if (audioBase64) {
        send({ type: "audio", audio: audioBase64, sessionId, timestamp: new Date().toISOString() });
      } else {
        send({ type: "message", content, sessionId, timestamp: new Date().toISOString() });
      }
    } else {
      setTimeout(() => {
        if (isLoading) {
          setLoading(false);
          addMessage({
            id: generateId(),
            conversationId: sessionId,
            type: "error" as const,
            content: "No se pudo conectar al agente. Verifica que el gateway esté funcionando.",
            timestamp: new Date().toISOString(),
          });
        }
      }, 3000);
    }
  };

  return (
    <div className="flex h-full flex-col min-h-0">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3 shrink-0 bg-zinc-950/80 backdrop-blur-sm z-10">

        {/* Agent info */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="h-9 w-9 rounded-xl bg-zinc-900 border border-cyan-500/20 flex items-center justify-center shadow">
              <Bot className="h-4.5 w-4.5 text-cyan-400" />
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 ${
              isConnected ? "bg-emerald-500" : isConnecting ? "bg-yellow-500 animate-pulse" : "bg-zinc-600"
            }`} />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">{agentName}</p>
            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Coordinador</p>
          </div>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ml-1 ${
            isConnected
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : isConnecting
                ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
                : "bg-zinc-800 border-zinc-700 text-zinc-500"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? "bg-emerald-500 animate-pulse" : isConnecting ? "bg-yellow-500 animate-pulse" : "bg-zinc-600"
            }`} />
            {isConnected ? "En línea" : isConnecting ? "Conectando" : "Desconectado"}
          </div>
        </div>

        {/* User info */}
        <div className="flex items-center gap-2.5">
          <div className="text-right">
            <p className="text-sm font-semibold text-zinc-200 leading-tight">{userName}</p>
            <p className="text-[10px] text-zinc-600 font-mono">Usuario</p>
          </div>
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[12px] font-bold text-white shadow ring-2 ring-zinc-950">
            {currentUser?.name ? getInitials(currentUser.name) : <User className="h-4 w-4" />}
          </div>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-zinc-950/30">
        <ChatHistory
          messages={messages}
          isLoading={isLoading}
          currentSteps={currentSteps}
          userName={userName}
          agentName={agentName}
        />
      </div>

      {/* ── Input ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/5 bg-zinc-950/80 backdrop-blur-sm">
        <ChatInput
          onSendMessage={handleSendMessage}
          disabled={!isConnected && !isConnecting}
        />
      </div>

    </div>
  );
}
