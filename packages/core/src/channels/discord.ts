import {
  Client,
  GatewayIntentBits,
  Events,
  type Message,
  type TextChannel,
  type DMChannel,
  type NewsChannel,
} from "discord.js";
import { BaseChannel, type ChannelConfig, type IncomingMessage, type OutboundMessage } from "./base.ts";
import { logger } from "../utils/logger.ts";
import { getDb } from "../storage/sqlite.ts";

export interface DiscordConfig extends ChannelConfig {
  botToken: string;
  applicationId?: string;
  guilds?: Record<string, unknown>;
}

type DiscordTextChannel = TextChannel | DMChannel | NewsChannel;

export class DiscordChannel extends BaseChannel {
  name = "discord";
  accountId: string;
  config: DiscordConfig;
  
  private client?: Client;
  private log = logger.child("discord");
  private channelCache: Map<string, DiscordTextChannel> = new Map();

  constructor(accountId: string, config: DiscordConfig) {
    super();
    this.accountId = accountId;
    this.config = config;
  }

  async start(): Promise<void> {
    if (!this.config.botToken) {
      throw new Error("Discord bot token not configured");
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on(Events.MessageCreate, async (message) => {
      await this.handleDiscordMessage(message);
    });

    this.client.on(Events.Error, (error) => {
      this.log.error(`Discord client error: ${error.message}`);
    });

    this.client.once(Events.ClientReady, () => {
      this.log.info(`Discord bot started: ${this.client?.user?.tag ?? "unknown"}`);
      this.running = true;
      try {
        getDb().query(`UPDATE channels SET status = 'connected' WHERE id = ?`).run(this.accountId);
      } catch { /* ignore DB errors */ }
    });

    try {
      await this.client.login(this.config.botToken);
    } catch (error) {
      this.log.error(`Failed to login to Discord: ${(error as Error).message}`);
      throw error;
    }
  }

  private async handleDiscordMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const isGuild = message.guild !== null;
    const kind = isGuild ? "group" : "direct";
    const peerId = isGuild 
      ? `${message.guildId}:${message.channelId}:${message.author.id}`
      : message.author.id;

    if (!isGuild && !this.isUserAllowed(message.author.id)) {
      this.log.debug(`Message from unauthorized user: ${message.author.id}`);
      return;
    }

    const sessionId = this.formatSessionId(peerId, kind);
    if (message.channel.isTextBased()) {
      this.channelCache.set(sessionId, message.channel as DiscordTextChannel);
    }

  const audioAttachment = message.attachments.find(a =>
    a.contentType?.startsWith("audio/") || a.url.endsWith(".mp3") || a.url.endsWith(".ogg") || a.url.endsWith(".webm") || a.url.endsWith(".wav")
  );

  const imageAttachment = message.attachments.find(a =>
    a.contentType?.startsWith("image/") || a.url.endsWith(".jpg") || a.url.endsWith(".jpeg") || a.url.endsWith(".png") || a.url.endsWith(".gif") || a.url.endsWith(".webp")
  );

  const documentAttachment = !audioAttachment && !imageAttachment
    ? message.attachments.find(a => a.contentType?.startsWith("application/") || a.url.endsWith(".pdf") || a.url.endsWith(".doc") || a.url.endsWith(".docx") || a.url.endsWith(".txt"))
    : undefined;

  const incomingMessage: IncomingMessage = {
    sessionId,
    channel: "discord",
    accountId: this.accountId,
    peerId,
    peerKind: kind,
    content: message.content || "",
    audio: audioAttachment ? { url: audioAttachment.url, mimeType: audioAttachment.contentType || "audio/webm" } : undefined,
    image: imageAttachment ? { url: imageAttachment.url, mimeType: imageAttachment.contentType || "image/png" } : undefined,
    document: documentAttachment ? { url: documentAttachment.url, mimeType: documentAttachment.contentType || "application/octet-stream", fileName: documentAttachment.name } : undefined,
      metadata: {
        discord: {
          guildId: message.guildId,
          channelId: message.channelId,
          userId: message.author.id,
          username: message.author.username,
          messageId: message.id,
          roles: message.member?.roles.cache.map(r => r.id),
        },
      },
      replyToId: message.reference?.messageId 
        ? `discord:${message.reference.messageId}` 
        : undefined,
    };

    await this.handleMessage(incomingMessage);
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.running = false;
      this.log.info("Discord bot stopped");
      try {
        getDb().query(`UPDATE channels SET status = 'disconnected' WHERE id = ?`).run(this.accountId);
      } catch { /* ignore DB errors */ }
    }
  }

  private async getChannel(sessionId: string): Promise<DiscordTextChannel | null> {
    const cached = this.channelCache.get(sessionId);
    if (cached) return cached;

    if (!this.client) return null;

    const parts = sessionId.split(":");
    const peerPart = parts.slice(3).join(":");
    
    let channelId: string;
    if (peerPart.includes(":")) {
      const channelPart = peerPart.split(":");
      channelId = channelPart[1] ?? peerPart;
    } else {
      channelId = peerPart;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        this.channelCache.set(sessionId, channel as DiscordTextChannel);
        return channel as DiscordTextChannel;
      }
    } catch {
      // Channel not found
    }

    return null;
  }

  async startTyping(sessionId: string): Promise<void> {
    const channel = await this.getChannel(sessionId);
    if (!channel) return;

    await channel.sendTyping();

    const interval = setInterval(async () => {
      try {
        await channel.sendTyping();
      } catch {
        this.stopTyping(sessionId);
      }
    }, 8000);

    this.typingIntervals.set(sessionId, interval);
  }

  async stopTyping(sessionId: string): Promise<void> {
    const interval = this.typingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(sessionId);
    }
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    await this.stopTyping(sessionId);

    const channel = await this.getChannel(sessionId);
    
    if (!channel) {
      throw new Error(`Channel not found for session: ${sessionId}`);
    }

    const content = message.content ?? "";
    const maxLength = 2000;

    try {
      if (content.length <= maxLength) {
        await channel.send(content);
      } else {
        const chunks = this.chunkMessage(content, maxLength);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    } catch (error) {
      this.log.error(`Failed to send Discord message: ${(error as Error).message}`);
      throw error;
    }
  }

  private chunkMessage(content: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitPoint = remaining.lastIndexOf("\n", maxLength);
      if (splitPoint === -1 || splitPoint < maxLength * 0.5) {
        splitPoint = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitPoint === -1 || splitPoint < maxLength * 0.5) {
        splitPoint = maxLength;
      }

      chunks.push(remaining.slice(0, splitPoint));
      remaining = remaining.slice(splitPoint).trim();
    }

    return chunks;
  }

  async sendAudio(sessionId: string, audio: Buffer, mimeType: string): Promise<void> {
    const channel = await this.getChannel(sessionId);
    
    if (!channel) {
      throw new Error(`Channel not found for session: ${sessionId}`);
    }

    try {
      const attachmentName = `response.${mimeType === "audio/mpeg" ? "mp3" : "ogg"}`;
      await channel.send({
        files: [{ attachment: audio, name: attachmentName }]
      });
    } catch (error) {
      this.log.error(`Failed to send Discord audio: ${(error as Error).message}`);
      throw error;
    }
  }
}

export function createDiscordChannel(accountId: string, config: DiscordConfig): DiscordChannel {
  return new DiscordChannel(accountId, config);
}
