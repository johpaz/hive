// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api";
import type { ConnectedChannel } from "@/types";
import { ChannelConfigDialog } from "./ChannelConfigDialog";

vi.mock("@/lib/api", () => ({ apiClient: vi.fn() }));
vi.mock("@/components/ui/select", () => {
  const Contents = ({ children }: { children: ReactNode }) => children;
  return {
    Select: ({ children, value, disabled, onValueChange }: {
      children: ReactNode; value: string; disabled: boolean; onValueChange: (value: string) => void;
    }) => <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>,
    SelectTrigger: Contents,
    SelectValue: ({ placeholder }: { placeholder: string }) => <option value="">{placeholder}</option>,
    SelectContent: Contents,
    SelectGroup: Contents,
    SelectLabel: () => null,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
  };
});
vi.mock("@/stores/useGlobalConfigStore", () => {
  const refresh = vi.fn(async () => {});
  const providers = [
    { id: "kitten", name: "Kitten", active: true, enabled: true },
    { id: "groq", name: "Groq", active: true, enabled: true },
    { id: "gemini", name: "Gemini", active: true, enabled: true },
    { id: "openrouter", name: "OpenRouter", active: true, enabled: true },
    { id: "inactive", active: false, enabled: false },
    { id: "partially-active", active: true, enabled: false },
    { id: "no-key", active: true, enabled: true },
  ];
  const model = (id: string, provider_id: string, model_type: string, active = true) =>
    ({ id, name: id, provider_id, model_type, active, enabled: active });
  const models = [
    model("kitten-mini", "kitten", "tts"),
    model("orpheus", "groq", "tts"),
    model("whisper", "groq", "stt"),
    { ...model("Gemini Flash", "gemini", "llm"), supports_stt: true },
    { ...model("Nemotron Transcribe", "openrouter", "stt"), supports_stt: true },
    { ...model("STT apagado", "gemini", "llm", false), supports_stt: true },
    { ...model("STT de proveedor apagado", "inactive", "stt"), supports_stt: true },
    { ...model("Retired STT", "groq", "stt"), unlisted: true },
    model("disabled", "groq", "tts", false),
    model("inactive-provider-model", "inactive", "tts"),
    model("STT proveedor deshabilitado", "partially-active", "stt"),
    model("TTS proveedor deshabilitado", "partially-active", "tts"),
    model("unconfigured-model", "no-key", "tts"),
    { ...model("Unconfigured STT", "no-key", "stt"), supports_stt: true },
  ];
  const configuredVoiceProviders = { kitten: true, groq: true, gemini: true, openrouter: true, inactive: true, "partially-active": true };
  return {
    useChannels: () => ({ createChannel: refresh, reconnectChannel: refresh, fetchChannels: refresh }),
    useModels: () => ({ models, fetchModels: refresh }),
    useProviders: () => ({ providers, fetchProviders: refresh }),
    useVoice: () => ({ configuredVoiceProviders, fetchConfiguredVoiceProviders: refresh }),
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(apiClient).mockReset();
});

const webchat: ConnectedChannel = {
  id: "webchat", user_id: "user", type: "webchat", status: "connected",
  active: true, enabled: true, voice_enabled: true, tts_enabled: true,
  stt_provider: "whisper", tts_provider: "kitten-mini", tts_voice_id: "lucia",
  vision_enabled: true, ocr_provider: "gemini",
};

const open = (channel: ConnectedChannel) => {
  const onSave = vi.fn(async () => {});
  render(<MemoryRouter><ChannelConfigDialog isOpen channel={channel} onClose={vi.fn()} onSave={onSave} /></MemoryRouter>);
  return onSave;
};

it("muestra modelos disponibles y guarda los cambios de voz sin sobrescribir visión ni selecciones históricas", async () => {
  const onSave = open({ ...webchat, type: "telegram", id: "telegram", tts_provider: "inactive-provider-model" });
  expect(await screen.findByRole("option", { name: "Modelo actual no disponible" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "whisper" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Gemini Flash" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Nemotron Transcribe" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "STT apagado" })).toBeNull();
  expect(screen.queryByRole("option", { name: "STT de proveedor apagado" })).toBeNull();
  expect(screen.queryByRole("option", { name: /proveedor deshabilitado/ })).toBeNull();
  expect(screen.queryByRole("option", { name: "Retired STT" })).toBeNull();
  expect(screen.queryByRole("option", { name: "Unconfigured STT" })).toBeNull();
  expect(screen.getByRole("option", { name: "kitten-mini" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /disabled|inactive-provider-model|unconfigured-model/ })).toBeNull();
  expect(screen.queryByText(/Visión \/ Multimodal|OCR Fallback/)).toBeNull();
  fireEvent.click(screen.getAllByRole("switch")[1]);
  fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith("telegram", { tts_enabled: false }));
});

it("pide voces por modelo, limpia la voz previa e ignora respuestas atrasadas", async () => {
  let finishKitten!: (value: unknown) => void;
  vi.mocked(apiClient).mockImplementation(endpoint =>
    endpoint.includes("kitten-mini")
      ? new Promise(resolve => { finishKitten = resolve; })
      : Promise.resolve({ voices: [{ id: "troy", name: "Troy" }] }));
  const onSave = open(webchat);
  await waitFor(() => expect(apiClient).toHaveBeenCalledWith("/api/voice/kitten/voices?model=kitten-mini", expect.anything()));
  const tts = screen.getAllByRole("combobox")[1];
  await waitFor(() => expect((tts as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(tts, { target: { value: "orpheus" } });
  expect(await screen.findByRole("option", { name: "Troy" })).toBeTruthy();
  await act(async () => finishKitten({ voices: [{ id: "lucia", name: "Lucía" }] }));
  expect(screen.queryByRole("option", { name: "Lucía" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith("webchat", { tts_provider: "orpheus", tts_voice_id: "" }));
});
