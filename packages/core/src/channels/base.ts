import { readArtifactBytes } from "../artifacts/store";

/**
 * Resolves an OutboundMessage.image to raw bytes for channels that need to
 * upload a photo directly (Telegram/Discord/Slack/WhatsApp) — prefers the
 * artifact on disk (artifactId, the common path from mcp-result-normalizer.ts
 * results) over an inline base64 payload.
 */
export async function readOutboundImageBytes(
  image: NonNullable<OutboundMessage["image"]>,
): Promise<Buffer | null> {
  if (image.artifactId) {
    const artifact = await readArtifactBytes(image.artifactId);
    if (artifact) return artifact.bytes;
  }
  if (image.base64) return Buffer.from(image.base64, "base64");
  return null;
}

export interface OutboundMessage {
  type: "message" | "stream" | "status" | "error" | "pong" | "command_result" | "log" | "typing" | "audio" | "process" | "progress" | "notification";
  sessionId: string;
  id?: string; // Message ID for streaming
  messageId?: string;
  content?: string;
  chunk?: string;
  isChunk?: boolean; // True if this is a streaming chunk
  isLast?: boolean;
  isStep?: boolean;
  processKind?: "analysis" | "tool" | "observation" | "writing";
  processStatus?: "thinking" | "done" | "error";
  label?: string;
  detail?: string;
  summary?: string;
  stepType?: "plan" | "tool_call" | "tool_result" | "text";
  audio?: {
    buffer?: Buffer;
    base64?: string;
    mimeType?: string;
  };
  /** Image artifact to show alongside the response (e.g. an MCP image-generation tool's result — see mcp-result-normalizer.ts). `url` points at the artifacts download endpoint (webchat/HTTP consumers); `artifactId` lets server-side channels (Telegram/Discord/Slack/WhatsApp) read the bytes straight off disk via artifacts/store.ts's readArtifactBytes — no HTTP round trip needed since they run in the same process. */
  image?: {
    artifactId?: string;
    url?: string;
    base64?: string;
    mimeType?: string;
    caption?: string;
  };
  document?: {
    url?: string;
    base64?: string;
    mimeType?: string;
    filename?: string;
  };
  status?: {
    state: string;
    model?: string;
    tokens?: number;
  };
  error?: string;
  result?: unknown;
  notificationId?: string;
  createdAt?: number;
  logEntry?: {
    timestamp: string;
    level: string;
    source: string;
    message: string;
    meta?: Record<string, unknown>;
  };
}

export interface IncomingMessage {
  sessionId: string;
  channel: string;
  accountId: string;
  peerId: string;
  peerKind: "direct" | "group";
  content: string;
  audio?: {
    buffer?: Buffer;
    url?: string;
    base64?: string;
    mimeType?: string;
  };
  image?: {
    url?: string;
    base64?: string;
    buffer?: Buffer;
    mimeType?: string;
    caption?: string;
  };
  document?: {
    url?: string;
    base64?: string;
    buffer?: Buffer;
    mimeType?: string;
    fileName?: string;
  };
  metadata?: Record<string, unknown>;
  replyToId?: string;
}

export interface ChannelConfig {
  enabled: boolean;
  dmPolicy: "open" | "pairing" | "allowlist";
  allowFrom: string[];
}

export interface IChannel {
  name: string;
  accountId: string;
  config: ChannelConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(sessionId: string, message: OutboundMessage): Promise<void>;
  sendAudio?(sessionId: string, audio: Buffer, mimeType: string): Promise<void>;
  onMessage(handler: MessageHandler): void;
  isRunning(): boolean;
  startTyping?(sessionId: string): Promise<void>;
  stopTyping?(sessionId: string): Promise<void>;
  markAsRead?(sessionId: string, messageId?: string): Promise<void>;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

export abstract class BaseChannel implements IChannel {
  abstract name: string;
  abstract accountId: string;
  abstract config: ChannelConfig;

  protected messageHandler?: MessageHandler;
  protected running = false;
  protected typingIntervals: Map<string, Timer> = new Map();

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(sessionId: string, message: OutboundMessage): Promise<void>;

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  isRunning(): boolean {
    return this.running;
  }

  async startTyping(_sessionId: string): Promise<void> {
    // Default: no-op, override in subclasses
  }

  async stopTyping(sessionId: string): Promise<void> {
    const interval = this.typingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(sessionId);
    }
  }

  async markAsRead(_sessionId: string, _messageId?: string): Promise<void> {
    // Default: no-op, override in subclasses
  }

  protected async handleMessage(message: IncomingMessage): Promise<void> {
    if (this.messageHandler) {
      await this.messageHandler(message);
    }
  }

  protected isUserAllowed(peerId: string): boolean {
    if (this.config.dmPolicy === "open") {
      return true;
    }

    const normalizedPeerId = `${this.name}:${peerId}`;

    if (this.config.dmPolicy === "allowlist") {
      return this.config.allowFrom.some(
        (allowed) => allowed === peerId || allowed === normalizedPeerId
      );
    }

    if (this.config.dmPolicy === "pairing") {
      return this.config.allowFrom.some(
        (allowed) => allowed === peerId || allowed === normalizedPeerId
      );
    }

    return false;
  }

  protected formatSessionId(peerId: string, _kind: "direct" | "group"): string {
    return peerId;
  }
}
