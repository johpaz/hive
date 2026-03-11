import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";
import type { IChannel, IncomingMessage, MessageHandler } from "./base.ts";
import { createTelegramChannel, type TelegramConfig } from "./telegram.ts";
import { createDiscordChannel, type DiscordConfig } from "./discord.ts";
import { createWebChatChannel, type WebChatConfig } from "./webchat.ts";
import { createWhatsAppChannel, type WhatsAppConfig } from "./whatsapp.ts";
import { createSlackChannel, type SlackConfig } from "./slack.ts";
import { getDb } from "../storage/sqlite.ts";
import { decryptConfig } from "../storage/crypto.ts";

export class ChannelManager {
  private config: Config;
  private channels: Map<string, IChannel> = new Map();
  private messageHandler?: MessageHandler;
  private log = logger.child("channels");

  constructor(config: Config) {
    this.config = config;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async initialize(): Promise<void> {
    // Primero, intentar cargar canales desde la BD
    await this.initializeFromDB();

    // Si no hay canales en la BD, usar config
    if (this.channels.size === 0) {
      await this.initializeFromConfig();
    }

    this.log.info(`Initialized ${this.channels.size} channel(s)`);
  }

  private async initializeFromDB(): Promise<void> {
    try {
      const db = getDb();
      // Load all active channels - config may be empty for webchat
      const rows = db.query(`
        SELECT id, type, config_encrypted, config_iv, enabled, active
        FROM channels
        WHERE enabled = 1 AND active = 1
      `).all() as Array<{
        id: string;
        type: string;
        config_encrypted: string | null;
        config_iv: string | null;
        enabled: number;
        active: number;
      }>;

      for (const row of rows) {
        let config: Record<string, unknown> = {};

        if (row.config_encrypted && row.config_iv) {
          try {
            config = await decryptConfig(row.config_encrypted, row.config_iv);
            this.log.debug(`Decrypted config for ${row.type}:${row.id}:`, Object.keys(config));
          } catch (error) {
            this.log.warn(`Failed to decrypt config for channel ${row.id}:`, (error as Error).message);
          }
        }

        // Use channel id as accountId
        const accountId = row.id;
        this.log.info(`Creating channel ${row.type}:${accountId} with config keys:`, Object.keys(config));
        await this.createChannel(row.type, accountId, config);
      }
    } catch (error) {
      this.log.debug("No channels found in DB or DB not initialized:", (error as Error).message);
    }
  }

  private async initializeFromConfig(): Promise<void> {
    const channelConfigs = this.config.channels ?? {};

    for (const [channelName, channelConfig] of Object.entries(channelConfigs)) {
      // If enabled is explicitly false, skip
      if (channelConfig.enabled === false) {
        this.log.debug(`Channel ${channelName} is disabled`);
        continue;
      }

      const accounts = channelConfig.accounts;
      if (!accounts || Object.keys(accounts).length === 0) {
        this.log.warn(`Channel ${channelName} has no accounts configured`);
        continue;
      }

      for (const [accountId, accountConfig] of Object.entries(accounts)) {
        const fullConfig = { ...channelConfig, ...accountConfig };
        await this.createChannel(channelName, accountId, fullConfig);
      }
    }
  }

  private async createChannel(
    channelName: string,
    accountId: string,
    config: Record<string, unknown>
  ): Promise<void> {
    let channel: IChannel;

    try {
      switch (channelName) {
        case "telegram":
          channel = createTelegramChannel(accountId, {
            enabled: true,
            botToken: config.botToken as string,
            dmPolicy: (config.dmPolicy as "open" | "pairing" | "allowlist") ?? "open",
            allowFrom: (config.allowFrom as string[]) ?? [],
            groups: (config.groups as boolean) ?? false,
          } as TelegramConfig);
          break;

        case "discord":
          channel = createDiscordChannel(accountId, {
            enabled: true,
            botToken: config.botToken as string,
            applicationId: config.applicationId as string,
            dmPolicy: (config.dmPolicy as "open" | "pairing" | "allowlist") ?? "allowlist",
            allowFrom: (config.allowFrom as string[]) ?? [],
          } as DiscordConfig);
          break;

        case "webchat":
          channel = createWebChatChannel({
            enabled: true,
            dmPolicy: "open",
            allowFrom: [],
          } as WebChatConfig);
          break;

        case "whatsapp":
          channel = createWhatsAppChannel({
            enabled: true,
            accountId,
            agentId: (config.agentId as string) ?? "main",
            dmPolicy: (config.dmPolicy as "open" | "pairing" | "allowlist") ?? "allowlist",
            allowFrom: (config.allowFrom as string[]) ?? [],
            reconnectMaxAttempts: (config.reconnectMaxAttempts as number) ?? 10,
            reconnectBaseDelayMs: (config.reconnectBaseDelayMs as number) ?? 5000,
          } as WhatsAppConfig);
          break;

        case "slack":
          channel = createSlackChannel({
            enabled: true,
            botToken: config.botToken as string,
            appToken: config.appToken as string,
            signingSecret: config.signingSecret as string,
            port: (config.port as number) ?? 3000,
            dmPolicy: (config.dmPolicy as "open" | "pairing" | "allowlist") ?? "allowlist",
            allowFrom: (config.allowFrom as string[]) ?? [],
          } as SlackConfig);
          break;

        default:
          this.log.warn(`Unknown channel type: ${channelName}`);
          return;
      }

      channel.onMessage(async (message: IncomingMessage) => {
        if (this.messageHandler) {
          await this.messageHandler(message);
        }
      });

      const key = `${channelName}:${accountId}`;
      this.channels.set(key, channel);

      this.log.info(`Created channel: ${key}`);
    } catch (error) {
      this.log.error(`Failed to create channel ${channelName}:${accountId}: ${(error as Error).message}`);
    }
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [key, channel] of this.channels) {
      if (channel.isRunning()) {
        this.log.info(`Channel ${key} is already running, skipping`);
        continue;
      }
      promises.push(
        channel.start().catch((error) => {
          this.log.error(`Failed to start channel ${key}: ${error.message}`);
        })
      );
    }

    await Promise.allSettled(promises);
    this.log.info("All channels started");
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [key, channel] of this.channels) {
      promises.push(
        channel.stop().catch((error) => {
          this.log.error(`Failed to stop channel ${key}: ${error.message}`);
        })
      );
    }

    await Promise.allSettled(promises);
    this.log.info("All channels stopped");
  }

  getChannel(channelName: string, accountId?: string): IChannel | undefined {
    if (accountId) {
      return this.channels.get(`${channelName}:${accountId}`);
    }

    for (const [key, channel] of this.channels) {
      if (key.startsWith(channelName)) {
        return channel;
      }
    }

    return undefined;
  }

  async removeChannel(channelName: string, accountId: string): Promise<void> {
    const key = `${channelName}:${accountId}`;
    await this.stopChannel(channelName, accountId);
    this.channels.delete(key);
    this.log.info(`Removed channel: ${key}`);
  }

  getAccountConfig(channelName: string, accountId: string): any {
    const channelConfigs = (this.config.channels ?? {}) as Record<string, any>;
    const channelConfig = channelConfigs[channelName];
    if (!channelConfig) return null;

    const accounts = channelConfig.accounts;
    if (!accounts) return null;
    return accounts[accountId] || null;
  }

  async startChannel(channelName: string, accountId: string): Promise<void> {
    const key = `${channelName}:${accountId}`;
    let channel = this.channels.get(key);

    if (!channel) {
      const channelConfigs = (this.config.channels ?? {}) as Record<string, any>;
      const channelConfig = channelConfigs[channelName];
      if (!channelConfig) {
        throw new Error(`Channel configuration not found: ${channelName}`);
      }

      const accounts = channelConfig.accounts;
      if (!accounts) {
        throw new Error(`Accounts configuration not found for channel ${channelName}`);
      }
      const accountConfig = accounts[accountId];
      if (!accountConfig) {
        throw new Error(`Account configuration not found: ${accountId} for channel ${channelName}`);
      }

      const fullConfig = { ...channelConfig, ...(accountConfig ?? {}) };
      await this.createChannel(channelName, accountId, fullConfig as any);
      channel = this.channels.get(key);
    }

    if (!channel) {
      throw new Error(`Failed to instantiate channel: ${key}`);
    }

    if (channel.isRunning()) {
      this.log.info(`Channel ${key} is already running`);
      return;
    }

    await channel.start();
    this.log.info(`Started channel: ${key}`);
  }

  async stopChannel(channelName: string, accountId: string): Promise<void> {
    const key = `${channelName}:${accountId}`;
    const channel = this.channels.get(key);

    if (!channel) {
      this.log.warn(`Channel ${key} not found or not instantiated`);
      return;
    }

    if (!channel.isRunning()) {
      this.log.info(`Channel ${key} is not running`);
      return;
    }

    await channel.stop();
    this.log.info(`Stopped channel: ${key}`);
  }

  listAllAvailableChannels(): Array<{ name: string; accountId: string; running: boolean; enabled: boolean }> {
    const available: Array<{ name: string; accountId: string; running: boolean; enabled: boolean }> = [];
    const channelConfigs = (this.config.channels ?? {}) as Record<string, any>;

    for (const [channelName, channelConfig] of Object.entries(channelConfigs)) {
      const accounts = channelConfig.accounts;
      if (!accounts) continue;
      for (const accountId of Object.keys(accounts)) {
        const key = `${channelName}:${accountId}`;
        const channel = this.channels.get(key);
        available.push({
          name: channelName,
          accountId: accountId,
          running: channel ? channel.isRunning() : false,
          enabled: channelConfig.enabled !== false,
        });
      }
    }
    return available;
  }

  listChannels(): Array<{ name: string; accountId: string; running: boolean }> {
    return Array.from(this.channels.entries()).map(([key, channel]) => {
      const [name, accountId] = key.split(":");
      return {
        name: name ?? "unknown",
        accountId: accountId ?? "unknown",
        running: channel.isRunning(),
      };
    });
  }

  async send(
    channelName: string,
    sessionId: string,
    message: unknown
  ): Promise<void> {
    const channel = this.getChannel(channelName);

    if (!channel) {
      throw new Error(`Channel not found: ${channelName}`);
    }

    await channel.send(sessionId, message as any);
  }

  async startTyping(channelName: string, sessionId: string): Promise<void> {
    const channel = this.getChannel(channelName);
    if (channel?.startTyping) {
      await channel.startTyping(sessionId);
    }
  }

  async stopTyping(channelName: string, sessionId: string): Promise<void> {
    const channel = this.getChannel(channelName);
    if (channel?.stopTyping) {
      await channel.stopTyping(sessionId);
    }
  }

  async markAsRead(channelName: string, sessionId: string, messageId?: string): Promise<void> {
    const channel = this.getChannel(channelName);
    if (channel?.markAsRead) {
      await channel.markAsRead(sessionId, messageId);
    }
  }

  async sendAudio(channelName: string, sessionId: string, audio: Buffer, mimeType: string): Promise<void> {
    const channel = this.getChannel(channelName);
    if (!channel) {
      throw new Error(`Channel not found: ${channelName}`);
    }
    if (!channel.sendAudio) {
      throw new Error(`Channel ${channelName} does not support audio`);
    }
    await channel.sendAudio(sessionId, audio, mimeType);
  }
}

export function createChannelManager(config: Config): ChannelManager {
  return new ChannelManager(config);
}
