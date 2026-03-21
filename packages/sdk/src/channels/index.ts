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

export { ChannelManager } from "@johpaz/hive-agents/channels/manager";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
  MessageHandler,
} from "@johpaz/hive-agents/channels/base";

export { TelegramChannel, type TelegramConfig } from "@johpaz/hive-agents/channels/telegram";

export { DiscordChannel, type DiscordConfig } from "@johpaz/hive-agents/channels/discord";

export { WhatsAppChannel, type WhatsAppConfig, type WhatsAppConnectionState } from "@johpaz/hive-agents/channels/whatsapp";

export { SlackChannel, type SlackConfig, type SlackConnectionState } from "@johpaz/hive-agents/channels/slack";

export { WebChatChannel, type WebChatConfig } from "@johpaz/hive-agents/channels/webchat";
