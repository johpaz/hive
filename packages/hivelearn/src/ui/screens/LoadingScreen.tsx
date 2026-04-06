import { useState, useMemo } from 'react'
import { useLessonStore } from '../store/lessonStore'

// ─── Tipos ───────────────────────────────────────────────────────────────────
type AgentStatus = 'idle' | 'pending' | 'running' | 'thinking' | 'tool_call' | 'completed' | 'failed'

// ─── Constantes de agentes ───────────────────────────────────────────────────
const AGENTS = [
  { id: 'hl-profile-agent',      label: 'Perfil',       icon: '👤' },
  { id: 'hl-intent-agent',       label: 'Intención',    icon: '🎯' },
  { id: 'hl-structure-agent',    label: 'Estructura',   icon: '🗺️' },
  { id: 'hl-explanation-agent',  label: 'Explicación',  icon: '📖' },
  { id: 'hl-exercise-agent',     label: 'Ejercicios',   icon: '✏️' },
  { id: 'hl-quiz-agent',         label: 'Quiz',         icon: '❓' },
  { id: 'hl-challenge-agent',    label: 'Reto',         icon: '⚡' },
  { id: 'hl-code-agent',         label: 'Código',       icon: '💻' },
  { id: 'hl-svg-agent',          label: 'Diagrama',     icon: '📊' },
  { id: 'hl-gif-agent',          label: 'Animación',    icon: '🎞️' },
  { id: 'hl-infographic-agent',  label: 'Infografía',   icon: '📈' },
  { id: 'hl-image-agent',        label: 'Imagen',       icon: '🖼️' },
  { id: 'hl-gamification-agent', label: 'Gamificación', icon: '🏆' },
  { id: 'hl-evaluation-agent',   label: 'Evaluación',   icon: '📝' },
  { id: 'hl-feedback-agent',     label: 'Feedback',     icon: '🧠' },
]

// ─── Descripciones y acciones por agente ────────────────────────────────────
const AGENT_INFO: Record<string, { rol: string; acciones: Partial<Record<AgentStatus, string>> }> = {
  'hl-profile-agent':      { rol: 'Analiza el historial y preferencias del alumno para personalizar la lección.', acciones: { running: 'Leyendo historial y preferencias...', thinking: 'Adaptando nivel de dificultad al alumno...' } },
  'hl-intent-agent':       { rol: 'Detecta el objetivo real de aprendizaje detrás de la solicitud.', acciones: { running: 'Interpretando el objetivo del alumno...', thinking: 'Clasificando tema y nivel de complejidad...' } },
  'hl-structure-agent':    { rol: 'Diseña la secuencia de nodos de la lección.', acciones: { running: 'Definiendo secuencia de nodos pedagógicos...', thinking: 'Calculando progresión de dificultad...' } },
  'hl-explanation-agent':  { rol: 'Genera las explicaciones principales del tema.', acciones: { running: 'Redactando explicación principal del concepto...', tool_call: 'Generando ejemplo concreto de aplicación...' } },
  'hl-exercise-agent':     { rol: 'Crea ejercicios prácticos para reforzar lo aprendido.', acciones: { running: 'Diseñando ejercicio con enunciado aplicado...', thinking: 'Ajustando dificultad según perfil...' } },
  'hl-quiz-agent':         { rol: 'Formula preguntas de comprensión con opciones múltiples.', acciones: { running: 'Formulando pregunta de opción múltiple...', thinking: 'Generando distractores coherentes...' } },
  'hl-challenge-agent':    { rol: 'Diseña un reto integrador al final del nodo.', acciones: { running: 'Construyendo escenario de reto real...', thinking: 'Definiendo criterios de éxito...' } },
  'hl-code-agent':         { rol: 'Produce snippets de código funcional y comentado.', acciones: { running: 'Escribiendo código de ejemplo funcional...', tool_call: 'Formateando y comentando bloque de código...' } },
  'hl-svg-agent':          { rol: 'Crea diagramas SVG para visualizar conceptos.', acciones: { running: 'Dibujando diagrama conceptual en SVG...', thinking: 'Calculando layout y proporciones...' } },
  'hl-gif-agent':          { rol: 'Genera animaciones frame a frame para ilustrar procesos.', acciones: { running: 'Creando frames de la animación educativa...', thinking: 'Definiendo transiciones y tiempos...' } },
  'hl-infographic-agent':  { rol: 'Produce infografías con datos y secciones clave.', acciones: { running: 'Organizando secciones de la infografía...', thinking: 'Seleccionando datos más relevantes...' } },
  'hl-image-agent':        { rol: 'Genera imágenes ilustrativas con IA generativa.', acciones: { running: 'Construyendo prompt de imagen detallado...', tool_call: 'Generando imagen con modelo de IA...' } },
  'hl-gamification-agent': { rol: 'Define recompensas, logros y XP del nodo.', acciones: { running: 'Calculando XP y diseñando badges...', thinking: 'Personalizando mensaje de celebración...' } },
  'hl-evaluation-agent':   { rol: 'Genera preguntas para la evaluación final de la lección.', acciones: { running: 'Formulando preguntas de evaluación sumativa...', thinking: 'Balanceando dificultad de preguntas...' } },
  'hl-feedback-agent':     { rol: 'Prepara respuestas de feedback adaptadas al estilo del alumno.', acciones: { running: 'Generando feedback personalizado...', thinking: 'Ajustando tono y nivel de detalle...' } },
}

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle:      'rgba(255,255,255,0.15)',
  pending:   '#64748b',
  running:   '#3b82f6',
  thinking:  '#a855f7',
  tool_call: '#06b6d4',
  completed: '#22c55e',
  failed:    '#ef4444',
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle:      'Esperando',
  pending:   'En cola',
  running:   'Trabajando',
  thinking:  'Pensando',
  tool_call: 'Usando tool',
  completed: 'Completado',
  failed:    'Error',
}

// ─── Coordinator Center ───────────────────────────────────────────────────────
function CoordinatorCenter({ progress, status, currentWorker }: {
  progress: number
  status: string
  currentWorker: string | null
}) {
  const r1 = 80  // progress ring radius
  const r2 = 70  // pulse ring radius
  const c1 = 2 * Math.PI * r1
  const offset = c1 - (progress / 100) * c1

  const glowColor = status === 'thinking' ? '#a855f7'
    : status === 'delegating' ? '#06b6d4'
    : status === 'assembling' ? '#f59e0b'
    : status === 'completed' ? '#22c55e'
    : '#3b82f6'

  const statusText = status === 'analyzing' ? 'Analizando perfil...'
    : status === 'delegating' ? `Delegando${currentWorker ? ` → ${currentWorker}` : '...'}`
    : status === 'assembling' ? 'Ensamblando lección...'
    : status === 'completed' ? 'Lección lista ✓'
    : 'Iniciando...'

  return (
    <div className="relative flex items-center justify-center">
      {/* SVG rings */}
      <svg className="absolute w-[190px] h-[190px] -rotate-90" viewBox="0 0 190 190">
        {/* Decorative outer ring */}
        <circle cx="95" cy="95" r={r1} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 6" />
        {/* Track */}
        <circle cx="95" cy="95" r={r1} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
        {/* Progress arc */}
        <circle
          cx="95" cy="95" r={r1}
          fill="none"
          stroke={glowColor}
          strokeWidth="4"
          strokeDasharray={c1}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
          style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
        />
        {/* Inner pulse ring */}
        <circle
          cx="95" cy="95" r={r2}
          fill="none"
          stroke={`${glowColor}20`}
          strokeWidth="1"
        />
      </svg>

      {/* Coordinator circle */}
      <div
        className="w-[140px] h-[140px] rounded-full flex flex-col items-center justify-center backdrop-blur-sm relative z-10 transition-all duration-500"
        style={{
          background: `radial-gradient(circle at 35% 35%, ${glowColor}30, rgba(15,20,50,0.9))`,
          border: `1.5px solid ${glowColor}40`,
          boxShadow: `0 0 40px ${glowColor}25, 0 0 80px ${glowColor}10, inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}
      >
        <span className="text-4xl select-none mb-1">🐝</span>
        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Coordinador</span>
      </div>

      {/* Status badge */}
      <div
        className="absolute -bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full text-[10px] font-semibold tracking-wide transition-all duration-500"
        style={{
          background: `${glowColor}18`,
          border: `1px solid ${glowColor}35`,
          color: glowColor,
        }}
      >
        {statusText}
      </div>

      {/* Progress % */}
      <div className="absolute -top-9 left-1/2 -translate-x-1/2">
        <span className="text-[11px] font-bold tabular-nums" style={{ color: glowColor }}>{progress}%</span>
      </div>
    </div>
  )
}

// ─── Delegation Beams (SVG overlay) ──────────────────────────────────────────
function DelegationBeams({ workerNodes }: {
  workerNodes: { agent: { id: string }; status: AgentStatus; x: number; y: number }[]
}) {
  const cx = 310
  const cy = 310

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="620" height="620"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {workerNodes.filter(n => n.status !== 'idle').map(({ agent, status, x, y }) => {
          const nx = cx + x
          const ny = cy + y
          const color = STATUS_COLOR[status]
          return (
            <linearGradient
              key={`grad-${agent.id}`}
              id={`grad-${agent.id}`}
              x1={cx} y1={cy} x2={nx} y2={ny}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={color} stopOpacity="0.6" />
              <stop offset="100%" stopColor={color} stopOpacity="0.05" />
            </linearGradient>
          )
        })}
      </defs>

      {workerNodes.map(({ agent, status, x, y }) => {
        if (status === 'idle') return null
        const nx = cx + x
        const ny = cy + y
        const color = STATUS_COLOR[status]
        const isActive = status === 'running' || status === 'thinking' || status === 'tool_call'
        const isDone = status === 'completed'
        const pathId = `beam-path-${agent.id}`

        return (
          <g key={agent.id}>
            {/* Static beam line */}
            <line
              x1={cx} y1={cy} x2={nx} y2={ny}
              stroke={color}
              strokeWidth={isActive ? 1.5 : 0.5}
              strokeOpacity={isDone ? 0.15 : isActive ? 0.4 : 0.1}
              strokeDasharray={isDone ? 'none' : '4 4'}
            />

            {/* Animated path for traveler */}
            {isActive && (
              <>
                <path
                  id={pathId}
                  d={`M ${cx} ${cy} L ${nx} ${ny}`}
                  fill="none"
                  stroke="none"
                />
                {/* Traveling dot */}
                <circle r="3" fill={color} fillOpacity="0.9" style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
                  <animateMotion
                    dur={status === 'tool_call' ? '0.8s' : '1.4s'}
                    repeatCount="indefinite"
                  >
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </circle>
                {/* Return dot (completed direction hint) */}
                <circle r="2" fill="white" fillOpacity="0.3">
                  <animateMotion
                    dur={status === 'tool_call' ? '0.8s' : '1.4s'}
                    repeatCount="indefinite"
                    begin="0.7s"
                  >
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </circle>
              </>
            )}

            {/* Completed glow endpoint */}
            {isDone && (
              <circle cx={nx} cy={ny} r="5" fill={color} fillOpacity="0.12" stroke={color} strokeOpacity="0.3" strokeWidth="1" />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Agent Hover Card ─────────────────────────────────────────────────────────
function AgentHoverCard({ agent, status, x, y }: {
  agent: { id: string; label: string; icon: string }
  status: AgentStatus
  x: number
  y: number
}) {
  const info = AGENT_INFO[agent.id]
  const color = STATUS_COLOR[status]
  const accionActual = info?.acciones[status] ?? STATUS_LABEL[status]
  const isActive = status === 'running' || status === 'thinking' || status === 'tool_call'
  const isDone = status === 'completed'

  // Position: right of node if x < 0 (left side), left of node if x > 0 (right side)
  const nodeLeft = 310 + x   // center x of the node in container
  const nodeTop = 310 + y    // center y of the node in container
  const cardWidth = 230
  const cardHeight = 120
  const isRightSide = x > 50
  const cardLeft = isRightSide ? nodeLeft - 38 - cardWidth - 12 : nodeLeft + 38 + 12
  const cardTop = nodeTop - cardHeight / 2

  return (
    <div
      className="absolute pointer-events-none z-50 transition-all duration-200"
      style={{
        left: `${cardLeft}px`,
        top: `${cardTop}px`,
        width: `${cardWidth}px`,
      }}
    >
      <div
        className="rounded-xl p-3.5 backdrop-blur-xl"
        style={{
          background: 'rgba(10, 15, 35, 0.92)',
          border: `1px solid ${color}30`,
          boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px ${color}10`,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{agent.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-white/90 leading-tight">{agent.label}</p>
            <div
              className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
              style={{ background: `${color}18`, color }}
            >
              {isActive && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />}
              {STATUS_LABEL[status]}
            </div>
          </div>
        </div>

        {/* Rol description */}
        <p className="text-[10px] text-white/40 leading-relaxed mb-2">{info?.rol}</p>

        {/* Acción actual */}
        {isActive && (
          <div className="flex items-start gap-1.5 pt-2 border-t border-white/5">
            <span className="text-[10px] mt-px">⚡</span>
            <p className="text-[10px] font-medium leading-relaxed" style={{ color }}>{accionActual}</p>
          </div>
        )}
        {isDone && (
          <div className="flex items-center gap-1.5 pt-2 border-t border-white/5">
            <span className="text-[10px]">✅</span>
            <p className="text-[10px] font-medium text-emerald-400">Tarea entregada al coordinador</p>
          </div>
        )}
      </div>
      {/* Arrow pointer */}
      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={{
          [isRightSide ? 'right' : 'left']: '-5px',
          width: 0,
          height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          [isRightSide ? 'borderLeft' : 'borderRight']: `5px solid ${color}30`,
        }}
      />
    </div>
  )
}

// ─── Worker Orbital Node ──────────────────────────────────────────────────────
function WorkerNode({
  agent, status, x, y, onMouseEnter, onMouseLeave,
}: {
  agent: { id: string; label: string; icon: string }
  status: AgentStatus
  x: number
  y: number
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const isActive = status === 'running' || status === 'thinking' || status === 'tool_call'
  const isDone = status === 'completed'
  const isFailed = status === 'failed'
  const color = STATUS_COLOR[status]
  const opacity = isActive || isDone || isFailed || status === 'pending' ? 1 : 0.3

  const actionPill = isActive ? (AGENT_INFO[agent.id]?.acciones[status] ?? STATUS_LABEL[status]) : null

  return (
    <div
      className="absolute transition-all duration-700 cursor-pointer group"
      style={{
        transform: `translate(${x - 38}px, ${y - 38}px)`,
        opacity,
        width: '76px',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Worker circle */}
      <div
        className="w-[76px] h-[76px] rounded-full flex items-center justify-center relative transition-all duration-300 backdrop-blur-sm"
        style={{
          background: isActive
            ? `radial-gradient(circle at 35% 35%, ${color}20, rgba(15,20,50,0.85))`
            : isDone
            ? 'rgba(34,197,94,0.08)'
            : 'rgba(255,255,255,0.04)',
          border: isActive
            ? `1.5px solid ${color}50`
            : isDone
            ? '1.5px solid rgba(34,197,94,0.3)'
            : '1px solid rgba(255,255,255,0.08)',
          boxShadow: isActive
            ? `0 0 24px ${color}30, 0 0 48px ${color}12, inset 0 1px 0 rgba(255,255,255,0.06)`
            : isDone
            ? '0 0 12px rgba(34,197,94,0.15)'
            : 'none',
        }}
      >
        {/* Pulse ring */}
        {isActive && (
          <div
            className="absolute inset-[-4px] rounded-full animate-ping"
            style={{
              border: `1px solid ${color}25`,
              animationDuration: status === 'tool_call' ? '0.8s' : '1.5s',
            }}
          />
        )}

        {/* Icon */}
        <span className={`text-2xl relative z-10 select-none ${isActive ? 'animate-pulse' : ''}`}
          style={{ animationDuration: '2s' }}>
          {isDone ? '✅' : isFailed ? '❌' : agent.icon}
        </span>

        {/* Status dot */}
        <div
          className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-[#0b1326] transition-all duration-300"
          style={{ background: color, boxShadow: isActive ? `0 0 6px ${color}` : 'none' }}
        />
      </div>

      {/* Label */}
      <div className="mt-2 text-center">
        <span className={`text-[11px] font-semibold block leading-tight transition-colors duration-300 ${
          isActive ? 'text-white/80' : isDone ? 'text-emerald-400/70' : 'text-white/35'
        }`}>
          {agent.label}
        </span>
      </div>

      {/* Action pill */}
      {actionPill && (
        <div
          className="mt-1.5 mx-auto px-2 py-0.5 rounded-full text-center animate-fade-in"
          style={{
            background: `${color}15`,
            border: `1px solid ${color}25`,
            maxWidth: '90px',
          }}
        >
          <span className="text-[8px] font-medium leading-tight block truncate" style={{ color }}>
            {actionPill.replace(/\.\.\.$/, '')}…
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Delegation Feed ──────────────────────────────────────────────────────────
function DelegationFeed({ agentStatuses, progress, mensaje }: {
  agentStatuses: Record<string, AgentStatus>
  progress: number
  mensaje: string
}) {
  const stage = progress < 20 ? 'Análisis' : progress < 60 ? 'Contenido' : progress < 90 ? 'Finalización' : 'Revisión final'
  const activeCount = Object.values(agentStatuses).filter(s => s === 'running' || s === 'thinking' || s === 'tool_call').length
  const doneCount = Object.values(agentStatuses).filter(s => s === 'completed').length

  const feedEntries = useMemo(() => {
    const entries: { id: string; from: string; fromIcon: string; to: string; toIcon: string; action: string; type: 'delegate' | 'return' | 'start'; color: string }[] = []

    const add = (id: string, from: string, fromIcon: string, to: string, toIcon: string, action: string, type: 'delegate' | 'return' | 'start', color: string) => {
      entries.push({ id, from, fromIcon, to, toIcon, action, type, color })
    }

    add('start', '🐝', '🐝', '', '', 'Enjambre iniciado — analizando solicitud', 'start', '#3b82f6')

    const tier0 = ['hl-profile-agent', 'hl-intent-agent', 'hl-structure-agent']
    const tier1 = AGENTS.filter(a => !tier0.includes(a.id))

    for (const agentId of tier0) {
      const agent = AGENTS.find(a => a.id === agentId)!
      const status = agentStatuses[agentId]
      if (status === 'running' || status === 'thinking' || status === 'completed') {
        add(`${agentId}-del`, '🐝', '🐝', agent.label, agent.icon, `Delegando análisis → ${agent.label}`, 'delegate', '#06b6d4')
      }
      if (status === 'completed') {
        add(`${agentId}-ret`, agent.label, agent.icon, 'Coordinador', '🐝', `${agent.label} completado ✓`, 'return', '#22c55e')
      }
    }

    const t1Active = tier1.filter(a => {
      const s = agentStatuses[a.id]
      return s === 'running' || s === 'thinking' || s === 'tool_call' || s === 'completed'
    })

    if (t1Active.length > 0) {
      add('t1-launch', '🐝', '🐝', '', '', `Lanzando ${t1Active.length} agentes de contenido en paralelo`, 'start', '#a855f7')
    }

    for (const agent of t1Active) {
      const status = agentStatuses[agent.id]
      if (status === 'running' || status === 'thinking' || status === 'tool_call') {
        add(`${agent.id}-del`, '🐝', '🐝', agent.label, agent.icon, `${agent.label}: generando contenido`, 'delegate', STATUS_COLOR[status])
      }
      if (status === 'completed') {
        add(`${agent.id}-ret`, agent.label, agent.icon, 'Coordinador', '🐝', `${agent.label} entregó resultado ✓`, 'return', '#22c55e')
      }
    }

    return entries.slice(-7)
  }, [agentStatuses])

  return (
    <div className="w-full flex flex-col gap-4 h-full">
      {/* Title */}
      <div>
        <h3 className="text-[11px] font-bold text-white/50 uppercase tracking-[0.15em]">Flujo de Delegación</h3>
        <p className="text-[10px] text-white/25 mt-0.5">{stage} en progreso</p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/35 font-medium">{mensaje.length > 40 ? mensaje.slice(0, 40) + '…' : mensaje}</span>
          <span className="text-[12px] font-bold text-blue-400 tabular-nums">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.max(progress, 2)}%`,
              background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
              boxShadow: '0 0 8px rgba(59,130,246,0.4)',
            }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-white/20">
          <span>{doneCount} completados</span>
          <span>{activeCount} activos</span>
          <span>{AGENTS.length - doneCount - activeCount} pendientes</span>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/[0.05]" />

      {/* Feed entries */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto min-h-0">
        {feedEntries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-2.5 rounded-xl p-2.5 transition-all duration-300"
            style={{
              background: entry.type === 'return'
                ? 'rgba(34,197,94,0.04)'
                : entry.type === 'start'
                ? 'rgba(59,130,246,0.04)'
                : 'rgba(255,255,255,0.03)',
              border: `1px solid ${entry.color}15`,
            }}
          >
            {/* Arrow icon */}
            <div
              className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px]"
              style={{ background: `${entry.color}15` }}
            >
              {entry.type === 'return' ? '↩' : entry.type === 'start' ? '▶' : '→'}
            </div>

            <div className="flex-1 min-w-0">
              {/* From → To */}
              {entry.to && (
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[10px]">{entry.fromIcon}</span>
                  <span className="text-[9px] text-white/25">→</span>
                  <span className="text-[10px]">{entry.toIcon}</span>
                  <span className="text-[9px] font-semibold text-white/40">{entry.to}</span>
                </div>
              )}
              {/* Action text */}
              <p className="text-[10px] leading-relaxed" style={{ color: entry.type === 'return' ? '#4ade80' : entry.type === 'start' ? '#93c5fd' : 'rgba(255,255,255,0.55)' }}>
                {entry.action}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer stats */}
      <div className="pt-3 border-t border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[9px] text-white/25">{activeCount} de {AGENTS.length} agentes activos</span>
        </div>
        <span className="text-[9px] text-white/20">~2 min</span>
      </div>
    </div>
  )
}

// ─── LoadingScreen principal ──────────────────────────────────────────────────
export function LoadingScreen() {
  const { swarmProgress, meta, perfil, agentStatuses, coordinatorState } = useLessonStore()
  const porcentaje = swarmProgress?.porcentaje ?? 0
  const mensaje = swarmProgress?.mensaje ?? 'Iniciando el enjambre de agentes...'
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null)

  const coordinatorStatus = porcentaje < 10 ? 'analyzing'
    : porcentaje < 80 ? 'delegating'
    : porcentaje < 95 ? 'assembling'
    : 'completed'

  // Worker nodes con coordenadas
  const orbitRadius = 210
  const containerSize = 620
  const center = containerSize / 2  // 310

  const workerNodes = AGENTS.map((agent, i) => {
    const angle = (i / AGENTS.length) * 2 * Math.PI - Math.PI / 2
    const x = Math.cos(angle) * orbitRadius
    const y = Math.sin(angle) * orbitRadius
    const status = (agentStatuses[agent.id] as AgentStatus) ?? 'idle'
    return { agent, status, x, y, angle }
  })

  const hoveredNode = hoveredAgent ? workerNodes.find(n => n.agent.id === hoveredAgent) : null

  // Nombre del worker activo para el coordinador
  const activeWorkerLabel = coordinatorState.currentWorker
    ? AGENTS.find(a => a.id === coordinatorState.currentWorker)?.label ?? null
    : null

  return (
    <div className="absolute inset-0 bg-[#0b1326] overflow-hidden flex flex-col">
      {/* Nebula background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0e27] via-[#15102e] to-[#0d1128]" />
        <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/12 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '7s' }} />
        <div className="absolute top-2/3 left-1/2 -translate-x-1/2 w-72 h-72 bg-indigo-500/08 rounded-full blur-[80px] animate-pulse" style={{ animationDuration: '5s' }} />
        {/* Stars */}
        <div className="absolute inset-0">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full animate-pulse"
              style={{
                width: `${1 + (i % 3) * 0.8}px`,
                height: `${1 + (i % 3) * 0.8}px`,
                background: `rgba(255,255,255,${0.08 + (i % 4) * 0.05})`,
                top: `${(i * 37 + 13) % 100}%`,
                left: `${(i * 61 + 7) % 100}%`,
                animationDelay: `${(i * 0.3) % 5}s`,
                animationDuration: `${3 + (i % 3)}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="relative z-20 flex items-center justify-between px-6 py-3.5 bg-[#0b1326]/70 backdrop-blur-md border-b border-white/[0.05]">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🐝</span>
          <span className="text-sm font-bold text-white/80">HiveLearn</span>
          <span className="text-white/20 text-xs">—</span>
          <span className="text-xs text-blue-400/70 font-medium">{mensaje}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">Enjambre activo</span>
        </div>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-1 min-h-0">
        {/* Left: Orbital visualization */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          {/* Meta info */}
          {meta && (
            <div className="absolute top-4 left-6 z-20">
              <p className="text-[12px] text-white/40 font-medium max-w-xs truncate">"{meta}"</p>
              {perfil && (
                <p className="text-[10px] text-white/20 mt-0.5">{perfil.nombre} · {perfil.tiempoSesion} min</p>
              )}
            </div>
          )}

          {/* Orbital container */}
          <div
            className="relative flex items-center justify-center"
            style={{ width: `${containerSize}px`, height: `${containerSize}px` }}
          >
            {/* Delegation beams SVG */}
            <DelegationBeams workerNodes={workerNodes} />

            {/* Orbital rings (decorative) */}
            <svg className="absolute inset-0 pointer-events-none" width={containerSize} height={containerSize}>
              <circle
                cx={center} cy={center} r={orbitRadius}
                fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"
                strokeDasharray="3 8"
              />
              <circle
                cx={center} cy={center} r={orbitRadius - 30}
                fill="none" stroke="rgba(255,255,255,0.015)" strokeWidth="1"
              />
            </svg>

            {/* Coordinator at center */}
            <div className="absolute" style={{ left: `${center}px`, top: `${center}px`, transform: 'translate(-50%, -50%)' }}>
              <CoordinatorCenter
                progress={porcentaje}
                status={coordinatorStatus}
                currentWorker={activeWorkerLabel}
              />
            </div>

            {/* Worker nodes */}
            {workerNodes.map((node) => (
              <div key={node.agent.id} className="absolute" style={{ left: `${center}px`, top: `${center}px` }}>
                <WorkerNode
                  agent={node.agent}
                  status={node.status}
                  x={node.x}
                  y={node.y}
                  onMouseEnter={() => setHoveredAgent(node.agent.id)}
                  onMouseLeave={() => setHoveredAgent(null)}
                />
              </div>
            ))}

            {/* Hover card */}
            {hoveredNode && hoveredNode.status !== 'idle' && (
              <AgentHoverCard
                agent={hoveredNode.agent}
                status={hoveredNode.status}
                x={hoveredNode.x}
                y={hoveredNode.y}
              />
            )}
          </div>
        </div>

        {/* Right: Delegation Feed */}
        <div
          className="w-[360px] flex-shrink-0 border-l border-white/[0.04] p-6 flex flex-col"
          style={{ background: 'rgba(13,19,42,0.7)', backdropFilter: 'blur(16px)' }}
        >
          <DelegationFeed
            agentStatuses={agentStatuses as Record<string, AgentStatus>}
            progress={porcentaje}
            mensaje={mensaje}
          />
        </div>
      </div>
    </div>
  )
}
