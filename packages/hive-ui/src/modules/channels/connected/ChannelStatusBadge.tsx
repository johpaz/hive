import { Badge } from "@/components/ui/badge";
import type { ChannelStatus } from "@/types";

const statusConfig: Record<ChannelStatus, { label: string; className: string }> = {
  connected: { label: "Conectado", className: "bg-hive-connected/15 text-hive-connected border-hive-connected/30" },
  connecting: { label: "Conectando", className: "bg-hive-thinking/15 text-hive-thinking border-hive-thinking/30 animate-pulse" },
  disconnected: { label: "Desconectado", className: "bg-muted text-muted-foreground border-border" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive border-destructive/30" },
  rate_limited: { label: "Rate Limited", className: "bg-hive-thinking/15 text-hive-thinking border-hive-thinking/30" },
};

interface ChannelStatusBadgeProps {
  status: ChannelStatus;
}

export function ChannelStatusBadge({ status }: ChannelStatusBadgeProps) {
  // Handle undefined or invalid status with fallback to disconnected
  const validStatus = status ?? 'disconnected';
  const config = statusConfig[validStatus] ?? statusConfig.disconnected;
  return (
    <Badge variant="outline" className={config?.className ?? 'border-muted'}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {config?.label ?? 'Desconocido'}
    </Badge>
  );
}
