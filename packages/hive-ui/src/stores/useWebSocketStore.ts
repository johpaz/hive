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

function getBackoffDelay(retryCount: number): number {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    return delay + Math.random() * 1000;
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let watchdogInterval: ReturnType<typeof setInterval> | null = null;
    let lastActivity = 0;
    let currentSessionId: string | undefined;

    const ZOMBIE_MS = 75_000;   // sin mensajes (ni ping/pong) → socket zombi
    const STALE_MS = 45_000;    // al volver a la pestaña, actividad más vieja → reconectar

    /** Reconexión inmediata (pestaña visible de nuevo / red recuperada). */
    const reconnectNow = () => {
        const state = get();
        if (state.status === "disconnected" && !state.ws && !reconnectTimeout) return; // nunca conectó
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        set({ retryCount: 0 });
        try { state.ws?.close(4000); } catch { /* ignore */ }
        // Si el close no dispara onclose (socket ya muerto), forzamos connect
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            get().connect(currentSessionId);
        }
    };

    // Listeners de visibilidad/red: en pestañas en segundo plano los timers se
    // throttle-an y un socket muerto puede no disparar onclose durante minutos.
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible") return;
            const { ws } = get();
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                reconnectNow();
            } else if (Date.now() - lastActivity > STALE_MS) {
                reconnectNow();
            } else {
                // Señal de vida inmediata al despertar
                try { ws.send(JSON.stringify({ type: "ping", sessionId: currentSessionId })); } catch { /* ignore */ }
            }
        });
    }
    if (typeof window !== "undefined") {
        window.addEventListener("online", reconnectNow);
    }

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
            currentSessionId = sessionId ?? currentSessionId;
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
                    lastActivity = Date.now();
                    set({ status: "connected", retryCount: 0, ws });

                    ws.send(JSON.stringify({ type: "canvas_subscribe" }));

                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    heartbeatInterval = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: "ping", sessionId }));
                        }
                    }, 30000);

                    // Watchdog: si no llega NADA (ni pings del servidor) en
                    // ZOMBIE_MS, el socket está muerto aunque readyState diga OPEN.
                    if (watchdogInterval) clearInterval(watchdogInterval);
                    watchdogInterval = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN && Date.now() - lastActivity > ZOMBIE_MS) {
                            try { ws.close(4000); } catch { /* ignore */ }
                        }
                    }, 15000);
                };

                ws.onclose = (event) => {
                    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
                    if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
                    set({ status: "disconnected", ws: null });

                    if (event.code !== 1000 && event.code !== 1001) {
                        const currentRetryCount = get().retryCount;
                        const delay = getBackoffDelay(currentRetryCount);
                        set((s) => ({ retryCount: s.retryCount + 1 }));
                        reconnectTimeout = setTimeout(() => {
                            get().connect(sessionId);
                        }, delay);
                    }
                };

                ws.onerror = () => {
                    set({ status: "error" });
                };

                ws.onmessage = (event) => {
                    lastActivity = Date.now();
                    set({ lastPing: new Date().toISOString() });
                    try {
                        const data = JSON.parse(event.data);
                        const type = data.type;

                        if (type === "pong") return;
                        // Keepalive del servidor → respondemos pong (prueba de vida a nivel app)
                        if (type === "ping") {
                            try { ws.send(JSON.stringify({ type: "pong", sessionId: currentSessionId })); } catch { /* ignore */ }
                            return;
                        }

                        if (type === "welcome" && data.sessionId) {
                            set({ sessionId: data.sessionId });
                            useWelcomeStore.getState().show(data as WelcomeData);
                        }

                        const handlers = get().handlers.get(type);
                        if (handlers) {
                            handlers.forEach((handler) => handler(data));
                        }
                    } catch {
                        // Ignore malformed messages
                    }
                };
            } catch {
                set({ status: "error" });
            }
        },

        disconnect: () => {
            const { ws } = get();
            if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
            if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
            if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
            ws?.close(1000);
            set({ ws: null, status: "disconnected", retryCount: 0 });
        },

        send: (message: any) => {
            const { ws, status } = get();
            if (ws && status === "connected") {
                ws.send(JSON.stringify(message));
            }
        },

        subscribe: (type: string, handler: MessageHandler) => {
            set((state) => {
                const handlers = new Map(state.handlers);
                const typeHandlers = new Set(handlers.get(type) ?? []);
                typeHandlers.add(handler);
                handlers.set(type, typeHandlers);
                return { handlers };
            });

            return () => {
                set((state) => {
                    const handlers = new Map(state.handlers);
                    const typeHandlers = new Set(handlers.get(type) ?? []);
                    typeHandlers.delete(handler);
                    if (typeHandlers.size === 0) handlers.delete(type);
                    else handlers.set(type, typeHandlers);
                    return { handlers };
                });
            };
        }
    };
});
