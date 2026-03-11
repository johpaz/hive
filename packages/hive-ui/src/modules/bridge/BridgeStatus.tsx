import { Badge } from "@/components/ui/badge";
import type { WebSocketStatus } from "@/types";

const statusLabels: Record<WebSocketStatus, { label: string; className: string }> = {
  connected: { label: "Conectado", className: "bg-hive-connected/15 text-hive-connected border-hive-connected/30" },
  connecting: { label: "Conectando…", className: "bg-hive-thinking/15 text-hive-thinking border-hive-thinking/30 animate-pulse-slow" },
  disconnected: { label: "Desconectado", className: "bg-destructive/15 text-destructive border-destructive/30" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

interface BridgeStatusProps {
  status: WebSocketStatus;
}

export function BridgeStatus({ status }: BridgeStatusProps) {
  const config = statusLabels[status];
  return (
    <Badge variant="outline" className={config.className}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {config.label}
    </Badge>
  );
}
