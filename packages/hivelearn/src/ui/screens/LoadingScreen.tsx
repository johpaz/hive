import { useMemo } from 'react'
import { useLessonStore } from '../store/lessonStore'

// ─── 16 agentes del enjambre ─────────────────────────────────────────────────
const AGENTS = [
  { id: 'hl-profile-agent',       label: 'Perfil',       icon: '👤' },
  { id: 'hl-intent-agent',        label: 'Intención',    icon: '🎯' },
  { id: 'hl-structure-agent',     label: 'Estructura',   icon: '🗺️' },
  { id: 'hl-explanation-agent',   label: 'Explicación',  icon: '📖' },
  { id: 'hl-exercise-agent',      label: 'Ejercicios',   icon: '✏️' },
  { id: 'hl-quiz-agent',          label: 'Quiz',         icon: '❓' },
  { id: 'hl-challenge-agent',     label: 'Reto',         icon: '⚡' },
  { id: 'hl-code-agent',          label: 'Código',       icon: '💻' },
  { id: 'hl-svg-agent',           label: 'Diagrama',     icon: '📊' },
  { id: 'hl-gif-agent',           label: 'Animación',    icon: '🎞️' },
  { id: 'hl-infographic-agent',   label: 'Infografía',   icon: '📈' },
  { id: 'hl-image-agent',         label: 'Imagen',       icon: '🖼️' },
  { id: 'hl-gamification-agent',  label: 'Gamificación', icon: '🏆' },
  { id: 'hl-evaluation-agent',    label: 'Evaluación',   icon: '📝' },
  { id: 'hl-feedback-agent',      label: 'Feedback',     icon: '🧠' },
  { id: 'hl-coordinator-agent',   label: 'Coordinador',  icon: '🎯' },
]

type AgentStatus = 'idle' | 'pending' | 'running' | 'thinking' | 'tool_call' | 'completed' | 'failed'

// ─── Coordinator Visual ──────────────────────────────────────────────────────
function CoordinatorCenter({ progress, status }: { progress: number; status: string }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (progress / 100) * circumference

  const statusColor = status === 'thinking' ? '#a855f7' : status === 'delegating' ? '#06b6d4' : status === 'completed' ? '#22c55e' : '#3b82f6'

  return (
    <div className="relative flex items-center justify-center">
      {/* Progress ring */}
      <svg className="absolute w-[120px] h-[120px] -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
        <circle
          cx="60" cy="60" r={radius} fill="none"
          stroke={statusColor} strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>

      {/* Coordinator circle */}
      <div className="w-[100px] h-[100px] rounded-full bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-white/10 flex items-center justify-center backdrop-blur-sm">
        <div className="text-3xl select-none">🎯</div>
      </div>

      {/* Status label */}
      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">{status}</span>
      </div>
    </div>
  )
}

// ─── Worker Orbital Node ─────────────────────────────────────────────────────
function WorkerNode({
  agent, status, angle, radius,
}: {
  agent: { id: string; label: string; icon: string }
  status: AgentStatus
  angle: number
  radius: number
}) {
  const x = Math.cos(angle) * radius
  const y = Math.sin(angle) * radius

  const isActive = status === 'running' || status === 'thinking' || status === 'tool_call'
  const isDone = status === 'completed'
  const isFailed = status === 'failed'

  const statusColor = isActive ? (status === 'thinking' ? '#a855f7' : status === 'tool_call' ? '#06b6d4' : '#3b82f6') : isDone ? '#22c55e' : isFailed ? '#ef4444' : 'rgba(255,255,255,0.2)'
  const opacity = isActive || isDone || isFailed ? 1 : 0.35

  return (
    <div
      className="absolute transition-all duration-700"
      style={{
        transform: `translate(${x}px, ${y}px)`,
        opacity,
      }}
    >
      {/* Connection line to center (only for active) */}
      {isActive && (
        <div
          className="absolute top-1/2 left-1/2 origin-left"
          style={{
            width: `${radius - 25}px`,
            height: '1px',
            background: `linear-gradient(90deg, ${statusColor}40, transparent)`,
            transform: `translate(-50%, -50%) rotate(${(angle * 180) / Math.PI + 180}deg)`,
          }}
        />
      )}

      {/* Worker circle */}
      <div className={`relative w-[48px] h-[48px] rounded-full flex items-center justify-center transition-all duration-300 ${
        isActive ? 'bg-white/10 border border-white/20 shadow-lg' : 'bg-white/5 border border-white/5'
      }`}>
        {/* Status glow */}
        {isActive && (
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              background: `radial-gradient(circle, ${statusColor}20, transparent)`,
              boxShadow: `0 0 12px ${statusColor}30`,
            }}
          />
        )}

        {/* Icon */}
        <span className={`text-lg relative z-10 ${isActive ? 'animate-pulse' : ''} ${isDone || isFailed ? 'grayscale' : ''}`}>
          {isDone ? '✅' : isFailed ? '❌' : agent.icon}
        </span>

        {/* Status dot */}
        <div
          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border border-[#0b1326]"
          style={{ background: statusColor }}
        />
      </div>

      {/* Label */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap">
        <span className="text-[8px] font-medium text-white/40 truncate block max-w-[60px]">{agent.label}</span>
      </div>
    </div>
  )
}

// ─── Activity Log ────────────────────────────────────────────────────────────
function ActivityLog({ agentStatuses, progress, mensaje }: {
  agentStatuses: Record<string, string>
  progress: number
  mensaje: string
}) {
  const stage = progress < 20 ? 'Análisis' : progress < 60 ? 'Contenido' : progress < 90 ? 'Finalización' : 'Revisión'

  const logLines = useMemo(() => {
    const lines: { time: string; icon: string; text: string }[] = []
    const t0 = Date.now() - 60000
    let timeOffset = 0

    const addLine = (icon: string, text: string, offsetMs: number) => {
      const t = new Date(t0 + timeOffset + offsetMs)
      lines.push({
        time: `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`,
        icon,
        text,
      })
    }

    addLine('🎯', 'Coordinador: Analizando perfil del alumno...', 0)
    if (agentStatuses['hl-profile-agent'] === 'completed' || agentStatuses['hl-profile-agent'] === 'running') {
      addLine('👤', 'ProfileAgent: Iniciado', 2000)
    }
    if (agentStatuses['hl-profile-agent'] === 'completed') {
      addLine('👤', 'ProfileAgent: Completado ✓', 5000)
      addLine('🎯', 'Coordinador: Entendiendo intención...', 6000)
    }
    if (agentStatuses['hl-intent-agent'] === 'running' || agentStatuses['hl-intent-agent'] === 'completed') {
      addLine('🎯', 'IntentAgent: Iniciado', 8000)
    }
    if (agentStatuses['hl-intent-agent'] === 'completed') {
      addLine('🎯', 'IntentAgent: Completado ✓', 11000)
      addLine('🎯', 'Coordinador: Diseñando estructura...', 12000)
    }

    // Show current active agents
    const activeAgents = Object.entries(agentStatuses)
      .filter(([, s]) => s === 'running' || s === 'thinking')
      .slice(0, 3)

    for (const [agentId, status] of activeAgents) {
      const agent = AGENTS.find(a => a.id === agentId)
      if (agent && status === 'thinking') {
        addLine(agent.icon, `${agent.label}: Pensando...`, timeOffset + 15000)
      }
    }

    return lines.slice(-8)
  }, [agentStatuses])

  const activeCount = Object.values(agentStatuses).filter(s => s === 'running' || s === 'thinking' || s === 'tool_call').length

  return (
    <div className="w-full max-w-sm bg-[#131b2e]/80 backdrop-blur-xl rounded-2xl border border-white/[0.06] p-5 space-y-4">
      {/* Title */}
      <h3 className="text-xs font-bold text-white/60 uppercase tracking-[0.15em]">Actividad del Enjambre</h3>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/40 font-medium">{stage}</span>
          <span className="text-[11px] font-bold text-blue-400 tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-700"
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>
      </div>

      {/* Terminal log */}
      <div className="bg-[#060e20]/80 rounded-xl p-3 space-y-1.5 max-h-[200px] overflow-y-auto font-mono text-[10px]">
        {logLines.map((line, i) => (
          <div key={i} className="flex items-start gap-2 text-white/40">
            <span className="text-white/20 flex-shrink-0 tabular-nums">{line.time}</span>
            <span className="flex-shrink-0">{line.icon}</span>
            <span className="leading-relaxed">{line.text}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-[10px] text-white/25 pt-2 border-t border-white/[0.04]">
        <span>{activeCount} de {AGENTS.length - 1} agentes activos</span>
        <span>Estimado: ~2 min</span>
      </div>
    </div>
  )
}

// ─── LoadingScreen principal ─────────────────────────────────────────────────
export function LoadingScreen() {
  const { swarmProgress, meta, perfil, agentStatuses } = useLessonStore()
  const porcentaje = swarmProgress?.porcentaje ?? 0
  const mensaje = swarmProgress?.mensaje ?? 'Iniciando el enjambre de agentes...'

  const coordinatorStatus = porcentaje < 10 ? 'analyzing' : porcentaje < 80 ? 'delegating' : porcentaje < 95 ? 'assembling' : 'completed'

  // Calculate orbital positions for 15 workers
  const workerAgents = AGENTS.filter(a => a.id !== 'hl-coordinator-agent')
  const orbitRadius = 160
  const workerNodes = workerAgents.map((agent, i) => {
    const angle = (i / workerAgents.length) * 2 * Math.PI - Math.PI / 2
    const status = (agentStatuses[agent.id] as AgentStatus) ?? 'idle'
    return { agent, status, angle, radius: orbitRadius }
  })

  return (
    <div className="absolute inset-0 bg-[#0b1326] overflow-hidden flex">
      {/* Nebula background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0e27] via-[#15102e] to-[#0d1128]" />
        {/* Large nebula orbs */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-600/20 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '5s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/15 rounded-full blur-[80px] animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-500/10 rounded-full blur-[60px] animate-pulse" style={{ animationDuration: '4s' }} />
        {/* Star particles */}
        <div className="absolute inset-0">
          {[...Array(40)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full animate-pulse"
              style={{
                width: `${1 + Math.random() * 2}px`,
                height: `${1 + Math.random() * 2}px`,
                background: `rgba(255, 255, 255, ${0.1 + Math.random() * 0.2})`,
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 5}s`,
                animationDuration: `${2 + Math.random() * 4}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3 bg-[#0b1326]/60 backdrop-blur-sm border-b border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🐝</span>
          <span className="text-sm font-semibold text-white/70">HiveLearn</span>
          <span className="text-xs text-white/30">—</span>
          <span className="text-xs text-blue-400/60 font-medium">{mensaje}</span>
        </div>
        <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">Enjambre activo</span>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex w-full h-full pt-12">
        {/* Left: Roundtable */}
        <div className="flex-1 flex items-center justify-center relative">
          {/* Meta info */}
          {meta && (
            <div className="absolute top-4 left-6 z-10">
              <p className="text-[11px] text-white/30 font-medium truncate max-w-xs">"{meta}"</p>
              {perfil && (
                <p className="text-[10px] text-white/20 mt-0.5">{perfil.nombre} · {perfil.tiempoSesion} min</p>
              )}
            </div>
          )}

          {/* Roundtable container */}
          <div className="relative w-[500px] h-[500px] flex items-center justify-center">
            {/* Coordinator */}
            <CoordinatorCenter progress={porcentaje} status={coordinatorStatus} />

            {/* Workers */}
            {workerNodes.map((node) => (
              <WorkerNode
                key={node.agent.id}
                agent={node.agent}
                status={node.status}
                angle={node.angle}
                radius={node.radius}
              />
            ))}
          </div>
        </div>

        {/* Right: Activity Panel */}
        <div className="w-[320px] flex items-center justify-center p-6">
          <ActivityLog
            agentStatuses={agentStatuses}
            progress={porcentaje}
            mensaje={mensaje}
          />
        </div>
      </div>
    </div>
  )
}
