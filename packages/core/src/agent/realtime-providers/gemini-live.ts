/**
 * Adaptador de la Live API de Gemini (`bidiGenerateContent`).
 *
 * Sobre `ai.live.connect()` de @google/genai. El import es dinámico igual que en
 * ../llm-providers/gemini.ts: el SDK arrastra dependencias de Vertex que no hacen
 * falta con API key, y cargarlo perezosamente evita pagarlas en el arranque.
 *
 * Verificado contra gemini-3.1-flash-live-preview (2026-08): la inyección de
 * texto va por `sendRealtimeInput({text})`; `sendClientContent` quedó restringido
 * al contexto inicial en 3.x, así que no se usa acá.
 */

import { logger } from "../../utils/logger";
import { ensureArrayItems } from "../llm-providers/interface";
import type {
  RealtimeProvider,
  RealtimeSession,
  RealtimeSessionOptions,
  RealtimeToolCall,
} from "./interface";

const log = logger.child("realtime:gemini");

/** Modelos con `bidiGenerateContent`. El id vive en la BD; esto es sólo el fallback. */
export const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

class GeminiLiveSession implements RealtimeSession {
  closed = false;

  constructor(
    readonly model: string,
    private readonly session: any,
    private readonly callbacks: RealtimeSessionOptions["callbacks"],
  ) {}

  sendAudio(pcm: ArrayBufferLike): void {
    if (this.closed) return;
    try {
      this.session.sendRealtimeInput({
        audio: {
          data: Buffer.from(pcm as ArrayBuffer).toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      });
    } catch (error) {
      this.fail(error, "sendAudio");
    }
  }

  sendVideoFrame(base64: string, mimeType: string): void {
    if (this.closed) return;
    try {
      this.session.sendRealtimeInput({ video: { data: base64, mimeType } });
    } catch (error) {
      this.fail(error, "sendVideoFrame");
    }
  }

  sendText(text: string): void {
    if (this.closed || !text.trim()) return;
    try {
      this.session.sendRealtimeInput({ text });
    } catch (error) {
      this.fail(error, "sendText");
    }
  }

  sendToolResult(id: string, name: string, result: Record<string, unknown>): void {
    if (this.closed) return;
    try {
      this.session.sendToolResponse({ functionResponses: [{ id, name, response: result }] });
    } catch (error) {
      this.fail(error, "sendToolResult");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.session.close();
    } catch {
      /* el socket ya estaba cerrado */
    }
  }

  /** Marca la sesión como muerta: seguir escribiendo en un socket roto sólo genera ruido. */
  private fail(error: unknown, op: string): void {
    this.closed = true;
    const err = error instanceof Error ? error : new Error(String(error));
    log.warn(`${op} falló: ${err.message}`);
    this.callbacks.onError?.(err);
  }
}

export class GeminiLiveProvider implements RealtimeProvider {
  readonly id = "gemini";

  async connect(options: RealtimeSessionOptions): Promise<RealtimeSession> {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: options.apiKey });
    const cb = options.callbacks;

    const config: Record<string, unknown> = {
      responseModalities: ["AUDIO"],
      systemInstruction: options.systemInstruction,
      // Necesarias para persistir el hilo y pintarlo en el chat: sin esto sólo
      // llegan bytes de audio y la conversación hablada no deja rastro escrito.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Sin compresión la sesión muere a los 15 min de audio.
      contextWindowCompression: { slidingWindow: {} },
      // Handle para reanudar tras un goAway sin perder el hilo.
      sessionResumption: options.resumptionHandle ? { handle: options.resumptionHandle } : {},
    };

    if (options.voice || options.language) {
      const speechConfig: Record<string, unknown> = {};
      if (options.voice) {
        speechConfig.voiceConfig = { prebuiltVoiceConfig: { voiceName: options.voice } };
      }
      if (options.language) speechConfig.languageCode = options.language;
      config.speechConfig = speechConfig;
    }
    if (options.silenceDurationMs || options.startOfSpeechSensitivity) {
      const deteccion: Record<string, unknown> = {};
      if (options.silenceDurationMs) deteccion.silenceDurationMs = options.silenceDurationMs;
      if (options.startOfSpeechSensitivity) {
        deteccion.startOfSpeechSensitivity = options.startOfSpeechSensitivity;
      }
      config.realtimeInputConfig = { automaticActivityDetection: deteccion };
    }
    if (options.tools?.length) {
      config.tools = [
        {
          functionDeclarations: options.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: ensureArrayItems(t.function.parameters),
          })),
        },
      ];
    }

    let wrapper: GeminiLiveSession | null = null;

    const session = await ai.live.connect({
      model: options.model,
      config: config as any,
      callbacks: {
        onopen: () => log.info(`sesión abierta (${options.model})`),
        onmessage: (msg: any) => {
          try {
            handleMessage(msg, cb);
          } catch (error) {
            cb.onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        },
        onerror: (e: any) => {
          cb.onError?.(new Error(e?.message ?? String(e)));
        },
        onclose: (e: any) => {
          if (wrapper) wrapper.closed = true;
          cb.onClose?.(e?.reason || "");
        },
      },
    });

    wrapper = new GeminiLiveSession(options.model, session, cb);
    return wrapper;
  }
}

function handleMessage(msg: any, cb: RealtimeSessionOptions["callbacks"]): void {
  const content = msg.serverContent;
  if (content) {
    for (const part of content.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data) cb.onAudio?.(Buffer.from(data, "base64"));
    }
    if (content.inputTranscription?.text) cb.onInputTranscript?.(content.inputTranscription.text);
    if (content.outputTranscription?.text) cb.onOutputTranscript?.(content.outputTranscription.text);
    if (content.interrupted) cb.onInterrupted?.();
    if (content.turnComplete) cb.onTurnComplete?.();
  }

  if (msg.toolCall?.functionCalls?.length) {
    const calls: RealtimeToolCall[] = msg.toolCall.functionCalls.map((fc: any) => ({
      id: fc.id ?? "",
      name: fc.name ?? "",
      args: (fc.args ?? {}) as Record<string, unknown>,
    }));
    cb.onToolCall?.(calls);
  }

  if (msg.toolCallCancellation?.ids?.length) {
    cb.onToolCallCancellation?.(msg.toolCallCancellation.ids);
  }

  if (msg.usageMetadata) {
    const u = msg.usageMetadata;
    cb.onUsage?.({
      inputTokens: Number(u.promptTokenCount ?? 0),
      outputTokens: Number(u.responseTokenCount ?? 0),
      totalTokens: Number(u.totalTokenCount ?? 0),
    });
  }

  if (msg.sessionResumptionUpdate?.newHandle) {
    cb.onResumptionHandle?.(msg.sessionResumptionUpdate.newHandle);
  }

  if (msg.goAway) {
    cb.onGoAway?.(parseDuration(msg.goAway.timeLeft));
  }
}

/** `timeLeft` llega como duración protobuf ("9.5s") o como objeto {seconds,nanos}. */
function parseDuration(value: unknown): number {
  if (typeof value === "string") {
    const seconds = parseFloat(value.replace(/s$/, ""));
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
  }
  if (value && typeof value === "object") {
    const v = value as { seconds?: number | string; nanos?: number };
    const seconds = Number(v.seconds ?? 0);
    return Math.round(seconds * 1000 + (v.nanos ?? 0) / 1e6);
  }
  return 0;
}
