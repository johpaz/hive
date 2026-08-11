import type { Config } from "../config/loader";
import { loadConfig, getHiveDir } from "../config/loader";
import { logger, onLogEntry } from "../utils/logger";
import { resolveUISource } from "./helpers/ui-source";
import { sessionManager, parseSessionId } from "./session";
import { enqueueChatTurn, initWebchatTurnRunner } from "./webchat-turn";
import {
  type InboundMessage,
  type OutboundMessage,
  isSlashCommand,
  executeSlashCommand,
} from "./slash-commands";
import { ChannelManager } from "../channels/manager";
import { AgentService } from "../agent/service";
import { AgentRunner } from "../agent/providers/index";
import type { IncomingMessage } from "../channels/base";
import { mkdirSync, rmSync, unlinkSync, watch, existsSync, writeFileSync, readFileSync } from "node:fs";
import * as path from "node:path";
import rootPackage from "../../../../package.json";

// Static JSON import lets Bun inline the release version into npm bundles and
// standalone executables instead of depending on a package.json at runtime.
const _pkgVersion = rootPackage.version;
import { ensureHiveDb } from "../storage/bootstrap";
import { col, fromIndexable, nextId } from "../storage/hive";
import { reconcileOnBoot } from "../storage/reconcile";
import { getBootId } from "../storage/boot-id";
import { stopAllLeaseRenewals, interruptRun, findRunsByStatus } from "../agent/run-store";
import { shutdownToolRuntime } from "../tool-runtime";
import { initDurableQueue, getDurableQueue } from "./durable-queue";
import { initJobExecutors, setJobExecutorMCPManager } from "./job-executors";
import { initDelegationNotify } from "./delegation-notify";
import { findAllPendingJobs, findExpiredLeases, loadJobRetryPolicy } from "./job-store";
import type { UserDoc, AgentDoc } from "../storage/collections";
import { canvasManager } from "../canvas/canvas-manager.ts";
import { subscribeCanvas, unsubscribeCanvas, emitCanvas, getCanvasSnapshot } from "../canvas/emitter";
import { randomUUID } from "crypto";
import { circuitBreakerRegistry } from "../resilience/circuit-breaker.ts";
import { loadMcpHeaders } from "../storage/crypto.ts";
import { resolveContext } from "./resolver";
import { voiceService } from "../voice/index";
import { multimodalService } from "../multimodal/index";
import { initializeGateway, type GatewayInitializationResult } from "./initializer";
import { handleSetupStatus, handleVerifyProvider, handleCompleteSetup, handleSetupProviders, handleSetupEthics, handleSetupOllamaModels } from "./routes/setup";
import { handleAuthStatus, handleLogin, handleSetupCredentials, handleChangePassword, handleRecover, handleDisableAuth, handleRecoveryKey } from "./routes/auth";
import { resolveUserId } from "../storage/onboarding";
import { handleGetAgents, handleCreateAgent, handleUpdateAgent, handleDeleteAgent, handleGetAgentProposals } from "./routes/agents";
import { handleGetProviders, handleCreateProvider, handleToggleProvider, handleUpdateProvider, handleSyncProviderModels, handleGetProviderAvailableModels, handleLoadHiveAgentsModel, handleGetHiveAgentsModelStatus } from "./routes/providers";
import { handleGetUsers, handleCreateUser, handleUpdateUserSettings, handleGetUserChannels, handleLinkUserChannel } from "./routes/users";
import { handleGetSkills, handleActivateSkill, handleUpdateSkill, handleDeleteSkill, handleCreateSkill } from "./routes/skills";
import { handleGetA2UISurfaces, handleDeleteA2UISurface } from "./routes/a2ui";
import { handleGetRuntimeStatus } from "./routes/runtime";
import { handleGetEthics, handleActivateEthics, handleDeleteEthics } from "./routes/ethics";
import { handleGetTools, handleActivateTool, handleUpdateTool } from "./routes/tools";
import { handleGetTasks, handleUpdateTask } from "./routes/tasks";
import { setChannelSendFn } from "./channel-notify";
import {
  acknowledgeNotification,
  listPendingNotifications,
  markNotificationDelivered,
} from "./notification-inbox";
import { setNarrationDelivery } from "../events/narration";
import {
  resolveNarrationMode,
  shouldDeliverToChannel,
  formatNarrationForChannel,
  enqueueChannelNarration,
  awaitChannelNarration,
} from "../events/channel-narration";
import { CronScheduler } from "../scheduler/CronScheduler";
import { createTaskHandler, setSchedulerForCleanup } from "../scheduler/integration";

import { setSchedulerInstance as setScheduleToolsInstance } from "../tools/cron/index.ts";
import { setSchedulerInstance as setCronApiInstance } from "./routes/cron-api";
import {
  handleGetCronJobs,
  handleGetCronJob,
  handleCreateCronJob,
  handleUpdateCronJob,
  handleDeleteCronJob,
  handlePauseCronJob,
  handleResumeCronJob,
  handleTriggerCronJob,
  handleGetCronJobHistory,
  handleGetCronStatus,
  handleGetCronChannels,
} from "./routes/cron-api";
import { handleGetChannels, handleGetChannelConfig, handleActivateChannel, handleDeactivateChannel, handleCreateChannel, handleGetChannelAccount, handleUpdateChannelAccount, handleDeleteChannelAccount, handleChannelAction, handleUpdateChannelSettings, handleToggleChannel, handleGetChannelStatus, handleReconnectChannel, handleGetWhatsAppDetails, handleDisconnectWhatsApp, handleUpdateWhatsAppConfig } from "./routes/channels";
import { handleGetMcpServers, handleGetMcpServerDetail, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer, handleToggleMcpServer, handleGetMCPServerTools } from "./routes/mcp";
import { handleGetModels, handleCreateModel, handleToggleModel, handleGetModelsConfig, handleUpdateModelsConfig, handleDeleteModel, handleUpdateModel } from "./routes/models";
import { handleGetVoiceProviders, handleGetConfiguredVoiceProviders, handleSaveVoiceProviderKey, handleTestVoice, handleGetChannelVoice, handleUpdateChannelVoice, handleGetVoiceProviderVoices } from "./routes/voice";
import { handleGetVisionProviders, handleGetChannelVision, handleUpdateChannelVision, handleOcrImage } from "./routes/multimodal";
import { handleGetLocalTTSStatus, handleGetLocalTTSLogs, handleInstallLocalTTS, handleStartLocalTTS, handleStopLocalTTS, handleSpeakLocalTTS, handleGetAvailableModels, handleGetInstalledVoices, handleDownloadModel, handleGetDownloadLogs, initializeLocalTTS } from "./routes/tts-local";
import { handleCreateMeeting, handleListMeetings, handleGetMeeting, handleAddMeetingSegment, handleStopMeeting, handleGenerateMeetingReport, handleDownloadMeetingReport } from "./routes/meeting";
import { handleGetActivityStats, handleGetSystemStats, handleGetUsageStats, handleSystemReload, handleApiReload, handleGetVersion, handleTriggerUpdate } from "./routes/system";
import { handleGetChatHistory, handleGetNotes, handleUpdateNote } from "./routes/chat";
import { handleChat as handlePostChat } from "./routes/chat";
import { handleGetConfig } from "./routes/config";
import { handleHttpRequest } from "./routes/http-client";
import { handleGetWorkspace, handleUpdateWorkspace, handleValidateWorkspace, handleCreateWorkspace, handleOpenWorkspace } from "./routes/workspace";
import { getNarration, expandPath, addCorsHeaders, CORS_ORIGINS } from "./helpers";
import { redactConfig } from "./helpers";

const logSubscribers = new Set<string>();

// Helpers imported from ./helpers/index.ts
// - getNarration, TOOL_NARRATIONS
// - expandPath
// - addCorsHeaders, CORS_ORIGINS
// - redactConfig, redactValue

interface WebSocketData {
  sessionId: string;
  authenticatedAt: number;
  providerId?: string;
  modelId?: string;
  meetingSessionId?: string;
}

export type EmbeddedUIAsset = {
  data: Uint8Array;
  mime: string;
};

export async function startGateway(
  config: Config,
  embeddedUI?: ReadonlyMap<string, EmbeddedUIAsset>,
): Promise<void> {
  const host = config.gateway?.host ?? "127.0.0.1";
  const port = config.gateway?.port ?? 18790;
  const pidFile = expandPath(config.gateway?.pidFile ?? "~/.hive/gateway.pid");

  // FIX 2 — startTime para calcular uptime en /status y /api/agents
  const startTime = Date.now();

  const log = logger.child("gateway");

  log.info(`Starting gateway on ${host}:${port}`);

  // ── Auto-generate auth token if not provided ─────────────────────────────
  // Priority: HIVE_AUTH_TOKEN env var > persisted token file > generate new
  const tokenFile = path.join(getHiveDir(), ".auth_token");
  if (!process.env.HIVE_AUTH_TOKEN) {
    if (existsSync(tokenFile)) {
      process.env.HIVE_AUTH_TOKEN = readFileSync(tokenFile, "utf-8").trim();
      log.info("🔑 Auth token loaded from persistent storage");
    } else {
      const generated = randomUUID().replace(/-/g, "");
      process.env.HIVE_AUTH_TOKEN = generated;
      mkdirSync(path.dirname(tokenFile), { recursive: true });
      writeFileSync(tokenFile, generated, { mode: 0o600 });
      log.info("🔑 Auth token auto-generated and persisted");
    }
  } else {
    // User provided token via env — persist it so it's visible in the file too
    writeFileSync(tokenFile, process.env.HIVE_AUTH_TOKEN, { mode: 0o600 });
    log.info("🔑 Auth token loaded from environment variable");
  }

  // ── Inicialización modular con manejo de errores ──────────────────────────
  let agent: AgentService;
  let runner: AgentRunner;
  let channelManager: ChannelManager;
  let dbProvider: string;
  let dbModel: string;
  // ── Bind port immediately so parent health-check doesn't timeout ──────────
  // The full handler is loaded via server.reload() once initialization finishes
  let server = Bun.serve<WebSocketData>({
    port,
    hostname: host,
    idleTimeout: 0,  // Disable 10s idle timeout — SSE streams can run for minutes
    fetch: (req) => {
      const origin = req.headers.get("Origin") ?? ""
      const isLocalhost = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("0.0.0.0")
      const corsHeaders = isLocalhost ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Requested-With",
        "Access-Control-Allow-Credentials": "true",
      } : {}
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders })
      const pathname = new URL(req.url).pathname
      if (pathname === "/health" || pathname === "/health/") {
        return Response.json({ status: "starting" }, { headers: corsHeaders })
      }
      return Response.json({ status: "starting" }, { status: 503, headers: corsHeaders })
    },
    websocket: { open() { }, message() { }, close() { } },
  });
  log.info(`Port ${port} bound (initializing gateway...)`);

  // Inicializar DB siempre (en setup mode crea la DB vacía, los endpoints retornan [] en vez de 500)
  try {
    // Seed providers/models/etc so setup wizard has data before onboarding completes
    await ensureHiveDb();
  } catch { /* si falla, los endpoints manejarán el error */ }

  // Setup mode: DB existe pero tiene 0 usuarios (primera ejecución interrumpida)
  let gatewaySetupMode = false;
  try {
    const usersCol = await col("users");
    gatewaySetupMode = (await usersCol.count()) === 0;
  } catch {
    gatewaySetupMode = true;
  }

  try {
    // Usar el inicializador modular para todos los componentes críticos
    const init = await initializeGateway(config, pidFile);

    agent = init.agent;
    runner = init.runner;
    channelManager = init.channelManager;
    dbProvider = init.provider;
    dbModel = init.model;

    // Auto-iniciar TTS local si está instalado
    await initializeLocalTTS();

    // Conectar channel-notify singleton para que las tools (notify, report_progress) puedan enviar mensajes
    setChannelSendFn(async (channel, sessionId, content, metadata) => {
      await channelManager.send(channel, sessionId, {
        content,
        type: metadata?.notificationId ? "notification" : "progress",
        sessionId,
        notificationId: metadata?.notificationId,
      }, metadata?.accountId);
    });
    setNarrationDelivery(async (event) => {
      if (event.channel === "webchat" && event.session_id) {
        const session = sessionManager.get(event.session_id);
        if (session?.ws && session.ws.readyState === 1) {
          session.ws.send(JSON.stringify({
            type: "process",
            sessionId: event.session_id,
            id: event.id,
            messageId: event.turn_id,
            processKind: event.kind === "tool_call" ? "tool" : "observation",
            processStatus: event.status === "error" ? "error" : event.status === "done" ? "done" : "thinking",
            label: event.label,
            detail: event.detail,
            timestamp: new Date(event.created_at).toISOString(),
          }));
          return;
        }
      }
      if (!event.channel || !event.session_id) return;

      // Messaging channels turn every event into a permanent chat message, so
      // they get a filtered feed (see events/channel-narration.ts) delivered
      // off the agent loop's critical path.
      const mode = await resolveNarrationMode(event.channel);
      if (!shouldDeliverToChannel(event, mode)) return;

      enqueueChannelNarration(`${event.channel}:${event.session_id}`, async () => {
        await channelManager.send(event.channel, event.session_id, {
          content: formatNarrationForChannel(event),
          type: "progress",
        });
      });
    });

    if (gatewaySetupMode) {
      log.info("🎉 Setup mode: gateway running — open http://localhost:" + port + "/setup to configure");
    } else {
      log.info("✅ Gateway initialization completed successfully");

      // ── Initialize New Cron Scheduler (Croner-based) ───────────────────────
      try {
        // ── Reconcile stale rows from previous crash ──────────────────────
        // taskRuns running→timeout, meetings active→stopped, agentRuns expired
        // lease→interrupted, jobQueue expired lease→reclaim/interrupt.
        const bootId = getBootId();
        await reconcileOnBoot(bootId);

        // Initialize durable queue + executors
        initJobExecutors();
        const harnessCfg = config.harness;
        const durableQueue = initDurableQueue({
          maxGlobalConcurrency: harnessCfg?.maxGlobalConcurrency ?? 4,
          taskTimeoutMs: harnessCfg?.taskTimeoutMs ?? 30 * 60 * 1000,
          jobRetryPolicy: loadJobRetryPolicy(),
        });
        setJobExecutorMCPManager(agent?.getMCPManager() ?? null);
        // chat_turn jobs re-execute through this runner (live or post-crash)
        initWebchatTurnRunner({
          runner,
          getProvider: () => dbProvider,
          getModel: () => dbModel,
        });
        // Closes the async task_delegate loop: relays worker_task outcomes
        // back into the delegating conversation (see delegation-notify.ts).
        initDelegationNotify();
        log.info(`🔀 DurableQueue initialized (maxConcurrency=${durableQueue.getMaxGlobalConcurrency()})`);

        // Create and boot scheduler
        const handler = createTaskHandler();
        const scheduler = new CronScheduler(handler);
        await scheduler.boot();

        // Register scheduler globally for tools, routes, and internal cleanup
        setScheduleToolsInstance(scheduler);
        setCronApiInstance(scheduler);
        setSchedulerForCleanup(scheduler);

        log.info(`📅 CronScheduler initialized with ${(await scheduler.getStatus()).length} task(s)`);
      } catch (err) {
        log.error(`❌ CronScheduler initialization failed: ${(err as Error).message}`);
      }

    }
  } catch (error) {
    log.error(`❌ Gateway initialization failed: ${(error as Error).message}`);
    log.error("Stack trace:", (error as Error).stack);
    process.exit(1);
  }

  // Check for insecure binding
  if (host === "0.0.0.0" && config.security?.warnOnInsecureConfig !== false) {
    log.warn("Gateway binding to 0.0.0.0 exposes server to all network interfaces!");
  }

  // ── CRON Handler setup ─────────────────────────────────────────────────────
  function prepareTools(agentInstance: AgentService, sessionId: string) {
    // Tools are now handled by the native agent-loop internally
    return undefined;
  }

  type WebChatProcessKind = "analysis" | "tool" | "observation" | "writing";
  type WebChatProcessStatus = "thinking" | "done" | "error";

  function createWebChatProcessReporter(ws: { send: (payload: string) => void }, sessionId: string, messageId: string) {
    const sent = new Set<string>();

    const send = (event: {
      kind?: WebChatProcessKind;
      label?: string;
      detail?: string;
      status?: WebChatProcessStatus;
      summary?: string;
    }) => {
      ws.send(JSON.stringify({
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
      } as OutboundMessage));
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

  // Set up hot reload watchers
  const watchers: Array<() => void> = [];

  // Note: Context store, Ethics, Agent Loop, LLM runner, and Channel Manager
  // are now initialized by initializeGateway() above

  // Handle messages from channels (Telegram, Discord, WhatsApp, Slack)
  if (!gatewaySetupMode) channelManager.onMessage(async (message: IncomingMessage) => {
    log.info(`📥 Message from ${message.channel}:${message.accountId}`);
    log.info(`   Session: ${message.sessionId}`);

    const voiceConfig = await voiceService.getChannelVoiceConfig(message.channel);
    const visionConfig = await multimodalService.getChannelVisionConfig(message.channel);
    let messageContent = message.content;

    let preferAudioResponse = false;
    let inputType: "text" | "audio_transcribed" | "image" | "document" = "text";
    let sttProviderUsed: string | null = null;
    let contentParts: import("../multimodal/types").ContentPart[] | undefined;

    if (voiceConfig.voiceEnabled && message.audio) {
      log.info(`🎙️ Voice enabled, processing audio...`);

      if (!voiceConfig.sttProvider) {
        log.warn(`⚠️ STT provider not configured for channel ${message.channel}`);
        await channelManager.send(message.channel, message.sessionId, {
          content: `🎙️ Para usar notas de voz, necesitas configurar el proveedor STT en la configuración del canal. Ve a Configuración > Canales > [Tu canal] y configura "Prov. STT" (ej: groq-whisper o openai)`,
        });
        return;
      }

      try {
        const audioInput = voiceService.normalizeAudioFromChannel(message.channel, message.audio);
        sttProviderUsed = voiceConfig.sttProvider || "groq-whisper";
        messageContent = await voiceService.transcribe(audioInput, sttProviderUsed);
        log.info(`📝 Transcribed: ${messageContent.substring(0, 100)}...`);

        inputType = "audio_transcribed";
        // If user sent audio and TTS is available, always respond in audio
        preferAudioResponse = !!voiceConfig.ttsProvider;

        await channelManager.send(message.channel, message.sessionId, {
          content: `🎙️ Transcripción: ${messageContent}`,
          type: "message"
        });
      } catch (error) {
        log.error(`❌ Transcription failed: ${(error as Error).message}`);
        await channelManager.send(message.channel, message.sessionId, {
          content: `Error al transcribir audio: ${(error as Error).message}`,
        });
        return;
      }
    }

    // ── Multimodal: image/document processing ──
    if (message.image || message.document) {
      log.info(`🖼️ Multimodal content detected on channel ${message.channel}`);

      if (message.image) {
        try {
          const imageInput = multimodalService.normalizeImageFromChannel(message.channel, message.image);
          const activeModelId = dbModel;
          const activeProviderId = dbProvider;
          const modelHasVision = activeModelId && activeProviderId
            ? await multimodalService.modelSupportsVision(activeProviderId, activeModelId)
            : false;

          if (visionConfig.visionEnabled && modelHasVision) {
            contentParts = await multimodalService.processImage(imageInput, visionConfig.visionModelId || undefined);
            inputType = "image";
            log.info(`🖼️ Image sent as vision ContentParts (model supports vision)`);
          } else {
            const ocrProvider = visionConfig.ocrProvider || "openai";
            log.info(`🖼️ Model lacks vision, using OCR via ${ocrProvider}...`);
            const ocrText = await multimodalService.ocrImage(imageInput, ocrProvider);
            messageContent = ocrText
              ? `[Imagen adjunta — contenido extraído por OCR]\n${ocrText}\n\n${messageContent || ""}`
              : messageContent || "";
            inputType = "image";
            log.info(`🖼️ OCR result: ${ocrText.substring(0, 100)}...`);
          }
        } catch (imgError) {
          log.error(`❌ Image processing failed: ${(imgError as Error).message}`);
          await channelManager.send(message.channel, message.sessionId, {
            content: `⚠️ Error al procesar la imagen: ${(imgError as Error).message}`,
          });
        }
      }

      if (message.document) {
        try {
          const docInput = multimodalService.normalizeDocumentFromChannel(message.channel, message.document);
          const ocrProvider = visionConfig.ocrProvider || "openai";
          log.info(`📄 Document detected, extracting text via OCR (${ocrProvider})...`);
          const docImage: import("../multimodal/types").ImageInput = {
            type: docInput.type,
            data: docInput.data,
            mimeType: docInput.mimeType,
            caption: docInput.fileName,
          };
          const ocrText = await multimodalService.ocrImage(docImage, ocrProvider);
          messageContent = ocrText
            ? `[Documento adjunto: ${docInput.fileName || "unknown"}]\n${ocrText}\n\n${messageContent || ""}`
            : messageContent || "";
          inputType = "document";
          log.info(`📄 Document OCR result: ${ocrText.substring(0, 100)}...`);
        } catch (docError) {
          log.error(`❌ Document processing failed: ${(docError as Error).message}`);
          await channelManager.send(message.channel, message.sessionId, {
            content: `⚠️ Error al procesar el documento: ${(docError as Error).message}`,
          });
        }
      }
    }

    log.info(` Content: ${messageContent.substring(0, 150)}${messageContent.length > 150 ? "..." : ""}`);

    const { userId, threadId: conversationThreadId } = await resolveContext({
      channel: message.channel,
      channelUserId: message.sessionId,
      accountId: message.accountId,
    });

    const telegramMeta = message.metadata?.telegram as { messageId?: number } | undefined;
    const messageId = telegramMeta?.messageId?.toString();
    await Promise.all([
      channelManager.markAsRead(message.channel, message.sessionId, messageId),
      channelManager.startTyping(message.channel, message.sessionId),
    ]);

    // conversationThreadId = conversations.thread_id canónico compartido por todos los canales
    const unifiedSessionId = conversationThreadId;
    // routingSessionId = peerId del canal → para enviar respuestas de vuelta al canal correcto
    const routingSessionId = message.sessionId;

    const userMetadata = inputType === "audio_transcribed"
      ? { input_type: "audio_transcribed", stt_provider: sttProviderUsed, channel: message.channel }
      : inputType === "image" || inputType === "document"
        ? { input_type: inputType, ocr_provider: visionConfig.ocrProvider, channel: message.channel }
        : { input_type: "text", channel: message.channel };

    // Obtener la zona horaria del usuario para el timestamp exacto
    const usersColForTz = await col<UserDoc>("users");
    const userRow = await usersColForTz.get(userId);
    const userTimezone = userRow?.doc.timezone || "UTC";
    const now = new Date();
    let exactTime = "";
    try {
      exactTime = now.toLocaleString("en-US", {
        timeZone: userTimezone,
        dateStyle: "full",
        timeStyle: "long",
      });
    } catch (e) {
      exactTime = now.toISOString();
    }
    const messageContentWithTime = `[Timestamp: ${exactTime} (${userTimezone})]\n${messageContent}`;

    const messages = contentParts
      ? [{ role: "user" as const, content: [{ type: "text" as const, text: messageContentWithTime }, ...contentParts] as import("../multimodal/types").ContentPart[] }]
      : [{ role: "user" as const, content: messageContentWithTime }];

    try {
      log.info(`🤖 Routing to agent loop...`);

      const turnId = randomUUID();
      const response = await runner.generate({
        provider: dbProvider as any,
        messages,
        rawUserMessage: messageContent,
        maxTokens: 4096,
        tools: prepareTools(agent, unifiedSessionId),
        maxSteps: 15,
        threadId: unifiedSessionId,
        userId,
        channel: message.channel,
        turnId,
        sessionId: routingSessionId,
        onStep: async (step) => {
          // Explicit tool-authored progress remains supported. Ordinary agent
          // and tool lifecycle narration is emitted by the domain service.
          if (step.type === "tool_result" && step.message) {
            try {
              const result = JSON.parse(step.message);
              if (result._sendToUser) {
                const userMessage = result.message || result.status || step.message;
                try {
                  await channelManager.send(message.channel, routingSessionId, {
                    content: userMessage,
                    type: "progress",
                  });
                } catch (err) {
                  log.warn(`[onStep] Tool result send failed: ${(err as Error).message}`);
                }
              }
            } catch {
              // No es JSON estructurado — no enviamos resultados crudos al usuario
            }
            return;
          }
        },
      });

      const { sealDelegationGroup } = await import("./delegation-groups");
      const delegationGroup = await sealDelegationGroup(turnId);
      const responseContent = delegationGroup ? "" : response.content?.trim() || "";
      if (!responseContent) {
        log.warn(`📤 LLM response: empty — skipping send`);
        return;
      }
      log.info(`📤 LLM response: ${responseContent.substring(0, 100)}${responseContent.length > 100 ? "..." : ""}`);

      // Narration is delivered off the critical path — let it drain first so the
      // final answer lands after the progress messages, not before them.
      await awaitChannelNarration(`${message.channel}:${routingSessionId}`);

      const shouldSpeak = preferAudioResponse;
      let responseType: "text" | "audio" = "text";
      let ttsProviderUsed: string | null = null;
      let ttsMimeType: string | null = null;

      if (responseContent) {
        if (shouldSpeak) {
          if (!voiceConfig.ttsProvider) {
            log.warn(`⚠️ TTS provider not configured, user requested audio`);
            await channelManager.send(message.channel, routingSessionId, {
              content: `${responseContent}\n\n🔊 Para recibir respuestas en audio, configura el proveedor TTS en Configuración > Canales > [Tu canal] (ej: elevenlabs, openai-tts)`
            });
          } else {
            try {
              log.info(`🔊 TTS enabled, synthesizing audio...`);
              const audioOutput = await voiceService.speak(responseContent, voiceConfig.ttsProvider, voiceConfig.ttsVoiceId || undefined);
              ttsProviderUsed = voiceConfig.ttsProvider;
              ttsMimeType = audioOutput.mimeType;
              responseType = "audio";

              try {
                const channel = channelManager.getChannel(message.channel, message.accountId);
                if (channel?.sendAudio) {
                  await channel.sendAudio(routingSessionId, audioOutput.data as Buffer, audioOutput.mimeType);
                  log.info(`✅ Audio sent to ${routingSessionId}`);
                } else {
                  log.warn(`Channel ${message.channel} does not support audio, sending text`);
                  await channelManager.send(message.channel, routingSessionId, { content: responseContent });
                }
              } catch (audioError) {
                log.error(`❌ Audio send failed: ${(audioError as Error).message}, sending text instead`);
                // Fallback to text
                await channelManager.send(message.channel, routingSessionId, { content: responseContent });
              }
            } catch (ttsError) {
              log.error(`❌ TTS failed: ${(ttsError as Error).message}, sending text instead`);
              await channelManager.send(message.channel, routingSessionId, { content: responseContent });
            }
          }
        } else {
          await channelManager.send(message.channel, routingSessionId, { content: responseContent });
        }
      }

      const assistantMetadata = {
        response_type: responseType,
        tts_provider: ttsProviderUsed,
        mime_type: ttsMimeType,
        channel: message.channel
      };

      await channelManager.stopTyping(message.channel, routingSessionId);
      log.info(`✅ Response sent to ${routingSessionId} via ${message.channel}`);
    } catch (error) {
      await channelManager.stopTyping(message.channel, routingSessionId);
      log.error(`❌ Error: ${(error as Error).message} `);
      await channelManager.send(message.channel, routingSessionId, {
        content: `Error: ${(error as Error).message} `,
      });
    }
  });

  // ── Auth helper ──────────────────────────────────────────────────────────
  // Dev mode when HIVE_DEV is set to "true" or "1".
  // Set HIVE_DEV=true in your development environment.
  const isDev = process.env.HIVE_DEV === "true" || process.env.HIVE_DEV === "1";

  async function checkAuth(req: Request, url: URL): Promise<boolean> {
    // En modo desarrollo, permitir todo
    if (isDev) return true;

    // En setup mode (sin usuarios), bypass total — el wizard no tiene token aún
    if (gatewaySetupMode) return true;

    // Setup endpoints are always public — needed before the client has a token
    if (url.pathname.startsWith("/api/setup/")) return true;

    // Auth endpoints: status, login, recover are public; others require token
    if (url.pathname === "/api/auth/status") return true;
    if (url.pathname === "/api/auth/login") return true;
    if (url.pathname === "/api/auth/recover") return true;

    // Users endpoint is public when no credentials configured (matches /api/auth/status behavior)
    // This allows the UI to load user data when login is not configured yet
    if (url.pathname === "/api/users" && req.method === "GET") {
      try {
        const usersCol = await col<UserDoc>("users");
        const user = (await usersCol.scan({ limit: 1 }))[0]?.doc;
        const hasCredentials = !!(user?.email && user?.password_hash);
        // Allow access if no credentials configured
        if (!hasCredentials) return true;
      } catch {
        // If DB query fails, fall through to token check
      }
    }

    // Si no hay credenciales configuradas (modo open), bypass total — el UI
    // no tiene token en localStorage porque nunca pasó por login.
    // Coincide con el comportamiento de AuthGuard: status.hasCredentials === false → open.
    try {
      const usersCol = await col<UserDoc>("users");
      const user = (await usersCol.scan({ limit: 1 }))[0]?.doc;
      const hasCredentials = !!(user?.email && user?.password_hash);
      if (!hasCredentials) return true;
    } catch {
      // Si falla la consulta, caemos al chequeo de token
    }

    const activeToken = process.env.HIVE_AUTH_TOKEN;
    if (!activeToken) return true;
    const authHeader = req.headers.get("authorization");
    const provided = authHeader?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token");
    return provided === activeToken;
  }

  // Reload with full handler now that initialization is complete
  server.reload({
    async fetch(req, server) {
      const start = Date.now();
      const url = new URL(req.url);
      const method = req.method;

      const logRequest = (status: number, duration: number) => {
        // Skip health checks from spamming logs unless debug
        if (url.pathname === "/health" || url.pathname === "/health/") {
          log.debug(`${method} ${url.pathname} - ${status} (${duration}ms)`);
        } else {
          log.info(`${method} ${url.pathname} - ${status} (${duration}ms)`);
        }
      };

      const handleRequest = async (): Promise<Response | undefined> => {

        // ── CORS preflight ────────────────────────────────────────────────────
        if (req.method === "OPTIONS") {
          const origin = req.headers.get("Origin");
          if (origin && (origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("0.0.0.0") || CORS_ORIGINS.some(o => origin.includes(o.replace("http://", ""))))) {
            return new Response(null, {
              status: 204,
              headers: {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Requested-With",
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Max-Age": "86400",
              },
            });
          }
          return new Response(null, { status: 204 });
        }

        // ── WebSocket upgrade ────────────────────────────────────────────────
        if (url.pathname === "/ws" || url.pathname === "/ws/") {
          let sessionId = url.searchParams.get("session") || (await resolveUserId({})) || "default";
          // Auth: accept ?token=<authToken> (same as REST Bearer) as alternative to ?session=<userId>
          if (!isDev && !gatewaySetupMode) {
            const tokenParam = url.searchParams.get("token");
            const activeToken = process.env.HIVE_AUTH_TOKEN;
            const usersColForWs = await col<UserDoc>("users");
            if (tokenParam && activeToken && tokenParam === activeToken) {
              // Token auth — resolve the real userId from DB
              const user = (await usersColForWs.scan({ limit: 1 }))[0];
              if (user) sessionId = user.id;
            }
            try {
              const userExists = await usersColForWs.get(sessionId);
              if (!userExists) {
                return new Response("Unauthorized", { status: 401 });
              }
            } catch {
              return new Response("Unauthorized", { status: 401 });
            }
          }
          if (!sessionId) {
            return new Response("Missing session or user ID", { status: 400 });
          }
          const success = server.upgrade(req, {
            data: { sessionId, authenticatedAt: Date.now() },
          });
          if (success) return undefined;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }




        // ── Meeting Stream WebSocket upgrade ───────────────────────────────────
        if (url.pathname === "/meeting-stream" || url.pathname === "/meeting-stream/") {
          const meetingSessionId = url.searchParams.get("meetingSessionId") ?? "";
          const sessionId = `meeting:${meetingSessionId || crypto.randomUUID()}`;
          const success = server.upgrade(req, {
            data: { sessionId, meetingSessionId, authenticatedAt: Date.now() },
          });
          if (success) return undefined;
          return new Response("Meeting stream WebSocket upgrade failed", { status: 400 });
        }

        // ── Health (must be before UI routing so it works in dev mode too) ───
        if (url.pathname === "/health" || url.pathname === "/health/") {
          const uptime = Math.floor((Date.now() - startTime) / 1000);
          const dq = getDurableQueue();
          const [pending, expiredLeases, activeRuns] = await Promise.all([
            findAllPendingJobs().catch(() => []),
            findExpiredLeases().catch(() => []),
            findRunsByStatus("running").catch(() => []),
          ]);
          return addCorsHeaders(Response.json({
            status: "ok",
            version: _pkgVersion,
            uptime,
            bootId: getBootId(),
            circuitBreakers: circuitBreakerRegistry.getAllStats(),
            queue: {
              running: dq.getRunningCount(),
              maxGlobalConcurrency: dq.getMaxGlobalConcurrency(),
              pending: pending.length,
              expiredLeases: expiredLeases.length,
            },
            runs: {
              active: activeRuns.length,
            },
          }), req);
        }

        // ── Dashboard / UI ────────────────────────────────────────────────────
        // In development: UI is served by Vite on port 5173, Gateway only handles /api and /ws
        // In production: serve static files from packages/hive-ui/dist

        // Check if this is an API or WebSocket request
        const isApiRequest = url.pathname.startsWith("/api");
        const isWsRequest = url.pathname.startsWith("/ws");
        const isUiRequest = url.pathname === "/ui" || url.pathname === "/ui/" || url.pathname.startsWith("/ui/") || url.pathname.startsWith("/ui?");
        const isSetupRequest = url.pathname === "/setup" || url.pathname === "/setup/" || url.pathname.startsWith("/setup/") || url.pathname.startsWith("/setup?");

        // In development mode, serve static files with HMR support
        // In production, serve static files from dist folder
        if (!isApiRequest && !isWsRequest) {
          // In development: serve from packages/hive-ui/dist with HMR injection
          if (isDev) {
            const uiDir = path.join(process.cwd(), "packages/hive-ui/dist");

            // Verificar si existe el build de la UI
            const indexPath = path.join(uiDir, "index.html");
            if (!existsSync(indexPath)) {
              return new Response(
                "UI build not found. Please run: cd packages/hive-ui && bun run build\n\n" +
                "Or use: bun run dev (from root) which builds automatically.",
                { status: 503, headers: { "Content-Type": "text/plain" } }
              );
            }

            let subPath = url.pathname;
            if (subPath === "/" || subPath === "/setup" || subPath === "/ui" || subPath === "/ui/") {
              subPath = "/index.html";
            } else if (subPath.startsWith("/ui/")) {
              subPath = subPath.replace(/^\/ui/, "");
            } else if (subPath.startsWith("/setup/")) {
              subPath = subPath.replace(/^\/setup/, "");
            }

            const filePath = path.join(uiDir, subPath);

            // Para index.html, inyectar script de HMR de Vite
            if (subPath === "/index.html") {
              const indexFile = Bun.file(filePath);
              if (await indexFile.exists()) {
                let html = await indexFile.text();
                // Inyectar script de HMR de Vite antes de </head>
                const hmrScript = `<script type="module" src="http://localhost:5173/@vite/client"></script>`;
                html = html.replace("</head>", `${hmrScript}</head>`);
                return new Response(html, { headers: { "Content-Type": "text/html" } });
              }
            }

            const uiFile = Bun.file(filePath);
            if (await uiFile.exists()) {
              return new Response(uiFile);
            }

            // SPA fallback: servir index.html para rutas de React Router
            const fallbackFile = Bun.file(path.join(uiDir, "index.html"));
            if (await fallbackFile.exists()) {
              let html = await fallbackFile.text();
              // Inyectar script de HMR de Vite
              const hmrScript = `<script type="module" src="http://localhost:5173/@vite/client"></script>`;
              html = html.replace("</head>", `${hmrScript}</head>`);
              return new Response(html, { headers: { "Content-Type": "text/html" } });
            }

            return new Response("Not found", { status: 404 });
          }

          // In production: serve from dist folder, o del bundle embebido si no
          // hay nada en disco. Ver helpers/ui-source.ts para el orden y por qué
          // el disco le gana al embed.
          const uiSource = resolveUISource({
            uiDirEnv: process.env.HIVE_UI_DIR,
            distDirEnv: process.env.HIVE_DIST_DIR,
            hiveDir: getHiveDir(),
            cwd: process.cwd(),
            hasEmbedded: Boolean(embeddedUI?.size),
          });
          let subPath = url.pathname;

          // En setup mode: / y /ui redirigen a /setup
          if (gatewaySetupMode && (subPath === "/" || subPath === "/ui" || subPath === "/ui/")) {
            const _publicBase = process.env.HIVE_PUBLIC_URL?.replace(/\/$/, "")
              ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
            return Response.redirect(`${_publicBase}/setup`, 302);
          }

          // Normalize path for /ui routes
          if (subPath === "/ui" || subPath === "/ui/") {
            subPath = "/index.html";
          } else if (subPath.startsWith("/ui/")) {
            subPath = subPath.replace(/^\/ui/, "");
            if (!subPath) subPath = "/index.html";
          } else if (subPath === "/") {
            subPath = "/index.html";
          }

          // Normalize path for /setup routes
          if (subPath === "/setup" || subPath === "/setup/") {
            subPath = "/index.html";
          } else if (subPath.startsWith("/setup/")) {
            subPath = subPath.replace(/^\/setup/, "");
            if (!subPath) subPath = "/index.html";
          }

          // Standalone executables carry the UI inside the Bun binary. The CLI
          // passes that bundle into the child gateway process so both API and
          // UI continue to share a single port without extracting files.
          if (uiSource.kind === "embedded" && embeddedUI) {
            const entry = embeddedUI.get(subPath)
              ?? (!path.extname(subPath) ? embeddedUI.get("/index.html") : undefined);
            if (entry) {
              const bytes = entry.data;
              const body = bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              ) as ArrayBuffer;
              return new Response(body, {
                headers: { "Content-Type": entry.mime },
              });
            }
          }

          if (uiSource.kind === "disk") {
            const uiFile = Bun.file(path.join(uiSource.dir, subPath));
            if (await uiFile.exists()) {
              return new Response(uiFile);
            }

            // SPA fallback: paths without a file extension are React Router routes — serve index.html
            if (!path.extname(subPath)) {
              const indexFile = Bun.file(path.join(uiSource.dir, "index.html"));
              if (await indexFile.exists()) {
                return new Response(indexFile);
              }
            }
          }

          // If UI is not available, show helpful message for any non-API route
          return new Response(
            "UI not found.\n\n" +
            "Options:\n" +
            "  1. Place the UI in ~/.hive/ui/ (copy hive-ui/dist contents there)\n" +
            "  2. Set HIVE_UI_DIR=/path/to/ui\n" +
            "  3. Build from source: cd packages/hive-ui && bun run build\n",
            { status: 404, headers: { "Content-Type": "text/plain" } }
          );
        }

        // Handle /dashboard redirect for backwards compatibility
        if (url.pathname.startsWith("/dashboard")) {
          const tokenParam = url.searchParams.get("token") ? `? token = ${url.searchParams.get("token")} ` : "";
          return Response.redirect(`/ ui${tokenParam} `, 301);
        }

        // ── Rutas que requieren autenticación ────────────────────────────────
        if (!(await checkAuth(req, url))) {
          log.warn(`[AUTH] Unauthorized request to ${url.pathname} from ${req.headers.get("origin")} `);
          return addCorsHeaders(new Response("Unauthorized", { status: 401 }), req);
        }

        // ── Setup API ────────────────────────────────────────────────────────
        // GET /api/setup/status
        if (url.pathname === "/api/setup/status" || url.pathname === "/api/setup/status/") {
          return addCorsHeaders(await handleSetupStatus(), req)
        }

        // GET /api/a2ui/surfaces — exact surface IDs for the authenticated canvas session
        if ((url.pathname === "/api/a2ui/surfaces" || url.pathname === "/api/a2ui/surfaces/") && req.method === "GET") {
          return await handleGetA2UISurfaces(req, addCorsHeaders)
        }
        const a2uiSurfaceMatch = url.pathname.match(/^\/api\/a2ui\/surfaces\/([^/]+)$/)
        if (a2uiSurfaceMatch && req.method === "DELETE") {
          return await handleDeleteA2UISurface(req, addCorsHeaders)
        }

        // GET /api/system/runtime — catalog/sidecar diagnostics for desktop support
        if ((url.pathname === "/api/system/runtime" || url.pathname === "/api/system/runtime/") && req.method === "GET") {
          return await handleGetRuntimeStatus(req, addCorsHeaders)
        }

        // GET /api/setup/providers
        if (url.pathname === "/api/setup/providers" && req.method === "GET") {
          return handleSetupProviders(addCorsHeaders, req)
        }

        // GET /api/setup/ollama-models
        if (url.pathname === "/api/setup/ollama-models" && req.method === "GET") {
          return handleSetupOllamaModels(addCorsHeaders, req)
        }

        // GET /api/setup/ethics
        if (url.pathname === "/api/setup/ethics" && req.method === "GET") {
          return handleSetupEthics(addCorsHeaders, req)
        }

        // POST /api/setup/verify-provider
        if (url.pathname === "/api/setup/verify-provider" && req.method === "POST") {
          return addCorsHeaders(await handleVerifyProvider(req), req)
        }

        // POST /api/setup/complete
        if (url.pathname === "/api/setup/complete" && req.method === "POST") {
          return await handleCompleteSetup(req, config, addCorsHeaders)
        }

        // ── Auth API ─────────────────────────────────────────────────────────
        // GET /api/auth/status
        if (url.pathname === "/api/auth/status" && req.method === "GET") {
          return handleAuthStatus(req, addCorsHeaders);
        }
        // POST /api/auth/login
        if (url.pathname === "/api/auth/login" && req.method === "POST") {
          return handleLogin(req, addCorsHeaders);
        }
        // POST /api/auth/setup-credentials
        if (url.pathname === "/api/auth/setup-credentials" && req.method === "POST") {
          return handleSetupCredentials(req, addCorsHeaders);
        }
        // POST /api/auth/change-password
        if (url.pathname === "/api/auth/change-password" && req.method === "POST") {
          return handleChangePassword(req, addCorsHeaders);
        }
        // POST /api/auth/recover
        if (url.pathname === "/api/auth/recover" && req.method === "POST") {
          return handleRecover(req, addCorsHeaders);
        }
        // POST /api/auth/disable
        if (url.pathname === "/api/auth/disable" && req.method === "POST") {
          return handleDisableAuth(req, addCorsHeaders);
        }
        // GET /api/auth/recovery-key
        if (url.pathname === "/api/auth/recovery-key" && req.method === "GET") {
          return handleRecoveryKey(req, addCorsHeaders);
        }

        // ── Status ───────────────────────────────────────────────────────────
        if (url.pathname === "/status" || url.pathname === "/status/") {
          return addCorsHeaders(new Response(
            JSON.stringify({
              status: "ok",
              // Estaba hardcodeada en "0.1.7" mientras package.json iba por 1.0.1:
              // /status mentía sobre qué versión estaba corriendo.
              version: _pkgVersion,
              uptime: Math.floor((Date.now() - startTime) / 1000),
              gateway: { host, port },
              sessions: sessionManager.list().map((s) => ({
                id: s.id,
                createdAt: s.createdAt,
                messageCount: s.messageCount,
              })),
              channels: channelManager?.listChannels() ?? [],
              queue: { activeSessions: 0 },
            }),
            { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=5" } }
          ), req);
        }

        // ── Activity Stats ─────────────────────────────────────────────────
        if (url.pathname === "/api/activity-stats" || url.pathname === "/api/activity-stats/") {
          return await handleGetActivityStats(req, addCorsHeaders)
        }

        // ── System Stats ───────────────────────────────────────────────────
        if (url.pathname === "/api/system-stats" || url.pathname === "/api/system-stats/") {
          return await handleGetSystemStats(req, addCorsHeaders, startTime)
        }

        // ── Version Check ──────────────────────────────────────────────────
        if (url.pathname === "/api/version" || url.pathname === "/api/version/") {
          return await handleGetVersion(req, addCorsHeaders)
        }

        // ── Trigger Update ─────────────────────────────────────────────────
        if (url.pathname === "/api/update" || url.pathname === "/api/update/") {
          if (req.method === "POST") {
            return await handleTriggerUpdate(req, addCorsHeaders)
          }
        }

        // ── Usage Stats ─────────────────────────────────────────────────────
        if (url.pathname === "/api/usage-stats" || url.pathname === "/api/usage-stats/") {
          return await handleGetUsageStats(req, addCorsHeaders)
        }

        // ── System Reload ─────────────────────────────────────────────────
        if (url.pathname === "/api/system/reload" || url.pathname === "/api/system/reload/") {
          return await handleSystemReload(req, addCorsHeaders)
        }

        // ── Config ─────────────────────────────────────────────────────────
        if (url.pathname === "/api/config") {
          if (req.method === "GET") {
            return await handleGetConfig(req, addCorsHeaders, config);
          }
        }

        // ── HTTP Client API ────────────────────────────────────────────────
        if ((url.pathname === "/api/http-request" || url.pathname === "/api/http-request/") && req.method === "POST") {
          return await handleHttpRequest(req, addCorsHeaders)
        }

        // ── Tasks API ─────────────────────────────────────────────────────
        if ((url.pathname === "/api/tasks" || url.pathname === "/api/tasks/") && req.method === "GET") {
          return await handleGetTasks(req, addCorsHeaders)
        }

        const taskDetailMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/)
        if (taskDetailMatch && req.method === "PATCH") {
          return await handleUpdateTask(req, addCorsHeaders)
        }
        const channelDetailMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/([^/]+)$/);
        if (channelDetailMatch) {
          const name = channelDetailMatch[1];
          const accountId = channelDetailMatch[2];

          if (req.method === "GET") {
            return await handleGetChannelAccount(req, addCorsHeaders, name, accountId);
          }
          if (req.method === "PUT") {
            const body = await req.json().catch(() => ({}));
            if (!body.config) return new Response("Missing config", { status: 400 });

            config.channels = config.channels || {};
            config.channels[name] = config.channels[name] || { enabled: true, accounts: {} };
            const channelEntry = config.channels[name] as any;
            channelEntry.accounts = channelEntry.accounts || {};
            channelEntry.accounts[accountId] = body.config;
            return await handleUpdateChannelAccount(req, addCorsHeaders, name, accountId, channelManager);
          }
          if (req.method === "DELETE") {
            // Config update handled by caller
            if (config.channels?.[name]) {
              const channelEntry = config.channels[name] as any;
              if (channelEntry.accounts) {
                delete channelEntry.accounts[accountId];
                if (Object.keys(channelEntry.accounts).length === 0) {
                  delete config.channels[name];
                }
              }
            }
            return await handleDeleteChannelAccount(req, addCorsHeaders, name, accountId, config, channelManager);
          }
        }

        const channelActionMatch = url.pathname.match(
          /^\/api\/channels\/([^/]+)\/([^/]+)\/(start|stop)$/
        );
        if (channelActionMatch) {
          const [, name, accountId, action] = channelActionMatch;
          if (req.method === "POST") {
            return await handleChannelAction(req, addCorsHeaders, name, accountId, action as "start" | "stop", channelManager);
          }
        }

        // ── Skills API ───────────────────────────────────────────────────────
        if ((url.pathname === "/api/skills" || url.pathname === "/api/skills/") && req.method === "POST") {
          return await handleCreateSkill(req, addCorsHeaders);
        }

        // ── Model Config API ─────────────────────────────────────────────────
        if (url.pathname === "/api/config/models") {
          if (req.method === "GET") {
            return await handleGetModelsConfig(req, addCorsHeaders, config);
          }
          if (req.method === "POST") {
            return await handleUpdateModelsConfig(req, addCorsHeaders, config, agent);
          }
        }

        // ── MCP API ──────────────────────────────────────────────────────────
        // Note: Full MCP route handlers are in routes/mcp.ts
        if (url.pathname === "/api/mcp/servers" && req.method === "GET") {
          const mcpManager = agent?.getMCPManager() ?? null;
          return await handleGetMcpServers(req, addCorsHeaders, mcpManager)
        }

        // GET /api/mcp/servers/:id — detail with unredacted headers (for editing)
        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/) && req.method === "GET") {
          const serverId = url.pathname.split("/")[4];
          return await handleGetMcpServerDetail(req, addCorsHeaders, serverId)
        }

        if (url.pathname === "/api/mcp/servers" && req.method === "POST") {
          const response = await handleCreateMcpServer(req, addCorsHeaders)

          // Hot reload will auto-connect the server within 2 seconds
          // No manual connection needed

          return response
        }

        // PUT /api/mcp/servers/:id — update server config
        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/) && req.method === "PUT") {
          return await handleUpdateMcpServer(req, addCorsHeaders)
        }

        // DELETE /api/mcp/servers/:id — remove server
        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/) && req.method === "DELETE") {
          return await handleDeleteMcpServer(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/mcp\/servers\/[^/]+\/toggle$/)) {
          const mcpId = url.pathname.split("/")[4];
          if (req.method === "POST") {
            return await handleToggleMcpServer(req, addCorsHeaders, mcpId)
          }
        }

        // ── Workspace API ────────────────────────────────────────────────────
        // Validate workspace path
        if (url.pathname === "/api/workspace/validate" && req.method === "POST") {
          return await handleValidateWorkspace(req, addCorsHeaders);
        }

        // Create workspace directory
        if (url.pathname === "/api/workspace/create" && req.method === "POST") {
          return await handleCreateWorkspace(req, addCorsHeaders);
        }

        // Open workspace in file explorer
        if (url.pathname === "/api/workspace/open" && req.method === "GET") {
          return await handleOpenWorkspace(req, addCorsHeaders);
        }

        // Get/Update workspace files (soul, user, ethics)
        for (const wsType of ["soul", "user", "ethics"] as const) {
          if (url.pathname === `/api/workspace/${wsType}`) {
            const agentsColForWorkspace = await col<AgentDoc>("agents")
            const coordinatorRow = (await agentsColForWorkspace.findBy("role", "coordinator", { limit: 1 }))[0];
            const liveWorkspacePath = coordinatorRow?.doc.workspace
              ? expandPath(coordinatorRow.doc.workspace)
              : expandPath("~/.hive/workspace");
            if (req.method === "GET") {
              return await handleGetWorkspace(req, addCorsHeaders, liveWorkspacePath, wsType);
            }
            if (req.method === "POST") {
              const reloadFn = async (type: string) => {
                if (type === "soul") agent.reloadSoul();
                if (type === "user") agent.reloadUser();
                if (type === "ethics") await agent.reloadEthics();
              };
              return await handleUpdateWorkspace(req, addCorsHeaders, liveWorkspacePath, wsType, reloadFn);
            }
          }
        }

        // ── Reload API ───────────────────────────────────────────────────────
        if (url.pathname === "/api/reload" && req.method === "POST") {
          return await handleApiReload(req, addCorsHeaders, agent);
        }

        // ── User Channel Linking API ────────────────────────────────────────────
        if (url.pathname === "/api/user/channels" && req.method === "POST") {
          return await handleLinkUserChannel(req, addCorsHeaders, config, log);
        }

        if (url.pathname === "/api/user/channels" && req.method === "GET") {
          return await handleGetUserChannels(req, addCorsHeaders, config);
        }

        // ── Agents API ─────────────────────────────────────────────────────
        if (url.pathname === "/api/agents" && req.method === "GET") {
          return await handleGetAgents(req, addCorsHeaders)
        }

        if (url.pathname === "/api/agents/proposals" && req.method === "GET") {
          return await handleGetAgentProposals(req, addCorsHeaders)
        }

        if (url.pathname === "/api/agents" && req.method === "POST") {
          return await handleCreateAgent(req, addCorsHeaders)
        }

        if (url.pathname.startsWith("/api/agents/") && (req.method === "PATCH" || req.method === "PUT")) {
          return await handleUpdateAgent(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === "DELETE") {
          return await handleDeleteAgent(req, addCorsHeaders)
        }

        // ── Providers API ───────────────────────────────────────────────────
        if (url.pathname === "/api/providers" && req.method === "GET") {
          return await handleGetProviders(req, addCorsHeaders)
        }

        if (url.pathname === "/api/providers" && req.method === "POST") {
          return await handleCreateProvider(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/providers\/[^/]+\/toggle$/) && req.method === "POST") {
          return await handleToggleProvider(req, addCorsHeaders)
        }

        const providerIdMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/)
        if (providerIdMatch && (req.method === "PUT" || req.method === "PATCH")) {
          return await handleUpdateProvider(req, addCorsHeaders)
        }

        // ── HiveAgents model loading ───────────────────────────────────────
        if (url.pathname === "/api/providers/hiveagents/load-model" && req.method === "POST") {
          return await handleLoadHiveAgentsModel(req, addCorsHeaders)
        }
        if (url.pathname === "/api/providers/hiveagents/model-status" && req.method === "GET") {
          return await handleGetHiveAgentsModelStatus(req, addCorsHeaders)
        }

        // ── Models API ───────────────────────────────────────────────────
        // GET /api/models?provider_id=xxx - Get models filtered by provider
        if (url.pathname === "/api/models" && req.method === "GET") {
          return await handleGetModels(req, addCorsHeaders)
        }

        // POST /api/providers/:id/sync-models — sincroniza modelos desde la API local del provider
        const syncModelsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/sync-models$/)
        if (syncModelsMatch && req.method === "POST") {
          const providerId = syncModelsMatch[1]
          return await handleSyncProviderModels(req, addCorsHeaders, providerId)
        }

        // GET /api/providers/:id/available-models — lista lo que sirve el provider, sin persistir
        const availableModelsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/available-models$/)
        if (availableModelsMatch && req.method === "GET") {
          return await handleGetProviderAvailableModels(req, addCorsHeaders, availableModelsMatch[1])
        }

        // POST /api/models - Create a new model
        if (url.pathname === "/api/models" && req.method === "POST") {
          return await handleCreateModel(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/models\/[^/]+\/toggle$/) && req.method === "POST") {
          return await handleToggleModel(req, addCorsHeaders)
        }

        // DELETE /api/models/:id
        if (url.pathname.match(/^\/api\/models\/[^/]+$/) && req.method === "DELETE") {
          return await handleDeleteModel(req, addCorsHeaders)
        }

        // PUT /api/models/:id
        if (url.pathname.match(/^\/api\/models\/[^/]+$/) && req.method === "PUT") {
          return await handleUpdateModel(req, addCorsHeaders)
        }

        // ── Skills API ─────────────────────────────────────────────────────
        if (url.pathname === "/api/skills" && req.method === "GET") {
          return await handleGetSkills(req, addCorsHeaders)
        }

        if (url.pathname === "/api/skills" && req.method === "POST") {
          const body = await req.json().catch(() => ({}))
          const { name, description, category, tools, triggers, preferred_agents, body: bodyContent } = body
          if (!name) return addCorsHeaders(new Response("Missing name", { status: 400 }), req)
          const id = randomUUID()
          const skillsColForCreate = await col<import("../storage/collections").SkillDoc>("skills")
          const nowForSkill = Date.now()
          await skillsColForCreate.put(id, {
            id, name, description: description || "", version: "0.0.1", author: "Anonymous", icon: "🧩",
            category: category || "", permissions: "[]", dependencies: "[]",
            tools: tools || "", triggers: triggers || "",
            preferred_agents: typeof preferred_agents === 'object' ? JSON.stringify(preferred_agents || []) : (preferred_agents || "[]"),
            body: bodyContent || "", version_num: 1, active: true, created_at: nowForSkill, updated_at: nowForSkill,
          }, { expectedVersion: 0 })
          return addCorsHeaders(Response.json({ success: true, id }), req)
        }

        if (url.pathname.match(/^\/api\/skills\/[^/]+\/toggle$/) && req.method === "POST") {
          return await handleActivateSkill(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/skills\/[^/]+$/) && req.method === "PUT") {
          return await handleUpdateSkill(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/skills\/[^/]+$/) && req.method === "DELETE") {
          return await handleDeleteSkill(req, addCorsHeaders)
        }

        // ── Tools API ────────────────────────────────────────────────────────
        if (url.pathname === "/api/tools" && req.method === "GET") {
          return await handleGetTools(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/tools\/[^/]+\/toggle$/) && req.method === "POST") {
          return await handleActivateTool(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/tools\/[^/]+$/) && req.method === "PUT") {
          return await handleUpdateTool(req, addCorsHeaders)
        }

        // ── Ethics API ──────────────────────────────────────────────────────
        if (url.pathname === "/api/ethics" && req.method === "GET") {
          return await handleGetEthics(req, addCorsHeaders)
        }

        if (url.pathname === "/api/ethics" && req.method === "POST") {
          const body = await req.json().catch(() => ({}))
          const { name, description, content, is_default } = body
          if (!name || !content) return addCorsHeaders(Response.json({ success: false, error: "Missing name or content" }, { status: 400 }), req)
          const id = randomUUID()
          const ethicsColForCreate = await col<import("../storage/collections").EthicsDoc>("ethics")
          await ethicsColForCreate.put(id, {
            id, name, description: description || "", content, is_default: !!is_default, enabled: true, active: true,
          }, { expectedVersion: 0 })
          return addCorsHeaders(Response.json({ success: true, id }), req)
        }

        if (url.pathname.match(/^\/api\/ethics\/[^/]+$/) && req.method === "PUT") {
          return await handleActivateEthics(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/ethics\/[^/]+$/) && req.method === "DELETE") {
          return await handleDeleteEthics(req, addCorsHeaders)
        }

        // ── Users API ───────────────────────────────────────────────────────
        if (url.pathname === "/api/users" && req.method === "GET") {
          return await handleGetUsers(req, addCorsHeaders)
        }

        if (url.pathname === "/api/users" && req.method === "POST") {
          return await handleCreateUser(req, addCorsHeaders)
        }

        if (url.pathname === "/api/user/settings" && req.method === "PATCH") {
          return await handleUpdateUserSettings(req, addCorsHeaders)
        }

        // ── MCP Servers API ──────────────────────────────────────────────────
        if (url.pathname === "/api/mcp/servers" && req.method === "GET") {
          return await handleGetMcpServers(req, addCorsHeaders, agent?.getMCPManager() ?? null)
        }

        // GET /api/mcp/servers/:id — detail with unredacted headers (for editing)
        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/) && req.method === "GET") {
          const serverId = url.pathname.split("/")[4];
          return await handleGetMcpServerDetail(req, addCorsHeaders, serverId)
        }

        // GET /api/mcp/servers/:id/tools - Get tools for a specific MCP server
        // Note: Tools are loaded from MCP Manager at runtime, not from DB
        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/tools$/) && req.method === "GET") {
          const serverId = url.pathname.split("/")[4];
          const mcpManager = agent?.getMCPManager() ?? null;
          return await handleGetMCPServerTools(req, addCorsHeaders, serverId, mcpManager)
        }

        // Note: /api/mcp/tools/:id/toggle and /api/mcp/tools/:id DELETE removed
        // MCP tools are not stored in DB - they are loaded at runtime from servers

        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/toggle$/)) {
          const mcpName = url.pathname.split("/")[4];
          if (req.method === "POST") {
            const body = await req.json().catch(() => ({}))
            // Support both { active: boolean } and { action: "connect"|"disconnect" }
            let active = body.active
            if (active === undefined && body.action !== undefined) {
              active = body.action === "connect"
            }
            if (active === undefined) {
              return addCorsHeaders(Response.json({ success: false, error: "Missing active field" }, { status: 400 }), req)
            }

            log.info(`[MCP] Toggle connection for ${mcpName}, active=${active}`)

            // Update DB
            const mcpServersColT = await col<import("../storage/collections").McpServerDoc>("mcpServers")
            const findMcpEntry = async (idOrName: string) => {
              const byId = await mcpServersColT.get(idOrName)
              if (byId) return byId
              return (await mcpServersColT.scan({})).find(e => e.doc.name === idOrName)
            }
            const toggleEntry = await findMcpEntry(mcpName)
            if (toggleEntry) {
              await mcpServersColT.put(toggleEntry.id, { ...toggleEntry.doc, active: !!active, enabled: !!active }, { expectedVersion: toggleEntry.version })
            }

            // Connect/Disconnect MCP server in real-time (no restart needed)
            try {
              const mcp = agent?.getMCPManager() ?? null;
              if (mcp) {
                log.info(`[MCP] Manager found, connecting ${mcpName}...`)
                if (active) {
                  const server = (await findMcpEntry(mcpName))?.doc;
                  if (server) {
                    log.info(`[MCP] Server config: transport=${server.transport}, url=${server.url}`)

                    // Build MCP server config
                    const mcpServerConfig: any = {
                      transport: server.transport,
                      command: server.command,
                      args: server.args ? JSON.parse(server.args) : [],
                      url: server.url,
                      enabled: true,
                    }

                    // Load headers from keychain (modern approach)
                    const keychainHeaders = await loadMcpHeaders(server.id);
                    if (Object.keys(keychainHeaders).length > 0) {
                      mcpServerConfig.headers = keychainHeaders;
                    }

                    // Get current MCP config and add/update this server
                    const currentConfig = (mcp as any).config || { servers: {} }
                    const newServersConfig = { ...currentConfig.servers }
                    newServersConfig[mcpName] = mcpServerConfig

                    // Register the server (or refresh its config) — this alone does not
                    // connect: updateConfig() only (re)connects a server whose config
                    // actually changed, so an already-registered dormant server needs an
                    // explicit connect below.
                    await mcp.updateConfig({
                      ...currentConfig,
                      servers: newServersConfig,
                    });

                    log.info(`[MCP] Server registered in MCP Manager`)

                    // Explicitly wake the server — connectServer() is a no-op if it's
                    // already connected, so this is safe to call unconditionally.
                    await mcp.connectServer(mcpName).catch((err: Error) => {
                      log.error(`[MCP] Connect attempt failed for ${mcpName}: ${err.message}`);
                    });

                    // Get tools after connection
                    const tools = mcp.getServerTools(mcpName) || [];
                    const serverDetails = mcp.getServerDetails?.(mcpName);
                    const serverStatus = serverDetails?.status ?? mcp.getServerStatus(mcpName);
                    if (serverStatus === "error" && serverDetails?.error) {
                      log.error(`[MCP] Connection error for ${mcpName}: ${serverDetails.error}`);
                    }
                    log.info(`[MCP] Connected! Tools: ${tools.length}, status: ${serverStatus}`);
                    const entryAfterConnect = await findMcpEntry(mcpName)
                    if (entryAfterConnect) {
                      await mcpServersColT.put(entryAfterConnect.id, { ...entryAfterConnect.doc, status: serverStatus === "connected" ? "connected" : "error", tools_count: tools.length }, { expectedVersion: entryAfterConnect.version })
                    }
                  } else {
                    log.error(`[MCP] Server not found in DB: ${mcpName}`)
                  }
                } else {
                  await mcp.disconnectServer(mcpName);
                  const entryAfterDisconnect = await findMcpEntry(mcpName)
                  if (entryAfterDisconnect) {
                    await mcpServersColT.put(entryAfterDisconnect.id, { ...entryAfterDisconnect.doc, status: "disconnected" }, { expectedVersion: entryAfterDisconnect.version })
                  }
                }
              } else {
                log.error(`[MCP] No MCP Manager found`)
              }
            } catch (error) {
              log.error(`[MCP] Failed to connect ${mcpName}: ${(error as Error).message}`);
            }

            return addCorsHeaders(Response.json({ success: true, active, message: active ? "Servidor MCP conectado" : "Servidor MCP desconectado" }), req)
          }
        }

        // GET /api/mcp/servers/:id — detail with unredacted headers (for editing)
        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/) && req.method === "GET") {
          const serverId = url.pathname.split("/")[4];
          return await handleGetMcpServerDetail(req, addCorsHeaders, serverId)
        }

        // Support /api/mcp/servers/{name} with POST for connect (frontend uses this)
        if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/)) {
          const mcpName = url.pathname.split("/")[4];
          if (req.method === "POST") {
            const body = await req.json().catch(() => ({}))
            // Support both { active: boolean } and { action: "connect"|"disconnect" }
            let active = body.active
            if (active === undefined && body.action !== undefined) {
              active = body.action === "connect"
            }
            if (active === undefined) {
              return addCorsHeaders(Response.json({ success: false, error: "Missing active field" }, { status: 400 }), req)
            }

            // Update DB
            const mcpServersColT2 = await col<import("../storage/collections").McpServerDoc>("mcpServers")
            const findMcpEntry2 = async (idOrName: string) => {
              const byId = await mcpServersColT2.get(idOrName)
              if (byId) return byId
              return (await mcpServersColT2.scan({})).find(e => e.doc.name === idOrName)
            }
            const toggleEntry2 = await findMcpEntry2(mcpName)
            if (toggleEntry2) {
              await mcpServersColT2.put(toggleEntry2.id, { ...toggleEntry2.doc, active: !!active, enabled: !!active }, { expectedVersion: toggleEntry2.version })
            }

            // Connect/Disconnect MCP server in real-time (no restart needed)
            try {
              const mcp = agent?.getMCPManager() ?? null;
              if (mcp) {
                if (active) {
                  const server = (await findMcpEntry2(mcpName))?.doc;
                  if (server) {
                    log.info(`[MCP] Server config: transport=${server.transport}, url=${server.url}`)

                    // Build MCP server config
                    const mcpServerConfig: any = {
                      transport: server.transport,
                      command: server.command,
                      args: server.args ? JSON.parse(server.args) : [],
                      url: server.url,
                      enabled: true,
                    }

                    // Load headers from keychain (modern approach)
                    const keychainHeaders2 = await loadMcpHeaders(server.id);
                    if (Object.keys(keychainHeaders2).length > 0) {
                      mcpServerConfig.headers = keychainHeaders2;
                    }

                    // Get current MCP config and add/update this server
                    const currentConfig = (mcp as any).config || { servers: {} }
                    const newServersConfig = { ...currentConfig.servers }
                    newServersConfig[mcpName] = mcpServerConfig

                    // Register the server (or refresh its config) — this alone does not
                    // connect: updateConfig() only (re)connects a server whose config
                    // actually changed, so an already-registered dormant server needs an
                    // explicit connect below.
                    await mcp.updateConfig({
                      ...currentConfig,
                      servers: newServersConfig,
                    });

                    log.info(`[MCP] Server registered in MCP Manager`)

                    // Explicitly wake the server — connectServer() is a no-op if it's
                    // already connected, so this is safe to call unconditionally.
                    await mcp.connectServer(mcpName).catch((err: Error) => {
                      log.error(`[MCP] Connect attempt failed for ${mcpName}: ${err.message}`);
                    });

                    // Get tools after connection
                    const tools = mcp.getServerTools(mcpName) || [];
                    const serverDetails2 = mcp.getServerDetails?.(mcpName);
                    const serverStatus2 = serverDetails2?.status ?? mcp.getServerStatus(mcpName);
                    if (serverStatus2 === "error" && serverDetails2?.error) {
                      log.error(`[MCP] Connection error for ${mcpName}: ${serverDetails2.error}`);
                    }
                    log.info(`[MCP] Connected! Tools: ${tools.length}, status: ${serverStatus2}`);

                    // Update DB with status and tools
                    const entryAfterConnect2 = await findMcpEntry2(mcpName)
                    if (entryAfterConnect2) {
                      await mcpServersColT2.put(entryAfterConnect2.id, { ...entryAfterConnect2.doc, status: serverStatus2 === "connected" ? "connected" : "error", tools_count: tools.length }, { expectedVersion: entryAfterConnect2.version })
                    }
                  } else {
                    log.error(`[MCP] Server not found in DB: ${mcpName}`)
                  }
                } else {
                  await mcp.disconnectServer(mcpName);
                  const entryAfterDisconnect2 = await findMcpEntry2(mcpName)
                  if (entryAfterDisconnect2) {
                    await mcpServersColT2.put(entryAfterDisconnect2.id, { ...entryAfterDisconnect2.doc, status: "disconnected" }, { expectedVersion: entryAfterDisconnect2.version })
                  }
                }
              }
            } catch (error) {
              log.error(`[MCP] Failed to connect ${mcpName}: ${(error as Error).message}`);
            }

            return addCorsHeaders(Response.json({ success: true, active, message: active ? "Servidor MCP conectado" : "Servidor MCP desconectado" }), req)
          }
        }

        // ── Channels API ───────────────────────────────────────────────────
        if (url.pathname === "/api/channels" && req.method === "GET") {
          return await handleGetChannels(req, addCorsHeaders, channelManager);
        }

        // PUT /api/channels/:id - Update channel settings
        const channelIdMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
        if (channelIdMatch && req.method === "PUT") {
          const channelId = channelIdMatch[1];
          return await handleUpdateChannelSettings(req, addCorsHeaders, channelId);
        }

        if (url.pathname.match(/^\/api\/channels\/[^/]+\/toggle$/)) {
          const channelId = url.pathname.split("/")[3];
          if (req.method === "POST") {
            return await handleToggleChannel(req, addCorsHeaders, channelId);
          }
        }

        // GET /api/channels/:type/:id/status — connection state + QR for WhatsApp
        if (url.pathname.match(/^\/api\/channels\/[^/]+\/[^/]+\/status$/) && req.method === "GET") {
          return await handleGetChannelStatus(req, addCorsHeaders, channelManager);
        }

        // WhatsApp-specific endpoints
        // GET /api/channels/whatsapp/:id/details
        if (url.pathname.match(/^\/api\/channels\/whatsapp\/([^/]+)\/details$/) && req.method === "GET") {
          const accountId = url.pathname.split("/")[3];
          return await handleGetWhatsAppDetails(req, addCorsHeaders, accountId, channelManager);
        }

        // POST /api/channels/whatsapp/:id/disconnect
        if (url.pathname.match(/^\/api\/channels\/whatsapp\/([^/]+)\/disconnect$/) && req.method === "POST") {
          const accountId = url.pathname.split("/")[3];
          return await handleDisconnectWhatsApp(req, addCorsHeaders, accountId, channelManager);
        }

        // PUT /api/channels/whatsapp/:id/config
        if (url.pathname.match(/^\/api\/channels\/whatsapp\/([^/]+)\/config$/) && req.method === "PUT") {
          const accountId = url.pathname.split("/")[3];
          return await handleUpdateWhatsAppConfig(req, addCorsHeaders, accountId, channelManager);
        }

        // POST /api/channels/:id/reconnect — restart channel (with optional new credentials)
        if (url.pathname.match(/^\/api\/channels\/[^/]+\/reconnect$/) && req.method === "POST") {
          const channelId = url.pathname.split("/")[3];
          return await handleReconnectChannel(req, addCorsHeaders, channelId, channelManager);
        }

        // ── Voice API ───────────────────────────────────────────────────────
        if (url.pathname === "/api/voice/providers" && req.method === "GET") {
          return await handleGetVoiceProviders(req, addCorsHeaders)
        }

        if (url.pathname === "/api/voice/configured-providers" && req.method === "GET") {
          return await handleGetConfiguredVoiceProviders(req, addCorsHeaders)
        }

        // POST /api/voice/providers/:providerId/key - Save API key for a voice provider
        const voiceProviderKeyMatch = url.pathname.match(/^\/api\/voice\/providers\/([^/]+)\/key$/)
        if (voiceProviderKeyMatch && req.method === "POST") {
          return await handleSaveVoiceProviderKey(req, addCorsHeaders)
        }

        if (url.pathname === "/api/voice/test" && req.method === "POST") {
          return await handleTestVoice(req, addCorsHeaders)
        }

        // GET /api/voice/:provider/voices - Get available voices for a provider
        const voiceProviderVoicesMatch = url.pathname.match(/^\/api\/voice\/([^/]+)\/voices$/)
        if (voiceProviderVoicesMatch && req.method === "GET") {
          const providerId = voiceProviderVoicesMatch[1]
          return await handleGetVoiceProviderVoices(req, addCorsHeaders, providerId)
        }

        // GET /api/channels/:id/voice - Get voice config for a channel
        const channelVoiceMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/voice$/)
        if (channelVoiceMatch && req.method === "GET") {
          const channelId = channelVoiceMatch[1]
          return await handleGetChannelVoice(req, addCorsHeaders, channelId)
        }

        // PATCH /api/channels/:id/voice - Update voice config for a channel
        if (channelVoiceMatch && req.method === "PATCH") {
          const channelId = channelVoiceMatch[1]
          return await handleUpdateChannelVoice(req, addCorsHeaders, channelId)
        }

        // ── Multimodal / Vision API ─────────────────────────────────────────
        if (url.pathname === "/api/multimodal/vision-providers" && req.method === "GET") {
          return await handleGetVisionProviders(req, addCorsHeaders)
        }

        if (url.pathname === "/api/multimodal/ocr" && req.method === "POST") {
          return await handleOcrImage(req, addCorsHeaders)
        }

        const channelVisionMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/vision$/)
        if (channelVisionMatch && req.method === "GET") {
          const channelId = channelVisionMatch[1]
          return await handleGetChannelVision(req, addCorsHeaders, channelId)
        }

        if (channelVisionMatch && req.method === "PATCH") {
          const channelId = channelVisionMatch[1]
          return await handleUpdateChannelVision(req, addCorsHeaders, channelId)
        }

        // ── Piper TTS Local ──────────────────────────────────────────────────
        if (url.pathname === "/api/tts-local/status" && req.method === "GET") {
          return await handleGetLocalTTSStatus(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/logs" && req.method === "GET") {
          return await handleGetLocalTTSLogs(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/install" && req.method === "POST") {
          return await handleInstallLocalTTS(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/start" && req.method === "POST") {
          return await handleStartLocalTTS(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/stop" && req.method === "POST") {
          return await handleStopLocalTTS(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/speak" && req.method === "POST") {
          return await handleSpeakLocalTTS(req, addCorsHeaders)
        }
        // Modelos
        if (url.pathname === "/api/tts-local/models" && req.method === "GET") {
          return await handleGetAvailableModels(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/models/download" && req.method === "POST") {
          return await handleDownloadModel(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/models/logs" && req.method === "GET") {
          return await handleGetDownloadLogs(req, addCorsHeaders)
        }
        if (url.pathname === "/api/tts-local/voices" && req.method === "GET") {
          return await handleGetInstalledVoices(req, addCorsHeaders)
        }

        // ── Meeting Transcription API ────────────────────────────────────────
        if (url.pathname === "/api/meetings" && req.method === "POST") {
          return await handleCreateMeeting(req, addCorsHeaders);
        }

        if (url.pathname === "/api/meetings" && req.method === "GET") {
          return await handleListMeetings(req, addCorsHeaders);
        }

        const meetingIdMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)$/);
        if (meetingIdMatch && req.method === "GET") {
          return await handleGetMeeting(req, addCorsHeaders, meetingIdMatch[1]);
        }

        const meetingSegmentMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/segments$/);
        if (meetingSegmentMatch && req.method === "POST") {
          return await handleAddMeetingSegment(req, addCorsHeaders, meetingSegmentMatch[1]);
        }

        const meetingStopMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/stop$/);
        if (meetingStopMatch && req.method === "POST") {
          return await handleStopMeeting(req, addCorsHeaders, meetingStopMatch[1]);
        }

        const meetingReportMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/report$/);
        if (meetingReportMatch && req.method === "POST") {
          return await handleGenerateMeetingReport(req, addCorsHeaders, meetingReportMatch[1]);
        }

        const meetingReportDownloadMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/report\/download$/);
        if (meetingReportDownloadMatch && req.method === "GET") {
          return await handleDownloadMeetingReport(req, addCorsHeaders, meetingReportDownloadMatch[1]);
        }

        // ── Chat / Notes API ────────────────────────────────────────────────
        if (url.pathname === "/api/chat/history" && req.method === "GET") {
          return await handleGetChatHistory(req, addCorsHeaders)
        }

        if (url.pathname === "/api/chat" && req.method === "POST") {
          return await handlePostChat(req, addCorsHeaders)
        }

        if (url.pathname === "/api/notes" && req.method === "GET") {
          return await handleGetNotes(req, addCorsHeaders)
        }

        // ── Cron Jobs API ──────────────────────────────────────────────────
        const cronMatch = url.pathname.match(/^\/api\/cron(\/[^/]+)?(\/[^/]+)?$/);
        if (cronMatch && req.method === "GET" && !cronMatch[2]) {
          if (cronMatch[1] === "/status") {
            return await handleGetCronStatus(req, addCorsHeaders);
          }
          if (cronMatch[1] === "/channels") {
            return await handleGetCronChannels(req, addCorsHeaders);
          }
          if (cronMatch[1]) {
            const taskId = cronMatch[1].slice(1);
            return await handleGetCronJob(req, addCorsHeaders, taskId);
          }
          return await handleGetCronJobs(req, addCorsHeaders);
        }

        if (cronMatch && req.method === "POST" && !cronMatch[2]) {
          return await handleCreateCronJob(req, addCorsHeaders);
        }

        if (cronMatch && req.method === "GET" && cronMatch[2] === "/history") {
          const taskId = cronMatch[1]?.slice(1);
          return await handleGetCronJobHistory(req, addCorsHeaders, taskId || "");
        }

        if (cronMatch && req.method === "POST" && cronMatch[2] === "/pause") {
          const taskId = cronMatch[1]?.slice(1);
          return await handlePauseCronJob(req, addCorsHeaders, taskId || "");
        }

        if (cronMatch && req.method === "POST" && cronMatch[2] === "/resume") {
          const taskId = cronMatch[1]?.slice(1);
          return await handleResumeCronJob(req, addCorsHeaders, taskId || "");
        }

        if (cronMatch && req.method === "POST" && cronMatch[2] === "/trigger") {
          const taskId = cronMatch[1]?.slice(1);
          return await handleTriggerCronJob(req, addCorsHeaders, taskId || "");
        }

        if (cronMatch && req.method === "PATCH" && cronMatch[1] && !cronMatch[2]) {
          const taskId = cronMatch[1].slice(1);
          return await handleUpdateCronJob(req, addCorsHeaders, taskId);
        }

        if (cronMatch && req.method === "DELETE" && cronMatch[1] && !cronMatch[2]) {
          const taskId = cronMatch[1].slice(1);
          return await handleDeleteCronJob(req, addCorsHeaders, taskId);
        }

        return addCorsHeaders(new Response("Not Found", { status: 404 }), req)
      };

      try {
        const response = await handleRequest();
        const duration = Date.now() - start;
        if (response) {
          logRequest(response.status, duration);
        } else {
          // Bun upgrade returns undefined on success
          log.info(`${method} ${url.pathname} - 101 Switching Protocols(${duration}ms)`);
        }
        return response;
      } catch (error) {
        const duration = Date.now() - start;
        log.error(`${method} ${url.pathname} - Internal Error(${duration}ms): ${(error as Error).message} `);
        return addCorsHeaders(Response.json({ success: false, error: (error as Error).message, message: "Error interno del servidor" }, { status: 500 }), req);
      }
    },

    websocket: {
      async open(ws) {
        const data = ws.data;

        // ── Heartbeat a nivel de protocolo (todos los sockets) ──────────────
        // ws.ping() usa frames ping/pong WebSocket: el navegador responde pong
        // automáticamente incluso con la pestaña en segundo plano (los timers
        // JS se throttle-an, los frames de protocolo no). Si no hay señal de
        // vida en 90s (pong, mensaje o ping), cerramos para que el cliente
        // reconecte en lugar de quedar zombi.
        (data as any)._lastSeen = Date.now();
        const hbInterval = setInterval(() => {
          try {
            if (ws.readyState !== 1) return;
            ws.ping();
            const lastSeen = (data as any)._lastSeen ?? 0;
            if (Date.now() - lastSeen > 90_000) {
              try { ws.close(4000, "heartbeat timeout"); } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        }, 25_000);
        (data as any)._hbInterval = hbInterval;

        // ── Meeting Stream ─────────────────────────────────────────────────────
        if (data.sessionId.startsWith("meeting:")) {
          log.info(`Meeting stream client connected: ${data.sessionId}`);
          ws.send(JSON.stringify({ type: "meeting:connected", sessionId: data.sessionId, meetingSessionId: (data as any).meetingSessionId }));
          return;
        }

        log.debug(`WebSocket connected: ${data.sessionId} `);

        sessionManager.create(data.sessionId, ws);

        // ── Heartbeat ping (server→client every 30s) ──────────────────────
        // Prevents proxy/load-balancer idle timeouts from killing the socket.
        const pingInterval = setInterval(() => {
          try {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
          } catch { /* ignore */ }
        }, 30_000);
        (data as any)._pingInterval = pingInterval;

        const channel = channelManager?.getChannel("webchat") as any;
        if (channel?.registerConnection) channel.registerConnection(ws);

        // Send status message
        ws.send(JSON.stringify({
          type: "status",
          sessionId: data.sessionId,
          status: { state: "connected", model: `${dbProvider}/${dbModel}` },
        } as OutboundMessage));

        // Send welcome message with real user data
        try {
          const usersColForWelcome = await col<UserDoc>("users");
          const agentsColForWelcome = await col<AgentDoc>("agents");
          const channelsColForWelcome = await col<import("../storage/collections").ChannelDoc>("channels");

          const user = (await usersColForWelcome.scan({ limit: 1 }))[0]?.doc;
          const agent = (await agentsColForWelcome.findBy("role", "coordinator", { limit: 1 }))[0]?.doc;
          const channels = (await channelsColForWelcome.scan({})).filter(c => c.doc.active);
          const webchat = await channelsColForWelcome.get("webchat");

          ws.send(JSON.stringify({
            type: "welcome",
            sessionId: data.sessionId,
            user: user ? { id: user.id, name: user.name, language: user.language } : null,
            agent: agent ? { id: agent.id, name: agent.name, provider: fromIndexable(agent.provider_id), model: fromIndexable(agent.model_id) } : null,
            channels: channels.map(c => c.doc.id),
            voice: webchat ? {
              enabled: webchat.doc.voice_enabled,
              sttProvider: webchat.doc.stt_provider,
              ttsProvider: webchat.doc.tts_provider
            } : { enabled: false, sttProvider: null, ttsProvider: null },
          } as OutboundMessage));
        } catch (err) {
          log.error("Error sending welcome message:", err);
        }
      },

      async message(ws, message) {
        const data = ws.data;
        (data as any)._lastSeen = Date.now();

        // Bridge events clients are read-only; only respond to ping keepalive
        if (data.sessionId.startsWith("bridge:")) {
          try {
            const m = JSON.parse(message.toString());
            if (m?.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
          } catch { /* ignore */ }
          return;
        }

        // Meeting stream: handle audio chunks and stop commands
        if (data.sessionId.startsWith("meeting:")) {
          try {
            const m = JSON.parse(message.toString()) as Record<string, unknown>;
            if (m?.type === "ping") {
              ws.send(JSON.stringify({ type: "pong" }));
              return;
            }
            if (m?.type === "audio_chunk") {
              const meetingSessionId = (data as any).meetingSessionId as string;
              const audioBase64 = m.audio as string;
              const speaker = (m.speaker as string) || null;
              const mimeType = (m.mime_type as string) || "audio/webm";
              (async () => {
                try {
                  const sessionsCol = await col<import("../storage/collections").MeetingSessionDoc>("meetingSessions");
                  const sessionEntry = await sessionsCol.get(meetingSessionId);
                  if (!sessionEntry || sessionEntry.doc.status !== "active") {
                    ws.send(JSON.stringify({ type: "error", error: "Sesión no activa o no encontrada" }));
                    return;
                  }
                  const transcription = await voiceService.transcribe(
                    { type: "base64", data: audioBase64, mimeType },
                    sessionEntry.doc.stt_model
                  );
                  const paddedSeq = await nextId(`meetingSegments:${meetingSessionId}`);
                  const seq = parseInt(paddedSeq, 10) - 1;
                  const segmentsCol = await col<import("../storage/collections").MeetingSegmentDoc>("meetingSegments");
                  await segmentsCol.put(`${meetingSessionId}:${paddedSeq}`, {
                    id: `${meetingSessionId}:${paddedSeq}`,
                    session_id: meetingSessionId,
                    seq,
                    speaker,
                    text: transcription,
                    duration_ms: null,
                    created_at: Date.now(),
                  }, { expectedVersion: 0 });
                  ws.send(JSON.stringify({ type: "transcript_segment", seq, speaker, text: transcription }));
                } catch (err) {
                  ws.send(JSON.stringify({ type: "error", error: (err as Error).message }));
                }
              })();
              return;
            }
            if (m?.type === "meeting_stop") {
              const meetingSessionId = (data as any).meetingSessionId as string;
              (async () => {
                try {
                  const sessionsCol = await col<import("../storage/collections").MeetingSessionDoc>("meetingSessions");
                  const sessionEntry = await sessionsCol.get(meetingSessionId);
                  if (sessionEntry && sessionEntry.doc.status === "active") {
                    await sessionsCol.put(meetingSessionId, { ...sessionEntry.doc, status: "stopped", stopped_at: Date.now() }, { expectedVersion: sessionEntry.version });
                  }
                  const segmentsCol = await col<import("../storage/collections").MeetingSegmentDoc>("meetingSegments");
                  const count = (await segmentsCol.scan({ prefix: `${meetingSessionId}:` })).length;
                  ws.send(JSON.stringify({ type: "meeting_stopped", session_id: meetingSessionId, segment_count: count }));
                } catch (err) {
                  ws.send(JSON.stringify({ type: "error", error: (err as Error).message }));
                }
              })();
              return;
            }
          } catch { /* ignore malformed messages */ }
          return;
        }





        let msg: InboundMessage;
        try {
          msg = JSON.parse(message.toString()) as InboundMessage;
        } catch {
          ws.send(JSON.stringify({
            type: "error",
            sessionId: data.sessionId,
            error: "Invalid JSON message",
          } as OutboundMessage));
          return;
        }

        msg.sessionId = msg.sessionId ?? data.sessionId;
        sessionManager.touch(msg.sessionId);

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", sessionId: msg.sessionId } as OutboundMessage));
          return;
        }

        if (msg.type === "notification_sync") {
          const pending = await listPendingNotifications(data.sessionId, "webchat");
          for (const notification of pending) {
            ws.send(JSON.stringify({
              type: "notification",
              sessionId: data.sessionId,
              notificationId: notification.id,
              content: notification.message,
              createdAt: notification.created_at,
            } as OutboundMessage));
            await markNotificationDelivered(notification.id, data.sessionId);
          }
          return;
        }

        if (msg.type === "notification_ack") {
          if (msg.notificationId) {
            await acknowledgeNotification(msg.notificationId, data.sessionId);
          }
          return;
        }

        // Canvas subscribe
        if (msg.type === "canvas_subscribe") {
          subscribeCanvas(ws);
          canvasManager.registerSession(`canvas:${data.sessionId}`, ws);
          ws.send(JSON.stringify({
            type: "canvas:snapshot",
            data: await getCanvasSnapshot(),
          }));
          return;
        }

        // Canvas unsubscribe
        if (msg.type === "canvas_unsubscribe") {
          unsubscribeCanvas(ws);
          canvasManager.unregisterSession(`canvas:${data.sessionId}`, ws);
          return;
        }

        // A2UI actions — user interacted with an A2UI surface component
        if (msg.type === "a2ui:action") {
          const actionData = (msg.data ?? msg) as Record<string, unknown>;
          const actionName = actionData.name as string ?? "action";
          const surfaceId = actionData.surfaceId as string ?? "unknown";
          const sourceComponentId = actionData.sourceComponentId as string ?? "unknown";
          const context = actionData.context as Record<string, unknown> ?? {};

          const interactionMsg = `[a2ui:action] surface=${surfaceId} action=${actionName} component=${sourceComponentId}${Object.keys(context).length > 0 ? ` context=${JSON.stringify(context)}` : ""}`;
          log.info(`A2UI action forwarded to agent: ${interactionMsg}`);

          const sessionId = data.sessionId;
          ws.send(JSON.stringify({ type: "typing", isTyping: true, sessionId } as OutboundMessage));

          enqueueChatTurn({
            lane: sessionId,
            payload: { source: "a2ui", sessionId, content: interactionMsg },
            live: { sendRaw: (payload) => ws.send(payload) },
          }).catch((error) => {
            ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId } as OutboundMessage));
            ws.send(JSON.stringify({ type: "error", sessionId, error: (error as Error).message } as OutboundMessage));
            log.error(`A2UI action enqueue error: ${(error as Error).message}`);
          });

          return;
        }

        if (msg.type === "command" || (msg.content && isSlashCommand(msg.content))) {
          const result = await executeSlashCommand(msg.sessionId, msg.content ?? `/${msg.command}`, ws);
          if (result) {
            ws.send(JSON.stringify(result));
            return;
          }
        }

        // Logs subscription
        if (msg.type === "logs_subscribe") {
          logSubscribers.add(data.sessionId);
          log.debug(`Session ${data.sessionId} subscribed to logs`);
          return;
        }

        if (msg.type === "logs_unsubscribe") {
          logSubscribers.delete(data.sessionId);
          log.debug(`Session ${data.sessionId} unsubscribed from logs`);
          return;
        }

        // Stop generation (like ChatGPT/Claude stop button)
        if (msg.type === "stop") {
          const cancelled = (await getDurableQueue().cancelLane(msg.sessionId)) > 0;
          log.info(`[stop] Session ${msg.sessionId} — cancelled: ${cancelled}`);
          ws.send(JSON.stringify({
            type: "typing",
            isTyping: false,
            sessionId: msg.sessionId,
          } as OutboundMessage));
          if (cancelled) {
            ws.send(JSON.stringify({
              type: "status",
              sessionId: msg.sessionId,
              status: { state: "cancelled" },
            } as OutboundMessage));
          }
          return;
        }

        // Handle audio messages from WebChat
        if (msg.type === "audio" && msg.audio) {
          log.info(`WebChat audio from session ${msg.sessionId}`);

          const voiceConfig = await voiceService.getChannelVoiceConfig("webchat");

          if (!voiceConfig.voiceEnabled) {
            ws.send(JSON.stringify({
              type: "error",
              sessionId: msg.sessionId,
              error: "Voice input not enabled for this channel"
            } as OutboundMessage));
            return;
          }

          if (!voiceConfig.sttProvider) {
            ws.send(JSON.stringify({
              type: "message",
              sessionId: msg.sessionId,
              content: "🎙️ Para usar notas de voz, configura el proveedor STT en Configuración > Canales > WebChat (ej: groq-whisper)"
            } as OutboundMessage));
            return;
          }

          ws.send(JSON.stringify({
            type: "typing",
            isTyping: true,
            sessionId: msg.sessionId,
          } as OutboundMessage));

          try {
            const audioInput = { type: "base64" as const, data: msg.audio, mimeType: "audio/webm" };
            const sttProvider = voiceConfig.sttProvider || "groq-whisper";
            const messageContent = await voiceService.transcribe(audioInput, sttProvider);

            log.info(`📝 Transcribed: ${messageContent.substring(0, 100)}...`);

            ws.send(JSON.stringify({
              type: "message",
              sessionId: msg.sessionId,
              content: `🎙️ Transcripción: ${messageContent}`
            } as OutboundMessage));

            ws.send(JSON.stringify({
              type: "typing",
              isTyping: false,
              sessionId: msg.sessionId,
            } as OutboundMessage));

            enqueueChatTurn({
              lane: msg.sessionId,
              payload: {
                source: "audio",
                sessionId: msg.sessionId,
                content: messageContent,
                preferAudio: true,
              },
              live: { sendRaw: (payload) => ws.send(payload) },
            }).catch((error) => {
              ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: msg.sessionId } as OutboundMessage));
              ws.send(JSON.stringify({ type: "error", sessionId: msg.sessionId, error: (error as Error).message } as OutboundMessage));
              log.error(`Audio turn enqueue error: ${(error as Error).message}`);
            });
          } catch (error) {
            ws.send(JSON.stringify({
              type: "typing",
              isTyping: false,
              sessionId: msg.sessionId,
            } as OutboundMessage));
            ws.send(JSON.stringify({
              type: "error",
              sessionId: msg.sessionId,
              error: `Transcription failed: ${(error as Error).message}`
            } as OutboundMessage));
          }
          return;
        }

        if (msg.type === "message" && msg.content) {
          log.info(`WebChat message from session ${msg.sessionId}: ${msg.content.substring(0, 100)}`);

          // FIX 6 — typing indicator inmediato ANTES de encolar
          // El usuario ve "escribiendo..." de inmediato, no después del queue
          ws.send(JSON.stringify({
            type: "typing",
            isTyping: true,
            sessionId: msg.sessionId,
          } as OutboundMessage));

          enqueueChatTurn({
            lane: msg.sessionId,
            payload: {
              source: "message",
              sessionId: msg.sessionId,
              content: msg.content,
              image: msg.image
                ? { base64: msg.image.base64, mimeType: msg.image.mimeType, caption: msg.image.caption }
                : undefined,
              document: msg.document
                ? { base64: msg.document.base64, mimeType: msg.document.mimeType, fileName: (msg.document as any).fileName ?? (msg.document as any).caption }
                : undefined,
            },
            live: { sendRaw: (payload) => ws.send(payload) },
          }).catch((error) => {
            ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: msg.sessionId } as OutboundMessage));
            ws.send(JSON.stringify({
              type: "error",
              sessionId: msg.sessionId,
              error: (error as Error).message,
            } as OutboundMessage));
            log.error(`Message turn enqueue error: ${(error as Error).message}`);
          });

          return;
        }

        ws.send(JSON.stringify({
          type: "error",
          sessionId: msg.sessionId,
          error: "Unknown message type",
        } as OutboundMessage));
      },

      // Frames de protocolo: cualquier señal de vida resetea el watchdog
      ping(ws) {
        (ws.data as any)._lastSeen = Date.now();
        try { ws.pong(); } catch { /* ignore */ }
      },

      pong(ws) {
        (ws.data as any)._lastSeen = Date.now();
      },

      close(ws) {
        const data = ws.data;
        if ((data as any)._hbInterval) {
          clearInterval((data as any)._hbInterval);
          (data as any)._hbInterval = null;
        }
        if (data.sessionId.startsWith("meeting:")) {
          log.info(`Meeting stream client disconnected: ${data.sessionId}`);
          return;
        }

        // Clear heartbeat ping timer
        if ((data as any)._pingInterval) {
          clearInterval((data as any)._pingInterval);
          (data as any)._pingInterval = null;
        }

        log.debug(`WebSocket disconnected: ${data.sessionId}`);
        const wasCurrentSession = sessionManager.deleteIfOwner(data.sessionId, ws);
        if (wasCurrentSession) logSubscribers.delete(data.sessionId);
        unsubscribeCanvas(ws);
        canvasManager.unregisterSession(`canvas:${data.sessionId}`, ws);

        const channel = channelManager?.getChannel("webchat") as any;
        if (channel?.unregisterConnection) channel.unregisterConnection(data.sessionId, ws);
      },
    },
  });

  onLogEntry((entry) => {
    if (logSubscribers.size === 0) return;

    const payload = JSON.stringify({
      type: "log",
      sessionId: entry.meta?.sessionId || "system",
      logEntry: entry,
    });

    for (const sessionId of logSubscribers) {
      const session = sessionManager.get(sessionId);
      if (session?.ws && session.ws.readyState === 1) {
        try {
          session.ws.send(payload);
        } catch {
          logSubscribers.delete(sessionId);
        }
      } else {
        logSubscribers.delete(sessionId);
      }
    }
  });

  log.info(`Gateway started successfully`);

  // Check if running as child process in dev mode (parent handles browser open)
  const isGatewayChild = process.env.HIVE_GATEWAY_CHILD === "1";

  // Print URLs based on mode
  if (isDev) {
    // In development: Gateway serves UI on port 18790 (same as production), Vite provides HMR on 5173
    const devUrl = gatewaySetupMode ? `http://localhost:${port}/setup` : `http://localhost:${port}`;
    log.info(`[gateway] UI:        ${devUrl}`);
    log.info(`[gateway] API:       http://${host}:${port}`);
    log.info(`[gateway] WebSocket: ws://${host}:${port}/ws`);
    log.info(`[gateway] Actividad: ws://${host}:${port}/canvas`);
    log.info(`[gateway] Modo:     desarrollo`);
    if (!isGatewayChild) {
      log.info(gatewaySetupMode ? `🎉 Primer arranque — abriendo setup...` : `🐝 Administra tu Hive aquí: ${devUrl}`);
    }
  } else {
    // In production: Gateway serves UI from dist/
    const isSetupMode = gatewaySetupMode;
    const baseUrl = process.env.HIVE_PUBLIC_URL?.replace(/\/$/, "") ?? `http://${host}:${port}`;
    const uiUrl = isSetupMode ? `${baseUrl}/setup` : `${baseUrl}/ui`;

    log.info(`[gateway] UI:        ${uiUrl}`);
    log.info(`[gateway] API:       http://${host}:${port}`);
    log.info(`[gateway] WebSocket: ws://${host}:${port}/ws`);
    log.info(`[gateway] Actividad: ws://${host}:${port}/canvas`);

    // Always open browser on startup (setup and normal mode).
    // Set NO_BROWSER=1 to skip in headless/server environments (e.g. CLI parent manages the browser).
    if (!process.env.NO_BROWSER) {
      log.info(isSetupMode ? `🎉 Primer arranque — abriendo wizard de configuración...` : `🐝 Administra tu Hive aquí: ${uiUrl}`);
      try {
        const platform = process.platform;
        let shellCmd: string;
        if (platform === "win32") {
          shellCmd = `start "" "${uiUrl}"`;
        } else if (platform === "darwin") {
          shellCmd = `open "${uiUrl}"`;
        } else {
          // Linux: gio open first (GNOME/Wayland native), then xdg-open fallbacks
          shellCmd = `gio open "${uiUrl}" 2>/dev/null || xdg-open "${uiUrl}" 2>/dev/null || sensible-browser "${uiUrl}" 2>/dev/null || x-www-browser "${uiUrl}" 2>/dev/null || true`;
        }
        const shell = platform === "win32" ? "cmd" : "/bin/sh";
        const shellArg = platform === "win32" ? "/c" : "-c";
        // Use Bun.spawn (native Bun API) for reliable detached subprocess
        const proc = Bun.spawn([shell, shellArg, shellCmd], {
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
        });
        proc.unref();
      } catch (err) {
        log.warn(`Could not open browser: ${(err as Error).message}`);
      }
    }
  }
  if (!gatewaySetupMode) log.info(`Channels: ${channelManager.listChannels().map((c) => c.name).join(", ") || "none"}`);

  // FIX 7 — SIGTERM: graceful shutdown with full cleanup
  process.on("SIGTERM", async () => {
    log.info("Received SIGTERM, shutting down gracefully...");
    watchers.forEach((close) => close());

    // ── Durable runs: stop lease renewals + interrupt active runs ──────────
    try {
      stopAllLeaseRenewals();
      const { findExpiredRuns } = await import("../agent/run-store");
      const { findRunsByStatus } = await import("../agent/run-store");
      const activeRuns = await findRunsByStatus("running");
      for (const run of activeRuns) {
        if (run.boot_id === getBootId()) {
          await interruptRun(run.id, "Process shutdown (SIGTERM)").catch(() => {});
        }
      }
      log.info(`[SIGTERM] Interrupted ${activeRuns.length} active durable run(s)`);
    } catch (err) {
      log.warn(`[SIGTERM] Failed to cleanup durable runs: ${(err as Error).message}`);
    }

    // ── Shutdown tool runtime (dispose worker pool) ──────────────────────
    try {
      shutdownToolRuntime();
      log.info("[SIGTERM] Tool runtime disposed");
    } catch { }

    const mcp = agent?.getMCPManager();
    if (mcp) {
      log.info("Disconnecting MCP servers...");
      await mcp.disconnectAll().catch(() => { });
    }

    if (channelManager) {
      log.info("Stopping channels...");
      await channelManager.stopAll();
    }

    // BrowserService — kill any running browser processes
    try {
      const mod = await import("../tools/web/browser-service");
      mod.CDPClient.closeAll();
      log.info("Browser processes cleaned up");
    } catch { }

    // CanvasManager — stop heartbeat intervals
    try {
      canvasManager.clearAll();
      log.info("Canvas sessions cleaned up");
    } catch { }

    // MCP hot-reload — stop polling interval
    try {
      const { stopMCPHotReload } = await import("../mcp/hot-reload");
      stopMCPHotReload();
      log.info("MCP hot-reload stopped");
    } catch { }

    server.stop();

    try { unlinkSync(pidFile); } catch { }
    log.info("Gateway shutdown complete");
    process.exit(0);
  });

  if (process.platform !== "win32") process.on("SIGHUP", async () => {
    log.info("Received SIGHUP, reloading configuration...");
    try {
      const newConfig = await loadConfig();
      await agent.updateConfig(newConfig);
      await agent.reload();
      log.info("Configuration reloaded successfully");
    } catch (error) {
      log.error(`Failed to reload configuration: ${(error as Error).message}`);
    }
  });
}
