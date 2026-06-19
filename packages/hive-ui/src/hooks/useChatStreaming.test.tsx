// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/stores/chatStore";
import { useChatStreaming } from "./useChatStreaming";

function resetChatStore() {
  useChatStore.setState({
    messages: [],
    isLoading: false,
    currentSteps: [],
    streamingMessageId: null,
    connectionWarning: null,
  });
  localStorage.clear();
}

describe("useChatStreaming", () => {
  beforeEach(() => {
    resetChatStore();
  });

  it("keeps process events and streamed content on the same assistant message", () => {
    const { result } = renderHook(() => useChatStreaming("main", "session-1"));

    act(() => {
      result.current.handleProcess({
        type: "process",
        id: "assistant-1",
        messageId: "assistant-1",
        processKind: "analysis",
        processStatus: "thinking",
        label: "Revisando tu solicitud",
        timestamp: "2026-06-10T10:00:00.000Z",
      });
    });

    act(() => {
      result.current.handleStreamingChunk({
        type: "message",
        id: "assistant-1",
        isChunk: true,
        content: "Hola",
        timestamp: "2026-06-10T10:00:01.000Z",
      });
      result.current.handleStreamingChunk({
        type: "message",
        id: "assistant-1",
        isChunk: true,
        content: " mundo",
        timestamp: "2026-06-10T10:00:02.000Z",
      });
    });

    act(() => {
      result.current.handleProcess({
        type: "process",
        id: "assistant-1",
        messageId: "assistant-1",
        processStatus: "done",
        summary: "Listo",
        timestamp: "2026-06-10T10:00:03.000Z",
      });
    });

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Hola mundo");
    expect(state.messages[0].process?.status).toBe("done");
    expect(state.messages[0].process?.summary).toBe("Listo");
    expect(state.messages[0].process?.items[0].label).toBe("Revisando tu solicitud");
    expect(state.streamingMessageId).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});
