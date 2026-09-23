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

  private explicitAccountId?: string;
  /**
   * Every open socket of a session. One user can hold several at once — the
   * desktop app and a browser tab, or overlapping reconnects after a gateway
   * restart. Keeping only the last one meant that closing it orphaned the
   * sockets still open: the UI stayed "connected" while every reply was lost.
   */
  private connections: Map<string, Set<ServerWebSocket<WebSocketData>>> = new Map();
  private log = logger.child("webchat");

  constructor(config: WebChatConfig) {
    super();
    this.config = config;
    this.explicitAccountId = config.accountId;
    this.accountId = config.accountId || "webchat";
  }

  async start(): Promise<void> {
    // Resolve accountId from database (single user) if not provided explicitly
    if (!this.explicitAccountId) {
      this.accountId = (await resolveUserId({})) || "webchat";
    }
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
    const sockets = this.connections.get(data.sessionId) ?? new Set();
    sockets.add(ws);
    this.connections.set(data.sessionId, sockets);
    this.log.debug(`WebChat connection registered: ${data.sessionId} (${sockets.size} open)`);
  }

  /** Without `ws`, forgets every socket of the session. */
  unregisterConnection(sessionId: string, ws?: ServerWebSocket<WebSocketData>): void {
    const sockets = this.connections.get(sessionId);
    if (!sockets) return;
    if (ws) sockets.delete(ws);
    if (!ws || sockets.size === 0) this.connections.delete(sessionId);
    this.log.debug(`WebChat connection unregistered: ${sessionId} (${ws ? sockets.size : 0} open)`);
  }

  /**
   * Sends `payload` to every open socket of the session; a socket that throws
   * is dropped. Returns how many received it.
   */
  private broadcast(sessionId: string, payload: string): number {
    const sockets = this.connections.get(sessionId);
    if (!sockets) return 0;
    let delivered = 0;
    for (const ws of [...sockets]) {
      try {
        ws.send(payload);
        delivered++;
      } catch {
        sockets.delete(ws);
      }
    }
    if (sockets.size === 0) this.connections.delete(sessionId);
    return delivered;
  }

  /** Returns the first active WebChat session ID, or undefined if no one is connected */
  getAnyActiveSession(): string | undefined {
    return this.connections.keys().next().value;
  }

  hasSession(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  async startTyping(sessionId: string): Promise<void> {
    this.broadcast(sessionId, JSON.stringify({ type: "typing", isTyping: true }));
  }

  async stopTyping(sessionId: string): Promise<void> {
    this.broadcast(sessionId, JSON.stringify({ type: "typing", isTyping: false }));
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    if (this.broadcast(sessionId, JSON.stringify(message)) === 0) {
      throw new Error(`No WebChat connection for session: ${sessionId}`);
    }
  }

  async sendAudio(sessionId: string, audio: Buffer, mimeType: string): Promise<void> {
    const delivered = this.broadcast(sessionId, JSON.stringify({
      type: "audio",
      sessionId,
      audio: audio.toString("base64"),
      mimeType,
    }));
    if (delivered === 0) this.log.warn(`No WebChat connection for session: ${sessionId}`);
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
