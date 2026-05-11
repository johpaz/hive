import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  type WASocket,
  type ConnectionState,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type { ChannelConfig, IncomingMessage, OutboundMessage } from "./base.ts";
import { BaseChannel } from "./base.ts";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.ts";
import { getDb } from "../storage/sqlite.ts";
// @ts-ignore — no type definitions for qrcode-terminal
import qrcodeTerminal from "qrcode-terminal";

// Baileys uses the `ws` npm package which triggers "[bun] Warning: ws.WebSocket 'upgrade'
// event is not implemented in bun" etc. Bun writes these directly to stderr from native
// code, bypassing process.emitWarning. Patch process.stderr.write to filter them out.
const _origStderrWrite = process.stderr.write.bind(process.stderr);
(process.stderr as any).write = function (chunk: string | Buffer, ...args: unknown[]) {
  const str = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : "";
  if (str.includes("[bun] Warning:") && str.includes("not implemented in bun")) return true;
  return _origStderrWrite(chunk, ...(args as any[]));
};

export interface WhatsAppConfig extends ChannelConfig {
  accountId: string;
  agentId: string;
  acceptGroups?: boolean;
  selfMessagesOnly?: boolean;
  reconnectMaxAttempts?: number;
  reconnectBaseDelayMs?: number;
}

export interface WhatsAppConnectionState {
  status: "connecting" | "connected" | "disconnected" | "qr" | "error";
  qrCode?: string;
  lastConnected?: Date;
  reconnectAttempts: number;
  error?: string;
  phoneNumber?: string;
  waVersion?: string;
}

export class WhatsAppChannel extends BaseChannel {
  name = "whatsapp";
  accountId: string;
  config: WhatsAppConfig;

  private socket: WASocket | null = null;
  private connectionState: WhatsAppConnectionState = {
    status: "disconnected",
    reconnectAttempts: 0,
  };
  private authPath: string;
  private reconnectTimeout: Timer | null = null;
  private log: ReturnType<typeof logger.child>;
  private jidCache: Map<string, string> = new Map();

  constructor(config: WhatsAppConfig) {
    super();
    this.config = config;
    this.accountId = config.accountId;
    this.authPath = this.getAuthPath(config.agentId, config.accountId);
    this.log = logger.child("whatsapp");
  }

  private getAuthPath(agentId: string, accountId: string): string {
    const baseDir = process.env.HOME ?? "";
    const authDir = path.join(baseDir, ".hive", "agents", agentId, "whatsapp", accountId);

    if (!existsSync(authDir)) {
      mkdirSync(authDir, { recursive: true });
    }

    return authDir;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      try {
        await this.socket.end(undefined);
      } catch {
        // Ignore close errors
      }
      this.socket = null;
    }

    this.connectionState.status = "disconnected";
    this.log.info("WhatsApp channel stopped");
  }

  private async connect(): Promise<void> {
    if (!this.running) return;

    this.connectionState.status = "connecting";
    this.log.info("Connecting to WhatsApp...");

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
      const { version } = await fetchLatestBaileysVersion();
      this.connectionState.waVersion = version.join(".");
      this.log.info(`Using WhatsApp Web v${version.join(".")}`);

      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        getMessage: async () => ({ conversation: "" }),
      });

      this.socket.ev.on("connection.update", async (update) => {
        await this.handleConnectionUpdate(update, saveCreds);
      });

      this.socket.ev.on("messages.upsert", async (update) => {
        await this.handleMessages(update);
      });

      this.socket.ev.on("creds.update", saveCreds);

      // Baileys v7: handle LID ↔ phone-number mapping updates
      this.socket.ev.on("lid-mapping.update" as any, () => {
        // LID mappings are persisted automatically via useMultiFileAuthState
      });

    } catch (error) {
      this.connectionState.status = "error";
      this.connectionState.error = (error as Error).message;
      this.log.error(`WhatsApp connection error: ${(error as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private async handleConnectionUpdate(
    update: Partial<ConnectionState>,
    saveCreds: () => Promise<void>
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.connectionState.status = "qr";
      this.connectionState.qrCode = qr;
      this.printQR(qr);
      this.log.info("Scan the QR code above with WhatsApp");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode: number } })?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      this.connectionState.status = "disconnected";
      this.log.warn(`WhatsApp disconnected: ${statusCode}`);

      try {
        getDb().query(`UPDATE channels SET status = ? WHERE id = ?`)
          .run(shouldReconnect ? "connecting" : "disconnected", this.accountId);
      } catch { /* ignore DB errors */ }

      const needsSessionClear =
        statusCode === DisconnectReason.loggedOut ||
        statusCode === DisconnectReason.badSession;
      // NOTE: 515 (restartRequired) is sent by WhatsApp AFTER a successful pairing
      // to signal Baileys to reconnect with the new credentials — do NOT clear session.

      if (needsSessionClear) {
        this.log.info("Clearing WhatsApp session files for fresh QR scan.");
        rmSync(this.authPath, { recursive: true, force: true });
        mkdirSync(this.authPath, { recursive: true });
      }

      if (shouldReconnect && this.running) {
        this.scheduleReconnect();
      }
    }

    if (connection === "open") {
      this.connectionState.status = "connected";
      this.connectionState.lastConnected = new Date();
      this.connectionState.reconnectAttempts = 0;
      this.connectionState.qrCode = undefined;
      void saveCreds();
      this.log.info("WhatsApp connected successfully");

      // Extract phone number from socket user ID
      const rawUserId = this.socket?.user?.id ?? "";
      if (rawUserId) {
        const phoneNumber = rawUserId.split(":")[0]?.replace("@s.whatsapp.net", "") ?? "";
        this.connectionState.phoneNumber = phoneNumber;
        this.log.info(`Linked phone: ${phoneNumber}`);
      }

      try {
        getDb().query(`UPDATE channels SET status = 'connected', last_active = ? WHERE id = ?`)
          .run(Date.now(), this.accountId);
      } catch { /* ignore DB errors */ }
    }
  }

  hasCredentials(): boolean {
    const credsFile = path.join(this.authPath, "creds.json");
    return existsSync(credsFile);
  }

  getConnectionState(): WhatsAppConnectionState {
    return { ...this.connectionState };
  }

  private printQR(qr: string): void {
    this.log.info("\n" + "=".repeat(50));
    this.log.info("  WHATSAPP QR CODE - Scan with your phone");
    this.log.info("=".repeat(50) + "\n");

    qrcodeTerminal.generate(qr, { small: false }, (qrString: string) => {
      this.log.info(qrString);
    });

    this.log.info("\n" + "=".repeat(50));
    this.log.info("  Open WhatsApp > Settings > Linked Devices");
    this.log.info("=".repeat(50) + "\n");
  }

  private async handleMessages(update: { messages: unknown[]; type: string }): Promise<void> {
    if (update.type !== "notify") return;

    for (const msg of update.messages) {
      const typedMsg = msg as {
        key: { fromMe?: boolean; remoteJid?: string; id?: string };
        message?: Record<string, unknown>;
        messageTimestamp?: number;
        pushName?: string;
      };

      const from = typedMsg.key.remoteJid;
      if (!from) continue;

      const isGroup = from.includes("@g.us");

          if (isGroup && !this.config.acceptGroups) {
        this.log.info(`[filter] Group message skipped (acceptGroups=false): ${from}`);
        continue;
      }

      const selfMessagesOnly = this.config.selfMessagesOnly !== false;

      if (!isGroup) {
        const fromNumber = from.split("@")[0];
        const ownJid = this.socket?.user?.id ?? "";
        const ownLid = this.socket?.user?.lid ?? "";
        const ownNumber = ownJid.split(":")[0].split("@")[0];
        const ownLidNumber = ownLid.split(":")[0].split("@")[0];
        const isToSelf = fromNumber === ownNumber || fromNumber === ownLidNumber;
        const isSelfMessage = !!typedMsg.key.fromMe && isToSelf;

        this.log.info(`[filter] DM from=${fromNumber} ownNumber=${ownNumber} ownLid=${ownLidNumber} fromMe=${typedMsg.key.fromMe} selfMessagesOnly=${selfMessagesOnly} isSelfMessage=${isSelfMessage}`);

        if (selfMessagesOnly) {
          if (!isSelfMessage) {
            this.log.info(`[filter] DM skipped (selfMessagesOnly=true, not self)`);
            continue;
          }
        } else {
          if (!isSelfMessage && !this.isUserAllowed(fromNumber)) {
            this.log.info(`[filter] DM skipped (not in allowlist): ${fromNumber}`);
            continue;
          }
        }
      }

  const { content, hasAudio, hasImage, hasDocument } = this.extractMessageContent(typedMsg.message);
  if (!content && !hasAudio && !hasImage && !hasDocument) continue;

  let audioBuffer: Buffer | null = null;
  let imageBuffer: Buffer | null = null;
  let documentBuffer: Buffer | null = null;
  let imageMime: string | undefined;
  let documentMime: string | undefined;
  let documentName: string | undefined;
  let imageCaption: string | undefined;

  if (hasAudio && this.socket) {
    try {
      audioBuffer = await downloadMediaMessage(
        typedMsg as unknown as WAMessage,
        "buffer",
        {},
        { reuploadRequest: this.socket.updateMediaMessage, logger: this.log as any }
      ) as Buffer;
    } catch (err) {
      this.log.warn(`Failed to download WhatsApp audio: ${(err as Error).message}`);
    }
  }

  if (hasImage && this.socket) {
    try {
      imageBuffer = await downloadMediaMessage(
        typedMsg as unknown as WAMessage,
        "buffer",
        {},
        { reuploadRequest: this.socket.updateMediaMessage, logger: this.log as any }
      ) as Buffer;
      const imgMsg = typedMsg.message?.imageMessage as { mimetype?: string; caption?: string } | undefined;
      imageMime = imgMsg?.mimetype || "image/jpeg";
      imageCaption = imgMsg?.caption || undefined;
    } catch (err) {
      this.log.warn(`Failed to download WhatsApp image: ${(err as Error).message}`);
    }
  }

  if (hasDocument && this.socket) {
    try {
      documentBuffer = await downloadMediaMessage(
        typedMsg as unknown as WAMessage,
        "buffer",
        {},
        { reuploadRequest: this.socket.updateMediaMessage, logger: this.log as any }
      ) as Buffer;
      const docMsg = typedMsg.message?.documentMessage as { mimetype?: string; fileName?: string } | undefined;
      documentMime = docMsg?.mimetype || "application/pdf";
      documentName = docMsg?.fileName || undefined;
    } catch (err) {
      this.log.warn(`Failed to download WhatsApp document: ${(err as Error).message}`);
    }
  }

      const peerId = isGroup ? from : from.replace("@s.whatsapp.net", "");

  const incoming: IncomingMessage = {
    sessionId: this.formatSessionId(peerId, isGroup ? "group" : "direct"),
    channel: "whatsapp",
    accountId: this.accountId,
    peerId,
    peerKind: isGroup ? "group" : "direct",
    content: content || (hasAudio ? "[Audio message]" : ""),
    audio: audioBuffer ? { buffer: audioBuffer, mimeType: "audio/ogg" } : undefined,
    image: imageBuffer ? { buffer: imageBuffer, mimeType: imageMime, caption: imageCaption } : undefined,
    document: documentBuffer ? { buffer: documentBuffer, mimeType: documentMime || "application/octet-stream", fileName: documentName } : undefined,
        metadata: {
          messageId: typedMsg.key.id,
          timestamp: typedMsg.messageTimestamp,
          pushName: typedMsg.pushName,
        },
      };

      await this.handleMessage(incoming);
    }
  }

  private extractMessageContent(message?: Record<string, unknown>): { content: string | null; hasAudio: boolean; hasImage: boolean; hasDocument: boolean } {
    if (!message) return { content: null, hasAudio: false, hasImage: false, hasDocument: false };

    if (message.conversation) {
      return { content: message.conversation as string, hasAudio: false, hasImage: false, hasDocument: false };
    }

    const extendedText = message.extendedTextMessage as { text?: string } | undefined;
    if (extendedText?.text) {
      return { content: extendedText.text, hasAudio: false, hasImage: false, hasDocument: false };
    }

    const imageMsg = message.imageMessage as { caption?: string } | undefined;
    if (imageMsg) {
      return { content: imageMsg.caption || "", hasAudio: false, hasImage: true, hasDocument: false };
    }

    const videoMsg = message.videoMessage as { caption?: string } | undefined;
    if (videoMsg?.caption) {
      return { content: `[Video] ${videoMsg.caption}`, hasAudio: false, hasImage: false, hasDocument: false };
    }

    const docMsg = message.documentMessage as { caption?: string } | undefined;
    if (docMsg) {
      return { content: docMsg.caption || "", hasAudio: false, hasImage: false, hasDocument: true };
    }

    if (message.audioMessage) {
      return { content: null, hasAudio: true, hasImage: false, hasDocument: false };
    }

    return { content: null, hasAudio: false, hasImage: false, hasDocument: false };
  }

  private scheduleReconnect(): void {
    if (!this.running) return;

    const maxAttempts = this.config.reconnectMaxAttempts ?? 10;
    const baseDelay = this.config.reconnectBaseDelayMs ?? 5000;
    const attempts = this.connectionState.reconnectAttempts;

    if (attempts >= maxAttempts) {
      this.log.error(`Max reconnection attempts (${maxAttempts}) reached`);
      this.connectionState.status = "error";
      this.connectionState.error = "Max reconnection attempts reached";
      return;
    }

    const delay = Math.min(baseDelay * Math.pow(2, attempts), 60000);
    this.connectionState.reconnectAttempts++;

    this.log.info(`Reconnecting in ${delay / 1000}s (attempt ${attempts + 1}/${maxAttempts})`);

    this.reconnectTimeout = setTimeout(async () => {
      await this.connect();
    }, delay);
  }

  private getJid(sessionId: string): string {
    const cached = this.jidCache.get(sessionId);
    if (cached) return cached;

    const peerId = this.extractPeerId(sessionId);
    const jid = peerId.includes("@") ? peerId : `${peerId}@s.whatsapp.net`;
    this.jidCache.set(sessionId, jid);
    return jid;
  }

  async startTyping(sessionId: string): Promise<void> {
    if (!this.socket || this.connectionState.status !== "connected") return;

    const jid = this.getJid(sessionId);
    try {
      await this.socket.sendPresenceUpdate("composing", jid);
    } catch {
      // Ignore typing errors
    }
  }

  async stopTyping(sessionId: string): Promise<void> {
    if (!this.socket || this.connectionState.status !== "connected") return;

    const jid = this.getJid(sessionId);
    try {
      await this.socket.sendPresenceUpdate("paused", jid);
    } catch {
      // Ignore typing errors
    }
  }

  async markAsRead(sessionId: string, messageId?: string): Promise<void> {
    if (!this.socket || this.connectionState.status !== "connected") return;
    if (!messageId) return;

    const jid = this.getJid(sessionId);
    try {
      await this.socket.readMessages([
        { remoteJid: jid, id: messageId, fromMe: false }
      ]);
    } catch {
      // Ignore read receipt errors
    }
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.socket || this.connectionState.status !== "connected") {
      throw new Error("WhatsApp not connected");
    }

    await this.stopTyping(sessionId);

    const text = message.content ?? message.chunk ?? "";
    if (!text) return;

    const jid = this.getJid(sessionId);

    await this.socket.sendMessage(jid, { text });
    this.log.debug(`Sent message to ${jid}`);
  }

  async sendAudio(sessionId: string, audio: Buffer, mimeType: string): Promise<void> {
    if (!this.socket || this.connectionState.status !== "connected") {
      throw new Error("WhatsApp not connected");
    }

    const jid = this.getJid(sessionId);

    try {
      await this.socket.sendMessage(jid, {
        audio: audio,
        mimetype: mimeType,
      });
      this.log.debug(`Sent audio to ${jid}`);
    } catch (error) {
      this.log.error(`Failed to send WhatsApp audio: ${(error as Error).message}`);
      throw error;
    }
  }

  private extractPeerId(sessionId: string): string {
    const parts = sessionId.split(":");
    return parts[parts.length - 1] ?? "";
  }

  getState(): WhatsAppConnectionState {
    return { ...this.connectionState };
  }

  getConfig(): WhatsAppConfig {
    return { ...this.config };
  }

  async disconnect(clearSession: boolean = false): Promise<void> {
    this.running = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      try {
        await this.socket.end(undefined);
      } catch {
        // Ignore close errors
      }
      this.socket = null;
    }

    this.connectionState.status = "disconnected";
    this.connectionState.phoneNumber = undefined;
    this.log.info("WhatsApp channel disconnected");

    if (clearSession) {
      this.log.info("Clearing WhatsApp session files.");
      rmSync(this.authPath, { recursive: true, force: true });
      mkdirSync(this.authPath, { recursive: true });
    }
  }
}

export function createWhatsAppChannel(config: WhatsAppConfig): WhatsAppChannel {
  return new WhatsAppChannel(config);
}
