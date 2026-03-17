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

export { ChannelManager } from "@johpaz/hive/channels/manager";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
  MessageHandler,
} from "@johpaz/hive/channels/base";

export { TelegramChannel, type TelegramConfig } from "@johpaz/hive/channels/telegram";

export { DiscordChannel, type DiscordConfig } from "@johpaz/hive/channels/discord";

export { WhatsAppChannel, type WhatsAppConfig, type WhatsAppConnectionState } from "@johpaz/hive/channels/whatsapp";

export { SlackChannel, type SlackConfig, type SlackConnectionState } from "@johpaz/hive/channels/slack";

export { WebChatChannel, type WebChatConfig } from "@johpaz/hive/channels/webchat";
