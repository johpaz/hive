// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebChatNotifications } from "./WebChatNotifications";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  toast: vi.fn(),
  notificationHandler: null as ((data: unknown) => void) | null,
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    send: mocks.send,
    subscribe: (_type: string, handler: (data: unknown) => void) => {
      mocks.notificationHandler = handler;
      return () => {};
    },
  }),
}));

vi.mock("@/components/ui/sonner", () => ({ toast: mocks.toast }));

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

describe("WebChatNotifications", () => {
  beforeEach(() => {
    mocks.send.mockClear();
    mocks.toast.mockClear();
    mocks.notificationHandler = null;
    setVisibility("visible");
  });

  it("shows and acknowledges a notification while visible", () => {
    render(<WebChatNotifications />);
    act(() => mocks.notificationHandler?.({
      type: "notification",
      notificationId: "notice-1",
      content: "Trabajo terminado",
    }));

    expect(mocks.toast).toHaveBeenCalledWith("Trabajo terminado", expect.objectContaining({ id: "notice-1" }));
    expect(mocks.send).toHaveBeenCalledWith({
      type: "notification_ack",
      notificationId: "notice-1",
    });
  });

  it("leaves a background notification pending for the next sync", () => {
    setVisibility("hidden");
    render(<WebChatNotifications />);
    act(() => mocks.notificationHandler?.({
      type: "notification",
      notificationId: "notice-2",
      content: "Trabajo terminado",
    }));

    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
