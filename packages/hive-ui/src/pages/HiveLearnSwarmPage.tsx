import { useEffect, useState } from "react";
import {
  RefreshCw, Settings2, Crown, Shield, Bot, Terminal,
  Wifi, WifiOff, Zap,
} from "lucide-react";
import { useHiveLearnLive, type AgentLiveStatus } from "@/hooks/useHiveLearnLive";
import { AgentConfigDialog } from "@/modules/hivelearn/AgentConfigDialog";

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
  systemPrompt?: string;
  workspace?: string;
  tone?: string;
  maxIterations?: number;
}

interface AgentState {
  status: "idle" | "running" | "thinking" | "tool_call" | "completed" | "failed";
  currentTool?: string | null;
  model?: string;
  tools?: number;
}

// ─── Static metadata ──────────────────────────────────────────────────────────
const AGENT_META: Record<string, { icon: any; emoji: string; label: string; accion: string; color: string }> = {
  "hl-profile-agent":      { icon: Bot,         emoji: "👤", label: "Perfil",       accion: "Analiza edad, nivel y estilo de aprendizaje", color: "blue" },
  "hl-intent-agent":       { icon: Crown,        emoji: "🎯", label: "Intención",    accion: "Extrae el tema y define los objetivos", color: "amber" },
  "hl-structure-agent":    { icon: Terminal,     emoji: "🗺️", label: "Estructura",   accion: "Diseña el mapa de nodos del currículo", color: "indigo" },
  "hl-explanation-agent":  { icon: Bot,          emoji: "📖", label: "Explicación",  accion: "Genera teoría clara y ejemplos", color: "emerald" },
  "hl-exercise-agent":     { icon: Zap,          emoji: "✏️", label: "Ejercicios",   accion: "Crea práctica activa paso a paso", color: "orange" },
  "hl-quiz-agent":         { icon: Bot,          emoji: "❓", label: "Quiz",         accion: "Prepara preguntas de verificación", color: "pink" },
  "hl-challenge-agent":    { icon: Shield,       emoji: "⚡", label: "Reto",         accion: "Diseña desafíos integradores", color: "red" },
  "hl-code-agent":         { icon: Terminal,     emoji: "💻", label: "Código",       accion: "Genera ejemplos ejecutables", color: "cyan" },
  "hl-svg-agent":          { icon: Bot,          emoji: "📊", label: "Diagrama",     accion: "Dibuja visualizaciones SVG", color: "teal" },
  "hl-gif-agent":          { icon: Zap,          emoji: "🎞️", label: "Animación",    accion: "Crea guías animadas paso a paso", color: "violet" },
  "hl-image-agent":        { icon: Bot,          emoji: "🖼️", label: "Imagen",       accion: "Genera imágenes educativas con IA", color: "fuchsia" },
  "hl-infographic-agent":  { icon: Terminal,     emoji: "📈", label: "Infografía",   accion: "Construye resumen visual del tema", color: "lime" },
  "hl-gamification-agent": { icon: Crown,        emoji: "🏆", label: "Gamificación", accion: "Asigna XP, logros y rachas", color: "yellow" },
  "hl-evaluation-agent":   { icon: Shield,       emoji: "📝", label: "Evaluación",   accion: "Prepara examen final adaptativo", color: "rose" },
  "hl-coordinator-agent":  { icon: Crown,        emoji: "🔍", label: "Coordinador",  accion: "Revisa coherencia pedagógica", color: "purple" },
  "hl-feedback-agent":     { icon: Bot,          emoji: "🧠", label: "Feedback",     accion: "Evalúa comprensión semántica del alumno", color: "sky" },
};

const WORKER_IDS = Object.keys(AGENT_META).filter(id => id !== "hl-coordinator-agent");

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; glow: string; iconBg: string; badgeBorder: string }> = {
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400", glow: "shadow-[0_0_20px_rgba(59,130,246,0.25)]", iconBg: "bg-blue-500/15", badgeBorder: "border-blue-500/20" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", glow: "shadow-[0_0_20px_rgba(245,158,11,0.25)]", iconBg: "bg-amber-500/15", badgeBorder: "border-amber-500/20" },
  indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/30", text: "text-indigo-400", glow: "shadow-[0_0_20px_rgba(99,102,241,0.25)]", iconBg: "bg-indigo-500/15", badgeBorder: "border-indigo-500/20" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", glow: "shadow-[0_0_20px_rgba(16,185,129,0.25)]", iconBg: "bg-emerald-500/15", badgeBorder: "border-emerald-500/20" },
  orange: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", glow: "shadow-[0_0_20px_rgba(249,115,22,0.25)]", iconBg: "bg-orange-500/15", badgeBorder: "border-orange-500/20" },
  pink: { bg: "bg-pink-500/10", border: "border-pink-500/30", text: "text-pink-400", glow: "shadow-[0_0_20px_rgba(236,72,153,0.25)]", iconBg: "bg-pink-500/15", badgeBorder: "border-pink-500/20" },
  red: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", glow: "shadow-[0_0_20px_rgba(239,68,68,0.25)]", iconBg: "bg-red-500/15", badgeBorder: "border-red-500/20" },
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400", glow: "shadow-[0_0_20px_rgba(6,182,212,0.25)]", iconBg: "bg-cyan-500/15", badgeBorder: "border-cyan-500/20" },
  teal: { bg: "bg-teal-500/10", border: "border-teal-500/30", text: "text-teal-400", glow: "shadow-[0_0_20px_rgba(20,184,166,0.25)]", iconBg: "bg-teal-500/15", badgeBorder: "border-teal-500/20" },
  violet: { bg: "bg-violet-500/10", border: "border-violet-500/30", text: "text-violet-400", glow: "shadow-[0_0_20px_rgba(139,92,246,0.25)]", iconBg: "bg-violet-500/15", badgeBorder: "border-violet-500/20" },
  fuchsia: { bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/30", text: "text-fuchsia-400", glow: "shadow-[0_0_20px_rgba(217,70,239,0.25)]", iconBg: "bg-fuchsia-500/15", badgeBorder: "border-fuchsia-500/20" },
  lime: { bg: "bg-lime-500/10", border: "border-lime-500/30", text: "text-lime-400", glow: "shadow-[0_0_20px_rgba(132,204,22,0.25)]", iconBg: "bg-lime-500/15", badgeBorder: "border-lime-500/20" },
  yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", glow: "shadow-[0_0_20px_rgba(234,179,8,0.25)]", iconBg: "bg-yellow-500/15", badgeBorder: "border-yellow-500/20" },
  rose: { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-400", glow: "shadow-[0_0_20px_rgba(244,63,94,0.25)]", iconBg: "bg-rose-500/15", badgeBorder: "border-rose-500/20" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", glow: "shadow-[0_0_20px_rgba(168,85,247,0.25)]", iconBg: "bg-purple-500/15", badgeBorder: "border-purple-500/20" },
  sky: { bg: "bg-sky-500/10", border: "border-sky-500/30", text: "text-sky-400", glow: "shadow-[0_0_20px_rgba(14,165,233,0.25)]", iconBg: "bg-sky-500/15", badgeBorder: "border-sky-500/20" },
};

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
  agentId, dbAgent, agentState, onConfigSuccess,
}: {
  agentId: string;
  dbAgent?: HLAgent;
  agentState: AgentState;
  onConfigSuccess: () => void;
}) {
  const meta = AGENT_META[agentId];
  if (!meta) return null;

  const [configOpen, setConfigOpen] = useState(false);
  const colors = COLOR_MAP[meta.color] ?? COLOR_MAP.blue;
  const IconComponent = meta.icon ?? Bot;

  const { status, currentTool } = agentState;
  const isThinking = status === "thinking";
  const isToolCall = status === "tool_call";
  const isActive = isThinking || isToolCall || status === "running";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  const isDisabled = dbAgent && !dbAgent.enabled;

  return (
    <div className={`relative group w-full rounded-xl p-5 flex flex-col gap-4 transition-all duration-300
      bg-[rgba(255,255,255,0.03)] backdrop-blur-xl border
      ${isThinking
        ? `${colors.border} ${colors.glow}`
        : isCompleted
        ? "border-green-500/30"
        : isFailed
        ? "border-red-500/30"
        : "border-white/[0.08] hover:border-white/20"}
      ${isDisabled ? "opacity-50 grayscale" : ""}
    `}>
      {/* Top accent line when active */}
      {isActive && (
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-${meta.color}-500/60 to-transparent animate-pulse`} />
      )}

      {/* Header: Icon + Badge */}
      <div className="flex items-start justify-between">
        <div className={`p-3 rounded-xl ${colors.iconBg} border ${colors.badgeBorder}`}>
          <IconComponent className={`h-6 w-6 ${colors.text} ${isActive ? "animate-pulse" : ""}`} />
        </div>
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase border ${colors.bg} ${colors.text} ${colors.badgeBorder}`}>
          {meta.label}
        </span>
      </div>

      {/* Content: Name + Description */}
      <div className="flex-1 space-y-2">
        <div>
          <h3 className="font-bold text-white text-base leading-tight mb-1.5">{meta.label}</h3>
          <p className="text-[11px] text-white/50 leading-relaxed line-clamp-2">{meta.accion}</p>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {isThinking ? (
            <div className="flex gap-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${colors.text} animate-bounce`} />
              <span className={`w-1.5 h-1.5 rounded-full ${colors.text} animate-bounce [animation-delay:-0.15s]`} />
              <span className={`w-1.5 h-1.5 rounded-full ${colors.text} animate-bounce [animation-delay:-0.3s]`} />
            </div>
          ) : (
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[status] ?? "bg-gray-500"}`} />
          )}
          <span className="text-[10px] text-white/50 font-medium uppercase tracking-wider">
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>
      </div>

      {/* Tool chip */}
      {(isToolCall || isThinking) && currentTool && (
        <div className={`flex items-center gap-2 ${colors.bg} border ${colors.badgeBorder} rounded-lg px-2.5 py-1.5`}>
          <Terminal className={`h-3.5 w-3.5 ${colors.text} shrink-0`} />
          <span className="text-[10px] font-mono text-white/70 truncate">{currentTool}</span>
        </div>
      )}

      {/* Configure button */}
      <button
        onClick={() => setConfigOpen(true)}
        className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all text-white/30 hover:text-white hover:bg-white/10"
        title="Configurar agente"
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>

      {/* Config Dialog */}
      {dbAgent && (
        <AgentConfigDialog
          agentId={dbAgent.id}
          agentName={meta.label}
          agentDescription={meta.accion}
          agentData={{
            id: dbAgent.id,
            name: dbAgent.name,
            description: dbAgent.description,
            provider_id: dbAgent.providerId,
            model_id: dbAgent.modelId,
            system_prompt: dbAgent.systemPrompt ?? "",
            workspace: dbAgent.workspace ?? "",
            tone: dbAgent.tone ?? "",
            role: dbAgent.role,
            enabled: dbAgent.enabled,
            max_iterations: dbAgent.maxIterations ?? 3,
          }}
          open={configOpen}
          onOpenChange={setConfigOpen}
          onSuccess={onConfigSuccess}
        />
      )}
    </div>
  );
}

// ─── Coordinator Card (prominent) ─────────────────────────────────────────────
function CoordinatorCard({
  coordinator, agentState, isConnected, isGenerating, onConfigSuccess,
}: {
  coordinator?: HLAgent;
  agentState: AgentState;
  isConnected: boolean;
  isGenerating: boolean;
  onConfigSuccess: () => void;
}) {
  const [configOpen, setConfigOpen] = useState(false);

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
              onClick={() => setConfigOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 text-xs transition-all"
            >
              <Settings2 className="h-3 w-3" /> Configurar
            </button>
          )}
        </div>
      </div>

      {/* Coordinator Config Dialog */}
      {coordinator && (
        <AgentConfigDialog
          agentId={coordinator.id}
          agentName={coordinator.name ?? "HiveLearn Coordinator"}
          agentDescription={coordinator.description ?? "Coordina el enjambre educativo completo"}
          agentData={{
            id: coordinator.id,
            name: coordinator.name ?? "HiveLearn Coordinator",
            description: coordinator.description ?? "Coordina el enjambre educativo completo",
            provider_id: coordinator.providerId,
            model_id: coordinator.modelId,
            system_prompt: coordinator.systemPrompt ?? "",
            workspace: coordinator.workspace ?? "",
            tone: coordinator.tone ?? "",
            role: coordinator.role,
            enabled: coordinator.enabled,
            max_iterations: 10,
          }}
          open={configOpen}
          onOpenChange={setConfigOpen}
          onSuccess={onConfigSuccess}
        />
      )}
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

  const [coordinatorConfigOpen, setCoordinatorConfigOpen] = useState(false);

  const handleConfigSuccess = () => {
    fetchAgents();
    setCoordinatorConfigOpen(false);
  };

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
        onConfigSuccess={handleConfigSuccess}
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
              onConfigSuccess={handleConfigSuccess}
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
            onClick={() => setCoordinatorConfigOpen(true)}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-sm transition-all flex items-center gap-2"
          >
            <Settings2 className="h-4 w-4" />
            Configurar coordinador
          </button>
        </div>
      )}

      {/* Coordinator Config Dialog (empty state) */}
      {coordinator && (
        <AgentConfigDialog
          agentId={coordinator.id}
          agentName={coordinator.name ?? "HiveLearn Coordinator"}
          agentDescription={coordinator.description ?? "Coordina el enjambre educativo completo"}
          agentData={{
            id: coordinator.id,
            name: coordinator.name ?? "HiveLearn Coordinator",
            description: coordinator.description ?? "Coordina el enjambre educativo completo",
            provider_id: coordinator.providerId,
            model_id: coordinator.modelId,
            system_prompt: coordinator.systemPrompt ?? "",
            workspace: coordinator.workspace ?? "",
            tone: coordinator.tone ?? "",
            role: coordinator.role,
            enabled: coordinator.enabled,
            max_iterations: 10,
          }}
          open={coordinatorConfigOpen}
          onOpenChange={setCoordinatorConfigOpen}
          onSuccess={handleConfigSuccess}
        />
      )}
    </div>
  );
}
