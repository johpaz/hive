import { useEffect, useState } from "react";
import { RefreshCw, Settings2, Crown, Network, Zap, Database, GitBranch, Edit2, Wifi, WifiOff } from "lucide-react";
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

// ─── Static metadata per agent (always shown even if not from DB) ──────────
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

const PHASE_ORDER = [
  ["hl-profile-agent", "hl-intent-agent", "hl-structure-agent"],
  ["hl-explanation-agent", "hl-exercise-agent", "hl-quiz-agent", "hl-challenge-agent", "hl-code-agent", "hl-svg-agent", "hl-gif-agent", "hl-image-agent"],
  ["hl-infographic-agent", "hl-gamification-agent", "hl-evaluation-agent", "hl-coordinator-agent", "hl-feedback-agent"],
] as const;

const PHASE_CONFIG = [
  { label: "Análisis",    pill: "bg-amber-500/10 border-amber-500/30 text-amber-400",  cardBg: "bg-amber-500/[0.06]",  cardBorder: "border-amber-500/20",  cardBorderActive: "border-amber-500/60 shadow-[0_0_20px_rgba(245,158,11,0.2)]", accent: "via-amber-500/60", note: "Secuencial · cada uno espera al anterior" },
  { label: "Contenido",   pill: "bg-blue-500/10 border-blue-500/30 text-blue-400",    cardBg: "bg-blue-500/[0.06]",   cardBorder: "border-blue-500/20",   cardBorderActive: "border-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.2)]",  accent: "via-blue-500/60",  note: "Paralelo · 8 agentes simultáneos" },
  { label: "Finalización",pill: "bg-green-500/10 border-green-500/30 text-green-400", cardBg: "bg-green-500/[0.06]",  cardBorder: "border-green-500/20",  cardBorderActive: "border-green-500/60 shadow-[0_0_20px_rgba(34,197,94,0.2)]",  accent: "via-green-500/60", note: "Paralelo · revisión y cierre" },
] as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function AgentCard({
  agentId, dbAgent, liveStatus, isCurrentlyRunning, compact = false,
  phase,
}: {
  agentId: string;
  dbAgent?: HLAgent;
  liveStatus: AgentLiveStatus;
  isCurrentlyRunning: boolean;
  compact?: boolean;
  phase: 0 | 1 | 2;
}) {
  const navigate = useNavigate();
  const meta = AGENT_META[agentId];
  if (!meta) return null;

  const cfg = PHASE_CONFIG[phase];
  const isRunning   = liveStatus === "running" || isCurrentlyRunning;
  const isCompleted = liveStatus === "completed";
  const isFailed    = liveStatus === "failed";
  const isDisabled  = dbAgent && !dbAgent.enabled;

  const borderCls = isRunning   ? cfg.cardBorderActive
                  : isCompleted ? (phase === 0 ? "border-amber-500/40" : phase === 1 ? "border-blue-500/40" : "border-green-500/40")
                  : isFailed    ? "border-red-500/30"
                  : `${cfg.cardBorder} hover:border-white/20`;

  const bgCls = isRunning ? cfg.cardBg : isCompleted ? "bg-white/[0.03]" : isFailed ? "bg-red-500/[0.04]" : "bg-white/[0.02] hover:bg-white/[0.03]";

  return (
    <div className={`
      relative overflow-hidden rounded-xl border transition-all duration-300 group cursor-default
      ${compact ? "p-3" : "p-4"}
      ${bgCls} ${borderCls}
      ${isDisabled ? "opacity-50 grayscale" : ""}
    `}>
      {/* Top accent line when active */}
      {isRunning && (
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${cfg.accent} to-transparent animate-pulse`} />
      )}
      {isCompleted && (
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${cfg.accent} to-transparent opacity-40`} />
      )}

      <div className={`flex ${compact ? "items-center gap-2" : "flex-col gap-2.5"}`}>
        {/* Emoji */}
        <span className={`${compact ? "text-xl" : "text-2xl"} leading-none flex-shrink-0 ${isRunning ? "animate-bounce" : ""}`}>
          {meta.emoji}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`font-bold text-white leading-tight ${compact ? "text-xs" : "text-sm"}`}>
              {meta.label}
            </p>
            {!compact && dbAgent?.enabled === false && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 border border-white/10">Inactivo</span>
            )}
          </div>
          {!compact && (
            <p className={`text-[11px] leading-tight mt-0.5 transition-colors ${isRunning ? "text-white/70" : "text-white/35"}`}>
              {isRunning ? `▶ ${meta.accion}...` : meta.accion}
            </p>
          )}
        </div>

        {/* Status + actions */}
        <div className={`flex items-center ${compact ? "gap-1" : "justify-between gap-2 mt-1"}`}>
          <StatusPill liveStatus={liveStatus} isCurrentlyRunning={isCurrentlyRunning} />
          {!compact && dbAgent && (
            <button
              onClick={() => navigate(`/agents/${dbAgent.id}`)}
              className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white hover:bg-white/10"
              title="Configurar agente"
            >
              <Edit2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Running pulse border */}
      {isRunning && (
        <div className="absolute inset-0 rounded-xl pointer-events-none animate-pulse opacity-30 ring-1 ring-inset ring-current" />
      )}
    </div>
  );
}

function StatusPill({ liveStatus, isCurrentlyRunning }: { liveStatus: AgentLiveStatus; isCurrentlyRunning: boolean }) {
  const isRunning = liveStatus === "running" || isCurrentlyRunning;
  if (isRunning) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Activo ▶
    </span>
  );
  if (liveStatus === "completed") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-500/15 text-green-400 border border-green-500/20">
      ✓ Listo
    </span>
  );
  if (liveStatus === "failed") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 text-red-400 border border-red-500/20">
      ✗ Error
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-white/5 text-white/30 border border-white/10">
      <span className="w-1.5 h-1.5 rounded-full bg-white/20" /> En espera
    </span>
  );
}

function PhaseArrow({ isActive }: { isActive: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 px-1 self-center flex-shrink-0">
      <div className={`h-px w-6 border-t-2 border-dashed transition-colors ${isActive ? "border-amber-500/60" : "border-white/10"}`} />
      <span className={`text-xs font-bold transition-colors ${isActive ? "text-amber-400/60" : "text-white/15"}`}>→</span>
    </div>
  );
}

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

  // Map DB agents by ID for quick lookup
  const agentMap = new Map(dbAgents.map(a => [a.id, a]));
  const coordinator = dbAgents.find(a => a.role === "coordinator");
  const isConfigured = !!coordinator?.providerId;

  // Phase activity detection: phase is active if any of its agents are running/completed
  const phaseIsActive = PHASE_ORDER.map(ids =>
    ids.some(id => agentStatuses[id] === "running" || agentStatuses[id] === "completed")
  );

  return (
    <div className="hive-page mt-8 animate-in fade-in duration-700">
      <div className="hive-page-container relative">

        {/* Ambient glows */}
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] bg-amber-600/10 rounded-full blur-[120px] pointer-events-none opacity-50" />
        <div className="absolute top-40 -right-40 h-[400px] w-[400px] bg-orange-600/8 rounded-full blur-[100px] pointer-events-none opacity-40" />

        {/* ── Header ── */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10 animate-in slide-in-from-left-8 duration-700">
          <div>
            <div className="flex items-center gap-3 mb-3 opacity-80">
              <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.6)]" />
              <span className="text-[10px] font-bold tracking-[0.2em] text-amber-400 uppercase">HIVELEARN · ENJAMBRE</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-3">
              Enjambre{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
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
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Generando...
              </span>
            )}
            {!isConfigured && !isLoading && (
              <button
                onClick={() => navigate("/hivelearn/config")}
                className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 hover:text-amber-300 rounded-lg border border-amber-500/30 hover:border-amber-400/50 transition-all duration-300 flex items-center gap-2 font-medium text-sm"
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
              <RefreshCw className={`h-4 w-4 text-amber-400 transition-transform duration-500 group-hover:rotate-180 ${isLoading ? "animate-spin" : ""}`} />
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

          {/* ── Pipeline flow ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-5 px-1">
              Pipeline · {PHASE_ORDER.flat().length} agentes · 3 fases
            </p>

            {/* Horizontal scrollable pipeline */}
            <div className="flex gap-1 items-start overflow-x-auto pb-3">
              {PHASE_ORDER.map((phaseIds, phaseIdx) => {
                const cfg = PHASE_CONFIG[phaseIdx];
                const active = phaseIsActive[phaseIdx];
                return (
                  <div key={phaseIdx} className="flex items-start gap-1 flex-shrink-0">
                    {/* Phase column */}
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
                        // Phase 1: 2x4 grid
                        <div className="grid grid-cols-4 gap-2">
                          {phaseIds.map(id => (
                            <AgentCard
                              key={id}
                              agentId={id}
                              dbAgent={agentMap.get(id)}
                              liveStatus={agentStatuses[id] ?? "idle"}
                              isCurrentlyRunning={currentAgentId === id}
                              compact
                              phase={1}
                            />
                          ))}
                        </div>
                      ) : (
                        // Phase 0 & 2: vertical stack
                        <div className="space-y-2">
                          {phaseIds.map((id, i) => (
                            <div key={id}>
                              <AgentCard
                                agentId={id}
                                dbAgent={agentMap.get(id)}
                                liveStatus={agentStatuses[id] ?? "idle"}
                                isCurrentlyRunning={currentAgentId === id}
                                phase={phaseIdx as 0 | 2}
                              />
                              {phaseIdx === 0 && i < phaseIds.length - 1 && (
                                <div className="flex justify-center py-1">
                                  <div className={`w-px h-4 border-l-2 border-dashed transition-colors ${active ? "border-amber-500/30" : "border-white/8"}`} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Arrow between phases */}
                    {phaseIdx < 2 && (
                      <PhaseArrow isActive={phaseIsActive[phaseIdx] || phaseIsActive[phaseIdx + 1]} />
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
                  <span className="text-amber-400/60 animate-pulse">🔄 Generando ahora...</span>
                </>
              )}
            </div>
          </div>

          {/* ── Coordinator card ── */}
          {!isLoading && (
            <div>
              <p className="px-1 pb-3 text-[10px] font-bold uppercase tracking-widest text-amber-400/50">
                Coordinador del enjambre
              </p>
              <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent backdrop-blur-sm p-6">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-amber-400 to-orange-500" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.15)] flex-shrink-0">
                      <Crown className="h-6 w-6 text-amber-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-bold text-white text-lg">
                          {coordinator?.name ?? "hl-coordinator-agent"}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Coordinador
                        </span>
                        {coordinator && (
                          <StatusPill
                            liveStatus={agentStatuses["hl-coordinator-agent"] ?? "idle"}
                            isCurrentlyRunning={currentAgentId === "hl-coordinator-agent"}
                          />
                        )}
                      </div>
                      <p className="text-white/50 text-sm leading-relaxed">
                        {coordinator?.description ?? "Coordina el enjambre educativo completo y revisa la coherencia pedagógica del programa generado."}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-white/20 text-xs">
                        <Network className="h-3.5 w-3.5 text-amber-400/40" />
                        <span>Delega tareas a {PHASE_ORDER.flat().length - 1} agentes workers · revisión final antes de entregar</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {coordinator?.providerId && (
                      <div className="text-[10px] text-white/30 text-right">
                        <div className="font-mono">{coordinator.providerId}</div>
                        <div className="font-mono text-amber-400/60">{coordinator.modelId}</div>
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
                <div className="absolute bottom-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
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
                colorClass="bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40" />
              <InsightCard icon={Zap} title="Paralelismo Inteligente"
                description="8 agentes de contenido trabajan simultáneamente. El tiempo total = el más lento. Hasta 8× más rápido que secuencial."
                colorClass="bg-blue-500/5 border-blue-500/20 hover:border-blue-500/40" />
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
