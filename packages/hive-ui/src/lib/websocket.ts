import type { WebSocketConfig } from "@/types";

export const defaultWebSocketConfig: WebSocketConfig = {
  url: import.meta.env.VITE_WS_URL || "ws://localhost:18790",
  reconnectInterval: 3000,
  maxRetries: 5,
};
