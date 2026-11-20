// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";
import { ChatHistory } from "./ChatHistory";

vi.mock("./ChatMessage", () => ({
  ChatMessage: ({ message, currentSteps = [] }: { message: Message; currentSteps?: string[] }) => (
    <article data-testid="chat-message">
      {message.content}
      {currentSteps.map((step) => (
        <span key={step}>{step}</span>
      ))}
    </article>
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

    // Un navegador real dispara "scroll" al mover la barra; jsdom no.
    viewport.scrollTop = 0;
    fireEvent.scroll(viewport);

    rerender(<ChatHistory messages={[...initialMessages, message("user-2")]} />);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(viewport.scrollTop).toBe(0);
  });

  it("attaches current steps to the streaming message instead of rendering the fallback at the end", () => {
    const { queryByText, getByText } = render(
      <ChatHistory
        messages={[message("user-1"), { ...message("agent-1"), content: "" }]}
        isLoading
        currentSteps={["Ejecutando search_knowledge..."]}
        streamingMessageId="agent-1"
      />
    );

    expect(getByText("Ejecutando search_knowledge...")).toBeTruthy();
    expect(queryByText("Coordinador")).toBeNull();
  });

  it("vuelve al final cuando el servidor reemplaza el historial local con otro de distinto tamaño", () => {
    const local = [message("user-1"), message("agent-1")];
    const { container, rerender } = render(<ChatHistory messages={local} />);
    const viewport = scrollViewport(container);
    act(() => { vi.runOnlyPendingTimers(); });

    // El historial del servidor trae otra cantidad de mensajes y otro primer id.
    viewport.scrollTop = 0;
    rerender(<ChatHistory messages={[message("agent-0"), message("user-1b"), message("agent-1b"), message("agent-2b")]} />);
    act(() => { vi.runOnlyPendingTimers(); });

    expect(viewport.scrollTop).toBe(viewport.scrollHeight);
  });

  it("acompaña al contenido que crece después de renderizar mientras se está al final", () => {
    let notificar: () => void = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: () => void) { notificar = cb; }
      observe() {}
      disconnect() {}
    });
    const { container } = render(<ChatHistory messages={[message("user-1"), message("agent-1")]} />);
    const viewport = scrollViewport(container);
    act(() => { vi.runOnlyPendingTimers(); });

    viewport.scrollTop = 0; // simula que la altura creció y quedó por encima del final
    act(() => { notificar(); });
    expect(viewport.scrollTop).toBe(viewport.scrollHeight);

    // Si el usuario sube a leer, el crecimiento ya no lo arrastra.
    viewport.scrollTop = 0;
    fireEvent.scroll(viewport);
    act(() => { notificar(); });
    expect(viewport.scrollTop).toBe(0);
    vi.unstubAllGlobals();
  });
});
