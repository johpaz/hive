import { useEffect, useState } from "react";
import {
  RefreshCw, Settings2, Crown, Shield, Bot, Terminal, Edit2,
  Wifi, WifiOff, Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useHiveLearnLive, type AgentLiveStatus } from "@/hooks/useHiveLearnLive";

// ─── Types ───────────────────────────────────────────────────────────────────
interface HLAgent {
  id: string;
  name: string;
  description: string;
  role: "coordinator" | "worker";
  status: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
}

interface AgentState {
  status: "idle" | "running" | "thinking" | "tool_call" | "completed" | "failed";
  currentTool?: string | null;
  model?: string;
  tools?: number;
}

// ─── Static metadata ──────────────────────────────────────────────────────────
const AGENT_META: Record<string, { emoji: string; label: string; accion: string }> = {
  "hl-profile-agent":      { emoji: "👤", label: "Perfil",       accion: "Analiza edad, nivel y estilo de aprendizaje" },
  "hl-intent-agent":       { emoji: "🎯", label: "Intención",    accion: "Extrae el tema y define los objetivos" },
  "hl-structure-agent":    { emoji: "🗺️", label: "Estructura",   accion: "Diseña el mapa de nodos del currículo" },
  "hl-explanation-agent":  { emoji: "📖", label: "Explicación",  accion: "Genera teoría clara y ejemplos" },
  "hl-exercise-agent":     { emoji: "✏️", label: "Ejercicios",   accion: "Crea práctica activa paso a paso" },
  "hl-quiz-agent":         { emoji: "❓", label: "Quiz",         accion: "Prepara preguntas de verificación" },
  "hl-challenge-agent":    { emoji: "⚡", label: "Reto",         accion: "Diseña desafíos integradores" },
  "hl-code-agent":         { emoji: "💻", label: "Código",       accion: "Genera ejemplos ejecutables" },
  "hl-svg-agent":          { emoji: "📊", label: "Diagrama",     accion: "Dibuja visualizaciones SVG" },
  "hl-gif-agent":          { emoji: "🎞️", label: "Animación",    accion: "Crea guías animadas paso a paso" },
  "hl-image-agent":        { emoji: "🖼️", label: "Imagen",       accion: "Genera imágenes educativas con IA" },
  "hl-infographic-agent":  { emoji: "📈", label: "Infografía",   accion: "Construye resumen visual del tema" },
  "hl-gamification-agent": { emoji: "🏆", label: "Gamificación", accion: "Asigna XP, logros y rachas" },
  "hl-evaluation-agent":   { emoji: "📝", label: "Evaluación",   accion: "Prepara examen final adaptativo" },
  "hl-coordinator-agent":  { emoji: "🔍", label: "Coordinador",  accion: "Revisa coherencia pedagógica" },
  "hl-feedback-agent":     { emoji: "🧠", label: "Feedback",     accion: "Evalúa comprensión semántica del alumno" },
};

const WORKER_IDS = Object.keys(AGENT_META).filter(id => id !== "hl-coordinator-agent");

const STATUS_COLORS: Record<AgentState["status"], string> = {
  idle: "bg-emerald-500",
  running: "bg-green-500",
  thinking: "bg-purple-500",
  tool_call: "bg-cyan-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
};

const STATUS_LABELS: Record<AgentState["status"], string> = {
  idle: "Disponible",
  running: "Ejecutando",
  thinking: "Pensando",
  tool_call: "Usando Herramienta",
  completed: "Completado",
  failed: "Error",
};

// ─── Live Badge ───────────────────────────────────────────────────────────────
function LiveBadge({ isConnected }: { isConnected: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest
      ${isConnected
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        : "bg-white/5 border-white/10 text-white/30"}`}>
      {isConnected
        ? <><Wifi className="h-3 w-3 animate-pulse" /> Live</>
        : <><WifiOff className="h-3 w-3" /> Offline</>}
    </div>
  );
}

// ─── Worker Card (Canvas style) ──────────────────────────────────────────────
function WorkerGraphNode({
  agentId, dbAgent, agentState,
}: {
  agentId: string;
  dbAgent?: HLAgent;
  agentState: AgentState;
}) {
  const navigate = useNavigate();
  const meta = AGENT_META[agentId];
  if (!meta) return null;

  const { status, currentTool } = agentState;
  const isThinking = status === "thinking";
  const isToolCall = status === "tool_call";
  const isActive = isThinking || isToolCall || status === "running";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  const isDisabled = dbAgent && !dbAgent.enabled;

  return (
    <div className={`relative group w-full rounded-xl p-5 flex flex-col gap-3 transition-all duration-300
      bg-[rgba(255,255,255,0.03)] backdrop-blur-xl border
      ${isThinking
        ? "border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.25)]"
        : isCompleted
        ? "border-green-500/30"
        : isFailed
        ? "border-red-500/30"
        : "border-white/[0.08] hover:border-blue-500/30 hover:shadow-[0_0_15px_rgba(59,130,246,0.12)]"}
      ${isDisabled ? "opacity-50 grayscale" : ""}
    `}>
      {/* Top accent line when active */}
      {isActive && (
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/60 to-transparent animate-pulse" />
      )}

      {/* Avatar + badge */}
      <div className="flex justify-between items-start">
        <div className="p-2.5 rounded-lg bg-blue-500/10">
          <Bot className={`h-6 w-6 text-blue-400 ${isActive ? "animate-pulse" : ""}`} />
        </div>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border
          ${isCompleted
            ? "bg-green-500/10 text-green-400 border-green-500/20"
            : "bg-blue-500/10 text-blue-400 border-blue-500/20"}`}>
          {meta.label}
        </span>
      </div>

      {/* Name + status */}
      <div>
        <h3 className="font-bold text-white text-base leading-tight truncate">{meta.label}</h3>
        <div className="flex items-center gap-1.5 mt-1.5">
          {isThinking ? (
            <div className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" />
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce [animation-delay:-0.3s]" />
            </div>
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[status] ?? "bg-gray-500"}`} />
          )}
          <span className="text-[10px] text-white/50 font-medium uppercase tracking-widest">
            {STATUS_LABELS[status] ?? status}
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
      {(agentState.model || agentState.tools !== undefined) && (
        <div className="absolute -top-[72px] left-1/2 -translate-x-1/2 w-44 p-3 bg-[#1c1b1d] border border-white/10 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
          {agentState.model && (
            <div className="text-[10px] text-white/50 flex justify-between mb-1">
              Modelo: <span className="text-white font-mono text-[9px]">{agentState.model}</span>
            </div>
          )}
          {agentState.tools !== undefined && (
            <div className="text-[10px] text-white/50 flex justify-between">
              Tools: <span className="text-white">{agentState.tools}</span>
            </div>
          )}
          <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#1c1b1d] border-r border-b border-white/10 rotate-45" />
        </div>
      )}

      {/* Configure button */}
      {dbAgent && (
        <button
          onClick={() => navigate(`/agents/${dbAgent.id}`)}
          className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white hover:bg-white/10"
          title="Configurar agente"
        >
          <Edit2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── Coordinator Card (prominent) ─────────────────────────────────────────────
function CoordinatorCard({
  coordinator, agentState, isConnected, isGenerating,
}: {
  coordinator?: HLAgent;
  agentState: AgentState;
  isConnected: boolean;
  isGenerating: boolean;
}) {
  const navigate = useNavigate();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent backdrop-blur-sm p-6 lg:p-8">
      {/* Decorative accents */}
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-400 to-purple-600" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/60 to-transparent" />
      <div className="absolute bottom-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />

      {/* Ambient glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-start gap-6">
        {/* Left: icon + info */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="p-4 rounded-2xl bg-purple-500/15 border border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.15)] flex-shrink-0">
            <Crown className="h-8 w-8 text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="font-bold text-white text-xl lg:text-2xl">
                {coordinator?.name ?? "HiveLearn Coordinator"}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-400 border border-purple-500/30">
                Coordinador
              </span>
              <StatusPill status={agentState.status} />
            </div>
            <p className="text-white/50 text-sm leading-relaxed mb-3">
              {coordinator?.description ?? "Coordina el enjambre educativo completo. Recibe el perfil del alumno y su meta, delega tareas a 15 agentes workers, ensambla el LessonProgram y lo renderiza vía A2UI."}
            </p>

            {/* Tool chip if active */}
            {(agentState.status === "thinking" || agentState.status === "tool_call") && agentState.currentTool && (
              <div className="inline-flex items-center gap-1.5 bg-purple-500/5 border border-purple-500/10 rounded-md px-3 py-1.5">
                <Terminal className="h-3.5 w-3.5 text-purple-400/70 shrink-0" />
                <span className="text-[10px] font-mono text-purple-400/80 truncate">⚙ {agentState.currentTool}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: config info */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <LiveBadge isConnected={isConnected} />
            {isGenerating && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                <Zap className="h-3 w-3" /> Generando...
              </span>
            )}
          </div>
          {coordinator?.providerId && (
            <div className="text-[10px] text-white/30 text-right">
              <div className="font-mono">{coordinator.providerId}</div>
              <div className="font-mono text-purple-400/60">{coordinator.modelId}</div>
            </div>
          )}
          {coordinator && (
            <button
              onClick={() => navigate(`/agents/${coordinator.id}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 text-xs transition-all"
            >
              <Edit2 className="h-3 w-3" /> Configurar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Status Pill (compact) ───────────────────────────────────────────────────
function StatusPill({ status }: { status: AgentState["status"] }) {
  const colorMap: Record<AgentState["status"], string> = {
    idle: "bg-white/5 text-white/30 border-white/10",
    running: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    thinking: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    tool_call: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    completed: "bg-green-500/15 text-green-400 border-green-500/20",
    failed: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  const dotColor = STATUS_COLORS[status] ?? "bg-white/20";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${colorMap[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${status === "running" || status === "thinking" ? "animate-pulse" : ""}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function HiveLearnSwarmPage() {
  const navigate = useNavigate();
  const [dbAgents, setDbAgents] = useState<HLAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});

  const { isConnected, isGenerating, agentStatuses, currentAgentId } = useHiveLearnLive();

  const fetchAgents = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hivelearn/agents");
      const data = await res.json();
      setDbAgents(data.agents ?? []);
    } catch {
      setError("No se pudo cargar el enjambre HiveLearn.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, []);

  // Derive agent states
  useEffect(() => {
    const newStates: Record<string, AgentState> = {};
    for (const agentId of Object.keys(AGENT_META)) {
      const isCurrent = currentAgentId === agentId;
      let status: AgentState["status"] = "idle";
      let currentTool: string | null = null;

      if (isCurrent && isGenerating) {
        status = Math.random() > 0.5 ? "thinking" : "tool_call";
        currentTool = status === "tool_call" ? "delegar_a_enjambre" : null;
      } else if (agentStatuses[agentId] === "completed") {
        status = "completed";
      } else if (agentStatuses[agentId] === "failed") {
        status = "failed";
      }

      const dbAgent = dbAgents.find(a => a.id === agentId);
      newStates[agentId] = {
        status,
        currentTool,
        model: dbAgent?.modelId,
        tools: Math.floor(Math.random() * 5) + 1,
      };
    }
    setAgentStates(newStates);
  }, [agentStatuses, currentAgentId, dbAgents, isGenerating]);

  const agentMap = new Map(dbAgents.map(a => [a.id, a]));
  const coordinator = dbAgents.find(a => a.role === "coordinator");

  const activeCount = Object.values(agentStates).filter(s =>
    s.status === "running" || s.status === "thinking" || s.status === "tool_call"
  ).length;

  const completedCount = Object.values(agentStates).filter(s => s.status === "completed").length;

  return (
    <div className="relative z-10 space-y-6">

      {/* ── Header ─ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-2 w-2 rounded-full bg-purple-500 animate-pulse shadow-[0_0_10px_rgba(168,85,247,0.6)]" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-purple-400 uppercase">HIVELEARN · ENJAMBRE</span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-black tracking-tight text-white">
            Enjambre{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-purple-600">
              Educativo
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <LiveBadge isConnected={isConnected} />
          <button
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all group"
            onClick={fetchAgents}
            disabled={isLoading}
            title="Refrescar"
          >
            <RefreshCw className={`h-4 w-4 text-purple-400/70 transition-transform duration-500 group-hover:rotate-180 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Coordinator (prominent, first) ── */}
      <CoordinatorCard
        coordinator={coordinator}
        agentState={agentStates["hl-coordinator-agent"] ?? { status: "idle" }}
        isConnected={isConnected}
        isGenerating={isGenerating}
      />

      {/* ── Workers ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">
            15 agentes workers
          </p>
          <div className="flex items-center gap-3 text-[10px] text-white/25">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              {activeCount} activos
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {completedCount} completados
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {WORKER_IDS.map(id => (
            <WorkerGraphNode
              key={id}
              agentId={id}
              dbAgent={agentMap.get(id)}
              agentState={agentStates[id] ?? { status: "idle" }}
            />
          ))}
        </div>
      </div>

      {/* ── Empty state if no agents ── */}
      {dbAgents.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-white/5 rounded-3xl bg-black/20 backdrop-blur-sm">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-lg font-bold text-white mb-2">Sin agentes configurados</h3>
          <p className="text-white/40 mb-6 text-sm max-w-xs">
            Configura un modelo para el coordinador para activar el enjambre.
          </p>
          <button
            onClick={() => navigate("/hivelearn/config")}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-sm transition-all flex items-center gap-2"
          >
            <Settings2 className="h-4 w-4" />
            Configurar modelo
          </button>
        </div>
      )}
    </div>
  );
}
