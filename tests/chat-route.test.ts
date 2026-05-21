import { describe, expect, it } from "bun:test";
import { DEFAULT_CHAT_HISTORY_LIMIT, resolveChatThreadId } from "../packages/core/src/gateway/routes/chat";

describe("chat route thread resolution", () => {
  it("uses a stable user thread when thread_id is omitted", () => {
    expect(resolveChatThreadId("user-1")).toBe("user-1");
  });

  it("preserves an explicit thread_id", () => {
    expect(resolveChatThreadId("user-1", "project-thread")).toBe("project-thread");
  });

  it("falls back to user thread for blank thread_id", () => {
    expect(resolveChatThreadId("user-1", "   ")).toBe("user-1");
  });

  it("defaults chat history to the last 40 messages", () => {
    expect(DEFAULT_CHAT_HISTORY_LIMIT).toBe(40);
  });
});
