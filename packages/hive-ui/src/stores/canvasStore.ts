import { create } from "zustand";
import type { CanvasComponent } from "@/types/canvas";
import { getWsBaseUrl } from "@/lib/gateway-url";

export interface GraphNode {
  id: string;
  name: string;
  type: "agent" | "mcp" | "project" | "task";
  status: string;
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
}

interface GatewayMessage {
  type: string;
  sessionId?: string;
  component?: CanvasComponent;
  componentId?: string;
  data?: {
    nodes?: GraphNode[];
    edges?: GraphEdge[];
    id?: string;
    components?: CanvasComponent[];
    [key: string]: unknown;
  };
}

interface CanvasState {
  ws: WebSocket | null;
  components: CanvasComponent[];
  selectedComponentId: string | null;
  sessionId: string | null;
  isConnected: boolean;
  isReconnecting: boolean;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];

  // Actions
  setComponents: (components: CanvasComponent[]) => void;
  addComponent: (component: CanvasComponent) => void;
  removeComponent: (id: string) => void;
  selectComponent: (id: string | null) => void;
  setSessionId: (id: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  setGraphSnapshot: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  addGraphNode: (node: GraphNode) => void;
  updateGraphNode: (id: string, updates: Partial<GraphNode>) => void;
  removeGraphNode: (id: string) => void;
  addGraphEdge: (edge: GraphEdge) => void;

  // Connection management
  connect: (sessionId: string, userId?: string | null) => void;
  disconnect: () => void;
  sendMessage: (message: any) => void;
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = 3000;
const MAX_RECONNECT_DELAY = 60000;

export const useCanvasStore = create<CanvasState>((set, get) => ({
  ws: null,
  components: [],
  selectedComponentId: null,
  sessionId: null,
  isConnected: false,
  isReconnecting: false,
  graphNodes: [],
  graphEdges: [],

  setComponents: (components) => set({ components }),
  addComponent: (component) => set((s) => ({ components: [...s.components, component] })),
  removeComponent: (id) => set((s) => ({ components: s.components.filter((c) => c.id !== id) })),
  selectComponent: (id) => set({ selectedComponentId: id }),
  setSessionId: (id) => set({ sessionId: id }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setGraphSnapshot: (nodes, edges) => set({ graphNodes: nodes, graphEdges: edges }),

  addGraphNode: (node) =>
    set((s) => {
      const existing = s.graphNodes.find((n) => n.id === node.id);
      if (existing) {
        return { graphNodes: s.graphNodes.map((n) => (n.id === node.id ? node : n)) };
      }
      return { graphNodes: [...s.graphNodes, node] };
    }),

  updateGraphNode: (id, updates) =>
    set((s) => ({
      graphNodes: s.graphNodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),

  removeGraphNode: (id) =>
    set((s) => ({
      graphNodes: s.graphNodes.filter((n) => n.id !== id),
      graphEdges: s.graphEdges.filter((e) => e.source !== id && e.target !== id),
    })),

  addGraphEdge: (edge) =>
    set((s) => {
      const existing = s.graphEdges.find((e) => e.id === edge.id);
      if (existing) return s;
      return { graphEdges: [...s.graphEdges, edge] };
    }),

  connect: (sessionId, userId) => {
    const currentState = get();

    // Si ya está conectado a la misma sesión, no hacer nada
    if (currentState.ws && currentState.sessionId === sessionId && currentState.ws.readyState === WebSocket.OPEN) {
      console.log(`[CanvasStore] Already connected to session: ${sessionId}`);
      return;
    }

    // Si hay una conexión previa diferente, cerrarla
    if (currentState.ws) {
      console.log(`[CanvasStore] Closing previous connection for session: ${currentState.sessionId}`);
      currentState.disconnect();
    }

    const wsUrl = `${getWsBaseUrl()}/canvas?sessionId=${encodeURIComponent(sessionId)}`;

    console.log(`[CanvasStore] Connecting to ${wsUrl}`);
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log(`[CanvasStore] Connected with sessionId: ${sessionId}`);
      reconnectDelay = 3000;
      set({ isConnected: true, isReconnecting: false, sessionId, ws: socket });

      // Handshake
      socket.send(JSON.stringify({
        type: "canvas:handshake",
        sessionId,
        userId: userId || null,
        client: "hive-ui",
        version: "1.0"
      }));

      // Heartbeat every 30s
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "canvas:ping", sessionId }));
        }
      }, 30000);
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as GatewayMessage;

        if (message.type === "canvas:pong") return;

        if (message.type === "canvas:render" || message.type === "canvas:update") {
          // emitCanvas wraps payload in { type, data, timestamp } — component lives in data
          const component = (message.data?.component ?? message.component) as CanvasComponent | undefined;
          if (component) {
            set((s) => {
              const existing = s.components.find((c) => c.id === component.id);
              if (existing) {
                return { components: s.components.map(c => c.id === component.id ? component : c) };
              }
              return { components: [...s.components, component] };
            });
          }
        } else if (message.type === "canvas:clear") {
          set({ components: [] });
        } else if (message.type === "canvas:snapshot") {
          const d = message.data;
          if (d && Array.isArray(d.nodes) && Array.isArray(d.edges)) {
            const updates: Partial<CanvasState> = {
              graphNodes: d.nodes as GraphNode[],
              graphEdges: d.edges as GraphEdge[],
            };
            if (Array.isArray(d.components)) {
              updates.components = d.components as CanvasComponent[];
            }
            set(updates);
          }
        } else if (message.type === "canvas:node_add") {
          const raw = message.data as Record<string, unknown>;
          if (raw?.id) {
            const subData = (raw.data as Record<string, unknown>) ?? {};
            const node: GraphNode = {
              id: raw.id as string,
              type: raw.type as GraphNode["type"],
              name: (raw.label ?? raw.name ?? raw.id) as string,
              status: (subData.status ?? raw.status ?? "pending") as string,
              data: subData,
            };
            get().addGraphNode(node);
          }
        } else if (message.type === "canvas:node_update") {
          const d = message.data as Record<string, unknown>;
          const nodeId = (d?.id ?? d?.nodeId) as string;
          if (nodeId) {
            const subData = (d.data ?? d.changes) as Record<string, unknown> ?? {};
            const updates: Partial<GraphNode> = {};
            if (subData.status) updates.status = subData.status as string;
            // Merge with existing node data to preserve fields like 'role'
            const existingNode = get().graphNodes.find((n) => n.id === nodeId);
            updates.data = { ...(existingNode?.data ?? {}), ...subData };
            get().updateGraphNode(nodeId, updates);
          }
        } else if (message.type === "canvas:node_remove") {
          const d = message.data;
          if (d?.id) get().removeGraphNode(d.id as string);
        } else if (message.type === "canvas:edge_add") {
          const edge = message.data as unknown as GraphEdge;
          if (edge?.id) get().addGraphEdge(edge);
        } else if (message.type === "canvas:ask") {
          const d = message.data as Record<string, unknown> ?? {};
          const component: CanvasComponent = {
            id: (d.id as string) || `ask_${Date.now()}`,
            type: "form",
            props: { question: d.question, fields: d.fields ?? [], raw: d },
            position: { x: 0, y: 0 },
            size: { width: 400, height: 300 },
            agentId: (d.agentId as string) || "",
          };
          set((s) => {
            const existing = s.components.find((c) => c.id === component.id);
            if (existing) return { components: s.components.map(c => c.id === component.id ? component : c) };
            return { components: [...s.components, component] };
          });
        } else if (message.type === "canvas:confirm") {
          const d = message.data as Record<string, unknown> ?? {};
          const component: CanvasComponent = {
            id: (d.id as string) || `confirm_${Date.now()}`,
            type: "alert-dialog",
            props: { message: d.message, confirmLabel: d.confirmLabel ?? "Confirmar", cancelLabel: d.cancelLabel ?? "Cancelar", raw: d },
            position: { x: 0, y: 0 },
            size: { width: 400, height: 200 },
            agentId: (d.agentId as string) || "",
          };
          set((s) => {
            const existing = s.components.find((c) => c.id === component.id);
            if (existing) return { components: s.components.map(c => c.id === component.id ? component : c) };
            return { components: [...s.components, component] };
          });
        }
      } catch (e) {
        console.error("[CanvasStore] Parse error:", e);
      }
    };

    socket.onerror = (error) => {
      console.error("[CanvasStore] WebSocket error:", error);
      set({ isConnected: false });
    };

    socket.onclose = (event) => {
      console.log("[CanvasStore] Disconnected:", event.code, event.reason);
      set({ isConnected: false, ws: null });

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      // Auto-reconnect with exponential backoff if not intentionally closed
      if (event.code !== 1000 && event.code !== 1001) {
        set({ isReconnecting: true });
        console.log(`[CanvasStore] Reconnecting in ${reconnectDelay}ms...`);
        setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
          get().connect(sessionId, userId);
        }, reconnectDelay);
      }
    };
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close(1000, "Intentional disconnect");
      set({ ws: null, isConnected: false });
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  },

  sendMessage: (message) => {
    const { ws, isConnected } = get();
    if (ws && isConnected && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}));
