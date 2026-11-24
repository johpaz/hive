// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api";
import { KittenTTSCard } from "./KittenTTSCard";

vi.mock("@/lib/api", () => ({ apiClient: vi.fn() }));
vi.mock("@/stores/useGlobalConfigStore", () => {
  const refresh = vi.fn(async () => {});
  return {
    useLocalTTS: () => ({
      localTTS: { phase: "ready", voices: [{ id: "lucia", name: "Lucía" }, { id: "diego", name: "Diego" }] },
      fetchLocalTTSStatus: refresh,
      startLocalTTS: refresh,
      stopLocalTTS: refresh,
    }),
    useVoice: () => ({ fetchConfiguredVoiceProviders: refresh }),
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(apiClient).mockReset();
  vi.unstubAllGlobals();
});

it("envía el texto de prueba al gateway y libera el WAV al salir de la pestaña", async () => {
  const createObjectURL = vi.fn().mockReturnValue("blob:kitten-sample");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
  const wav = new Blob(["audio"], { type: "audio/wav" });
  vi.mocked(apiClient).mockResolvedValue(wav);

  const view = render(<KittenTTSCard />);
  expect(screen.getByRole("combobox", { name: "Voz" }).textContent).toBe("Lucía");
  fireEvent.change(screen.getByLabelText("Texto de prueba"), { target: { value: " Hola, Hive. " } });
  fireEvent.click(screen.getByRole("button", { name: "Generar muestra" }));

  expect(apiClient).toHaveBeenCalledWith("/api/tts-local/speak", expect.objectContaining({
    method: "POST",
    body: { text: "Hola, Hive.", voice: "lucia" },
    responseType: "blob",
  }));
  expect((await screen.findByLabelText("Muestra de Lucía")).getAttribute("src")).toBe("blob:kitten-sample");
  expect(createObjectURL).toHaveBeenCalledWith(wav);

  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:kitten-sample");
});

it("muestra el error de síntesis y permite reintentar", async () => {
  vi.mocked(apiClient).mockRejectedValue(new Error("API Error: 503 Service Unavailable"));
  render(<KittenTTSCard />);
  const button = screen.getByRole("button", { name: "Generar muestra" }) as HTMLButtonElement;
  fireEvent.click(button);

  expect((await screen.findByRole("alert")).textContent).toContain("No se pudo generar la muestra");
  await waitFor(() => expect(button.disabled).toBe(false));
});
