import { useCallback, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import { generateId } from "@/lib/utils";

export function useChatStreaming(agentId: string, sessionId: string) {
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const addStep = useChatStore((s) => s.addStep);
  const clearSteps = useChatStore((s) => s.clearSteps);
  const setStreamingMessageId = useChatStore((s) => s.setStreamingMessageId);
  const streamingMessageIdRef = useRef<string | null>(null);

  const handleStreamingChunk = useCallback(
    (data: any) => {
      const messageId = data.id || streamingMessageIdRef.current || generateId();
      const { messages } = useChatStore.getState();
      const existingMessage = messages.find((m) => m.id === messageId);

      if (data.isChunk && existingMessage) {
        updateMessage(messageId, {
          content: (existingMessage.content || "") + data.content,
          timestamp: data.timestamp || existingMessage.timestamp,
        });
      } else if (data.isChunk && !existingMessage) {
        streamingMessageIdRef.current = messageId;
        setStreamingMessageId(messageId);
        addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "agent" as const,
          content: data.content || "",
          agentId,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      } else if (existingMessage) {
        updateMessage(messageId, {
          content: data.content || existingMessage.content,
          timestamp: data.timestamp || existingMessage.timestamp,
        });
      } else {
        addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "agent" as const,
          content: data.content || data.message || "",
          agentId,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      }

      if (!data.isChunk) {
        streamingMessageIdRef.current = null;
        setStreamingMessageId(null);
        clearSteps();
        setLoading(false);
      }
    },
    [agentId, sessionId, addMessage, updateMessage, setLoading, clearSteps, setStreamingMessageId]
  );

  const handleAudioMessage = useCallback(
    (data: any) => {
      const messageId = data.id || generateId();
      addMessage({
        id: messageId,
        conversationId: sessionId,
        type: "agent" as const,
        content: data.content || "",
        agentId,
        timestamp: data.timestamp || new Date().toISOString(),
        audio: data.audio ? { base64: data.audio, mimeType: data.mimeType } : undefined,
      });
      clearSteps();
      setLoading(false);
    },
    [agentId, sessionId, addMessage, clearSteps, setLoading]
  );

  const handleProgress = useCallback((data: any) => {
    if (data.content) {
      useChatStore.getState().addStep(data.content);
    }
  }, []);

  const handleTyping = useCallback((data: any) => {
    if (data.isTyping === false) {
      useChatStore.getState().clearSteps();
      useChatStore.getState().setLoading(false);
    }
  }, []);

  const resetStreamingRef = useCallback(() => {
    streamingMessageIdRef.current = null;
    setStreamingMessageId(null);
  }, [setStreamingMessageId]);

  return {
    handleStreamingChunk,
    handleAudioMessage,
    handleProgress,
    handleTyping,
    resetStreamingRef,
  };
}