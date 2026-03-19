import { useEffect, useState, useCallback, useRef } from "react";
import type { CanvasComponent } from "@/types";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Activity, Layout, Terminal, User as UserIcon, Wifi, WifiOff, Bot, Server, FolderOpen, CheckCircle2, Circle, Loader2, XCircle, MinusCircle } from "lucide-react";
import { ComponentRenderer } from "./ComponentRenderer";
import { useUserStore } from "@/stores/userStore";
import { useCanvasStore, type GraphNode, type GraphEdge } from "@/stores/canvasStore";

// Use environment variable for gateway URL, fall back to current host (production)
const API_URL = import.meta.env.VITE_API_URL;
const GATEWAY_WS_URL = API_URL
  ? API_URL.replace(/^http/, "ws")
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

interface CanvasContainerProps {
  sessionId?: string;
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
    [key: string]: unknown;
  };
}

// --- Graph Node Renderers ---

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  paused: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  idle: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  done: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  blocked: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  running: "bg-green-500/10 text-green-400 border-green-500/20",
  thinking: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  tool_call: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  pending: "Pendiente",
  in_progress: "En progreso",
  paused: "Pausado",
  idle: "Disponible",
  completed: "Completado",
  done: "Completado",
  failed: "Fallido",
  blocked: "Bloqueado",
  running: "Ejecutando",
  thinking: "Pensando",
  tool_call: "Usando Herramienta",
};

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    case "in_progress": return <Loader2 className="h-3.5 w-3.5 text-yellow-400 animate-spin" />;
    case "failed": return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case "blocked": return <MinusCircle className="h-3.5 w-3.5 text-orange-400" />;
    default: return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function AgentGraphNode({ node }: { node: GraphNode }) {
  const currentTool = (node.data?.currentTool as string | null) ?? null;
  const isActive = node.status === "thinking" || node.status === "tool_call";
  return (
    <div className="hive-card group">
      <div className="hive-card-body">
        <div className="flex items-center gap-2">
          <div className="hive-icon-wrap hive-icon-wrap--primary">
            <Bot className={`h-3.5 w-3.5 ${isActive ? "animate-pulse" : ""}`} />
          </div>
          <span className="text-sm font-medium truncate flex-1">{node.name}</span>
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 w-fit mt-2 ${STATUS_COLORS[node.status] ?? "bg-gray-500/10 text-gray-400"}`}
        >
          {STATUS_LABELS[node.status] ?? node.status}
        </Badge>
        {node.status === "tool_call" && currentTool && (
          <p className="text-[10px] text-cyan-400 mt-1 font-mono truncate">⚙ {currentTool}</p>
        )}
      </div>
    </div>
  );
}

function McpGraphNode({ node }: { node: GraphNode }) {
  return (
    <div className="hive-card group">
      <div className="hive-card-body">
        <div className="flex items-center gap-2">
          <div className="hive-icon-wrap bg-purple-500/10 border-purple-500/20 text-purple-400">
            <Server className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-medium truncate flex-1">{node.name}</span>
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 w-fit mt-2 ${STATUS_COLORS[node.status] ?? ""}`}
        >
          {STATUS_LABELS[node.status] ?? node.status}
        </Badge>
      </div>
    </div>
  );
}

function ProjectGraphNode({ node, tasks }: { node: GraphNode; tasks: GraphNode[] }) {
  const [expanded, setExpanded] = useState(true);
  const progress = (node.data?.progress as number) ?? 0;
  const projectType = (node.data?.projectType as string) ?? "general";

  return (
    <div className="hive-card overflow-hidden">
      <button
        className="w-full flex items-center gap-2.5 p-3 text-left hover:bg-blue-500/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{node.name}</span>
            <Badge variant="outline" className="hive-tag hive-tag--provider text-[10px] px-1.5 py-0">
              {projectType}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[node.status] ?? ""}`}
            >
              {STATUS_LABELS[node.status] ?? node.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <Progress value={progress} className="h-1 flex-1" />
            <span className="text-[11px] text-muted-foreground shrink-0">{progress}%</span>
          </div>
        </div>
      </button>

      {expanded && tasks.length > 0 && (
        <div className="border-t border-white/10 px-3 py-2 space-y-1.5">
          {tasks.map((task) => {
            const taskProgress = (task.data?.progress as number) ?? 0;
            return (
              <div key={task.id} className="flex items-center gap-2 py-0.5">
                <TaskStatusIcon status={task.status} />
                <span className="text-xs flex-1 text-muted-foreground truncate">{task.name}</span>
                {task.status === "in_progress" && (
                  <div className="w-12 shrink-0">
                    <Progress value={taskProgress} className="h-1" />
                  </div>
                )}
                <span className="text-[10px] text-muted-foreground w-7 text-right shrink-0">{taskProgress}%</span>
              </div>
            );
          })}
        </div>
      )}

      {expanded && tasks.length === 0 && (
        <div className="border-t border-white/10 px-3 py-2 text-xs text-muted-foreground">
          Sin tareas
        </div>
      )}
    </div>
  );
}

function GraphView({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const agentNodes = nodes.filter((n) => n.type === "agent");
  const mcpNodes = nodes.filter((n) => n.type === "mcp");
  const projectNodes = nodes.filter((n) => n.type === "project");
  const taskNodes = nodes.filter((n) => n.type === "task");

  // Map task nodes to their parent project
  const tasksByProject = new Map<string, GraphNode[]>();
  for (const edge of edges) {
    if (edge.edgeType === "contains") {
      const projectId = edge.source;
      const taskId = edge.target;
      const task = taskNodes.find((t) => t.id === taskId);
      if (task) {
        if (!tasksByProject.has(projectId)) tasksByProject.set(projectId, []);
        tasksByProject.get(projectId)!.push(task);
      }
    }
  }

  if (nodes.length === 0) {
    return (
      <div className="hive-empty-state">
        <Activity className="h-10 w-10 opacity-30" />
        <p className="text-sm mt-3">Sin agentes ni proyectos activos</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Agents row */}
      {agentNodes.length > 0 && (
        <div>
          <p className="hive-label mb-2">
            Agentes
          </p>
          <div className="flex flex-wrap gap-2">
            {agentNodes.map((n) => <AgentGraphNode key={n.id} node={n} />)}
          </div>
        </div>
      )}

      {/* MCP row */}
      {mcpNodes.length > 0 && (
        <div>
          <p className="hive-label mb-2">
            MCP Servers
          </p>
          <div className="flex flex-wrap gap-2">
            {mcpNodes.map((n) => <McpGraphNode key={n.id} node={n} />)}
          </div>
        </div>
      )}

      {/* Projects */}
      {projectNodes.length > 0 && (
        <div>
          <p className="hive-label mb-2">
            Proyectos
          </p>
          <div className="space-y-2">
            {projectNodes.map((n) => (
              <ProjectGraphNode
                key={n.id}
                node={n}
                tasks={tasksByProject.get(n.id) ?? []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CanvasContainer({ sessionId: propSessionId }: CanvasContainerProps) {
  const user = useUserStore((s) => s.currentUser);
  const isConnected = useCanvasStore((s) => s.isConnected);
  const isReconnecting = useCanvasStore((s) => s.isReconnecting);
  const components = useCanvasStore((s) => s.components);
  const graphNodes = useCanvasStore((s) => s.graphNodes);
  const graphEdges = useCanvasStore((s) => s.graphEdges);
  const connect = useCanvasStore((s) => s.connect);
  const sendMessage = useCanvasStore((s) => s.sendMessage);

  // Get the effective session ID: use prop, or user.id, or default
  const effectiveSessionId = propSessionId || user?.id || "default";
  const canvasSessionId = effectiveSessionId.startsWith("canvas:")
    ? effectiveSessionId
    : `canvas:${effectiveSessionId}`;

  useEffect(() => {
    // Conectar usando el store global (mantiene la conexión si ya existe)
    connect(canvasSessionId, user?.id);

    // NOTAR: No cerramos la conexión aquí para mantener el KeepAlive
    // Solo se cerrará si el usuario lo solicita explícitamente o al cerrar la app
  }, [canvasSessionId, user?.id, connect]);

  const handleInteraction = useCallback((componentId: string, action: string, data?: unknown) => {
    sendMessage({
      type: "canvas:interact",
      sessionId: canvasSessionId,
      componentId,
      action,
      data,
    });
  }, [sendMessage, canvasSessionId]);

  return (
    <div className="hive-card flex h-full flex-col shadow-2xl">
      {/* Header */}
      <div className="flex flex-row items-center justify-between space-y-0 border-b border-white/5 bg-white/5 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="hive-icon-wrap hive-icon-wrap--primary">
            <Layout className="h-5 w-5" />
          </div>
          <div>
            <h2 className="hive-title-page !text-lg">Canvas</h2>
            <div className="flex items-center gap-2 text-xs text-white/40 mt-0.5">
              <UserIcon className="h-3 w-3" />
              <span className="font-mono">{effectiveSessionId}</span>
            </div>
          </div>
        </div>

        <Badge
          variant="outline"
          className={`flex items-center gap-1.5 px-3 py-1 transition-all duration-500 border ${
            isConnected
              ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
              : isReconnecting
              ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20"
              : "bg-red-500/15 text-red-500 border-red-500/20 hover:bg-red-500/20"
          }`}
        >
          {isConnected ? (
            <>
              <Wifi className="h-3.5 w-3.5 animate-pulse" />
              <span className="font-semibold uppercase tracking-wider text-[10px]">Live</span>
            </>
          ) : isReconnecting ? (
            <>
              <Wifi className="h-3.5 w-3.5 animate-pulse" />
              <span className="font-semibold uppercase tracking-wider text-[10px]">Reconectando</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5" />
              <span className="font-semibold uppercase tracking-wider text-[10px]">Offline</span>
            </>
          )}
        </Badge>
      </div>

      {/* Content */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <ScrollArea className="flex-1 p-6">
          {/* Graph view */}
          <GraphView nodes={graphNodes} edges={graphEdges} />

          {/* Agent-rendered UI components */}
          {components.length > 0 && (
            <div className="mt-6">
              <p className="hive-label mb-3">
                Componentes
              </p>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {components.map((component) => (
                  <ComponentRenderer
                    key={component.id}
                    component={component}
                    onInteraction={handleInteraction}
                  />
                ))}
              </div>
            </div>
          )}
        </ScrollArea>

        {/* Status bar */}
        <div className="border-t border-white/5 bg-white/[0.02] px-6 py-2.5">
          <div className="flex items-center gap-2">
            <Terminal className="h-3 w-3 text-white/30" />
            <span className="hive-mono">
              {isConnected
                ? `Sincronizado · ${graphNodes.length} nodos · ${graphEdges.length} conexiones`
                : "Reconectando..."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
