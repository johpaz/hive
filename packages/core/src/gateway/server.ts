import type { Config } from "../config/loader";
import { loadConfig, getHiveDir } from "../config/loader";
import { logger, onLogEntry } from "../utils/logger";
import { sessionManager, parseSessionId } from "./session";
import { laneQueue } from "./lane-queue";
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
import { mkdirSync, rmSync, unlinkSync, watch, existsSync } from "node:fs";
import * as path from "node:path";
import { cpus as osCpus } from "node:os";
import { getDb, getDbPathLazy, initializeDatabase } from "../storage/sqlite";
import { getRecentMessages } from "../agent/conversation-store";
import { canvasManager } from "../canvas/canvas-manager.ts";
import { subscribeCanvas, unsubscribeCanvas, emitCanvas, getCanvasSnapshot } from "../canvas/emitter";
import { subscribeBridge, unsubscribeBridge } from "../tools/bridge-events";
import { randomUUID } from "crypto";
import { decryptConfig } from "../storage/crypto.ts";
import { resolveContext } from "./resolver";
import { voiceService } from "../voice/index";
import { initializeGateway, type GatewayInitializationResult } from "./initializer";
import { handleSetupStatus, handleVerifyProvider, handleCompleteSetup } from "./routes/setup";
import { resolveUserId } from "../storage/onboarding";
import { handleGetAgents, handleCreateAgent, handleUpdateAgent, handleDeleteAgent } from "./routes/agents";
import { handleGetProviders, handleCreateProvider, handleToggleProvider, handleUpdateProvider, handleSyncProviderModels } from "./routes/providers";
import { handleGetUsers, handleCreateUser, handleUpdateUserSettings, handleGetUserChannels, handleLinkUserChannel } from "./routes/users";
import { handleGetSkills, handleActivateSkill, handleUpdateSkill, handleDeleteSkill, handleCreateSkill } from "./routes/skills";
import { handleGetEthics, handleActivateEthics, handleDeleteEthics } from "./routes/ethics";
import { handleGetTools, handleActivateTool, handleUpdateTool } from "./routes/tools";
import { handleGetProjects, handleGetActiveProject, handleCreateProject, handleUpdateProject, handleGetProjectHistory, handleGetProjectDetail, handleGetProjectTasks } from "./routes/projects";
import { handleGetTasks, handleUpdateTask } from "./routes/tasks";
import { setChannelSendFn } from "./channel-notify";
import { handleGetCronJobs, handleGetCronChannels, handleUpdateCronJob } from "./routes/cron";
import { handleGetChannels, handleGetChannelConfig, handleActivateChannel, handleDeactivateChannel, handleCreateChannel, handleGetChannelAccount, handleUpdateChannelAccount, handleDeleteChannelAccount, handleChannelAction, handleUpdateChannelSettings, handleToggleChannel, handleGetChannelStatus, handleReconnectChannel } from "./routes/channels";
import { handleGetMcpServers, handleGetMcpServerDetail, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer, handleToggleMcpServer, handleGetMCPServerTools } from "./routes/mcp";
import { handleGetModels, handleCreateModel, handleToggleModel, handleGetModelsConfig, handleUpdateModelsConfig, handleDeleteModel, handleUpdateModel } from "./routes/models";
import { handleGetVoiceProviders, handleGetConfiguredVoiceProviders, handleSaveVoiceProviderKey, handleTestVoice, handleGetChannelVoice, handleUpdateChannelVoice, handleGetVoiceProviderVoices } from "./routes/voice";
import { handleGetActivityStats, handleGetSystemStats, handleGetUsageStats, handleSystemReload, handleApiReload } from "./routes/system";
import { handleGetChatHistory, handleGetCanvas, handleGetNotes, handleUpdateNote } from "./routes/chat";
import { handleChat as handlePostChat } from "./routes/chat";
import { handleGetConfig } from "./routes/config";
import { handleGetWorkspace, handleUpdateWorkspace, handleValidateWorkspace, handleCreateWorkspace, handleOpenWorkspace } from "./routes/workspace";
import { getNarration, expandPath, addCorsHeaders, redactConfig, CORS_ORIGINS } from "./helpers";
import { initCronScheduler, resolveBestChannel } from "../tools/cron";

const logSubscribers = new Set<string>();

// Helpers imported from ./helpers/index.ts
// - getNarration, TOOL_NARRATIONS
// - expandPath
// - addCorsHeaders, CORS_ORIGINS
// - redactConfig, redactValue

interface WebSocketData {
  sessionId: string;
  authenticatedAt: number;
}

export async function startGateway(config: Config): Promise<void> {
  const host = config.gateway?.host ?? "127.0.0.1";
  const port = config.gateway?.port ?? 18790;
  const pidFile = expandPath(config.gateway?.pidFile ?? "~/.hive/gateway.pid");

  // FIX 2 — startTime para calcular uptime en /status y /api/agents
  const startTime = Date.now();

  // CPU delta sampling — process.cpuUsage() is cumulative; we diff between calls
  const numCores = osCpus().length || 1;
  let lastCpuSample = process.cpuUsage();
  let lastCpuSampleTime = Date.now();
  const log = logger.child("gateway");
  const mcpLog = logger.child("mcp:api");

  log.info(`Starting gateway on ${host}:${port}`);

  // ── Inicialización modular con manejo de errores ──────────────────────────
  let agent: AgentService;
  let runner: AgentRunner;
  let channelManager: ChannelManager;
  let dbProvider: string;
  let dbModel: string;
  const agentList = config.agents?.list ?? [];
  const defaultAgent = agentList.find((a) => a.default) ?? agentList[0];
  const workspacePath = expandPath(defaultAgent?.workspace ?? "~/.hive/workspace");

  // ── Bind port immediately so parent health-check doesn't timeout ──────────
  // The full handler is loaded via server.reload() once initialization finishes
  let server = Bun.serve<WebSocketData>({
    port,
    hostname: host,
    fetch: (req) => {
      const origin = req.headers.get("Origin") ?? ""
      const isLocalhost = origin.includes("localhost") || origin.includes("127.0.0.1")
      const corsHeaders = isLocalhost ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Requested-With",
        "Access-Control-Allow-Credentials": "true",
      } : {}
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders })
      return Response.json({ status: "starting" }, { headers: corsHeaders })
    },
    websocket: { open() { }, message() { }, close() { } },
  });
  log.info(`Port ${port} bound (initializing gateway...)`);

  // Inicializar DB siempre (en setup mode crea la DB vacía, los endpoints retornan [] en vez de 500)
  try { initializeDatabase(); } catch { /* si falla, los endpoints manejarán el error */ }

  // Setup mode: no DB file OR DB existe pero tiene 0 usuarios (primera ejecución interrumpida)
  let gatewaySetupMode = false;
  try {
    const count = (getDb().query("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
    gatewaySetupMode = count === 0;
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

    // Conectar channel-notify singleton para que las tools (notify, report_progress) puedan enviar mensajes
    setChannelSendFn(async (channel, sessionId, content) => {
      await channelManager.send(channel, sessionId, { content, type: "progress" });
    });

    if (gatewaySetupMode) {
      log.info("🎉 Setup mode: gateway running — open http://localhost:" + port + "/setup to configure");
    } else {
      log.info("✅ Gateway initialization completed successfully");
      // ── Initialize Cron Scheduler ──────────────────────────────────────────
      initCronScheduler((sessionId, task, jobId, context) => {
        agent.emit("cron", sessionId, task, jobId, context);
      });
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

  if (!gatewaySetupMode) agent.on("cron", async (sessionId: string, task: string, jobId?: string, context?: { fecha_usuario: string; hora_usuario: string }) => {
    log.info(`[CRON] Triggered task '${task}' for session ${sessionId}, jobId: ${jobId || 'unknown'} [${context?.fecha_usuario} ${context?.hora_usuario}]`);

    let notifyChannel = "webchat";
    let notifySessionId = sessionId;
    let taskMessage = task; // Default to task name if no taskMessage found
    let projectId: string | null = null;

    if (jobId) {
      try {
        const db = getDb();
        const cronJob = db.query<any, [string]>(
          "SELECT user_id, project_id, notify_channel_id, task_config FROM cron_jobs WHERE id = ?"
        ).get(jobId) as any;

        if (cronJob) {
          projectId = cronJob.project_id || null;

          // Extract taskMessage from task_config if available
          const taskConfig = cronJob.task_config ? JSON.parse(cronJob.task_config) : {};
          taskMessage = taskConfig.message || task;

          // If linked to a project, activate it
          if (projectId) {
            const project = db.query<any, [string]>(
              "SELECT id, name, status FROM projects WHERE id = ?"
            ).get(projectId);
            if (project) {
              log.info(`[CRON] Activating linked project: ${project.name} (${projectId}) [status: ${project.status} → active]`);
              db.query(
                "UPDATE projects SET status = 'active', updated_at = unixepoch() WHERE id = ?"
              ).run(projectId);
            }
          }

          // Apply priority chain: explicit job channel → registered identity → webchat
          notifyChannel = resolveBestChannel(cronJob.user_id, cronJob.notify_channel_id);

          if (notifyChannel !== "webchat") {
            // External channel: need the channel-specific session ID from user_identities
            const identity = db.query<{ channel_user_id: string }, [string, string]>(
              "SELECT channel_user_id FROM user_identities WHERE user_id = ? AND channel = ? LIMIT 1"
            ).get(cronJob.user_id, notifyChannel);
            if (identity?.channel_user_id) {
              notifySessionId = identity.channel_user_id;
            } else {
              log.warn(`[CRON] No identity found for channel '${notifyChannel}', falling back to webchat`);
              notifyChannel = "webchat";
            }
          }

          if (notifyChannel === "webchat") {
            // Use any active WebChat session; fall back to user_id (works if client connects with that ID)
            const webchatChannel = channelManager.getChannel("webchat") as any;
            const activeWsSession = webchatChannel?.getAnyActiveSession?.() ?? cronJob.user_id;
            notifySessionId = activeWsSession;
            log.info(`[CRON] WebChat session resolved: ${notifySessionId}`);
          }
        }
      } catch (e) {
        log.warn(`[CRON] Could not fetch notify channel for job ${jobId}: ${(e as Error).message}`);
      }
    }

    // Use the resolved session for both internal processing and notifications
    const activeSessionId = notifySessionId;

    try {
      await channelManager.send(notifyChannel, activeSessionId, {
        content: `⏰ Ejecutando tarea: ${task}`,
        type: "progress"
      });
    } catch (notifyErr) {
      log.warn(`[CRON] Could not send start notification: ${(notifyErr as Error).message}`);
    }

    laneQueue.enqueue(activeSessionId, async (_t, signal) => {
      if (signal.aborted) return;
      try {
        // Add cron message as 'user' role so it appears in the chat history
        const cronMessage = `[CRON] Scheduled task triggered: ${task}.${projectId ? `\n[project_id: ${projectId}]` : ''}
[fecha_usuario: ${context?.fecha_usuario || ""}]
[hora_usuario: ${context?.hora_usuario || ""}]
Instruction: ${taskMessage}
Please execute it now.`;

        const history = getRecentMessages(activeSessionId, 50);
        const messages = [
          ...history.map((row) => ({
            role: row.role as "user" | "assistant" | "system",
            content: row.content,
          })),
          { role: "user" as const, content: cronMessage }
        ];

        const provider = dbProvider;

        log.info(`[CRON] Generating response for session ${activeSessionId}...`);
        const response = await runner.generate({
          provider: provider as any,
          messages,
          rawUserMessage: cronMessage,
          maxTokens: 4096,
          tools: prepareTools(agent, activeSessionId),
          maxSteps: 15,
          threadId: activeSessionId,
          channel: "cron",
          onStep: async (step) => {
            if (step.type === "text" && step.message) {
              const trimmedMessage = (typeof step.message === "string" ? step.message : "").trim();
              if (trimmedMessage) {
                await channelManager.send(notifyChannel, notifySessionId, {
                  content: trimmedMessage,
                  type: "progress"
                });
              }
            }
            if (step.type === "tool_result" && step.message) {
              try {
                const result = JSON.parse(step.message);
                if (result._sendToUser || result.status) {
                  const userMessage = result.message || result.status || step.message;
                  await channelManager.send(notifyChannel, notifySessionId, {
                    content: `📊 ${userMessage}`,
                    type: "progress"
                  });
                }
              } catch { }
            }
          },
        });

        const responseContent = response.content?.trim() || "Task completed.";

        // For cron tasks, always send the final response to the notification channel
        await channelManager.send(notifyChannel, notifySessionId, { content: responseContent });

        // Also send to WebSocket if the original session is connected
        const session = sessionManager.get(sessionId);
        if (session?.ws) {
          session.ws.send(JSON.stringify({ type: "message", sessionId: sessionId, content: responseContent } as OutboundMessage));
        }
      } catch (error) {
        log.error(`[CRON] Error for session ${sessionId}: ${(error as Error).message}`);
        await channelManager.send(notifyChannel, notifySessionId, {
          content: `❌ Error en tarea programada: ${(error as Error).message}`,
        });
      }
    });
  });

  // Set up hot reload watchers
  const watchers: Array<() => void> = [];

  // Note: Context store, Ethics, Agent Loop, LLM runner, and Channel Manager
  // are now initialized by initializeGateway() above

  // Handle messages from channels (Telegram, Discord, WhatsApp, Slack)
  if (!gatewaySetupMode) channelManager.onMessage(async (message: IncomingMessage) => {
    log.info(`📥 Message from ${message.channel}:${message.accountId}`);
    log.info(`   Session: ${message.sessionId}`);

    const voiceConfig = voiceService.getChannelVoiceConfig(message.channel);
    let messageContent = message.content;

    let preferAudioResponse = false;
    let inputType: "text" | "audio_transcribed" = "text";
    let sttProviderUsed: string | null = null;

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

    log.info(`   Content: ${messageContent.substring(0, 150)}${messageContent.length > 150 ? "..." : ""}`);

    const { userId } = resolveContext({
      channel: message.channel,
      channelUserId: message.sessionId,
    });

    const telegramMeta = message.metadata?.telegram as { messageId?: number } | undefined;
    const messageId = telegramMeta?.messageId?.toString();
    await Promise.all([
      channelManager.markAsRead(message.channel, message.sessionId, messageId),
      channelManager.startTyping(message.channel, message.sessionId),
    ]);

    // unifiedSessionId = userId del onboarding → historial y thread LangGraph unificados
    const unifiedSessionId = userId;
    // routingSessionId = peerId del canal → para enviar respuestas de vuelta al canal correcto
    const routingSessionId = message.sessionId;

    const userMetadata = inputType === "audio_transcribed"
      ? { input_type: "audio_transcribed", stt_provider: sttProviderUsed, channel: message.channel }
      : { input_type: "text", channel: message.channel };

    // Obtener la zona horaria del usuario para el timestamp exacto
    const userRow = getDb()
      .query<any, [string]>("SELECT * FROM users WHERE id = ?")
      .get(userId);
    const userTimezone = userRow?.timezone || "UTC";
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

    const messages = [{ role: "user" as const, content: messageContentWithTime }];

    try {
      log.info(`🤖 Routing to agent loop...`);

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
        onStep: async (step) => {
          // "text" = el agente narra lo que está pensando/haciendo antes de un tool_call
          if (step.type === "text" && step.message) {
            const trimmedMessage = (typeof step.message === "string" ? step.message : "").trim();
            if (trimmedMessage) {
              log.debug(`[NARRATION] ${trimmedMessage.substring(0, 100)}`);
              await channelManager.send(message.channel, routingSessionId, {
                content: trimmedMessage,
                type: "progress",
              });
            }
            return;
          }

          // "tool_call" = el agente va a ejecutar una herramienta → narrar al usuario
          if (step.type === "tool_call" && step.toolName) {
            const narration = getNarration(step.toolName);
            log.debug(`[TOOL] ${step.toolName} → "${narration}"`);
            await channelManager.send(message.channel, routingSessionId, {
              content: narration,
              type: "progress",
            });
            return;
          }

          // "tool_result" = resultado de la herramienta
          // Solo enviamos al usuario si el resultado lo pide explícitamente
          if (step.type === "tool_result" && step.message) {
            try {
              const result = JSON.parse(step.message);
              if (result._sendToUser) {
                const userMessage = result.message || result.status || step.message;
                await channelManager.send(message.channel, routingSessionId, {
                  content: userMessage,
                  type: "progress",
                });
              }
            } catch {
              // No es JSON estructurado — no enviamos resultados crudos al usuario
            }
            return;
          }
        },
      });

      const responseContent = response.content?.trim() || "";
      if (!responseContent) {
        log.warn(`📤 LLM response: empty — skipping send`);
        return;
      }
      log.info(`📤 LLM response: ${responseContent.substring(0, 100)}${responseContent.length > 100 ? "..." : ""}`);

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
                const channel = channelManager.getChannel(message.channel);
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
  // En modo desarrollo (HIVE_DEV=true), no requerimos autenticación
  const isDev = process.env.HIVE_DEV === "true" || process.env.NODE_ENV === "development";

  function checkAuth(req: Request, url: URL): boolean {
    // En modo desarrollo, permitir todo
    if (isDev) return true;

    // Read live from env so the token set during setup/complete takes effect immediately
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
          if (origin && (origin.includes("localhost") || origin.includes("127.0.0.1") || CORS_ORIGINS.some(o => origin.includes(o.replace("http://", ""))))) {
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
          // En modo desarrollo, no requerir autenticación para WebSocket
          if (!isDev && !checkAuth(req, url)) {
            return new Response("Unauthorized", { status: 401 });
          }
          const sessionId = url.searchParams.get("session") || resolveUserId({}) || "default";
          if (!sessionId) {
            return new Response("Missing session or user ID", { status: 400 });
          }
          const success = server.upgrade(req, {
            data: { sessionId, authenticatedAt: Date.now() },
          });
          if (success) return undefined;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // ── Bridge Events WebSocket upgrade ────────────────────────────────────
        if (url.pathname === "/bridge-events" || url.pathname === "/bridge-events/") {
          const sessionId = `bridge:${url.searchParams.get("sessionId") ?? (resolveUserId({}) ?? "default")}`;
          const success = server.upgrade(req, { data: { sessionId, authenticatedAt: Date.now() } });
          if (success) return undefined;
          return new Response("Bridge events WebSocket upgrade failed", { status: 400 });
        }

        // ── Canvas WebSocket upgrade ────────────────────────────────────────────
        if (url.pathname === "/canvas" || url.pathname === "/canvas/") {
          // En modo desarrollo, no requerir autenticación para Canvas WebSocket
          let sessionId = url.searchParams.get("sessionId") ?? url.searchParams.get("session");
          const defaultUserId = resolveUserId({});
          if (!sessionId && defaultUserId) {
            sessionId = `canvas:${defaultUserId}`;
          }
          if (!sessionId) {
            return new Response("Missing session or user ID for canvas", { status: 400 });
          }
          const success = server.upgrade(req, {
            data: { sessionId: sessionId.startsWith("canvas:") ? sessionId : `canvas:${sessionId}`, authenticatedAt: Date.now() },
          });
          if (success) return undefined;
          return new Response("Canvas WebSocket upgrade failed", { status: 400 });
        }

        // ── Health (must be before UI routing so it works in dev mode too) ───
        if (url.pathname === "/health" || url.pathname === "/health/") {
          return addCorsHeaders(Response.json({ status: "ok", pid: process.pid }), req);
        }

        // ── Dashboard / UI ────────────────────────────────────────────────────
        // In development: UI is served by Vite on port 5173, Gateway only handles /api and /ws
        // In production: serve static files from packages/hive-ui/dist

        // Check if this is an API or WebSocket request
        const isApiRequest = url.pathname.startsWith("/api");
        const isWsRequest = url.pathname.startsWith("/ws");
        const isUiRequest = url.pathname === "/ui" || url.pathname === "/ui/" || url.pathname.startsWith("/ui/") || url.pathname.startsWith("/ui?");
        const isSetupRequest = url.pathname === "/setup" || url.pathname === "/setup/" || url.pathname.startsWith("/setup/") || url.pathname.startsWith("/setup?");

        // In development mode, skip UI handling - Vite handles it directly
        // Only serve static files from dist if they exist (production mode)
        if (!isApiRequest && !isWsRequest) {
          // In development: tell user to use Vite directly
          if (isDev) {
            return new Response(
              "UI not available through Gateway in development.\n\n" +
              "Use Vite directly: http://localhost:5173\n",
              { status: 404, headers: { "Content-Type": "text/plain" } }
            );
          }

          // In production: serve from dist folder
          // Priority: HIVE_UI_DIR env > ~/.hive/ui > process.cwd()/packages/hive-ui/dist
          const uiDirFromEnv = process.env.HIVE_UI_DIR;
          const uiDirFromHive = path.join(getHiveDir(), "ui");
          const uiDirFromCwd = path.join(process.cwd(), "packages/hive-ui/dist");
          const uiDir = uiDirFromEnv
            || (existsSync(path.join(uiDirFromHive, "index.html")) ? uiDirFromHive : uiDirFromCwd);
          let subPath = url.pathname;

          // En setup mode: / y /ui redirigen a /setup
          if (gatewaySetupMode && (subPath === "/" || subPath === "/ui" || subPath === "/ui/")) {
            return Response.redirect(`http://${host}:${port}/setup`, 302);
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

          const filePath = path.join(uiDir, subPath);
          const uiFile = Bun.file(filePath);
          if (await uiFile.exists()) {
            return new Response(uiFile);
          }

          // If it's a UI route and no dist, show message
          if (isUiRequest || isSetupRequest) {
            return new Response(
              "UI not found.\n\n" +
              "Options:\n" +
              "  1. Place the UI in ~/.hive/ui/ (copy hive-ui/dist contents there)\n" +
              "  2. Set HIVE_UI_DIR=/path/to/ui\n" +
              "  3. Build from source: cd packages/hive-ui && bun run build\n",
              { status: 404, headers: { "Content-Type": "text/plain" } }
            );
          }
        }

        // Handle /dashboard redirect for backwards compatibility
        if (url.pathname.startsWith("/dashboard")) {
          const tokenParam = url.searchParams.get("token") ? `? token = ${url.searchParams.get("token")} ` : "";
          return Response.redirect(`/ ui${tokenParam} `, 301);
        }

        // ── Rutas que requieren autenticación ────────────────────────────────
        if (!checkAuth(req, url)) {
          log.warn(`[AUTH] Unauthorized request to ${url.pathname} from ${req.headers.get("origin")} `);
          return new Response("Unauthorized", { status: 401 });
        }

        // ── Setup API ────────────────────────────────────────────────────────
        // GET /api/setup/status
        if (url.pathname === "/api/setup/status" || url.pathname === "/api/setup/status/") {
          return addCorsHeaders(await handleSetupStatus(), req)
        }

        // POST /api/setup/verify-provider
        if (url.pathname === "/api/setup/verify-provider" && req.method === "POST") {
          return addCorsHeaders(await handleVerifyProvider(req), req)
        }

        // POST /api/setup/complete
        if (url.pathname === "/api/setup/complete" && req.method === "POST") {
          return await handleCompleteSetup(req, config, addCorsHeaders)
        }

        // ── Status ───────────────────────────────────────────────────────────
        if (url.pathname === "/status" || url.pathname === "/status/") {
          return addCorsHeaders(new Response(
            JSON.stringify({
              status: "ok",
              version: "0.1.7",
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

        // ── Projects API ─────────────────────────────────────────────────────
        if ((url.pathname === "/api/projects" || url.pathname === "/api/projects/") && req.method === "GET") {
          return await handleGetProjects(req, addCorsHeaders)
        }

        if (url.pathname === "/api/projects/active" && req.method === "GET") {
          return await handleGetActiveProject(req, addCorsHeaders)
        }

        if (url.pathname === "/api/projects/history" && req.method === "GET") {
          return await handleGetProjectHistory(req, addCorsHeaders)
        }

        const projectDetailMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/)
        if (projectDetailMatch && req.method === "GET") {
          const projectId = projectDetailMatch[1]
          return await handleGetProjectDetail(req, addCorsHeaders, projectId)
        }

        if (projectDetailMatch && (req.method === "PATCH" || req.method === "PUT")) {
          return await handleUpdateProject(req, addCorsHeaders)
        }

        const projectTasksMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/)
        if (projectTasksMatch && req.method === "GET") {
          const projectId = projectTasksMatch[1]
          return await handleGetProjectTasks(req, addCorsHeaders, projectId)
        }

        // POST /api/projects — crear nuevo proyecto
        if (url.pathname === "/api/projects" && req.method === "POST") {
          return await handleCreateProject(req, addCorsHeaders)
        }

        // ── Tasks API ─────────────────────────────────────────────────────
        if ((url.pathname === "/api/tasks" || url.pathname === "/api/tasks/") && req.method === "GET") {
          return await handleGetTasks(req, addCorsHeaders)
        }

        const taskDetailMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/)
        if (taskDetailMatch && req.method === "PATCH") {
          return await handleUpdateTask(req, addCorsHeaders)
        }



        // ── Channels API ─────────────────────────────────────────────────────
        if ((url.pathname === "/api/channels" || url.pathname === "/api/channels/") && req.method === "POST") {
          return await handleCreateChannel(req, addCorsHeaders, channelManager);
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
            if (req.method === "GET") {
              return await handleGetWorkspace(req, addCorsHeaders, workspacePath, wsType);
            }
            if (req.method === "POST") {
              const reloadFn = async (type: string) => {
                if (type === "soul") agent.reloadSoul();
                if (type === "user") agent.reloadUser();
                if (type === "ethics") await agent.reloadEthics();
              };
              return await handleUpdateWorkspace(req, addCorsHeaders, workspacePath, wsType, reloadFn);
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
          const { name, category, tools, triggers, body: bodyContent } = body
          if (!name) return addCorsHeaders(new Response("Missing name", { status: 400 }), req)
          const id = randomUUID()
          getDb().query(`INSERT INTO skills(id, name, category, tools, triggers, body, version, active) VALUES(?, ?, ?, ?, ?, ?, 1, 1)`).run(id, name, category || "", tools || "", triggers || "", bodyContent || "")
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
          getDb().query(`INSERT INTO ethics(id, name, description, content, is_default, enabled, active) VALUES(?, ?, ?, ?, ?, 1, 1)`).run(id, name, description || "", content, is_default ? 1 : 0)
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
            getDb().query(`UPDATE mcp_servers SET active = ?, enabled = ? WHERE id = ? OR name = ?`).run(active ? 1 : 0, active ? 1 : 0, mcpName, mcpName)

            // Connect/Disconnect MCP server in real-time (no restart needed)
            try {
              const mcp = agent?.getMCPManager() ?? null;
              if (mcp) {
                log.info(`[MCP] Manager found, connecting ${mcpName}...`)
                if (active) {
                  const server = getDb().query(`SELECT * FROM mcp_servers WHERE id = ? OR name = ?`).get(mcpName, mcpName) as Record<string, any> | undefined;
                  if (server) {
                    log.info(`[MCP] Server config: transport=${server.transport}, url=${server.url}`)

                    // Build MCP server config
                    const mcpServerConfig: any = {
                      transport: server.transport as string,
                      command: server.command as string | null,
                      args: server.args ? JSON.parse(server.args as string) : [],
                      url: server.url as string | null,
                      enabled: true,
                    }

                    // Decrypt headers if present
                    if (server.headers_encrypted && server.headers_iv) {
                      try {
                        mcpServerConfig.headers = decryptConfig(server.headers_encrypted, server.headers_iv);
                      } catch (e) {
                        log.warn(`Failed to decrypt headers for ${mcpName}`);
                      }
                    }

                    // Get current MCP config and add/update this server
                    const currentConfig = (mcp as any).config || { servers: {} }
                    const newServersConfig = { ...currentConfig.servers }
                    newServersConfig[mcpName] = mcpServerConfig

                    // Update MCP Manager config (this will register and auto-connect the server)
                    await mcp.updateConfig({
                      ...currentConfig,
                      servers: newServersConfig,
                    });

                    log.info(`[MCP] Server registered in MCP Manager`)

                    // Get tools after connection
                    const tools = mcp.getServerTools(mcpName) || [];
                    log.info(`[MCP] Connected! Tools: ${tools.length}`)
                    getDb().query(`UPDATE mcp_servers SET status = ?, tools_count = ? WHERE id = ? OR name = ?`).run("connected", tools.length, mcpName, mcpName);
                  } else {
                    log.error(`[MCP] Server not found in DB: ${mcpName}`)
                  }
                } else {
                  await mcp.disconnectServer(mcpName);
                  getDb().query(`UPDATE mcp_servers SET status = ? WHERE id = ? OR name = ?`).run("disconnected", mcpName, mcpName);
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
            getDb().query(`UPDATE mcp_servers SET active = ?, enabled = ? WHERE id = ? OR name = ?`).run(active ? 1 : 0, active ? 1 : 0, mcpName, mcpName)

            // Connect/Disconnect MCP server in real-time (no restart needed)
            try {
              const mcp = agent?.getMCPManager() ?? null;
              if (mcp) {
                if (active) {
                  const server = getDb().query(`SELECT * FROM mcp_servers WHERE id = ? OR name = ?`).get(mcpName, mcpName) as Record<string, any> | undefined;
                  if (server) {
                    log.info(`[MCP] Server config: transport=${server.transport}, url=${server.url}`)

                    // Build MCP server config
                    const mcpServerConfig: any = {
                      transport: server.transport as string,
                      command: server.command as string | null,
                      args: server.args ? JSON.parse(server.args as string) : [],
                      url: server.url as string | null,
                      enabled: true,
                    }

                    // Decrypt headers if present
                    if (server.headers_encrypted && server.headers_iv) {
                      try {
                        mcpServerConfig.headers = decryptConfig(server.headers_encrypted, server.headers_iv);
                      } catch (e) {
                        log.warn(`Failed to decrypt headers for ${mcpName}`);
                      }
                    }

                    // Get current MCP config and add/update this server
                    const currentConfig = (mcp as any).config || { servers: {} }
                    const newServersConfig = { ...currentConfig.servers }
                    newServersConfig[mcpName] = mcpServerConfig

                    // Update MCP Manager config (this will register and auto-connect the server)
                    await mcp.updateConfig({
                      ...currentConfig,
                      servers: newServersConfig,
                    });

                    log.info(`[MCP] Server registered in MCP Manager`)

                    // Get tools after connection
                    const tools = mcp.getServerTools(mcpName) || [];
                    log.info(`[MCP] Connected! Tools: ${tools.length}`)

                    // Update DB with status and tools
                    getDb().query(`UPDATE mcp_servers SET status = ?, tools_count = ? WHERE id = ? OR name = ?`).run("connected", tools.length, mcpName, mcpName);
                  } else {
                    log.error(`[MCP] Server not found in DB: ${mcpName}`)
                  }
                } else {
                  await mcp.disconnectServer(mcpName);
                  getDb().query(`UPDATE mcp_servers SET status = ? WHERE id = ? OR name = ?`).run("disconnected", mcpName, mcpName);
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
          return await handleGetChannels(req, addCorsHeaders);
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

        // ── Chat / Canvas / Notes API ───────────────────────────────────────
        if (url.pathname === "/api/chat/history" && req.method === "GET") {
          return await handleGetChatHistory(req, addCorsHeaders)
        }

        if (url.pathname === "/api/chat" && req.method === "POST") {
          return await handlePostChat(req, addCorsHeaders)
        }

        if (url.pathname === "/api/canvas" && req.method === "GET") {
          return await handleGetCanvas(req, addCorsHeaders)
        }

        if (url.pathname === "/api/notes" && req.method === "GET") {
          return await handleGetNotes(req, addCorsHeaders)
        }

        // ── Cron Jobs API ───────────────────────────────────────────────────
        if (url.pathname === "/api/cron-jobs" && req.method === "GET") {
          return await handleGetCronJobs(req, addCorsHeaders)
        }

        if (url.pathname === "/api/cron-jobs/channels" && req.method === "GET") {
          return await handleGetCronChannels(req, addCorsHeaders)
        }

        if (url.pathname.match(/^\/api\/cron-jobs\/[^/]+\/toggle$/) && req.method === "PATCH") {
          return await handleUpdateCronJob(req, addCorsHeaders)
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
      open(ws) {
        const data = ws.data;
        const isCanvas = data.sessionId.startsWith("canvas:");
        const isBridge = data.sessionId.startsWith("bridge:");

        if (isBridge) {
          log.info(`Bridge events client connected: ${data.sessionId}`);
          subscribeBridge(ws as any);
          ws.send(JSON.stringify({ type: "bridge:connected", sessionId: data.sessionId }));
          return;
        }

        if (isCanvas) {
          log.info(`Canvas session connected: ${data.sessionId} `);
          canvasManager.registerSession(data.sessionId, ws as any);
          subscribeCanvas(ws as any);
          ws.send(JSON.stringify({ type: "canvas:connected", sessionId: data.sessionId }));
          // Send initial snapshot so canvas shows current state
          ws.send(JSON.stringify({ type: "canvas:snapshot", data: getCanvasSnapshot() }));
          return;
        }

        log.debug(`WebSocket connected: ${data.sessionId} `);

        sessionManager.create(data.sessionId, ws);

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
          const db = getDb();
          const user = db.query("SELECT id, name, language FROM users LIMIT 1").get() as { id: string; name: string; language: string } | undefined;
          const agent = db.query("SELECT id, name, provider_id, model_id FROM agents WHERE role = 'coordinator' LIMIT 1").get() as { id: string; name: string; provider_id: string; model_id: string } | undefined;

          // Get channels
          const channels = db.query("SELECT id FROM channels WHERE active = 1").all() as Array<{ id: string }>;

          // Get voice config from webchat channel
          const voiceConfig = db.query("SELECT voice_enabled, stt_provider, tts_provider FROM channels WHERE id = 'webchat'").get() as { voice_enabled: number; stt_provider: string; tts_provider: string } | undefined;

          // Get code bridge
          const codeBridge = db.query("SELECT id FROM code_bridge WHERE enabled = 1").all() as Array<{ id: string }>;

          ws.send(JSON.stringify({
            type: "welcome",
            sessionId: user?.id || data.sessionId,
            user: user ? { id: user.id, name: user.name, language: user.language } : null,
            agent: agent ? { id: agent.id, name: agent.name, provider: agent.provider_id, model: agent.model_id } : null,
            channels: channels.map(c => c.id),
            voice: voiceConfig ? {
              enabled: voiceConfig.voice_enabled === 1,
              sttProvider: voiceConfig.stt_provider,
              ttsProvider: voiceConfig.tts_provider
            } : { enabled: false, sttProvider: null, ttsProvider: null },
            codeBridge: codeBridge.map(cb => cb.id)
          } as OutboundMessage));
        } catch (err) {
          log.error("Error sending welcome message:", err);
        }
      },

      async message(ws, message) {
        const data = ws.data;

        // Bridge events clients are read-only; ignore any messages they send
        if (data.sessionId.startsWith("bridge:")) return;

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

        // Canvas subscribe
        if (msg.type === "canvas_subscribe") {
          subscribeCanvas(ws);
          ws.send(JSON.stringify({
            type: "canvas:snapshot",
            data: getCanvasSnapshot(),
          }));
          return;
        }

        // Canvas unsubscribe
        if (msg.type === "canvas_unsubscribe") {
          unsubscribeCanvas(ws);
          return;
        }

        // Canvas session - handle interactions
        if (data.sessionId.startsWith("canvas:")) {
          canvasManager.handleMessage(data.sessionId, message);
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

        // Handle audio messages from WebChat
        let webchatPreferAudio = false;
        if (msg.type === "audio" && msg.audio) {
          log.info(`WebChat audio from session ${msg.sessionId}`);

          const voiceConfig = voiceService.getChannelVoiceConfig("webchat");

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

            webchatPreferAudio = true;

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

            laneQueue.enqueue(msg.sessionId, async (_task, signal) => {
              if (signal.aborted) {
                ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: msg.sessionId } as OutboundMessage));
                ws.send(JSON.stringify({ type: "error", sessionId: msg.sessionId, error: "Task cancelled" } as OutboundMessage));
                return;
              }

              try {
                const unifiedSessionId = msg.sessionId;
                const messages = [{ role: "user" as const, content: messageContent }];
                log.info(`Generating response for session ${unifiedSessionId}...`);

                const { userId } = resolveContext({
                  channel: "webchat",
                  channelUserId: msg.sessionId,
                });

                // Streaming: send tokens as they arrive
                let streamedContent = "";
                let messageId = crypto.randomUUID();

                const response = await runner.generate({
                  provider: dbProvider as any,
                  messages,
                  maxTokens: 4096,
                  tools: prepareTools(agent, unifiedSessionId),
                  maxSteps: 15,
                  threadId: unifiedSessionId,
                  userId,
                  onToken: async (token: string) => {
                    if (signal.aborted) return;
                    streamedContent += token;
                    // Send chunk to client
                    ws.send(JSON.stringify({
                      type: "message",
                      id: messageId,
                      sessionId: unifiedSessionId,
                      content: token,
                      isChunk: true,
                      isStep: false,
                    } as OutboundMessage));
                  },
                  onStep: async (step) => {
                    if (signal.aborted) return;
                    if (step.type === "tool_result" && step.message) {
                      try {
                        const result = JSON.parse(step.message);
                        if (result._sendToUser || result.status) {
                          const userMessage = result.message || result.status || step.message;
                          ws.send(JSON.stringify({
                            type: "message",
                            sessionId: unifiedSessionId,
                            content: `📊 ${userMessage}`,
                            isStep: true,
                          } as unknown as OutboundMessage));
                          return;
                        }
                      } catch { }
                    }
                    log.debug(`[TOOL] ${step.type}: ${step.toolName || ""}`);
                  },
                });

                // Use streamed content from onToken, fallback to response.content
                const content = streamedContent || response.content?.trim() || "";
                log.info(`Response sent to session ${unifiedSessionId} (${content.length} chars)`);

                const voiceCfg = voiceService.getChannelVoiceConfig("webchat");
                const shouldSpeak = webchatPreferAudio;
                let responseType: "text" | "audio" = "text";
                let ttsProviderUsed: string | null = null;
                let ttsMimeType: string | null = null;

                ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: unifiedSessionId } as OutboundMessage));

                // Don't send text message if already streamed (content came via onToken)
                const alreadyStreamed = streamedContent.length > 0;

                if (content && !alreadyStreamed) {
                  if (shouldSpeak) {
                    if (!voiceCfg.ttsProvider) {
                      ws.send(JSON.stringify({
                        type: "message",
                        sessionId: unifiedSessionId,
                        content: `${content}\n\n🔊 Para recibir respuestas en audio, configura el proveedor TTS en Configuración > Canales > WebChat (ej: elevenlabs)`,
                        isStep: false,
                      } as OutboundMessage));
                    } else {
                      try {
                        log.info(`🔊 TTS enabled, synthesizing audio for WebChat...`);
                        const audioOutput = await voiceService.speak(content, voiceCfg.ttsProvider, voiceCfg.ttsVoiceId || undefined);
                        ttsProviderUsed = voiceCfg.ttsProvider;
                        ttsMimeType = audioOutput.mimeType;
                        responseType = "audio";
                        const base64Audio = (audioOutput.data as Buffer).toString("base64");
                        ws.send(JSON.stringify({
                          type: "audio",
                          sessionId: unifiedSessionId,
                          audio: base64Audio,
                          content,
                          mimeType: audioOutput.mimeType,
                        } as OutboundMessage));
                      } catch (ttsError) {
                        log.error(`TTS failed: ${(ttsError as Error).message}), sending text instead`);
                        ws.send(JSON.stringify({ type: "message", sessionId: unifiedSessionId, content, isStep: false } as OutboundMessage));
                      }
                    }
                  } else {
                    ws.send(JSON.stringify({ type: "message", sessionId: unifiedSessionId, content, isStep: false } as OutboundMessage));
                  }
                }
              } catch (error) {
                ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: msg.sessionId } as OutboundMessage));
                ws.send(JSON.stringify({
                  type: "error",
                  sessionId: msg.sessionId,
                  error: (error as Error).message,
                } as OutboundMessage));
                log.error(`Error for session ${msg.sessionId}: ${(error as Error).message}`);
              }
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

          laneQueue.enqueue(msg.sessionId, async (_task, signal) => {
            if (signal.aborted) {
              ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: msg.sessionId } as OutboundMessage));
              ws.send(JSON.stringify({ type: "error", sessionId: msg.sessionId, error: "Task cancelled" } as OutboundMessage));
              return;
            }

            try {
              const unifiedSessionId = msg.sessionId;
              const messages = [{ role: "user" as const, content: msg.content }];
              log.info(`Generating response for session ${unifiedSessionId}...`);

              const { userId } = resolveContext({
                channel: "webchat",
                channelUserId: msg.sessionId,
              });

              // Streaming: send tokens as they arrive
              let streamedContent = "";
              let messageId = crypto.randomUUID();

              const response = await runner.generate({
                provider: dbProvider as any,
                messages,
                maxTokens: 4096,
                tools: prepareTools(agent, unifiedSessionId),
                maxSteps: 15,
                threadId: unifiedSessionId,
                userId,
                onToken: async (token: string) => {
                  if (signal.aborted) return;
                  streamedContent += token;
                  // Send chunk to client
                  ws.send(JSON.stringify({
                    type: "message",
                    id: messageId,
                    sessionId: unifiedSessionId,
                    content: token,
                    isChunk: true,
                    isStep: false,
                  } as OutboundMessage));
                },
                onStep: async (step) => {
                  if (signal.aborted) return;

                  // Para tool_result, verificar si es un mensaje de progreso
                  if (step.type === "tool_result" && step.message) {
                    try {
                      const result = JSON.parse(step.message);
                      if (result._sendToUser || result.status) {
                        const userMessage = result.message || result.status || step.message;
                        ws.send(JSON.stringify({
                          type: "message",
                          sessionId: unifiedSessionId,
                          content: `📊 ${userMessage}`,
                          isStep: true,
                        } as unknown as OutboundMessage));
                        return;
                      }
                    } catch {
                      // No es JSON de progreso
                    }
                  }

                  log.debug(`[TOOL] ${step.type}: ${step.toolName || ""}`);
                },
              });

              // Use streamed content from onToken, fallback to response.content
              const content = streamedContent || response.content?.trim() || "";
              log.info(`Response sent to session ${unifiedSessionId} (${content.length} chars)`);

              const voiceConfig = voiceService.getChannelVoiceConfig("webchat");
              const shouldSpeak = webchatPreferAudio;
              let responseType: "text" | "audio" = "text";
              let ttsProviderUsed: string | null = null;
              let ttsMimeType: string | null = null;

              ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: unifiedSessionId } as OutboundMessage));

              // Don't send text message if already streamed (content came via onToken)
              const alreadyStreamed = streamedContent.length > 0;

              if (content && !alreadyStreamed) {
                if (shouldSpeak) {
                  if (!voiceConfig.ttsProvider) {
                    ws.send(JSON.stringify({
                      type: "message",
                      sessionId: unifiedSessionId,
                      content: `${content}\n\n🔊 Para recibir respuestas en audio, configura el proveedor TTS en Configuración > Canales > WebChat (ej: elevenlabs)`,
                      isStep: false
                    } as OutboundMessage));
                  } else {
                    try {
                      log.info(`🔊 TTS enabled, synthesizing audio for WebChat...`);
                      const audioOutput = await voiceService.speak(content, voiceConfig.ttsProvider, voiceConfig.ttsVoiceId || undefined);
                      ttsProviderUsed = voiceConfig.ttsProvider;
                      ttsMimeType = audioOutput.mimeType;
                      responseType = "audio";

                      const base64Audio = (audioOutput.data as Buffer).toString("base64");

                      ws.send(JSON.stringify({
                        type: "audio",
                        sessionId: unifiedSessionId,
                        audio: base64Audio,
                        content,
                        mimeType: audioOutput.mimeType,
                      } as OutboundMessage));
                    } catch (ttsError) {
                      log.error(`TTS failed: ${(ttsError as Error).message}), sending text instead`);
                      ws.send(JSON.stringify({ type: "message", sessionId: unifiedSessionId, content, isStep: false } as OutboundMessage));
                    }
                  }
                } else {
                  ws.send(JSON.stringify({ type: "message", sessionId: unifiedSessionId, content, isStep: false } as OutboundMessage));
                }
              }
            } catch (error) {
              const unifiedSessionId = msg.sessionId;
              // Detener typing aunque falle — nunca dejar el spinner infinito
              ws.send(JSON.stringify({ type: "typing", isTyping: false, sessionId: unifiedSessionId } as OutboundMessage));
              ws.send(JSON.stringify({
                type: "error",
                sessionId: unifiedSessionId,
                error: (error as Error).message,
              } as OutboundMessage));
              log.error(`Error for session ${unifiedSessionId}: ${(error as Error).message}`);
            }
          });

          return;
        }

        ws.send(JSON.stringify({
          type: "error",
          sessionId: msg.sessionId,
          error: "Unknown message type",
        } as OutboundMessage));
      },

      close(ws) {
        const data = ws.data;
        const isCanvas = data.sessionId.startsWith("canvas:");
        const isBridge = data.sessionId.startsWith("bridge:");

        if (isBridge) {
          unsubscribeBridge(ws as any);
          return;
        }

        if (isCanvas) {
          canvasManager.unregisterSession(data.sessionId);
          unsubscribeCanvas(ws as any);
          return;
        }

        log.debug(`WebSocket disconnected: ${data.sessionId}`);
        logSubscribers.delete(data.sessionId);
        sessionManager.delete(data.sessionId);
        laneQueue.cancel(data.sessionId);

        const channel = channelManager?.getChannel("webchat") as any;
        if (channel?.unregisterConnection) channel.unregisterConnection(data.sessionId);
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
    // In development: UI is served by Vite on port 5173
    log.info(`[gateway] API:       http://${host}:${port}`);
    log.info(`[gateway] WebSocket: ws://${host}:${port}/ws`);
    log.info(`[gateway] Canvas:    ws://${host}:${port}/canvas`);
    log.info(`[gateway] Modo:     desarrollo`);
    if (!isGatewayChild) {
      log.info(`🐝 Administra tu Hive aquí: http://localhost:5173`);
    }
  } else {
    // In production: Gateway serves UI from dist/
    const isSetupMode = gatewaySetupMode;
    const baseUrl = `http://${host}:${port}`;
    const uiUrl = isSetupMode ? `${baseUrl}/setup` : `${baseUrl}/ui`;

    log.info(`[gateway] UI:        ${uiUrl}`);
    log.info(`[gateway] API:       http://${host}:${port}`);
    log.info(`[gateway] WebSocket: ws://${host}:${port}/ws`);
    log.info(`[gateway] Canvas:    ws://${host}:${port}/canvas`);

    log.info(isSetupMode ? `🎉 Primer arranque — abriendo wizard de configuración...` : `🐝 Administra tu Hive aquí: ${uiUrl}`);

    // Always open browser on startup (setup and normal mode).
    // Set NO_BROWSER=1 to skip in headless/server environments.
    if (!process.env.NO_BROWSER) {
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

  // FIX 7 — SIGTERM desconecta MCP limpiamente antes de cerrar
  process.on("SIGTERM", async () => {
    log.info("Received SIGTERM, shutting down gracefully...");
    watchers.forEach((close) => close());
    const mcp = agent?.getMCPManager();
    if (mcp) {
      log.info("Disconnecting MCP servers...");
      await mcp.disconnectAll().catch(() => { });
    }
    if (channelManager) await channelManager.stopAll();
    server.stop();
    try { unlinkSync(pidFile); } catch { }
    process.exit(0);
  });

  process.on("SIGHUP", async () => {
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