export type ChannelType =
  | "telegram"
  | "whatsapp"
  | "discord"
  | "slack"
  | "signal"
  | "imessage"
  | "webchat"
  | "matrix"
  | "google_chat"
  | "teams";

export type ChannelStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "rate_limited";

export interface ChannelConfig {
  type: ChannelType;
  credentials: Record<string, string>;
  policies: ChannelPolicies;
  webhookUrl?: string;
}

export interface ChannelPolicies {
  dmPolicy: "open" | "pairing";
  allowedUsers?: string[];
  requireAuth: boolean;
}

export interface ChannelTelegramConfig {
  botToken: string;
  webhookUrl?: string;
  allowedUsers?: string[];
  dmPolicy: "open" | "pairing";
}

export interface ChannelWhatsAppConfig {
  sessionName: string;
  phoneNumber?: string;
  qrCode?: string;
  pairingCode?: string;
  status: "awaiting_qr" | "awaiting_pairing" | "connected";
}

export interface ChannelDiscordConfig {
  botToken: string;
  guildIds?: string[];
  dmPolicy: "open" | "pairing";
  allowMentions: boolean;
}

export interface ChannelSignalConfig {
  phoneNumber: string;
  dataDir: string;
  trustedPeers: string[];
}

export interface ChannelWebChatConfig {
  port: number;
  corsOrigins: string[];
  requireAuth: boolean;
}

export interface ConnectedChannel {
  id: string;
  user_id: string;
  type: ChannelType;
  name?: string;
  status: ChannelStatus;
  config?: ChannelConfig;
  config_encrypted?: string;
  config_iv?: string;
  boundAgentId?: string;
  bindingMode?: "fixed" | "conditional" | "dynamic";
  createdAt?: string;
  updatedAt?: string;
  lastActivity?: string;
  last_active?: number;
  stats?: ChannelStats;
  accountId?: string;
  enabled: boolean;
  active: boolean;
  voice_enabled: boolean;
  tts_enabled: boolean;
  stt_provider?: string;
  tts_provider?: string;
  tts_voice_id?: string;
  step_delivery_mode?: string;
  isConfigured?: boolean;
}

export interface ChannelStats {
  totalMessages: number;
  messagesLast24h: number;
  activeUsers: number;
  avgResponseTime: number;
  errorRate: number;
}

export interface ChannelLog {
  id: string;
  channelId: string;
  type: "info" | "warning" | "error" | "debug";
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
