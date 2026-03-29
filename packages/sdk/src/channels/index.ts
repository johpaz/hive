/**
 * Hive SDK - Channels Module
 *
 * Exposes all channel adapters and channel management.
 *
 * @example
 * import { ChannelManager, TelegramChannel, DiscordChannel } from "@johpaz/hive-agents-sdk/channels";
 *
 * // Get channel manager
 * const manager = new ChannelManager(config);
 */

export { ChannelManager } from "@johpaz/hive-agents-core/channels/manager";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
  MessageHandler,
} from "@johpaz/hive-agents-core/channels/base";

export { TelegramChannel, type TelegramConfig } from "@johpaz/hive-agents-core/channels/telegram";

export { DiscordChannel, type DiscordConfig } from "@johpaz/hive-agents-core/channels/discord";

export { WhatsAppChannel, type WhatsAppConfig, type WhatsAppConnectionState } from "@johpaz/hive-agents-core/channels/whatsapp";

export { SlackChannel, type SlackConfig, type SlackConnectionState } from "@johpaz/hive-agents-core/channels/slack";

export { WebChatChannel, type WebChatConfig } from "@johpaz/hive-agents-core/channels/webchat";
