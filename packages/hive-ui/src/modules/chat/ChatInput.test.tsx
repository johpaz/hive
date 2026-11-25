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

/**
 * Adjuntar solo funcionaba con el botón del clip: pegar una captura o arrastrar un
 * archivo al input no hacía nada.
 */
describe("ChatInput — pegar y arrastrar archivos", () => {
  const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;
  const png = (name = "image.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
  const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "informe.pdf", { type: "application/pdf" });

  const clipboard = (files: File[], text = "") => ({
    files,
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    getData: (type: string) => (type === "text/plain" ? text : ""),
    types: [...(files.length ? ["Files"] : []), ...(text ? ["text/plain"] : [])],
  });
  const dragData = (files: File[], types = ["Files"]) => ({ types, files, dropEffect: "none" });

  async function send(onSendMessage: ReturnType<typeof vi.fn>) {
    fireEvent.keyDown(textarea(), { key: "Enter" });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
    return onSendMessage.mock.calls[0];
  }

  it("pegar una captura la adjunta con un nombre legible", async () => {
    const onSendMessage = vi.fn();
    render(<ChatInput onSendMessage={onSendMessage} />);

    const prevented = !fireEvent.paste(textarea(), { clipboardData: clipboard([png()]) });
    expect(prevented).toBe(true);

    await waitFor(() => expect(screen.getByAltText("preview")).toBeTruthy());
    const [, options] = await send(onSendMessage);
    expect(options.attachments).toHaveLength(1);
    expect(options.attachments[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(options.attachments[0].fileName).toMatch(/^captura-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
    expect(options.attachments[0].base64.length).toBeGreaterThan(0);
  });

  it("pegar un archivo copiado conserva su nombre y lo trata como documento", async () => {
    const onSendMessage = vi.fn();
    render(<ChatInput onSendMessage={onSendMessage} />);

    fireEvent.paste(textarea(), { clipboardData: clipboard([pdf()]) });

    await waitFor(() => expect(screen.getByText("informe.pdf")).toBeTruthy());
    const [, options] = await send(onSendMessage);
    expect(options.attachments[0]).toMatchObject({ type: "document", mimeType: "application/pdf", fileName: "informe.pdf" });
  });

  it("si el portapapeles trae texto y una imagen (Excel, Word), gana el texto", () => {
    render(<ChatInput onSendMessage={vi.fn()} />);

    const prevented = !fireEvent.paste(textarea(), { clipboardData: clipboard([png()], "celda A1") });

    expect(prevented).toBe(false); // el navegador pega el texto como siempre
    expect(screen.queryByAltText("preview")).toBeNull();
  });

  it("pegar solo texto no se toca", () => {
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(!fireEvent.paste(textarea(), { clipboardData: clipboard([], "hola") })).toBe(false);
  });

  it("arrastrar un archivo resalta la zona y al soltarlo lo adjunta", async () => {
    const onSendMessage = vi.fn();
    const { container } = render(<ChatInput onSendMessage={onSendMessage} />);
    const zona = container.firstElementChild as HTMLElement;

    fireEvent.dragEnter(zona, { dataTransfer: dragData([pdf()]) });
    expect(screen.getByText("Suelta para adjuntar")).toBeTruthy();

    fireEvent.drop(zona, { dataTransfer: dragData([pdf()]) });
    expect(screen.queryByText("Suelta para adjuntar")).toBeNull();
    await waitFor(() => expect(screen.getByText("informe.pdf")).toBeTruthy());
    const [, options] = await send(onSendMessage);
    expect(options.attachments[0].fileName).toBe("informe.pdf");
  });

  it("dragover con archivos permite soltar (preventDefault), el texto arrastrado no", () => {
    const { container } = render(<ChatInput onSendMessage={vi.fn()} />);
    const zona = container.firstElementChild as HTMLElement;

    expect(!fireEvent.dragOver(zona, { dataTransfer: dragData([pdf()]) })).toBe(true);
    expect(!fireEvent.dragOver(zona, { dataTransfer: dragData([], ["text/plain"]) })).toBe(false);
  });

  it("el resalte se apaga al salir aunque se pase por elementos hijos", () => {
    const { container } = render(<ChatInput onSendMessage={vi.fn()} />);
    const zona = container.firstElementChild as HTMLElement;
    const hijo = textarea();

    fireEvent.dragEnter(zona, { dataTransfer: dragData([pdf()]) });
    fireEvent.dragEnter(hijo, { dataTransfer: dragData([pdf()]) }); // burbujea: profundidad 2
    fireEvent.dragLeave(hijo, { dataTransfer: dragData([pdf()]) });
    expect(screen.getByText("Suelta para adjuntar")).toBeTruthy(); // sigue dentro
    fireEvent.dragLeave(zona, { dataTransfer: dragData([pdf()]) });
    expect(screen.queryByText("Suelta para adjuntar")).toBeNull();
  });

  it("no adjunta nada si el chat está deshabilitado", () => {
    const { container } = render(<ChatInput onSendMessage={vi.fn()} disabled />);

    fireEvent.drop(container.firstElementChild as HTMLElement, { dataTransfer: dragData([pdf()]) });
    fireEvent.paste(textarea(), { clipboardData: clipboard([png()]) });

    expect(screen.queryByText("informe.pdf")).toBeNull();
    expect(screen.queryByAltText("preview")).toBeNull();
  });

  it("un archivo por encima del tope se rechaza con un aviso", async () => {
    render(<ChatInput onSendMessage={vi.fn()} />);
    const enorme = pdf();
    Object.defineProperty(enorme, "size", { value: 60 * 1024 * 1024 });

    fireEvent.paste(textarea(), { clipboardData: clipboard([enorme]) });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("el máximo es 50 MB"));
    expect(screen.queryByText("informe.pdf")).toBeNull();
  });
});
