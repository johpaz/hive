// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";

/**
 * El botón de micrófono fallaba en silencio: `startRecording` metía todo en un
 * try/catch cuyo único efecto era un `console.error`. En la app de escritorio de
 * Linux `navigator.mediaDevices` ni siquiera existía (WebKitGTK trae la captura
 * de medios apagada), así que el botón parecía roto sin decir por qué.
 */

function micButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>("button:has(.lucide-mic)");
  // lucide-react no siempre emite esa clase en test; se cae al orden del DOM.
  return button ?? document.querySelectorAll("button")[1];
}

beforeEach(() => {
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatInput — micrófono", () => {
  it("avisa en pantalla cuando el motor no expone mediaDevices", async () => {
    const onSendMessage = vi.fn();
    render(<ChatInput onSendMessage={onSendMessage} />);

    fireEvent.click(micButton());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("no permite grabar audio");
    });
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("explica que hace falta HTTPS cuando el contexto no es seguro", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    render(<ChatInput onSendMessage={vi.fn()} />);

    fireEvent.click(micButton());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("HTTPS");
    });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  });

  it("traduce el rechazo de permiso en vez de dejar el botón mudo", async () => {
    const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(denied) },
    });
    // jsdom no trae MediaRecorder y sin él se toma la rama de "motor sin soporte".
    vi.stubGlobal("MediaRecorder", class {
      static isTypeSupported = () => true;
    });
    render(<ChatInput onSendMessage={vi.fn()} />);

    fireEvent.click(micButton());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Permiso de micrófono denegado");
    });
  });
});
