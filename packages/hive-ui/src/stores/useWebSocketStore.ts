import { create } from "zustand";
import type { WebSocketStatus } from "@/types";
import { useWelcomeStore, type WelcomeData } from "./useWelcomeStore";

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

    return {
        ws: null,
        status: "disconnected",
        url: import.meta.env.VITE_WS_URL ||
            (import.meta.env.VITE_API_URL || "http://localhost:18790").replace(/^http/, "ws") + "/ws",
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
            if (sessionId) {
                const urlObj = new URL(wsUrl);
                urlObj.searchParams.set("session", sessionId);
                wsUrl = urlObj.toString();
            }

            set({ status: "connecting" });

            try {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    console.log("[WS-GLOBAL] Connected to", wsUrl);
                    set({ status: "connected", retryCount: 0, ws });
                };

                ws.onclose = (event) => {
                    console.log("[WS-GLOBAL] Disconnected from", wsUrl, "Code:", event.code);
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
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            ws?.close();
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
