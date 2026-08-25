/**
 * realtime-providers — sesiones de voz full-duplex (speech-to-speech).
 *
 * `LLMProvider` (../llm-providers/interface.ts) es one-shot: `call()` recibe un
 * historial y devuelve una respuesta. Una sesión Live no encaja ahí — es un
 * socket que vive minutos, recibe audio continuo y emite audio continuo. De ahí
 * esta interfaz hermana en vez de una subclase.
 *
 * El modelo realtime NO es el cerebro de Hive: sólo oye, habla e interrumpe. El
 * trabajo real lo hace el agent-loop de siempre (Bee → especialistas → tools).
 * Por eso las herramientas que se declaran acá son un puñado fijo de funciones
 * puente (gateway/realtime/bridge-tools.ts) y no el catálogo del agente: la Live
 * API congela las tools en el `setup` y no admite cambiarlas a mitad de sesión.
 */

import type { LLMToolDef } from "../llm-client";

/** Lo que el micrófono debe entregar: PCM16 mono little-endian. */
export const REALTIME_INPUT_SAMPLE_RATE = 16_000;
/** Lo que el modelo devuelve: PCM16 mono. */
export const REALTIME_OUTPUT_SAMPLE_RATE = 24_000;

export interface RealtimeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface RealtimeCallbacks {
  /** Audio del modelo, PCM16 mono a REALTIME_OUTPUT_SAMPLE_RATE. */
  onAudio?: (pcm: Buffer) => void;
  /** Transcripción de lo que dijo el usuario (fragmentos incrementales). */
  onInputTranscript?: (text: string) => void;
  /** Transcripción de lo que dijo el modelo (fragmentos incrementales). */
  onOutputTranscript?: (text: string) => void;
  onToolCall?: (calls: RealtimeToolCall[]) => void;
  /** El modelo canceló tool calls ya emitidas (el usuario cambió de tema). */
  onToolCallCancellation?: (ids: string[]) => void;
  /** Barge-in: el usuario habló encima. Hay que vaciar la cola de reproducción YA. */
  onInterrupted?: () => void;
  onTurnComplete?: () => void;
  /** Consumo acumulado que reporta el proveedor. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void;
  /** Handle para reanudar la sesión tras un corte (válido ~2 h). */
  onResumptionHandle?: (handle: string) => void;
  /** El servidor va a cerrar la conexión; hay que reconectar con el handle. */
  onGoAway?: (timeLeftMs: number) => void;
  onError?: (error: Error) => void;
  onClose?: (reason: string) => void;
}

export interface RealtimeSessionOptions {
  model: string;
  apiKey: string;
  /** Prompt de la sesión de voz (no es el system prompt del agent-loop). */
  systemInstruction: string;
  /** Funciones puente. Congeladas: la Live API no permite cambiarlas después. */
  tools?: LLMToolDef[];
  /** Voz del proveedor (ej. "Kore"). Ver voiceService.getGeminiVoices(). */
  voice?: string;
  /**
   * Idioma con acento regional, en BCP-47 (es-CO, es-MX, en-US…).
   *
   * Los modelos de audio nativo cambian de idioma solos siguiendo al usuario,
   * pero sin esto eligen el acento por su cuenta: un usuario colombiano puede
   * terminar escuchando español rioplatense.
   */
  language?: string;
  /** Silencio en ms que cierra el turno del usuario (VAD automático). */
  silenceDurationMs?: number;
  /**
   * Cuánto cuesta que el modelo dé por empezada una intervención del usuario.
   * `START_SENSITIVITY_LOW` sube el listón: hace falta voz clara para
   * interrumpirle, en vez de cualquier ruido. Es lo que salva las manos libres,
   * donde lo que entra por el micrófono incluye su propia voz rebotando.
   */
  startOfSpeechSensitivity?: "START_SENSITIVITY_LOW" | "START_SENSITIVITY_HIGH";
  /** Handle devuelto por una sesión anterior, para retomar el hilo. */
  resumptionHandle?: string;
  callbacks: RealtimeCallbacks;
}

export interface RealtimeSession {
  readonly model: string;
  /** PCM16 mono a REALTIME_INPUT_SAMPLE_RATE. */
  sendAudio(pcm: ArrayBufferLike): void;
  /**
   * Un fotograma de la cámara, ya codificado (JPEG en base64).
   *
   * Va a baja cadencia a propósito: con vídeo, la Live API recorta la sesión de
   * 15 minutos a unos 2 y cada imagen cuesta cientos de tokens frente a los 25
   * por segundo del audio.
   */
  sendVideoFrame(base64: string, mimeType: string): void;
  /** Inyecta texto en la conversación (narración de la colmena, avisos). */
  sendText(text: string): void;
  sendToolResult(id: string, name: string, result: Record<string, unknown>): void;
  close(): void;
  readonly closed: boolean;
}

export interface RealtimeProvider {
  readonly id: string;
  connect(options: RealtimeSessionOptions): Promise<RealtimeSession>;
}

/** Toolset fijo de una sesión de voz, en el formato canónico de Hive. */
export type RealtimeToolset = LLMToolDef[];
