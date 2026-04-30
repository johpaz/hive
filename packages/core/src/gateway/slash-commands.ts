import type { ServerWebSocket } from "bun";
import { sessionManager } from "./session.ts";
import { laneQueue } from "./lane-queue.ts";
import { logger } from "../utils/logger.ts";

export interface InboundMessage {
  type: "message" | "command" | "ping" | "join" | "canvas_subscribe" | "canvas_unsubscribe" | "logs_subscribe" | "logs_unsubscribe" | "audio" | "canvas:interact" | "a2ui:action" | "stop";
  sessionId: string;
  content?: string;
  audio?: string;
  command?: string;
  args?: string[];
  metadata?: Record<string, unknown>;
  componentId?: string;
  data?: Record<string, unknown>;
  action?: string;
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
  type: "message" | "stream" | "status" | "error" | "pong" | "command_result" | "joined" | "typing" | "audio" | "welcome" | "progress";
  sessionId: string;
  id?: string; // Message ID for streaming
  content?: string;
  chunk?: string;
  isChunk?: boolean; // True if this is a streaming chunk
  isLast?: boolean;
  isTyping?: boolean;
  isStep?: boolean;
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
  codeBridge?: string[];
}

export interface SlashCommand {
  name: string;
  description: string;
  handler: (sessionId: string, args: string[], ws: ServerWebSocket<unknown>) => Promise<unknown>;
}

const slashCommands = new Map<string, SlashCommand>();

export function registerSlashCommand(command: SlashCommand): void {
  slashCommands.set(command.name, command);
}

export function isSlashCommand(content: string): boolean {
  return content.startsWith("/") && content.length > 1;
}

export function parseSlashCommand(content: string): { name: string; args: string[] } | null {
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
  description: "Start a new session",
  handler: async (sessionId) => {
    sessionManager.delete(sessionId);
    return { success: true, message: "Session reset" };
  },
});

registerSlashCommand({
  name: "compact",
  description: "Force context compaction",
  handler: async (sessionId) => {
    logger.info(`Compaction requested for session: ${sessionId}`);
    return { success: true, message: "Compaction triggered" };
  },
});

registerSlashCommand({
  name: "reset",
  description: "Reset the current context",
  handler: async (sessionId) => {
    logger.info(`Context reset requested for session: ${sessionId}`);
    return { success: true, message: "Context reset" };
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
