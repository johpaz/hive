import { create } from "zustand";
import type { CanvasComponent } from "@/types/canvas";
import type { A2UISurface, A2UIServerMessage, A2UIActionMessage, ComponentDef } from "@/types/a2ui";
import { updateDataModel } from "@/modules/canvas/a2ui/dataBinding";
import { useWebSocketStore } from "./useWebSocketStore";

function normalizeA2UIComponent(component: ComponentDef): ComponentDef {
  const rawComponent = component.component as unknown;
  if (!rawComponent || typeof rawComponent !== "object" || Array.isArray(rawComponent)) {
    return component;
  }

  const entries = Object.entries(rawComponent as Record<string, unknown>);
  const [type, props] = entries[0] ?? [];
  if (!type) return component;

  const normalizedProps = props && typeof props === "object" && !Array.isArray(props)
    ? props as Record<string, unknown>
    : {};

  return {
    ...component,
    ...normalizedProps,
    component: type,
  };
}

function collectA2UIChildIds(component: ComponentDef, referencedIds: Set<string>): void {
  const add = (id: unknown) => {
    if (typeof id === "string" && id.length > 0) referencedIds.add(id);
  };
  const addList = (ids: unknown) => {
    if (Array.isArray(ids)) ids.forEach(add);
  };

  const children = component.children;
  if (typeof children === "string") {
    add(children);
  } else if (Array.isArray(children)) {
    addList(children);
  } else if (children && typeof children === "object") {
    if ("explicitList" in children) addList((children as { explicitList?: unknown }).explicitList);
    if ("array" in children) addList((children as { array?: unknown }).array);
    if ("componentId" in children) add((children as { componentId?: unknown }).componentId);
    if ("template" in children) {
      add((children as { template?: { componentId?: unknown } }).template?.componentId);
    }
  }

  add(component.child);
  add(component.trigger);
  add(component.content);
  add(component.entryPointChild);
  add(component.contentChild);

  if (Array.isArray(component.tabItems)) {
    component.tabItems.forEach((tab) => add(tab.child));
  }
  if (Array.isArray(component.tabs)) {
    (component.tabs as Array<{ child?: unknown }>).forEach((tab) => add(tab.child));
  }
}

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
  sessionId: string | null;
  components: CanvasComponent[];
  selectedComponentId: string | null;
  isConnected: boolean;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  zoomLevel: number;
  panX: number;
  panY: number;

  // A2UI v0.9 surfaces
  a2uiSurfaces: Map<string, A2UISurface>;

  // Actions
  setComponents: (components: CanvasComponent[]) => void;
  setSessionId: (sessionId: string | null) => void;
  addComponent: (component: CanvasComponent) => void;
  removeComponent: (id: string) => void;
  selectComponent: (id: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  setGraphSnapshot: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  addGraphNode: (node: GraphNode) => void;
  updateGraphNode: (id: string, updates: Partial<GraphNode>) => void;
  removeGraphNode: (id: string) => void;
  addGraphEdge: (edge: GraphEdge) => void;
  setZoomLevel: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  setPan: (x: number, y: number) => void;

  // A2UI actions
  createA2UISurface: (surface: A2UISurface) => void;
  updateA2UIComponents: (surfaceId: string, components: ComponentDef[]) => void;
  updateA2UIDataModel: (surfaceId: string, path: string | undefined, value: unknown) => void;
  deleteA2UISurface: (surfaceId: string) => void;
  getA2UISurfaces: () => A2UISurface[];

  // Init: subscribes to main WS events, returns cleanup fn
  init: () => () => void;
  sendMessage: (message: any) => void;
  sendA2UIAction: (action: A2UIActionMessage) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  sessionId: null,
  components: [],
  selectedComponentId: null,
  isConnected: false,
  graphNodes: [],
  graphEdges: [],
  zoomLevel: 1,
  panX: 0,
  panY: 0,
  a2uiSurfaces: new Map(),

  setSessionId: (sessionId) => set({ sessionId }),
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

  setZoomLevel: (zoom) => set({ zoomLevel: Math.max(0.25, Math.min(2, zoom)) }),
  
  zoomIn: () => set((s) => ({ zoomLevel: Math.max(0.25, Math.min(2, s.zoomLevel + 0.25)) })),
  
  zoomOut: () => set((s) => ({ zoomLevel: Math.max(0.25, Math.min(2, s.zoomLevel - 0.25)) })),
  
  resetView: () => set({ zoomLevel: 1, panX: 0, panY: 0 }),
  
  setPan: (x, y) => set({ panX: x, panY: y }),

  createA2UISurface: (surface) =>
    set((s) => {
      const next = new Map(s.a2uiSurfaces);
      next.set(surface.surfaceId, surface);
      return { a2uiSurfaces: next };
    }),

  updateA2UIComponents: (surfaceId, incomingComponents) =>
    set((s) => {
      const surface = s.a2uiSurfaces.get(surfaceId);
      if (!surface) return s;
      const updated = { ...surface };
      const normalizedComponents = incomingComponents.map(normalizeA2UIComponent);
      // Merge components: add new, update existing
      const existingMap = new Map(updated.components.map((c) => [c.id, c]));
      for (const comp of normalizedComponents) {
        existingMap.set(comp.id, comp);
      }
      updated.components = Array.from(existingMap.values());
      // Auto-detect root: prefer explicit "root" id, otherwise find orphan (not referenced as child)
      if (!updated.rootId || !existingMap.has(updated.rootId)) {
        const allComponents = updated.components;
        // Collect all child IDs referenced by any component
        const referencedIds = new Set<string>();
        for (const comp of allComponents) {
          collectA2UIChildIds(comp, referencedIds);
        }
        // Root = first component not referenced as a child (true tree root)
        const orphan = allComponents.find((c) => !referencedIds.has(c.id));
        if (orphan) updated.rootId = orphan.id;
        else if (allComponents.length > 0) updated.rootId = allComponents[0].id;
      }
      const nextMap = new Map(s.a2uiSurfaces);
      nextMap.set(surfaceId, updated);
      return { a2uiSurfaces: nextMap };
    }),

  updateA2UIDataModel: (surfaceId, path, value) =>
    set((s) => {
      const surface = s.a2uiSurfaces.get(surfaceId);
      if (!surface) return s;
      const newModel = updateDataModel(surface.dataModel, path, value);
      const nextMap = new Map(s.a2uiSurfaces);
      nextMap.set(surfaceId, { ...surface, dataModel: newModel });
      return { a2uiSurfaces: nextMap };
    }),

  deleteA2UISurface: (surfaceId) =>
    set((s) => {
      const next = new Map(s.a2uiSurfaces);
      next.delete(surfaceId);
      return { a2uiSurfaces: next };
    }),

  getA2UISurfaces: () => Array.from(get().a2uiSurfaces.values()),

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

      // ─── A2UI v0.9 handlers ───────────────────────────────────────────────

      ws.subscribe("a2ui:createSurface", (msg) => {
        const d = (msg.data as Record<string, unknown>) ?? {};
        const surface: A2UISurface = {
          surfaceId: d.surfaceId as string,
          catalogId: d.catalogId as string ?? "basic",
          theme: d.theme as A2UISurface["theme"],
          sendDataModel: d.sendDataModel as boolean ?? false,
          rootId: undefined,
          components: [],
          dataModel: {},
          componentOrder: [],
        };
        get().createA2UISurface(surface);
      }),

      ws.subscribe("a2ui:updateComponents", (msg) => {
        const d = (msg.data as Record<string, unknown>) ?? {};
        const surfaceId = d.surfaceId as string;
        const components = (d.components as ComponentDef[]) ?? [];
        if (surfaceId && components.length > 0) {
          get().updateA2UIComponents(surfaceId, components);
        }
      }),

      ws.subscribe("a2ui:updateDataModel", (msg) => {
        const d = (msg.data as Record<string, unknown>) ?? {};
        const surfaceId = d.surfaceId as string;
        const path = d.path as string | undefined;
        const value = d.value;
        if (surfaceId) {
          get().updateA2UIDataModel(surfaceId, path, value);
        }
      }),

      ws.subscribe("a2ui:deleteSurface", (msg) => {
        const d = (msg.data as Record<string, unknown>) ?? {};
        const surfaceId = d.surfaceId as string;
        if (surfaceId) {
          get().deleteA2UISurface(surfaceId);
        }
      }),
    ];

    return () => unsubs.forEach((u) => u());
  },

  sendMessage: (message) => {
    useWebSocketStore.getState().send(message);
  },

  sendA2UIAction: (action) => {
    useWebSocketStore.getState().send({
      type: "a2ui:action",
      data: action,
    });
  },
}));
