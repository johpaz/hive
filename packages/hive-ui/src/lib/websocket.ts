import type { WebSocketConfig } from "@/types";

const _wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const _host = window.location.host.replace("0.0.0.0", "localhost");
const _wsUrl = import.meta.env.VITE_WS_URL
  || (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/^http/, "ws") : null)
  || `${_wsProto}//${_host}`;

export const defaultWebSocketConfig: WebSocketConfig = {
  url: _wsUrl,
  reconnectInterval: 3000,
  maxRetries: 5,
};
