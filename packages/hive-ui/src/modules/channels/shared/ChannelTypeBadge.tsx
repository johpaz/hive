import { Badge } from "@/components/ui/badge";
import type { ChannelType } from "@/types";

const nameMap: Record<ChannelType, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
  slack: "Slack",
  signal: "Signal",
  imessage: "iMessage",
  webchat: "Web Chat",
  matrix: "Matrix",
  google_chat: "Google Chat",
  teams: "Teams",
};

interface ChannelTypeBadgeProps {
  type: ChannelType;
}

export function ChannelTypeBadge({ type }: ChannelTypeBadgeProps) {
  return <Badge variant="secondary" className="text-xs">{nameMap[type] ?? type}</Badge>;
}
