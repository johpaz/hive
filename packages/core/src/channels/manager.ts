import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";
import type { IChannel, IncomingMessage, MessageHandler } from "./base.ts";
import { createTelegramChannel, type TelegramConfig } from "./telegram.ts";
import { createDiscordChannel, type DiscordConfig } from "./discord.ts";
import { createWebChatChannel, type WebChatConfig } from "./webchat.ts";
import { createWhatsAppChannel, WhatsAppChannel, type WhatsAppConfig } from "./whatsapp.ts";
import { createSlackChannel, type SlackConfig } from "./slack.ts";
import { col } from "../storage/hive.ts";
import type { ChannelDoc, AgentDoc, UserIdentityDoc } from "../storage/collections.ts";
import { loadChannelConfig } from "../storage/crypto.ts";

export class ChannelManager {
  private config: Config;
  private channels: Map<string, IChannel> = new Map();
  private messageHandler?: MessageHandler;
  private log = logger.child("channels");
  /**
   * `channel:sessionId` → accountId of the account that received the message.
   *
   * Outbound calls (agent reply, narration, notify tools, scheduler) only carry
   * a channel name and a routing session id. With two accounts of the same type
   * connected — two WhatsApp numbers — picking a channel by name alone sends the
   * reply out through whichever account happens to be first, to a peer that may
   * not even exist there. Every inbound message records its account here so the
   * reply goes back out the way it came in.
   *
   * Known limit: if the same peer id talks to two accounts of one type, the
   * routing session id is identical for both and the most recent inbound
   * message wins. Distinguishing them would require the account in the session
   * id itself.
   */
  private sessionAccounts: Map<string, string> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  private sessionKey(channelName: string, sessionId: string): string {
    return `${channelName}:${sessionId}`;
  }

  /**
   * Resolves which account owns an outbound session: an explicit account wins,
   * then the account that last received a message on it.
   */
  private resolveAccountId(
    channelName: string,
    sessionId: string,
    explicit?: string
  ): string | undefined {
    if (explicit) return explicit;
    return this.sessionAccounts.get(this.sessionKey(channelName, sessionId));
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

    await this.seedSessionAccounts();

    this.log.info(`Initialized ${this.channels.size} channel(s)`);
  }

  /**
   * Restores session→account routing from persisted identities. Without this, a
   * durable worker that finishes after a restart would have no record of which
   * account its conversation came in on.
   */
  private async seedSessionAccounts(): Promise<void> {
    try {
      const identitiesCol = await col<UserIdentityDoc>("userIdentities");
      for (const { doc } of await identitiesCol.scan({})) {
        if (!doc.account_id || !doc.channel_user_id) continue;
        // Skip identities whose account is gone (disconnected and replaced by
        // another one) — pinning a session to it would only fail every send.
        if (!this.channels.has(`${doc.channel}:${doc.account_id}`)) continue;
        this.sessionAccounts.set(this.sessionKey(doc.channel, doc.channel_user_id), doc.account_id);
      }
    } catch (error) {
      this.log.debug(`Could not seed session accounts: ${(error as Error).message}`);
    }
  }

  private async initializeFromDB(): Promise<void> {
    try {
      const channelsCol = await col<ChannelDoc>("channels");
      // Load all active channels - config may be empty for webchat
      const rows = (await channelsCol.scan({})).filter(e => e.doc.enabled && e.doc.active).map(e => e.doc);

      for (const row of rows) {
        let config: Record<string, unknown> = {};
        try {
          config = await loadChannelConfig(row.id);
          this.log.debug(`Loaded config for ${row.type}:${row.id}:`, Object.keys(config));
        } catch (error) {
          this.log.warn(`Failed to load config for channel ${row.id}:`, (error as Error).message);
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

  /**
   * Wires a channel into the manager: inbound messages record which account
   * received them before reaching the handler, so replies can be routed back.
   */
  private registerChannel(key: string, channel: IChannel): void {
    channel.onMessage(async (message: IncomingMessage) => {
      if (message.accountId && message.sessionId) {
        this.sessionAccounts.set(
          this.sessionKey(message.channel, message.sessionId),
          message.accountId
        );
      }
      if (this.messageHandler) {
        await this.messageHandler(message);
      }
    });

    this.channels.set(key, channel);
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

        case "whatsapp": {
          let coordinatorId = "main";
          try {
            const agentsCol = await col<AgentDoc>("agents");
            const coordinator = (await agentsCol.findBy("role", "coordinator", { limit: 1 }))[0];
            if (coordinator?.id) coordinatorId = coordinator.id;
          } catch { /* fallback to "main" */ }
          channel = createWhatsAppChannel({
            enabled: true,
            accountId,
            agentId: (config.agentId as string) ?? coordinatorId,
            dmPolicy: (config.dmPolicy as "open" | "pairing" | "allowlist") ?? "allowlist",
            allowFrom: (config.allowFrom as string[]) ?? [],
            acceptGroups: (config.acceptGroups as boolean) ?? false,
            reconnectMaxAttempts: (config.reconnectMaxAttempts as number) ?? 10,
            reconnectBaseDelayMs: (config.reconnectBaseDelayMs as number) ?? 5000,
          } as WhatsAppConfig);
          break;
        }

        case "slack":
          channel = createSlackChannel({
            enabled: true,
            accountId,
            botToken: config.botToken as string,
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

      const key = `${channelName}:${accountId}`;
      this.registerChannel(key, channel);

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

      // WhatsApp: skip auto-start if no credentials exist.
      // QR generation should only happen when the user explicitly requests connection.
      if (channel instanceof WhatsAppChannel && !channel.hasCredentials()) {
        this.log.info(`${key}: no credentials found, skipping auto-start — connect via UI to generate QR`);
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
      const exact = this.channels.get(`${channelName}:${accountId}`);
      // Deliberately no fallback: delivering through a different account would
      // send someone else's conversation out of the wrong number.
      if (!exact) {
        this.log.warn(`Channel ${channelName}:${accountId} is not instantiated — refusing to fall back to another account`);
      }
      return exact;
    }

    const matches = [...this.channels.entries()].filter(([key]) => key.startsWith(`${channelName}:`));
    if (matches.length > 1) {
      this.log.warn(
        `${matches.length} "${channelName}" accounts are connected and no account was given — routing through ${matches[0]![0]}`
      );
    }
    return matches[0]?.[1];
  }

  async removeChannel(channelName: string, accountId: string): Promise<void> {
    const key = `${channelName}:${accountId}`;
    await this.stopChannel(channelName, accountId);
    this.channels.delete(key);
    // Drop sessions pinned to this account, otherwise every later send to them
    // resolves to a channel that no longer exists.
    for (const [sessionKey, account] of this.sessionAccounts) {
      if (account === accountId && sessionKey.startsWith(`${channelName}:`)) {
        this.sessionAccounts.delete(sessionKey);
      }
    }
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

  async addChannel(type: string, accountId: string, config: Record<string, unknown>): Promise<void> {
    await this.createChannel(type, accountId, config);
    const channel = this.channels.get(`${type}:${accountId}`);
    if (channel && !channel.isRunning()) {
      await channel.start();
    }
  }

  getChannelStatus(type: string, accountId: string): { status: string; qrCode?: string } {
    const key = `${type}:${accountId}`;
    const channel = this.channels.get(key);
    if (!channel) return { status: "not_found" };

    if (type === "whatsapp" && "getConnectionState" in channel) {
      const state = (channel as any).getConnectionState();
      return { status: state.status, qrCode: state.qrCode };
    }

    if ("getState" in channel) {
      const state = (channel as any).getState();
      return { status: state.status };
    }

    return { status: channel.isRunning() ? "connected" : "disconnected" };
  }

  getWhatsAppDetails(accountId: string): {
    status: string;
    phoneNumber?: string;
    waVersion?: string;
    qrCode?: string;
    lastConnected?: number;
    reconnectAttempts: number;
    reconnectMaxAttempts: number;
    error?: string;
    acceptGroups: boolean;
    selfMessagesOnly: boolean;
    dmPolicy?: string;
    allowFrom: string[];
  } | null {
    const key = `whatsapp:${accountId}`;
    const channel = this.channels.get(key) as WhatsAppChannel | undefined;

    if (!channel) return null;

    const state = channel.getState();
    const config = channel.getConfig();

    return {
      status: state.status,
      phoneNumber: state.phoneNumber,
      waVersion: state.waVersion,
      qrCode: state.qrCode,
      lastConnected: state.lastConnected?.getTime(),
      reconnectAttempts: state.reconnectAttempts,
      reconnectMaxAttempts: config.reconnectMaxAttempts ?? 10,
      error: state.error,
      acceptGroups: config.acceptGroups ?? false,
      selfMessagesOnly: config.selfMessagesOnly !== false,
      dmPolicy: config.dmPolicy,
      allowFrom: config.allowFrom ?? [],
    };
  }

  async stopChannel(channelName: string, accountId: string): Promise<void> {
    const key = `${channelName}:${accountId}`;
    const channel = this.channels.get(key);

    if (!channel) {
      this.log.debug(`Channel ${key} not instantiated, skipping stop`);
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

  /** Resolves the account that owns this session (see `sessionAccounts`). */
  private channelForSession(
    channelName: string,
    sessionId: string,
    accountId?: string
  ): IChannel | undefined {
    return this.getChannel(channelName, this.resolveAccountId(channelName, sessionId, accountId));
  }

  async send(
    channelName: string,
    sessionId: string,
    message: unknown,
    accountId?: string
  ): Promise<void> {
    const channel = this.channelForSession(channelName, sessionId, accountId);

    if (!channel) {
      throw new Error(`Channel not found: ${channelName}`);
    }

    await channel.send(sessionId, message as any);
  }

  async startTyping(channelName: string, sessionId: string, accountId?: string): Promise<void> {
    const channel = this.channelForSession(channelName, sessionId, accountId);
    if (channel?.startTyping) {
      await channel.startTyping(sessionId);
    }
  }

  async stopTyping(channelName: string, sessionId: string, accountId?: string): Promise<void> {
    const channel = this.channelForSession(channelName, sessionId, accountId);
    if (channel?.stopTyping) {
      await channel.stopTyping(sessionId);
    }
  }

  async markAsRead(channelName: string, sessionId: string, messageId?: string, accountId?: string): Promise<void> {
    const channel = this.channelForSession(channelName, sessionId, accountId);
    if (channel?.markAsRead) {
      await channel.markAsRead(sessionId, messageId);
    }
  }

  async sendAudio(channelName: string, sessionId: string, audio: Buffer, mimeType: string, accountId?: string): Promise<void> {
    const channel = this.channelForSession(channelName, sessionId, accountId);
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
