/**
 * Hive SDK - Channels Module
 *
 * Exposes all channel adapters and channel management.
 *
 * @example
 * import { ChannelManager, TelegramChannel, DiscordChannel } from "@johpaz/hiveAgents-sdk/channels";
 *
 * // Get channel manager
 * const manager = new ChannelManager(config);
 */

export { ChannelManager } from "@johpaz/hiveAgents/channels/manager";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
  MessageHandler,
} from "@johpaz/hiveAgents/channels/base";

export { TelegramChannel, type TelegramConfig } from "@johpaz/hiveAgents/channels/telegram";

export { DiscordChannel, type DiscordConfig } from "@johpaz/hiveAgents/channels/discord";

export { WhatsAppChannel, type WhatsAppConfig, type WhatsAppConnectionState } from "@johpaz/hiveAgents/channels/whatsapp";

export { SlackChannel, type SlackConfig, type SlackConnectionState } from "@johpaz/hiveAgents/channels/slack";

export { WebChatChannel, type WebChatConfig } from "@johpaz/hiveAgents/channels/webchat";
