import { create } from "zustand";
import type { WebSocketStatus } from "@/types";
import { useWelcomeStore, type WelcomeData } from "./useWelcomeStore";
import { getWsBaseUrl } from "@/lib/gateway-url";

interface WebSocketMessage {
    type: string;
    [key: string]: any;
}

type MessageHandler = (data: any) => void;

interface WebSocketStore {
    ws: WebSocket | null;
    status: WebSocketStatus;
    url: string;
    lastPing: string | null;
    retryCount: number;
    handlers: Map<string, Set<MessageHandler>>;
    sessionId: string | null;

    // Actions
    connect: (sessionId?: string) => void;
    disconnect: () => void;
    send: (message: any) => void;
    subscribe: (type: string, handler: MessageHandler) => () => void;
    setStatus: (status: WebSocketStatus) => void;
    setLastPing: (ping: string) => void;
    setSessionId: (sessionId: string) => void;
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    return {
        ws: null,
        status: "disconnected",
        url: getWsBaseUrl() + "/ws",
        lastPing: null,
        retryCount: 0,
        handlers: new Map(),
        sessionId: null,

        setStatus: (status) => set({ status }),
        setLastPing: (ping) => set({ lastPing: ping }),
        setSessionId: (sessionId) => set({ sessionId }),

        connect: (sessionId?: string) => {
            const state = get();
            if (state.ws) {
                state.ws.close();
            }
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }

            let wsUrl = state.url;
            try {
                const urlObj = new URL(wsUrl);
                // Always send the auth token — server validates it as an alternative to ?session=
                const token = typeof localStorage !== "undefined" ? localStorage.getItem("hive-auth-token") : null;
                if (sessionId) urlObj.searchParams.set("session", sessionId);
                if (token) urlObj.searchParams.set("token", token);
                wsUrl = urlObj.toString();
            } catch {
                // wsUrl stays as-is if URL construction fails
            }

            set({ status: "connecting" });

            try {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    console.log("[WS-GLOBAL] Connected to", wsUrl);
                    set({ status: "connected", retryCount: 0, ws });

                    // Subscribe to canvas events on this session
                    ws.send(JSON.stringify({ type: "canvas_subscribe" }));

                    // Heartbeat every 30s to keep the connection alive
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    heartbeatInterval = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: "ping", sessionId }));
                        }
                    }, 30000);
                };

                ws.onclose = (event) => {
                    console.log("[WS-GLOBAL] Disconnected from", wsUrl, "Code:", event.code);
                    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
                    set({ status: "disconnected", ws: null });

                    // Auto-reconnect after 3 seconds if not intentionally closed
                    if (event.code !== 1000 && event.code !== 1001) {
                        reconnectTimeout = setTimeout(() => {
                            set((s) => ({ retryCount: s.retryCount + 1 }));
                            get().connect(sessionId);
                        }, 3000);
                    }
                };

                ws.onerror = () => {
                    console.error("[WS-GLOBAL] Error on", wsUrl);
                    set({ status: "error" });
                };

                ws.onmessage = (event) => {
                    set({ lastPing: new Date().toISOString() });
                    try {
                        const data = JSON.parse(event.data);
                        const type = data.type;

                        // Ignore pong responses — keepalive only
                        if (type === "pong") return;

                        // Handle welcome message - set sessionId and show welcome dialog
                        if (type === "welcome" && data.sessionId) {
                            set({ sessionId: data.sessionId });
                            useWelcomeStore.getState().show(data as WelcomeData);
                        }

                        const handlers = get().handlers.get(type);
                        if (handlers) {
                            handlers.forEach(handler => handler(data));
                        }
                    } catch (e) {
                        // Ignorar mensajes mal formateados
                    }
                };
            } catch (e) {
                console.error("[WS-GLOBAL] Failed to create WebSocket:", e);
                set({ status: "error" });
            }
        },

        disconnect: () => {
            const { ws } = get();
            if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
            if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
            ws?.close(1000);
            set({ ws: null, status: "disconnected" });
        },

        send: (message: any) => {
            const { ws, status } = get();
            if (ws && status === "connected") {
                ws.send(JSON.stringify(message));
            }
        },

        subscribe: (type: string, handler: MessageHandler) => {
            const { handlers } = get();
            if (!handlers.has(type)) {
                handlers.set(type, new Set());
            }
            handlers.get(type)!.add(handler);

            return () => {
                const h = handlers.get(type);
                if (h) {
                    h.delete(handler);
                    if (h.size === 0) {
                        handlers.delete(type);
                    }
                }
            };
        }
    };
});
