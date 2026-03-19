import type { WebSocketConfig } from "@/types";

const _wsUrl = import.meta.env.VITE_WS_URL
  || (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/^http/, "ws") : null)
  || `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

export const defaultWebSocketConfig: WebSocketConfig = {
  url: _wsUrl,
  reconnectInterval: 3000,
  maxRetries: 5,
};
