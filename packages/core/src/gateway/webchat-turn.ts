/**
 * webchat-turn — rehydratable chat turn execution for the durable queue.
 *
 * The turn logic that used to live inside the server's LaneQueue closures is
 * parameterized here so the same code runs on two paths:
 * - Live: the WS handler enqueues with a `sendRaw` callback bound to the
 *   socket → streaming, process reporter and TTS behave exactly as before.
 * - Rehydrated: after a crash the durable queue re-executes the job from its
 *   serialized payload with no callbacks → the turn runs headless and the
 *   final response is delivered through the user's channel.
 *
 * Server-scope dependencies (runner, active provider/model) are injected at
 * boot via initWebchatTurnRunner().
 */

import { logger } from "../utils/logger";
import { resolveContext } from "./resolver";
import { voiceService } from "../voice/index";
import { multimodalService } from "../multimodal/index";
import { sendToUserChannel } from "./channel-notify";
import { getNarration } from "./helpers";
import { createRun, getRun } from "../agent/run-store";
import { getDurableQueue } from "./durable-queue";
import type { JobDoc } from "../storage/collections";

const log = logger.child("webchat-turn");

export interface WebchatTurnPayload {
  /** "task_complete": synthetic system-authored turn delivering an async-delegated task's outcome (see delegation-notify.ts). Not literal user speech. */
  source: "message" | "audio" | "a2ui" | "canvas" | "api" | "task_complete";
  /** webchat channelUserId for WS sources; canonical threadId for "api". */
  sessionId: string;
  /** User text / audio transcript / interaction description. */
  content: string;
  /** Clean text without the timestamp prefix (search selectors); api source. */
  rawContent?: string;
  image?: { base64: string; mimeType?: string; caption?: string } | null;
  document?: { base64: string; mimeType?: string; fileName?: string } | null;
  /** Reply with TTS audio when possible (audio source). */
  preferAudio?: boolean;
  /** api source: pre-resolved context. */
  userId?: string;
  agentId?: string;
  channel?: string;
  /** Linked AgentRun (checkpoint/resume). Set by enqueueChatTurn. */
  runId?: string;
}

export interface WebchatTurnLive {
  /** Sends an already-serialized OutboundMessage frame to the live socket. */
  sendRaw?: (payload: string) => void;
}

export interface WebchatTurnDeps {
  runner: { generate: (opts: Record<string, unknown>) => Promise<{ content?: string }> };
  getProvider: () => string;
  getModel: () => string;
}

let deps: WebchatTurnDeps | null = null;

export function initWebchatTurnRunner(d: WebchatTurnDeps): void {
  deps = d;
  log.info("[initWebchatTurnRunner] Webchat turn runner registered");
}

// ─── Process reporter (moved from server.ts) ────────────────────────────────

type ProcessKind = "analysis" | "tool" | "observation" | "writing";
type ProcessStatus = "thinking" | "done" | "error";

function createProcessReporter(sendRaw: (payload: string) => void, sessionId: string, messageId: string) {
  const sent = new Set<string>();

  const send = (event: {
    kind?: ProcessKind;
    label?: string;
    detail?: string;
    status?: ProcessStatus;
    summary?: string;
  }) => {
    sendRaw(JSON.stringify({
      type: "process",
      sessionId,
      id: messageId,
      messageId,
      processKind: event.kind,
      processStatus: event.status,
      label: event.label,
      detail: event.detail,
      summary: event.summary,
      timestamp: new Date().toISOString(),
    }));
  };

  const sendOnce = (key: string, event: Parameters<typeof send>[0]) => {
    if (sent.has(key)) return;
    sent.add(key);
    send(event);
  };

  return {
    start(label = "Revisando tu solicitud") {
      sendOnce("start", { kind: "analysis", label, status: "thinking" });
    },
    writing() {
      sendOnce("writing", { kind: "writing", label: "Preparando la respuesta", status: "thinking" });
    },
    step(step: { type: string; message?: string; toolName?: string }) {
      if (step.type === "tool_call" && step.toolName) {
        sendOnce(`tool:${step.toolName}`, {
          kind: "tool",
          label: getNarration(step.toolName),
          status: "thinking",
        });
        return;
      }

      if (step.type === "tool_result") {
        sendOnce(`tool_result:${sent.size}`, {
          kind: "observation",
          label: "Revisando la informacion obtenida",
          status: "thinking",
        });
        return;
      }

      if (step.type === "text") {
        sendOnce("analysis:text", {
          kind: "analysis",
          label: "Organizando la informacion",
          status: "thinking",
        });
      }
    },
    done(summary = "Proceso completado") {
      send({ status: "done", summary });
    },
    error(summary = "No se pudo completar el proceso") {
      send({ status: "error", summary });
    },
  };
}

// ─── Turn execution ──────────────────────────────────────────────────────────

export async function runWebchatTurn(
  payload: WebchatTurnPayload,
  live: WebchatTurnLive | null,
  signal: AbortSignal,
): Promise<string> {
  if (!deps) throw new Error("webchat-turn runner not initialized (gateway boot pending)");
  const d = deps;
  const sessionId = payload.sessionId;
  const hasLive = !!live?.sendRaw;

  const sendRaw = (frame: string) => {
    try { live?.sendRaw?.(frame); } catch { /* socket gone mid-turn */ }
  };
  const send = (obj: unknown) => sendRaw(JSON.stringify(obj));

  if (signal.aborted) {
    send({ type: "typing", isTyping: false, sessionId });
    if (payload.source === "message" || payload.source === "audio") {
      send({ type: "error", sessionId, error: "Task cancelled" });
    }
    return "";
  }

  // ── Context ────────────────────────────────────────────────────────────────
  let userId: string;
  let threadId: string;
  const channel = payload.channel ?? "webchat";
  if (payload.source === "api") {
    userId = payload.userId ?? "default";
    threadId = payload.sessionId;
  } else {
    const ctx = await resolveContext({ channel: "webchat", channelUserId: sessionId });
    userId = ctx.userId;
    threadId = ctx.threadId;
  }

  // A re-claimed job resumes from its checkpoint when one exists; the payload
  // can't know this (it was serialized before the crash).
  let resume = false;
  if (payload.runId) {
    const run = await getRun(payload.runId).catch(() => null);
    resume = !!run?.state_json;
    if (resume) log.info(`[runWebchatTurn] Resuming run ${payload.runId} from checkpoint`);
  }

  const messageId = crypto.randomUUID();
  const withReporter = payload.source === "message" || payload.source === "audio";
  const processReporter = withReporter && hasLive
    ? createProcessReporter(sendRaw, sessionId, messageId)
    : null;

  try {
    processReporter?.start(
      payload.source === "audio"
        ? "Revisando la transcripcion"
        : payload.image || payload.document
          ? "Revisando tu solicitud y adjuntos"
          : "Revisando tu solicitud"
    );

    // ── Multimodal: process image/document if present ────────────────────────
    let finalMessageContent = payload.content;
    let contentParts: any[] | undefined = undefined;

    if (payload.image || payload.document) {
      const visionConfig = await multimodalService.getChannelVisionConfig("webchat");
      log.info(`🖼️ Multimodal content detected from WebChat session ${threadId}`);
      processReporter?.step({ type: "tool_result" });

      if (payload.image) {
        try {
          const imageInput = {
            type: "base64" as const,
            data: payload.image.base64,
            mimeType: payload.image.mimeType || "image/jpeg",
            caption: payload.image.caption,
          };

          const activeModelId = d.getModel();
          const activeProviderId = d.getProvider();
          const modelHasVision = activeModelId && activeProviderId
            ? await multimodalService.modelSupportsVision(activeProviderId, activeModelId)
            : false;

          if (visionConfig.visionEnabled && modelHasVision) {
            contentParts = await multimodalService.processImage(imageInput, visionConfig.visionModelId || undefined);
            log.info(`🖼️ Image sent as vision ContentParts (model supports vision)`);
          } else {
            const ocrProvider = visionConfig.ocrProvider || (["openai", "gemini", "anthropic"].includes(d.getProvider()) ? d.getProvider() : "openai");
            log.info(`🖼️ Model lacks vision or vision disabled, using OCR via ${ocrProvider}...`);
            const ocrText = await multimodalService.ocrImage(imageInput, ocrProvider);
            finalMessageContent = ocrText
              ? `[Imagen adjunta — contenido extraído por OCR]\n${ocrText}\n\n${finalMessageContent || ""}`
              : finalMessageContent || "";
            log.info(`🖼️ OCR result: ${ocrText.substring(0, 100)}...`);
          }
        } catch (imgError) {
          log.error(`❌ Image processing failed: ${(imgError as Error).message}`);
        }
      }

      if (payload.document) {
        try {
          const ocrProvider = visionConfig.ocrProvider || (["openai", "gemini", "anthropic"].includes(d.getProvider()) ? d.getProvider() : "openai");
          log.info(`📄 Document detected from WebChat, extracting text via OCR (${ocrProvider})...`);
          const docImage = {
            type: "base64" as const,
            data: payload.document.base64,
            mimeType: payload.document.mimeType || "application/pdf",
            caption: payload.document.fileName,
          };
          const ocrText = await multimodalService.ocrImage(docImage, ocrProvider);
          finalMessageContent = ocrText
            ? `[Documento adjunto]\n${ocrText}\n\n${finalMessageContent || ""}`
            : finalMessageContent || "";
          log.info(`📄 Document OCR result: ${ocrText.substring(0, 100)}...`);
        } catch (docError) {
          log.error(`❌ Document processing failed: ${(docError as Error).message}`);
        }
      }
    }

    const messages: any[] = contentParts
      ? [{ role: "user" as const, content: contentParts }]
      : [{ role: "user" as const, content: finalMessageContent }];

    log.info(`Generating response for session ${threadId} (source=${payload.source}, multimodal: ${!!(payload.image || payload.document)})...`);

    // ── Generate with streaming ──────────────────────────────────────────────
    let streamedContent = "";
    let reportedWriting = false;

    const generateOpts: Record<string, unknown> = {
      provider: d.getProvider(),
      messages,
      maxTokens: 4096,
      maxSteps: 15,
      threadId,
      userId,
      signal,
      runId: payload.runId,
      resume,
      durable: !!payload.runId,
      onToken: async (token: string) => {
        if (signal.aborted) return;
        if (!reportedWriting && token.trim()) {
          reportedWriting = true;
          processReporter?.writing();
        }
        streamedContent += token;
        send({
          type: "message",
          id: messageId,
          sessionId,
          content: token,
          isChunk: true,
          isStep: false,
        });
      },
      onReasoningToken: async (token: string) => {
        if (signal.aborted) return;
        send({
          type: "reasoning",
          id: messageId,
          sessionId,
          content: token,
          isChunk: true,
        });
      },
      onStep: async (step: { type: string; message?: string; toolName?: string }) => {
        if (signal.aborted) return;
        processReporter?.step(step);

        // "tool_result" = resultado de herramienta → solo si pide enviarse al usuario
        if (step.type === "tool_result" && step.message) {
          try {
            const result = JSON.parse(step.message);
            if (result._sendToUser || result.status) {
              const userMessage = result.message || result.status || "";
              if (userMessage) {
                send({ type: "progress", sessionId, content: userMessage });
              }
              return;
            }
          } catch { }
        }
      },
    };

    if (payload.source === "api") {
      generateOpts.agentId = payload.agentId;
      generateOpts.channel = channel;
      generateOpts.rawUserMessage = payload.rawContent ?? payload.content;
    }

    const response = await d.runner.generate(generateOpts);

    // Use streamed content from onToken, fallback to response.content
    const content = streamedContent || response.content?.trim() || "";
    log.info(`Response ready for session ${threadId} (${content.length} chars)`);

    send({ type: "typing", isTyping: false, sessionId });

    // ── Delivery ─────────────────────────────────────────────────────────────
    if (hasLive) {
      const alreadyStreamed = streamedContent.length > 0;
      const shouldSpeak = !!payload.preferAudio;
      const voiceConfig = shouldSpeak ? await voiceService.getChannelVoiceConfig("webchat") : null;

      if (content && !alreadyStreamed) {
        if (shouldSpeak) {
          if (!voiceConfig?.ttsProvider) {
            send({
              type: "message",
              id: messageId,
              sessionId,
              content: `${content}\n\n🔊 Para recibir respuestas en audio, configura el proveedor TTS en Configuración > Canales > WebChat (ej: elevenlabs)`,
              isStep: false,
            });
          } else {
            try {
              log.info(`🔊 TTS enabled, synthesizing audio for WebChat...`);
              const audioOutput = await voiceService.speak(content, voiceConfig.ttsProvider, voiceConfig.ttsVoiceId || undefined);
              const base64Audio = (audioOutput.data as Buffer).toString("base64");
              send({
                type: "message",
                id: messageId,
                sessionId,
                content,
                audio: base64Audio,
                mimeType: audioOutput.mimeType,
                isStep: false,
              });
            } catch (ttsError) {
              log.error(`TTS failed: ${(ttsError as Error).message}, sending text instead`);
              send({ type: "message", id: messageId, sessionId, content, isStep: false });
            }
          }
        } else {
          send({ type: "message", id: messageId, sessionId, content, isStep: false });
        }
      } else if (alreadyStreamed && shouldSpeak && voiceConfig?.ttsProvider) {
        try {
          log.info(`🔊 TTS enabled, synthesizing audio after streaming...`);
          const audioOutput = await voiceService.speak(content, voiceConfig.ttsProvider, voiceConfig.ttsVoiceId || undefined);
          const base64Audio = (audioOutput.data as Buffer).toString("base64");
          log.info(`Audio generated after streaming: ${base64Audio.length} bytes`);
          send({
            type: "message",
            id: messageId,
            sessionId,
            content,
            audio: base64Audio,
            mimeType: audioOutput.mimeType,
            isStep: false,
          });
        } catch (ttsError) {
          log.error(`TTS after streaming failed: ${(ttsError as Error).message}, skipping audio`);
        }
      }
    } else if (content && payload.source !== "api") {
      // Rehydrated turn (crash recovery): nobody streamed this response, so
      // deliver the final content through the user's channel.
      await sendToUserChannel(channel, userId, content).catch((err) =>
        log.warn(`[runWebchatTurn] Failed to deliver crash-recovered response: ${(err as Error).message}`)
      );
    }

    processReporter?.done("Listo");
    return content;
  } catch (error) {
    processReporter?.error("No se pudo completar la respuesta");
    // Detener typing aunque falle — nunca dejar el spinner infinito
    send({ type: "typing", isTyping: false, sessionId });
    send({ type: "error", sessionId, error: (error as Error).message });
    log.error(`Error for session ${sessionId}: ${(error as Error).message}`);
    throw error;
  }
}

// ─── Enqueue helper ──────────────────────────────────────────────────────────

/**
 * Create the linked AgentRun and enqueue a durable chat_turn job. The lane
 * serializes turns per session exactly like the old in-memory LaneQueue.
 */
export async function enqueueChatTurn(input: {
  lane: string;
  payload: WebchatTurnPayload;
  live?: WebchatTurnLive;
}): Promise<JobDoc> {
  const run = await createRun({
    thread_id: input.payload.source === "api" ? input.payload.sessionId : `webchat:${input.payload.sessionId}`,
    agent_id: input.payload.agentId ?? "",
    user_id: input.payload.userId ?? "",
    channel: input.payload.channel ?? "webchat",
    kind: "chat",
    max_iterations: 15,
  });
  input.payload.runId = run.id;

  return getDurableQueue().enqueue({
    lane: input.lane,
    type: "chat_turn",
    run_id: run.id,
    payload: input.payload as unknown as Record<string, unknown>,
    callbacks: input.live?.sendRaw ? { sendRaw: input.live.sendRaw } : undefined,
  });
}
