// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";
import { ChatHistory } from "./ChatHistory";

vi.mock("./ChatMessage", () => ({
  ChatMessage: ({ message }: { message: Message }) => (
    <article data-testid="chat-message">{message.content}</article>
  ),
}));

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

function message(id: string): Message {
  return {
    id,
    conversationId: "session-1",
    type: id.startsWith("user") ? "user" : "agent",
    content: `Message ${id}`,
    timestamp: "2026-05-20T12:00:00.000Z",
  };
}

function scrollViewport(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector(".overflow-y-auto");
  if (!(viewport instanceof HTMLElement)) {
    throw new Error("Chat scroll viewport was not rendered");
  }
  return viewport;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();

  if (originalScrollHeight) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
  }
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  }
});

describe("ChatHistory", () => {
  it("scrolls to the latest message when opening with existing history", () => {
    const { container } = render(
      <ChatHistory messages={[message("user-1"), message("agent-1"), message("user-2")]} />
    );

    const viewport = scrollViewport(container);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(viewport.scrollTop).toBe(viewport.scrollHeight);
  });

  it("does not force scroll for new messages when the user is reading older history", () => {
    const initialMessages = [message("user-1"), message("agent-1")];
    const { container, rerender } = render(<ChatHistory messages={initialMessages} />);
    const viewport = scrollViewport(container);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    viewport.scrollTop = 0;

    rerender(<ChatHistory messages={[...initialMessages, message("user-2")]} />);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(viewport.scrollTop).toBe(0);
  });
});
