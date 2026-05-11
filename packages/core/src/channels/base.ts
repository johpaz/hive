export interface OutboundMessage {
  type: "message" | "stream" | "status" | "error" | "pong" | "command_result" | "log" | "typing" | "audio";
  sessionId: string;
  id?: string; // Message ID for streaming
  content?: string;
  chunk?: string;
  isChunk?: boolean; // True if this is a streaming chunk
  isLast?: boolean;
  isStep?: boolean;
  stepType?: "plan" | "tool_call" | "tool_result" | "text";
  audio?: {
    buffer?: Buffer;
    base64?: string;
    mimeType?: string;
  };
  status?: {
    state: string;
    model?: string;
    tokens?: number;
  };
  error?: string;
  result?: unknown;
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
