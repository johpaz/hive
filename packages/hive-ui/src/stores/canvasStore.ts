import { create } from "zustand";
import type { A2UISurface, A2UIActionMessage, ComponentDef } from "@/types/a2ui";
import { updateDataModel } from "@/modules/canvas/a2ui/dataBinding";
import { useWebSocketStore } from "./useWebSocketStore";
import { appendCanvasWorkEvent } from "./canvasWorkEvents";

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
  description?: string;
  type: "agent" | "mcp";
  status: string;
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  data?: Record<string, unknown>;
}

export type CanvasWorkPhase =
  | "delegated"
  | "review_started"
  | "review_passed"
  | "review_failed"
  | "completed"
  | "failed"
  | "aborted"
  | "blocked";

export interface CanvasWorkEvent {
  eventId: string;
  phase: CanvasWorkPhase;
  taskRef: string;
  taskName: string;
  actorId: string;
  targetId: string | null;
  toolName?: string | null;
  detail?: string | null;
  timestamp: number;
}

interface CanvasState {
  isConnected: boolean;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  workEvents: CanvasWorkEvent[];

  // A2UI v0.9 surfaces
  a2uiSurfaces: Map<string, A2UISurface>;
  unseenA2UICount: number;

  // Actions
  setIsConnected: (connected: boolean) => void;
  setGraphSnapshot: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  addGraphNode: (node: GraphNode) => void;
  updateGraphNode: (id: string, updates: Partial<GraphNode>) => void;
  removeGraphNode: (id: string) => void;
  addGraphEdge: (edge: GraphEdge) => void;
  removeGraphEdge: (id: string) => void;
  addWorkEvent: (event: CanvasWorkEvent) => void;
  // A2UI actions
  createA2UISurface: (surface: A2UISurface) => void;
  updateA2UIComponents: (surfaceId: string, components: ComponentDef[]) => void;
  updateA2UIDataModel: (surfaceId: string, path: string | undefined, value: unknown) => void;
  deleteA2UISurface: (surfaceId: string) => void;
  getA2UISurfaces: () => A2UISurface[];
  markA2UISeen: () => void;

  // Init: subscribes to main WS events, returns cleanup fn
  init: () => () => void;
  sendA2UIAction: (action: A2UIActionMessage) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  isConnected: false,
  graphNodes: [],
  graphEdges: [],
  workEvents: [],
  a2uiSurfaces: new Map(),
  unseenA2UICount: 0,

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

  removeGraphEdge: (id) =>
    set((s) => ({ graphEdges: s.graphEdges.filter((e) => e.id !== id) })),

  addWorkEvent: (event) =>
    set((s) => ({ workEvents: appendCanvasWorkEvent(s.workEvents, event) })),

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

  markA2UISeen: () => set({ unseenA2UICount: 0 }),

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

      ws.subscribe("canvas:edge_remove", (msg) => {
        const d = msg.data;
        if (d?.id) get().removeGraphEdge(d.id as string);
      }),

      ws.subscribe("canvas:work_event", (msg) => {
        const data = msg.data as Omit<CanvasWorkEvent, "timestamp"> | undefined;
        if (!data?.eventId || !data.phase || !data.actorId) return;
        get().addWorkEvent({
          ...data,
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        });
      }),

      // ─── A2UI v0.9 handlers ───────────────────────────────────────────────

      ws.subscribe("a2ui:createSurface", (msg) => {
        const d = (msg.data as Record<string, unknown>) ?? {};
        const surfaceId = d.surfaceId as string;
        const surface: A2UISurface = {
          surfaceId,
          catalogId: d.catalogId as string ?? "basic",
          theme: d.theme as A2UISurface["theme"],
          sendDataModel: d.sendDataModel as boolean ?? false,
          rootId: undefined,
          components: [],
          dataModel: {},
          componentOrder: [],
        };
        // Replay (reconnect) re-sends createSurface for surfaces the client already
        // has — only count it as "unseen" the first time it shows up.
        const isNew = !get().a2uiSurfaces.has(surfaceId);
        get().createA2UISurface(surface);
        if (isNew) set((s) => ({ unseenA2UICount: s.unseenA2UICount + 1 }));
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

  sendA2UIAction: (action) => {
    useWebSocketStore.getState().send({
      type: "a2ui:action",
      data: action,
    });
  },
}));
