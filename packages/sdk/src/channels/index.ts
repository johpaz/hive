/**
 * Hive SDK - Channels Module
 * 
 * Exposes all channel adapters and channel management.
 * 
 * @example
 * import { ChannelManager, TelegramChannel, DiscordChannel } from "@johpaz/hive-sdk/channels";
 * 
 * // Get channel manager
 * const manager = new ChannelManager(config);
 */

export { ChannelManager } from "@johpaz/hive-core/channels/manager";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
  MessageHandler,
} from "@johpaz/hive-core/channels/base";

export { TelegramChannel, type TelegramConfig } from "@johpaz/hive-core/channels/telegram";

export { DiscordChannel, type DiscordConfig } from "@johpaz/hive-core/channels/discord";

export { WhatsAppChannel, type WhatsAppConfig, type WhatsAppConnectionState } from "@johpaz/hive-core/channels/whatsapp";

export { SlackChannel, type SlackConfig, type SlackConnectionState } from "@johpaz/hive-core/channels/slack";

export { WebChatChannel, type WebChatConfig } from "@johpaz/hive-core/channels/webchat";
