import type { ServerWebSocket } from "bun";
import { sessionManager } from "./session.ts";
import { laneQueue } from "./lane-queue.ts";
import { logger } from "../utils/logger.ts";

export interface InboundMessage {
  type: "message" | "command" | "ping" | "pong" | "join" | "canvas_subscribe" | "canvas_unsubscribe" | "canvas:pong" | "logs_subscribe" | "logs_unsubscribe" | "audio" | "a2ui:action" | "stop" | "notification_sync" | "notification_ack";
  sessionId: string;
  /**
   * Conversación de la web en la que escribir. Opaco: es el id que devuelve
   * /api/conversations. Sin él, el turno va a la conversación más reciente.
   */
  threadId?: string;
  content?: string;
  audio?: string;
  /** Tipo real del audio grabado: el motor del navegador decide si es webm, ogg o mp4. */
  mimeType?: string;
  command?: string;
  args?: string[];
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
  notificationId?: string;
  /** Código de la ventana que contesta al latido del lienzo. */
  connId?: string;
  image?: {
    base64: string;
    mimeType?: string;
    caption?: string;
  };
  document?: {
    base64: string;
    mimeType?: string;
    fileName?: string;
  };
}

export interface OutboundMessage {
  type: "message" | "stream" | "status" | "error" | "pong" | "command_result" | "joined" | "typing" | "audio" | "welcome" | "progress" | "process" | "reasoning" | "notification";
  sessionId: string;
  id?: string; // Message ID for streaming
  messageId?: string;
  content?: string;
  notificationId?: string;
  createdAt?: number;
  chunk?: string;
  isChunk?: boolean; // True if this is a streaming chunk
  isLast?: boolean;
  isTyping?: boolean;
  isStep?: boolean;
  processKind?: "analysis" | "tool" | "observation" | "writing";
  processStatus?: "thinking" | "done" | "error";
  label?: string;
  detail?: string;
  summary?: string;
  stepType?: "plan" | "tool_call" | "tool_result" | "text";
  status?: {
    state: string;
    model?: string;
    tokens?: number;
  };
  error?: string;
  result?: unknown;
  audio?: string; // Base64 encoded audio
  mimeType?: string; // Audio MIME type
  // Welcome message fields
  user?: {
    id: string;
    name: string;
    language: string;
  } | null;
  agent?: {
    id: string;
    name: string;
    provider: string;
    model: string;
  } | null;
  channels?: string[];
  voice?: {
    enabled: boolean;
    sttProvider: string | null;
    ttsProvider: string | null;
  };
}

export interface SlashCommand {
  name: string;
  description: string;
  handler: (sessionId: string, args: string[], ws: ServerWebSocket<unknown>) => Promise<unknown>;
}

const slashCommands = new Map<string, SlashCommand>();

function registerSlashCommand(command: SlashCommand): void {
  slashCommands.set(command.name, command);
}

export function isSlashCommand(content: string): boolean {
  return content.startsWith("/") && content.length > 1;
}

function parseSlashCommand(content: string): { name: string; args: string[] } | null {
  if (!isSlashCommand(content)) return null;

  const parts = content.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  if (!name) return null;

  return {
    name,
    args: parts.slice(1),
  };
}

export async function executeSlashCommand(
  sessionId: string,
  content: string,
  ws: ServerWebSocket<unknown>
): Promise<OutboundMessage | null> {
  const parsed = parseSlashCommand(content);
  if (!parsed) {
    return null;
  }

  const command = slashCommands.get(parsed.name);
  if (!command) {
    return null;
  }

  logger.info(`Executing slash command: /${parsed.name}`, { sessionId, args: parsed.args });

  try {
    const result = await command.handler(sessionId, parsed.args, ws);
    return {
      type: "command_result",
      sessionId,
      result,
    };
  } catch (error) {
    logger.error(`Slash command failed: /${parsed.name}`, { error: (error as Error).message });
    return {
      type: "error",
      sessionId,
      error: (error as Error).message,
    };
  }
}

registerSlashCommand({
  name: "stop",
  description: "Stop the current task",
  handler: async (sessionId) => {
    const cancelled = laneQueue.cancel(sessionId);
    return {
      success: cancelled,
      message: cancelled ? "Task stopped" : "No task running",
    };
  },
});

registerSlashCommand({
  name: "status",
  description: "Show session status",
  handler: async (sessionId) => {
    const session = sessionManager.get(sessionId);
    const queueStatus = laneQueue.getStatus(sessionId);

    return {
      sessionId,
      createdAt: session?.createdAt,
      messageCount: session?.messageCount,
      queueLength: queueStatus.queueLength,
      isProcessing: queueStatus.running !== undefined,
    };
  },
});

registerSlashCommand({
  name: "new",
  description: "Abrir una conversación nueva",
  handler: async (sessionId) => {
    // Antes esto sólo borraba la entrada del socket en memoria y contestaba
    // "Session reset": el contexto seguía intacto y el siguiente mensaje
    // continuaba la misma conversación. Ahora abre una de verdad.
    const { createWebConversation } = await import("../agent/thread-store");
    const { resolveContext } = await import("./resolver");
    try {
      const { userId } = await resolveContext({ channel: "webchat", channelUserId: sessionId });
      const conversation = await createWebConversation(userId);
      return {
        success: true,
        message: "Conversación nueva abierta.",
        threadId: conversation.id,
      };
    } catch (error) {
      return { success: false, message: `No pude abrir la conversación: ${(error as Error).message}` };
    }
  },
});

registerSlashCommand({
  name: "compact",
  description: "Resumir los turnos anteriores para liberar contexto",
  handler: async (sessionId) => {
    const { compactThread } = await import("../agent/compaction");
    const { resolveContext } = await import("./resolver");
    try {
      const { userId, threadId } = await resolveContext({ channel: "webchat", channelUserId: sessionId });
      await compactThread(threadId, { channel: "webchat", userId });
      return { success: true, message: "Listo: resumí los turnos anteriores." };
    } catch (error) {
      return { success: false, message: `No pude compactar: ${(error as Error).message}` };
    }
  },
});

registerSlashCommand({
  name: "reset",
  description: "Borrar el historial de esta conversación",
  handler: async (sessionId) => {
    const { deleteThread } = await import("../agent/thread-store");
    const { resolveContext } = await import("./resolver");
    try {
      const { threadId } = await resolveContext({ channel: "webchat", channelUserId: sessionId });
      await deleteThread(threadId);
      logger.info(`Contexto borrado para el hilo ${threadId}`);
      return { success: true, message: "Historial borrado. Empezamos de cero." };
    } catch (error) {
      return { success: false, message: `No pude borrar el historial: ${(error as Error).message}` };
    }
  },
});

registerSlashCommand({
  name: "model",
  description: "Switch model for this session",
  handler: async (_sessionId, args) => {
    const modelName = args[0];
    if (!modelName) {
      return { success: false, message: "Usage: /model <model-name>" };
    }
    return { success: true, message: `Model switched to: ${modelName}` };
  },
});

registerSlashCommand({
  name: "help",
  description: "Show available commands",
  handler: async () => {
    const commands = Array.from(slashCommands.values()).map((c) => `/${c.name} - ${c.description}`);
    return { commands };
  },
});

registerSlashCommand({
  name: "goal",
  description: "Start a goal-based autonomous run: /goal <meta> [--tries N] [--check-tool tool]",
  handler: async (sessionId, args) => {
    if (args.length === 0) {
      return { success: false, message: "Usage: /goal <meta> [--tries N] [--check-tool tool]" };
    }

    let goalText = "";
    let tries: number | undefined;
    let checkTool: string | undefined;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--tries" && args[i + 1]) {
        tries = parseInt(args[i + 1], 10);
        i++;
      } else if (arg === "--check-tool" && args[i + 1]) {
        checkTool = args[i + 1];
        i++;
      } else {
        goalText += (goalText ? " " : "") + arg;
      }
    }

    if (!goalText) {
      return { success: false, message: "Goal text is required" };
    }

    try {
      const { resolveContext } = await import("./resolver");
      const { resolveAgentId } = await import("../storage/onboarding");
      const { runGoal } = await import("../agent/goal-runner");

      const { userId, threadId, agentId } = await resolveContext({ channel: "webchat", channelUserId: sessionId });
      const goalAgentId = agentId || (await resolveAgentId(null)) || "main";

      const result = await runGoal({
        agentId: goalAgentId,
        threadId,
        userId,
        channel: "webchat",
        goal: goalText,
        goalCheckTool: checkTool ?? null,
        maxAttempts: tries,
      });

      return {
        success: true,
        message: `Goal run enqueued: "${goalText}"\nMax attempts: ${tries ?? 5}\nCheck tool: ${checkTool ?? "LLM verifier"}\n${result.reason}`,
      };
    } catch (error) {
      return { success: false, message: `Failed to start goal run: ${(error as Error).message}` };
    }
  },
});
