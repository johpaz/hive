import { useCallback, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import { generateId } from "@/lib/utils";
import { getApiBaseUrl } from "@/lib/gateway-url";
import type { Message, MessageProcessItem, MessageProcessKind, MessageProcessStatus } from "@/types";

/** data.image is a relative /api/artifacts/:id/download path from webchat-turn.ts — prefix with the gateway base URL, same pattern as MeetingPanel.tsx's report download link. */
function imageAttachment(data: any): Pick<Message, "image"> | Record<string, never> {
  if (!data.image) return {};
  return { image: { url: `${getApiBaseUrl()}${data.image}`, mimeType: data.imageMimeType } };
}

export function useChatStreaming(agentId: string, sessionId: string) {
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const addStep = useChatStore((s) => s.addStep);
  const clearSteps = useChatStore((s) => s.clearSteps);
  const setStreamingMessageId = useChatStore((s) => s.setStreamingMessageId);
  const streamingMessageIdRef = useRef<string | null>(null);

  const ensureAgentMessage = useCallback(
    (messageId: string, timestamp?: string) => {
      const state = useChatStore.getState();
      const existingMessage = state.messages.find((m) => m.id === messageId);
      if (existingMessage) return existingMessage;

      const message: Message = {
        id: messageId,
        conversationId: sessionId,
        type: "agent" as const,
        content: "",
        agentId,
        timestamp: timestamp || new Date().toISOString(),
      };
      state.addMessage(message);
      return message;
    },
    [agentId, sessionId]
  );

  const upsertProcessItem = useCallback(
    (
      messageId: string,
      item: MessageProcessItem | null,
      status: MessageProcessStatus = "thinking",
      summary?: string,
      timestamp?: string
    ) => {
      const state = useChatStore.getState();
      const existingMessage = state.messages.find((m) => m.id === messageId) || ensureAgentMessage(messageId, timestamp);
      const currentProcess = existingMessage.process || { status: "thinking" as const, items: [] };
      const items = item
        ? (() => {
            const last = currentProcess.items[currentProcess.items.length - 1];
            if (last?.kind === item.kind && last.label === item.label && last.detail === item.detail) {
              return currentProcess.items;
            }
            return [...currentProcess.items, item].slice(-12);
          })()
        : currentProcess.items;

      state.updateMessage(messageId, {
        process: {
          ...currentProcess,
          status,
          items,
          summary: summary ?? currentProcess.summary,
        },
        timestamp: timestamp || existingMessage.timestamp,
      });
    },
    [ensureAgentMessage]
  );

  const handleStreamingChunk = useCallback(
    (data: any) => {
      const isTranscription = data.content?.startsWith("🎙️ Transcripción:");
      if (isTranscription) {
        setLoading(true);
      }
      const messageId = streamingMessageIdRef.current || data.id || generateId();
      const { messages } = useChatStore.getState();
      const existingMessage = messages.find((m) => m.id === messageId);

      if (data.isChunk && existingMessage) {
        streamingMessageIdRef.current = messageId;
        setStreamingMessageId(messageId);
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
          ...(data.audio && { audio: { base64: data.audio, mimeType: data.mimeType } }),
          ...imageAttachment(data),
        });
      } else {
        addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "agent" as const,
          content: data.content || data.message || "",
          agentId,
          timestamp: data.timestamp || new Date().toISOString(),
          ...(data.audio && { audio: { base64: data.audio, mimeType: data.mimeType } }),
          ...imageAttachment(data),
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

  // Reasoning always precedes the final answer's content chunks for a turn, so
  // this doesn't drive loading/cleanup state — handleStreamingChunk's isChunk:false
  // still owns "the whole turn is done".
  const handleReasoningChunk = useCallback(
    (data: any) => {
      if (!data.content) return;
      const messageId = streamingMessageIdRef.current || data.id || generateId();
      const existingMessage = ensureAgentMessage(messageId, data.timestamp);

      streamingMessageIdRef.current = messageId;
      setStreamingMessageId(messageId);
      updateMessage(messageId, {
        reasoning: (existingMessage.reasoning || "") + data.content,
      });
    },
    [ensureAgentMessage, updateMessage, setStreamingMessageId]
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
        audio: data.audio ? { base64: data.audio, mimeType: data.mimeType || "audio/wav" } : undefined,
      });
      clearSteps();
      setLoading(false);
    },
    [agentId, sessionId, addMessage, clearSteps, setLoading]
  );

  const handleProgress = useCallback((data: any) => {
    if (data.content) {
      let messageId = streamingMessageIdRef.current;
      const state = useChatStore.getState();

      if (!messageId) {
        messageId = generateId();
        streamingMessageIdRef.current = messageId;
        state.setStreamingMessageId(messageId);
        state.addMessage({
          id: messageId,
          conversationId: sessionId,
          type: "agent" as const,
          content: "",
          agentId,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      }

      upsertProcessItem(messageId, {
        id: data.id || generateId(),
        kind: "observation",
        label: data.content,
        timestamp: data.timestamp || new Date().toISOString(),
      });
      state.addStep(data.content);
      state.setLoading(true);
    }
  }, [agentId, sessionId, upsertProcessItem]);

  const handleProcess = useCallback((data: any) => {
    const messageId = data.messageId || data.id || streamingMessageIdRef.current || generateId();
    const status = (data.processStatus || data.status || "thinking") as MessageProcessStatus;
    const kind = (data.processKind || data.kind || "analysis") as MessageProcessKind;
    const timestamp = data.timestamp || new Date().toISOString();

    if (status === "thinking") {
      streamingMessageIdRef.current = messageId;
      setStreamingMessageId(messageId);
      setLoading(true);
    }

    const label = data.label || data.content;
    const item = label
      ? {
          id: data.itemId || generateId(),
          kind,
          label,
          detail: data.detail,
          timestamp,
        }
      : null;

    upsertProcessItem(messageId, item, status, data.summary, timestamp);

    if (status === "done" || status === "error") {
      streamingMessageIdRef.current = null;
      setStreamingMessageId(null);
      clearSteps();
      setLoading(false);
    }
  }, [clearSteps, setLoading, setStreamingMessageId, upsertProcessItem]);

  const handleTyping = useCallback((data: any) => {
    if (data.isTyping === true) {
      useChatStore.getState().setLoading(true);
    } else if (data.isTyping === false) {
      streamingMessageIdRef.current = null;
      useChatStore.getState().setStreamingMessageId(null);
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
    handleReasoningChunk,
    handleAudioMessage,
    handleProgress,
    handleProcess,
    handleTyping,
    resetStreamingRef,
  };
}
