import { useEffect, useState, useCallback, useRef } from "react";
import type { CanvasComponent } from "@/types";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Activity, Layout, Terminal, User as UserIcon, Wifi, WifiOff, Bot, Server, FolderOpen, CheckCircle2, Circle, Loader2, XCircle, MinusCircle, Shield, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { ComponentRenderer } from "./ComponentRenderer";
import { useUserStore } from "@/stores/userStore";
import { useCanvasStore, type GraphNode, type GraphEdge } from "@/stores/canvasStore";


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
  const isThinking = node.status === "thinking";
  const isToolCall = node.status === "tool_call";
  const isActive = isThinking || isToolCall;
  const isCoordinator = (node.data?.role as string) === "coordinator";

  return (
    <div className={`relative group w-64 rounded-xl p-5 flex flex-col gap-3 transition-all duration-300
      bg-[rgba(255,255,255,0.03)] backdrop-blur-xl border
      ${isThinking
        ? "border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.25)]"
        : isCoordinator
        ? "border-purple-500/20 shadow-[0_0_16px_rgba(168,85,247,0.1)] hover:border-purple-500/40"
        : "border-white/[0.08] hover:border-blue-500/30 hover:shadow-[0_0_15px_rgba(59,130,246,0.12)]"}
    `}>
      {/* Role badge + avatar */}
      <div className="flex justify-between items-start">
        <div className={`p-2.5 rounded-lg ${isCoordinator ? "bg-purple-500/10" : "bg-blue-500/10"}`}>
          {isCoordinator
            ? <Shield className="h-6 w-6 text-purple-400" />
            : <Bot className={`h-6 w-6 text-blue-400 ${isActive ? "animate-pulse" : ""}`} />
          }
        </div>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border
          ${isCoordinator
            ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
            : "bg-blue-500/10 text-blue-400 border-blue-500/20"}`}>
          {isCoordinator ? "Coordinador" : "Worker"}
        </span>
      </div>

      {/* Name + status */}
      <div>
        <h3 className="font-bold text-white text-base leading-tight truncate">{node.name}</h3>
        <div className="flex items-center gap-1.5 mt-1.5">
          {isThinking ? (
            <div className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" />
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce [animation-delay:-0.3s]" />
            </div>
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              node.status === "active" || node.status === "running" ? "bg-green-400" :
              node.status === "idle" ? "bg-emerald-400" :
              node.status === "tool_call" ? "bg-cyan-400" :
              node.status === "error" ? "bg-red-400" : "bg-gray-500"
            }`} />
          )}
          <span className="text-[10px] text-white/50 font-medium uppercase tracking-widest">
            {STATUS_LABELS[node.status] ?? node.status}
          </span>
        </div>
      </div>

      {/* Tool chip */}
      {(isToolCall || isThinking) && currentTool && (
        <div className="flex items-center gap-1.5 bg-cyan-500/5 border border-cyan-500/10 rounded-md px-2 py-1">
          <Terminal className="h-3 w-3 text-cyan-400/70 shrink-0" />
          <span className="text-[9px] font-mono text-cyan-400/80 truncate">⚙ {currentTool}</span>
        </div>
      )}

      {/* Hover tooltip */}
      {node.data?.model && (
        <div className="absolute -top-[72px] left-1/2 -translate-x-1/2 w-44 p-3 bg-[#1c1b1d] border border-white/10 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
          <div className="text-[10px] text-white/50 flex justify-between mb-1">
            Modelo: <span className="text-white font-mono text-[9px]">{node.data.model as string}</span>
          </div>
          {node.data?.tools != null && (
            <div className="text-[10px] text-white/50 flex justify-between">
              Tools: <span className="text-white">{node.data.tools as number}</span>
            </div>
          )}
          <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#1c1b1d] border-r border-b border-white/10 rotate-45" />
        </div>
      )}
    </div>
  );
}

function McpGraphNode({ node }: { node: GraphNode }) {
  return (
    <div className="w-48 p-3 rounded-xl flex items-center gap-3 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl border border-teal-500/20 hover:border-teal-500/40 transition-all duration-300">
      <div className="p-1.5 bg-teal-500/10 rounded-lg shrink-0">
        <Server className="h-4 w-4 text-teal-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] text-teal-400 font-bold uppercase tracking-tight">MCP Server</div>
        <div className="text-sm font-bold text-white truncate">{node.name}</div>
      </div>
      <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${node.status === "connected" || node.status === "active" ? "bg-teal-400" : "bg-gray-500"}`} />
    </div>
  );
}

function ProjectGraphNode({ node, tasks }: { node: GraphNode; tasks: GraphNode[] }) {
  const [expanded, setExpanded] = useState(true);
  const progress = (node.data?.progress as number) ?? 0;
  const projectType = (node.data?.projectType as string) ?? "general";

  return (
    <div className="rounded-xl overflow-hidden bg-[rgba(255,255,255,0.03)] backdrop-blur-xl border border-blue-500/20 hover:border-blue-500/40 transition-all duration-300 w-72">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-blue-500/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="p-1.5 bg-blue-500/10 rounded-lg shrink-0">
          <FolderOpen className="h-4 w-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate">{node.name}</span>
            <span className="text-[9px] text-blue-400 font-bold uppercase tracking-tight shrink-0">{projectType}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <Progress value={progress} className="h-1 flex-1" />
            <span className="text-[10px] text-white/40 shrink-0 font-mono">{progress}%</span>
          </div>
        </div>
      </button>

      {/* Tasks */}
      {expanded && tasks.length > 0 && (
        <div className="border-t border-white/[0.06] p-3 space-y-2">
          {tasks.map((task) => {
            const taskProgress = (task.data?.progress as number) ?? 0;
            const taskBg =
              task.status === "in_progress" ? "bg-blue-500/10 border-blue-500/20" :
              task.status === "completed" ? "bg-white/[0.03] border-white/5" :
              "bg-white/[0.02] border-white/5 opacity-50";
            return (
              <div key={task.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${taskBg}`}>
                <TaskStatusIcon status={task.status} />
                <span className="text-[11px] flex-1 text-white/70 truncate">{task.name}</span>
                {task.status === "in_progress" && (
                  <div className="w-10 shrink-0">
                    <Progress value={taskProgress} className="h-1" />
                  </div>
                )}
                <span className="text-[10px] text-white/30 font-mono shrink-0">{taskProgress}%</span>
              </div>
            );
          })}
        </div>
      )}

      {expanded && tasks.length === 0 && (
        <div className="border-t border-white/[0.06] px-4 py-3 text-xs text-white/30">
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
    <div className="flex gap-6 h-full">
      {/* Main content: legend + agents + projects */}
      <div className="flex-1 min-w-0 space-y-8">
        {/* Status legend */}
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { color: "bg-green-400", label: "Activo" },
            { color: "bg-purple-400", label: "Pensando" },
            { color: "bg-cyan-400", label: "Herramienta" },
            { color: "bg-emerald-400", label: "Disponible" },
            { color: "bg-red-400", label: "Error" },
            { color: "bg-teal-400", label: "MCP" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 bg-white/[0.03] backdrop-blur-md px-3 py-1.5 rounded-full border border-white/[0.06]">
              <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
              <span className="text-[10px] font-bold tracking-wider text-white/50 uppercase">{label}</span>
            </div>
          ))}
        </div>

        {/* Agents */}
        {agentNodes.length > 0 && (
          <div>
            <p className="hive-label mb-3">Agentes</p>
            <div className="flex flex-wrap gap-4">
              {agentNodes.map((n) => <AgentGraphNode key={n.id} node={n} />)}
            </div>
          </div>
        )}

        {/* Projects */}
        {projectNodes.length > 0 && (
          <div>
            <p className="hive-label mb-3">Proyectos</p>
            <div className="flex flex-wrap gap-4">
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

      {/* MCP column — right side */}
      {mcpNodes.length > 0 && (
        <div className="shrink-0 w-52">
          <p className="hive-label mb-3">MCP Servers</p>
          <div className="flex flex-col gap-3">
            {mcpNodes.map((n) => <McpGraphNode key={n.id} node={n} />)}
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
      <div className="relative flex flex-1 flex-col overflow-hidden"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      >
        <ScrollArea className="flex-1 p-6">
          {/* Graph view */}
          <GraphView nodes={graphNodes} edges={graphEdges} />

          {/* Agent-rendered UI components */}
          {components.length > 0 && (
            <div className="mt-8">
              <p className="hive-label mb-3">Componentes</p>
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

        {/* Bottom toolbar */}
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-1 px-4 py-2 rounded-full border border-white/10 bg-[#1c1b1d]/70 backdrop-blur-xl shadow-[0_0_20px_rgba(59,130,246,0.08)]">
          <button className="p-2 text-white/40 hover:text-white hover:scale-110 transition-all duration-150 active:scale-90">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button className="p-2 text-white/40 hover:text-white hover:scale-110 transition-all duration-150 active:scale-90">
            <ZoomOut className="h-4 w-4" />
          </button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button className="p-2 text-blue-400 bg-blue-500/10 rounded-full hover:bg-blue-500/20 transition-all duration-150 active:scale-90">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

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
