import { create } from "zustand";
import type { CanvasComponent } from "@/types/canvas";
import { useWebSocketStore } from "./useWebSocketStore";

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

interface CanvasState {
  components: CanvasComponent[];
  selectedComponentId: string | null;
  isConnected: boolean;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];

  // Actions
  setComponents: (components: CanvasComponent[]) => void;
  addComponent: (component: CanvasComponent) => void;
  removeComponent: (id: string) => void;
  selectComponent: (id: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  setGraphSnapshot: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  addGraphNode: (node: GraphNode) => void;
  updateGraphNode: (id: string, updates: Partial<GraphNode>) => void;
  removeGraphNode: (id: string) => void;
  addGraphEdge: (edge: GraphEdge) => void;

  // Init: subscribes to main WS events, returns cleanup fn
  init: () => () => void;
  sendMessage: (message: any) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  components: [],
  selectedComponentId: null,
  isConnected: false,
  graphNodes: [],
  graphEdges: [],

  setComponents: (components) => set({ components }),
  addComponent: (component) => set((s) => ({ components: [...s.components, component] })),
  removeComponent: (id) => set((s) => ({ components: s.components.filter((c) => c.id !== id) })),
  selectComponent: (id) => set({ selectedComponentId: id }),
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

  init: () => {
    const ws = useWebSocketStore.getState();

    // Sync initial connection state
    set({ isConnected: ws.status === "connected" });

    // If WS is already connected when init() runs, request snapshot immediately.
    // (The canvas_subscribe sent on onopen may have fired before our handlers were registered)
    if (ws.status === "connected") {
      ws.send({ type: "canvas_subscribe" });
    }

    const unsubs = [
      useWebSocketStore.subscribe((state) => {
        set({ isConnected: state.status === "connected" });
      }),

      ws.subscribe("canvas:snapshot", (msg) => {
        const d = msg.data;
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
      }),

      ws.subscribe("canvas:node_add", (msg) => {
        const raw = msg.data as Record<string, unknown>;
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
      }),

      ws.subscribe("canvas:node_update", (msg) => {
        const d = msg.data as Record<string, unknown>;
        const nodeId = (d?.id ?? d?.nodeId) as string;
        if (nodeId) {
          const subData = ((d.data ?? d.changes) as Record<string, unknown>) ?? {};
          const updates: Partial<GraphNode> = {};
          if (subData.status) updates.status = subData.status as string;
          const existingNode = get().graphNodes.find((n) => n.id === nodeId);
          updates.data = { ...(existingNode?.data ?? {}), ...subData };
          get().updateGraphNode(nodeId, updates);
        }
      }),

      ws.subscribe("canvas:node_remove", (msg) => {
        const d = msg.data;
        if (d?.id) get().removeGraphNode(d.id as string);
      }),

      ws.subscribe("canvas:edge_add", (msg) => {
        const edge = msg.data as unknown as GraphEdge;
        if (edge?.id) get().addGraphEdge(edge);
      }),

      ws.subscribe("canvas:render", (msg) => {
        const component = (msg.data?.component ?? msg.component) as CanvasComponent | undefined;
        if (component) {
          set((s) => {
            const existing = s.components.find((c) => c.id === component.id);
            if (existing) {
              return { components: s.components.map((c) => (c.id === component.id ? component : c)) };
            }
            return { components: [...s.components, component] };
          });
        }
      }),

      ws.subscribe("canvas:clear", () => set({ components: [] })),

      ws.subscribe("canvas:ask", (msg) => {
        const d = (msg.data as Record<string, unknown>) ?? {};
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
          if (existing) return { components: s.components.map((c) => (c.id === component.id ? component : c)) };
          return { components: [...s.components, component] };
        });
      }),

      ws.subscribe("canvas:confirm", (msg) => {
        const d = (msg.data as Record<string, unknown>) ?? {};
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
          if (existing) return { components: s.components.map((c) => (c.id === component.id ? component : c)) };
          return { components: [...s.components, component] };
        });
      }),
    ];

    return () => unsubs.forEach((u) => u());
  },

  sendMessage: (message) => {
    useWebSocketStore.getState().send(message);
  },
}));
