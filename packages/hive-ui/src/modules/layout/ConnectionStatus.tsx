import { useWebSocket } from "@/hooks/useWebSocket";
import type { WebSocketStatus } from "@/types";

const dotClass: Record<WebSocketStatus, string> = {
  connected: "bg-hive-connected",
  connecting: "bg-hive-thinking animate-pulse",
  disconnected: "bg-hive-disconnected",
  error: "bg-hive-disconnected",
};

export function ConnectionStatus() {
  const { status } = useWebSocket();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass[status]}`} />
      <span className="hidden sm:inline">WS: {status}</span>
    </div>
  );
}
