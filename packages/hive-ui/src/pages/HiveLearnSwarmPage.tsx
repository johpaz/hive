import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw, Settings2, Crown, Network, Zap, Database, GitBranch, Edit2,
  Wifi, WifiOff, Shield, Bot, Terminal, CheckCircle2, XCircle, Circle,
  Loader2, MinusCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useHiveLearnLive, type AgentLiveStatus } from "@/hooks/useHiveLearnLive";

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Static metadata per agent ────────────────────────────────────────────────
const AGENT_META: Record<string, { emoji: string; label: string; accion: string; phase: 0 | 1 | 2 }> = {
  "hl-profile-agent":      { emoji: "👤", label: "Perfil",       accion: "Analiza edad, nivel y estilo de aprendizaje",  phase: 0 },
  "hl-intent-agent":       { emoji: "🎯", label: "Intención",    accion: "Extrae el tema y define los objetivos",          phase: 0 },
  "hl-structure-agent":    { emoji: "🗺️", label: "Estructura",   accion: "Diseña el mapa de nodos del currículo",          phase: 0 },
  "hl-explanation-agent":  { emoji: "📖", label: "Explicación",  accion: "Genera teoría clara y ejemplos",                 phase: 1 },
  "hl-exercise-agent":     { emoji: "✏️", label: "Ejercicios",   accion: "Crea práctica activa paso a paso",               phase: 1 },
  "hl-quiz-agent":         { emoji: "❓", label: "Quiz",         accion: "Prepara preguntas de verificación",              phase: 1 },
  "hl-challenge-agent":    { emoji: "⚡", label: "Reto",         accion: "Diseña desafíos integradores",                   phase: 1 },
  "hl-code-agent":         { emoji: "💻", label: "Código",       accion: "Genera ejemplos ejecutables",                    phase: 1 },
  "hl-svg-agent":          { emoji: "📊", label: "Diagrama",     accion: "Dibuja visualizaciones SVG",                     phase: 1 },
  "hl-gif-agent":          { emoji: "🎞️", label: "Animación",    accion: "Crea guías animadas paso a paso",                phase: 1 },
  "hl-image-agent":        { emoji: "🖼️", label: "Imagen",       accion: "Genera imágenes educativas con IA",              phase: 1 },
  "hl-infographic-agent":  { emoji: "📈", label: "Infografía",   accion: "Construye resumen visual del tema",              phase: 2 },
  "hl-gamification-agent": { emoji: "🏆", label: "Gamificación", accion: "Asigna XP, logros y rachas",                    phase: 2 },
  "hl-evaluation-agent":   { emoji: "📝", label: "Evaluación",   accion: "Prepara examen final adaptativo",                phase: 2 },
  "hl-coordinator-agent":  { emoji: "🔍", label: "Coordinador",  accion: "Revisa coherencia pedagógica",                   phase: 2 },
  "hl-feedback-agent":     { emoji: "🧠", label: "Feedback",     accion: "Evalúa comprensión semántica del alumno",        phase: 2 },
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

const PHASE_CONFIG = [
  { label: "Análisis",    pill: "bg-blue-500/10 border-blue-500/30 text-blue-400",  cardBorderActive: "border-purple-500/40", accent: "via-purple-500/60", note: "Secuencial · cada uno espera al anterior" },
  { label: "Contenido",   pill: "bg-blue-500/10 border-blue-500/30 text-blue-400",    cardBorderActive: "border-blue-500/60",  accent: "via-blue-500/60",  note: "Paralelo · 8 agentes simultáneos" },
  { label: "Finalización",pill: "bg-green-500/10 border-green-500/30 text-green-400", cardBorderActive: "border-green-500/60", accent: "via-green-500/60", note: "Paralelo · revisión y cierre" },
] as const;

// ─── Live Badge ───────────────────────────────────────────────────────────────
function LiveBadge({ isConnected }: { isConnected: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all
      ${isConnected
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        : "bg-white/5 border-white/10 text-white/30"}`}>
      {isConnected
        ? <><Wifi className="h-3 w-3 animate-pulse" /> Live</>
        : <><WifiOff className="h-3 w-3" /> Offline</>}
    </div>
  );
}

// ─── Agent Card (Canvas style) ───────────────────────────────────────────────
function AgentGraphNode({
  agentId, dbAgent, liveStatus, isCurrentlyRunning, phase,
  agentState,
}: {
  agentId: string;
  dbAgent?: HLAgent;
  liveStatus: AgentLiveStatus;
  isCurrentlyRunning: boolean;
  phase: 0 | 1 | 2;
  agentState: AgentState;
}) {
  const navigate = useNavigate();
  const meta = AGENT_META[agentId];
  if (!meta) return null;

  const status = agentState.status;
  const currentTool = agentState.currentTool;
  const isThinking = status === "thinking";
  const isToolCall = status === "tool_call";
  const isActive = isThinking || isToolCall || status === "running";
  const isCoordinator = agentId === "hl-coordinator-agent";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  const isDisabled = dbAgent && !dbAgent.enabled;

  const cfg = PHASE_CONFIG[phase];

  return (
    <div className={`relative group w-64 rounded-xl p-5 flex flex-col gap-3 transition-all duration-300
      bg-[rgba(255,255,255,0.03)] backdrop-blur-xl border
      ${isThinking
        ? "border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.25)]"
        : isCoordinator
        ? "border-purple-500/20 shadow-[0_0_16px_rgba(168,85,247,0.1)] hover:border-purple-500/40"
        : isCompleted
        ? "border-green-500/30"
        : isFailed
        ? "border-red-500/30"
        : "border-white/[0.08] hover:border-blue-500/30 hover:shadow-[0_0_15px_rgba(59,130,246,0.12)]"}
      ${isDisabled ? "opacity-50 grayscale" : ""}
    `}>
      {/* Top accent line when active */}
      {isActive && (
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${cfg.accent} to-transparent animate-pulse`} />
      )}

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
            : isCompleted
            ? "bg-green-500/10 text-green-400 border-green-500/20"
            : "bg-blue-500/10 text-blue-400 border-blue-500/20"}`}>
          {isCoordinator ? "Coordinador" : meta.label}
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

// ─── Insight Card ─────────────────────────────────────────────────────────────
function InsightCard({ icon: Icon, title, description, colorClass }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  colorClass: string;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-3 transition-all duration-200 hover:scale-[1.01] ${colorClass}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-white/40" />
        <p className="font-bold text-white/90 text-sm">{title}</p>
      </div>
      <p className="text-xs text-white/40 leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function HiveLearnSwarmPage() {
  const navigate = useNavigate();
  const [dbAgents, setDbAgents] = useState<HLAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});

  // Live WS connection for real-time agent status
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

  // Derive agent states from live statuses
  useEffect(() => {
    const newStates: Record<string, AgentState> = {};
    for (const agentId of Object.keys(AGENT_META)) {
      const liveStatus = agentStatuses[agentId];
      const isCurrent = currentAgentId === agentId;
      let status: AgentState["status"] = "idle";
      let currentTool: string | null = null;

      if (isCurrent) {
        // Simulate tool call or thinking based on phase
        const phaseIdx = Object.values(PHASE_ORDER).findIndex(ids => ids.includes(agentId));
        if (phaseIdx === 0) {
          status = Math.random() > 0.5 ? "thinking" : "tool_call";
          currentTool = status === "tool_call" ? "clasificar_intencion" : null;
        } else if (phaseIdx === 1) {
          status = "running";
        } else {
          status = liveStatus === "completed" ? "completed" : "idle";
        }
      } else if (liveStatus === "completed") {
        status = "completed";
      } else if (liveStatus === "failed") {
        status = "failed";
      } else {
        status = "idle";
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

  // Map DB agents by ID
  const agentMap = new Map(dbAgents.map(a => [a.id, a]));
  const coordinator = dbAgents.find(a => a.role === "coordinator");
  const isConfigured = !!coordinator?.providerId;

  const PHASE_ORDER = [
    ["hl-profile-agent", "hl-intent-agent", "hl-structure-agent"],
    ["hl-explanation-agent", "hl-exercise-agent", "hl-quiz-agent", "hl-challenge-agent", "hl-code-agent", "hl-svg-agent", "hl-gif-agent", "hl-image-agent"],
    ["hl-infographic-agent", "hl-gamification-agent", "hl-evaluation-agent", "hl-coordinator-agent", "hl-feedback-agent"],
  ] as const;

  const phaseIsActive = PHASE_ORDER.map(ids =>
    ids.some(id => {
      const st = agentStates[id]?.status;
      return st === "running" || st === "thinking" || st === "tool_call" || st === "completed";
    })
  );

  return (
    <div className="hive-page mt-8 animate-in fade-in duration-700">
      <div className="hive-page-container relative">

        {/* Ambient glows */}
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none opacity-50" />
        <div className="absolute top-40 -right-40 h-[400px] w-[400px] bg-indigo-600/8 rounded-full blur-[100px] pointer-events-none opacity-40" />

        {/* ── Header ── */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10 animate-in slide-in-from-left-8 duration-700">
          <div>
            <div className="flex items-center gap-3 mb-3 opacity-80">
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
              <span className="text-[10px] font-bold tracking-[0.2em] text-blue-400 uppercase">HIVELEARN · ENJAMBRE</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-3">
              Enjambre{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-600">
                Educativo
              </span>
            </h2>
            <p className="text-white/50 text-sm max-w-xl leading-relaxed font-light">
              {dbAgents.length || 16} agentes especializados colaboran en pipeline para generar lecciones adaptativas.
            </p>
          </div>

          <div className="flex items-center gap-3 animate-in slide-in-from-right-8 duration-700">
            <LiveBadge isConnected={isConnected} />
            {isGenerating && (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" /> Generando...
              </span>
            )}
            {!isConfigured && !isLoading && (
              <button
                onClick={() => navigate("/hivelearn/config")}
                className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 rounded-lg border border-blue-500/30 hover:border-blue-400/50 transition-all duration-300 flex items-center gap-2 font-medium text-sm"
              >
                <Settings2 className="h-4 w-4" />
                Configurar modelo
              </button>
            )}
            <button
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-all duration-300 flex items-center gap-2 font-medium text-sm backdrop-blur-sm group"
              onClick={fetchAgents}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 text-blue-400 transition-transform duration-500 group-hover:rotate-180 ${isLoading ? "animate-spin" : ""}`} />
              Refrescar
            </button>
          </div>
        </div>

        {error && (
          <div className="relative overflow-hidden rounded-2xl border border-red-500/20 bg-red-500/5 mb-8">
            <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
            <p className="px-6 py-5 text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="relative z-10 space-y-10">

          {/* ── Status Legend ── */}
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { color: "bg-green-400", label: "Ejecutando" },
              { color: "bg-purple-400", label: "Pensando" },
              { color: "bg-cyan-400", label: "Herramienta" },
              { color: "bg-emerald-400", label: "Disponible" },
              { color: "bg-red-400", label: "Error" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5 bg-white/[0.03] backdrop-blur-md px-3 py-1.5 rounded-full border border-white/[0.06]">
                <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                <span className="text-[10px] font-bold tracking-wider text-white/50 uppercase">{label}</span>
              </div>
            ))}
          </div>

          {/* ── Pipeline flow ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-5 px-1">
              Pipeline · {PHASE_ORDER.flat().length} agentes · 3 fases
            </p>

            <div className="flex gap-1 items-start overflow-x-auto pb-3">
              {PHASE_ORDER.map((phaseIds, phaseIdx) => {
                const cfg = PHASE_CONFIG[phaseIdx];
                const active = phaseIsActive[phaseIdx];
                return (
                  <div key={phaseIdx} className="flex items-start gap-1 flex-shrink-0">
                    <div className={`flex-shrink-0 space-y-2 transition-all duration-500 ${phaseIdx === 1 ? "w-[420px]" : "w-52"}`}>
                      {/* Phase header */}
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border transition-all ${cfg.pill} ${active ? "shadow-[0_0_12px_rgba(255,255,255,0.05)]" : ""}`}>
                          <span className={`w-1.5 h-1.5 rounded-full bg-current ${active ? "animate-pulse" : ""}`} />
                          Fase {phaseIdx} · {cfg.label}
                        </span>
                        {phaseIdx === 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-500/10 border border-blue-500/20 text-blue-400">
                            <Zap className="h-3 w-3" /> 8 en paralelo
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-white/20 uppercase tracking-widest mb-3">{cfg.note}</p>

                      {/* Agent cards */}
                      {phaseIdx === 1 ? (
                        <div className="grid grid-cols-2 gap-3">
                          {phaseIds.map(id => (
                            <AgentGraphNode
                              key={id}
                              agentId={id}
                              dbAgent={agentMap.get(id)}
                              liveStatus={agentStatuses[id] ?? "idle"}
                              isCurrentlyRunning={currentAgentId === id}
                              phase={1}
                              agentState={agentStates[id] ?? { status: "idle" }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {phaseIds.map(id => (
                            <AgentGraphNode
                              key={id}
                              agentId={id}
                              dbAgent={agentMap.get(id)}
                              liveStatus={agentStatuses[id] ?? "idle"}
                              isCurrentlyRunning={currentAgentId === id}
                              phase={phaseIdx as 0 | 2}
                              agentState={agentStates[id] ?? { status: "idle" }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Arrow between phases */}
                    {phaseIdx < 2 && (
                      <div className="flex flex-col items-center justify-center gap-0.5 px-1 self-center flex-shrink-0">
                        <div className={`h-px w-6 border-t-2 border-dashed transition-colors ${active ? "border-blue-500/60" : "border-white/10"}`} />
                        <span className={`text-xs font-bold transition-colors ${active ? "text-blue-400/60" : "text-white/15"}`}>→</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Timing note */}
            <div className="mt-4 flex items-center justify-center gap-3 text-[10px] text-white/20 font-mono">
              <span>⏱ Primera lección: ~2 min</span>
              <span className="text-white/8">·</span>
              <span>🐝 Con caché: ~10 seg</span>
              {isGenerating && (
                <>
                  <span className="text-white/8">·</span>
                  <span className="text-purple-400/60 animate-pulse">🔄 Generando ahora...</span>
                </>
              )}
            </div>
          </div>

          {/* ── Coordinator card ── */}
          {!isLoading && (
            <div>
              <p className="px-1 pb-3 text-[10px] font-bold uppercase tracking-widest text-purple-400/50">
                Coordinador del enjambre
              </p>
              <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent backdrop-blur-sm p-6">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-400 to-purple-600" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/60 to-transparent" />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-purple-500/15 border border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.15)] flex-shrink-0">
                      <Crown className="h-6 w-6 text-purple-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-bold text-white text-lg">
                          {coordinator?.name ?? "hl-coordinator-agent"}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-400 border border-purple-500/30">
                          Coordinador
                        </span>
                        {coordinator && (
                          <StatusPill status={agentStates["hl-coordinator-agent"]?.status ?? "idle"} />
                        )}
                      </div>
                      <p className="text-white/50 text-sm leading-relaxed">
                        {coordinator?.description ?? "Coordina el enjambre educativo completo y revisa la coherencia pedagógica del programa generado."}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-white/20 text-xs">
                        <Network className="h-3.5 w-3.5 text-purple-400/40" />
                        <span>Delega tareas a {PHASE_ORDER.flat().length - 1} agentes workers · revisión final antes de entregar</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
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
                <div className="absolute bottom-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
              </div>
            </div>
          )}

          {/* ── Insight cards ── */}
          <div>
            <p className="px-1 pb-4 text-[10px] font-bold uppercase tracking-widest text-white/25">
              ¿Cómo funciona el enjambre?
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <InsightCard icon={GitBranch} title="DAG Scheduler"
                description="Orquesta los 16 agentes en orden óptimo con un grafo de dependencias. Ningún agente comienza hasta que sus dependencias estén listas."
                colorClass="bg-blue-500/5 border-blue-500/20 hover:border-blue-500/40" />
              <InsightCard icon={Zap} title="Paralelismo Inteligente"
                description="8 agentes de contenido trabajan simultáneamente. El tiempo total = el más lento. Hasta 8× más rápido que secuencial."
                colorClass="bg-cyan-500/5 border-cyan-500/20 hover:border-cyan-500/40" />
              <InsightCard icon={Database} title="Caché de Nodos"
                description="Los nodos ya generados se reutilizan. Segunda lección del mismo tema: disponible en ~10 segundos sin re-ejecutar agentes."
                colorClass="bg-purple-500/5 border-purple-500/20 hover:border-purple-500/40" />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
