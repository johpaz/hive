import { MessageSquare, Phone, Hash, Slack, Shield, Smartphone, Globe, Grid3X3 } from "lucide-react";
import type { ChannelType } from "@/types";
import { cn } from "@/lib/utils";

const iconMap: Record<ChannelType, React.ComponentType<{ className?: string }>> = {
  telegram: MessageSquare,
  whatsapp: Phone,
  discord: Hash,
  slack: Slack,
  signal: Shield,
  imessage: Smartphone,
  webchat: Globe,
  matrix: Grid3X3,
  google_chat: MessageSquare,
  teams: MessageSquare,
};

const colorMap: Record<ChannelType, string> = {
  telegram: "text-blue-400",
  whatsapp: "text-green-400",
  discord: "text-indigo-400",
  slack: "text-pink-400",
  signal: "text-sky-400",
  imessage: "text-blue-300",
  webchat: "text-primary",
  matrix: "text-emerald-400",
  google_chat: "text-green-500",
  teams: "text-violet-400",
};

interface ChannelIconProps {
  type: ChannelType;
  className?: string;
  colored?: boolean;
}

export function ChannelIcon({ type, className, colored = true }: ChannelIconProps) {
  const Icon = iconMap[type] ?? Globe;
  return <Icon className={cn(className, colored && colorMap[type])} />;
}
