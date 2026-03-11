import type { ServerWebSocket } from "bun";
import { BaseChannel, type ChannelConfig, type IncomingMessage, type OutboundMessage } from "./base.ts";
import { logger } from "../utils/logger.ts";
import { resolveUserId } from "../storage/onboarding";

export interface WebChatConfig extends ChannelConfig {
  accountId?: string;
  // WebChat doesn't need extra config, it's served from the gateway
}

interface WebSocketData {
  sessionId: string;
  peerId: string;
  authenticatedAt: number;
}

export class WebChatChannel extends BaseChannel {
  name = "webchat";
  accountId: string;
  config: WebChatConfig;

  private connections: Map<string, ServerWebSocket<WebSocketData>> = new Map();
  private log = logger.child("webchat");

  constructor(config: WebChatConfig) {
    super();
    this.config = config;
    // Resolve accountId from database (single user) or use fallback
    this.accountId = config.accountId || resolveUserId({}) || "webchat";
  }

  async start(): Promise<void> {
    this.running = true;
    this.log.info("WebChat channel ready");
  }

  async stop(): Promise<void> {
    this.connections.clear();
    this.running = false;
    this.log.info("WebChat channel stopped");
  }

  registerConnection(ws: ServerWebSocket<WebSocketData>): void {
    const data = ws.data as WebSocketData;
    this.connections.set(data.sessionId, ws);
    this.log.debug(`WebChat connection registered: ${data.sessionId}`);
  }

  unregisterConnection(sessionId: string): void {
    this.connections.delete(sessionId);
    this.log.debug(`WebChat connection unregistered: ${sessionId}`);
  }

  /** Returns the first active WebChat session ID, or undefined if no one is connected */
  getAnyActiveSession(): string | undefined {
    return this.connections.keys().next().value;
  }

  hasSession(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  async startTyping(sessionId: string): Promise<void> {
    const ws = this.connections.get(sessionId);
    if (!ws) return;

    try {
      ws.send(JSON.stringify({ type: "typing", isTyping: true }));
    } catch {
      // Connection closed
    }
  }

  async stopTyping(sessionId: string): Promise<void> {
    const ws = this.connections.get(sessionId);
    if (!ws) return;

    try {
      ws.send(JSON.stringify({ type: "typing", isTyping: false }));
    } catch {
      // Connection closed
    }
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    const ws = this.connections.get(sessionId);

    if (!ws) {
      this.log.warn(`No WebChat connection for session: ${sessionId}`);
      return;
    }

    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      this.log.error(`Failed to send WebChat message: ${(error as Error).message}`);
    }
  }

  async sendAudio(sessionId: string, audio: Buffer, mimeType: string): Promise<void> {
    const ws = this.connections.get(sessionId);

    if (!ws) {
      this.log.warn(`No WebChat connection for session: ${sessionId}`);
      return;
    }

    try {
      const base64Audio = audio.toString("base64");
      ws.send(JSON.stringify({
        type: "audio",
        sessionId,
        audio: base64Audio,
        mimeType,
      }));
    } catch (error) {
      this.log.error(`Failed to send WebChat audio: ${(error as Error).message}`);
    }
  }

  createIncomingMessage(
    sessionId: string,
    content: string,
    peerId: string
  ): IncomingMessage {
    return {
      sessionId,
      channel: "webchat",
      accountId: this.accountId,
      peerId,
      peerKind: "direct",
      content,
    };
  }
}

export function createWebChatChannel(config: WebChatConfig): WebChatChannel {
  return new WebChatChannel(config);
}
