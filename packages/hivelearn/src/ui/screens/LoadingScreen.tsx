import { useLessonStore } from '../store/lessonStore'

type AgentStatus = 'pending' | 'running' | 'completed' | 'failed'

// ─── Metadata por agente ─────────────────────────────────────────────────────
const AGENT_META: Record<string, { label: string; icon: string; accion: string }> = {
  'hl-profile-agent':      { label: 'Perfil',        icon: '👤', accion: 'Analizando perfil del alumno'     },
  'hl-intent-agent':       { label: 'Intención',     icon: '🎯', accion: 'Extrayendo tema y nivel'          },
  'hl-structure-agent':    { label: 'Estructura',    icon: '🗺️', accion: 'Diseñando programa de nodos'     },
  'hl-explanation-agent':  { label: 'Explicación',   icon: '📖', accion: 'Generando explicación'            },
  'hl-exercise-agent':     { label: 'Ejercicios',    icon: '✏️', accion: 'Creando ejercicio práctico'       },
  'hl-quiz-agent':         { label: 'Quiz',          icon: '❓', accion: 'Preparando preguntas'             },
  'hl-challenge-agent':    { label: 'Reto',          icon: '⚡', accion: 'Diseñando reto integrador'        },
  'hl-code-agent':         { label: 'Código',        icon: '💻', accion: 'Generando código ejemplo'         },
  'hl-svg-agent':          { label: 'Diagrama',      icon: '📊', accion: 'Dibujando diagrama SVG'           },
  'hl-gif-agent':          { label: 'Animación',     icon: '🎞️', accion: 'Creando animación paso a paso'   },
  'hl-infographic-agent':  { label: 'Infografía',    icon: '📈', accion: 'Construyendo infografía'          },
  'hl-image-agent':        { label: 'Imagen',        icon: '🖼️', accion: 'Generando imagen educativa'       },
  'hl-gamification-agent': { label: 'Gamificación',  icon: '🏆', accion: 'Asignando XP y logros'            },
  'hl-evaluation-agent':   { label: 'Evaluación',    icon: '📝', accion: 'Preparando evaluación final'      },
}

const ANALYSIS_AGENTS  = ['hl-profile-agent', 'hl-intent-agent', 'hl-structure-agent']
const CONTENT_AGENTS   = ['hl-explanation-agent', 'hl-exercise-agent', 'hl-quiz-agent', 'hl-challenge-agent', 'hl-code-agent', 'hl-svg-agent', 'hl-gif-agent', 'hl-infographic-agent']
const PARALLEL_AGENTS  = ['hl-gamification-agent', 'hl-evaluation-agent']

// ─── AgentCard ────────────────────────────────────────────────────────────────
function AgentCard({ agentId, status = 'pending', compact = false }: {
  agentId: string
  status?: AgentStatus
  compact?: boolean
}) {
  const meta = AGENT_META[agentId] ?? { label: agentId, icon: '🤖', accion: 'Procesando...' }
  const isRunning   = status === 'running'
  const isDone      = status === 'completed'
  const isFailed    = status === 'failed'
  const isPending   = status === 'pending'

  return (
    <div className={`
      rounded-xl border transition-all duration-500 flex flex-col
      ${compact ? 'p-2.5 gap-1' : 'p-3 gap-1.5'}
      ${isRunning ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_12px_rgba(59,130,246,0.2)]' : ''}
      ${isDone    ? 'bg-green-500/8 border-green-500/30' : ''}
      ${isFailed  ? 'bg-red-500/8 border-red-500/30' : ''}
      ${isPending ? 'bg-white/[0.02] border-white/8 opacity-50' : ''}
    `}>
      {/* Fila superior: icono + nombre + status dot */}
      <div className="flex items-center gap-1.5">
        <span className={`text-base flex-shrink-0 ${isPending ? 'grayscale opacity-50' : ''} ${isRunning ? 'animate-pulse' : ''}`}>
          {meta.icon}
        </span>
        <span className={`text-xs font-bold truncate flex-1
          ${isRunning ? 'text-blue-200' : isDone ? 'text-green-300' : isFailed ? 'text-red-300' : 'text-white/30'}
        `}>
          {meta.label}
        </span>
        {/* Status indicator */}
        {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />}
        {isDone    && <span className="text-green-400 text-xs flex-shrink-0">✓</span>}
        {isFailed  && <span className="text-red-400 text-xs flex-shrink-0">✗</span>}
      </div>

      {/* Acción — solo visible cuando activo o completado */}
      {!isPending && (
        <p className={`text-[10px] leading-tight
          ${isRunning ? 'text-blue-300/70' : isDone ? 'text-green-400/60' : 'text-red-400/60'}
        `}>
          {isDone ? '✓ Listo' : isFailed ? 'Error' : meta.accion}
        </p>
      )}
    </div>
  )
}

// ─── SectionBlock ─────────────────────────────────────────────────────────────
function SectionBlock({ num, label, description, children, className = '' }: {
  num?: number
  label: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2">
        {num !== undefined && (
          <div className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
            {num}
          </div>
        )}
        <span className="text-xs font-bold text-white/70 uppercase tracking-wider">{label}</span>
        {description && <span className="text-xs text-white/25">{description}</span>}
      </div>
      {children}
    </div>
  )
}

// ─── LoadingScreen ────────────────────────────────────────────────────────────
export function LoadingScreen() {
  const { swarmProgress, meta, perfil, agentStatuses } = useLessonStore()
  const porcentaje = swarmProgress?.porcentaje ?? 0
  const mensaje    = swarmProgress?.mensaje ?? 'Iniciando el enjambre de agentes...'

  return (
    <div className="absolute inset-0 bg-gray-950 overflow-y-auto flex flex-col">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-500/6 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex-1 flex flex-col items-center px-4 py-8 gap-6 relative z-10 max-w-3xl mx-auto w-full">

        {/* Hero */}
        <div className="text-center space-y-2">
          <div className="relative mx-auto w-16 h-16">
            <div className="absolute inset-0 rounded-full bg-blue-500/15 animate-ping" style={{ animationDuration: '2.5s' }} />
            <div className="absolute inset-0 flex items-center justify-center text-4xl select-none">🐝</div>
          </div>
          <h2 className="text-xl font-black text-white">Construyendo tu programa</h2>
          {meta && (
            <p className="text-blue-400 text-sm font-medium max-w-sm mx-auto truncate">"{meta}"</p>
          )}
          {perfil && (
            <p className="text-white/25 text-xs">
              {perfil.nombre} · {perfil.tiempoSesion} min · <span className="capitalize">{perfil.rangoEdad}</span>
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-white/40 truncate max-w-[80%]">{mensaje}</span>
            <span className="text-blue-400 font-bold tabular-nums ml-2">{porcentaje}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-600 via-blue-400 to-blue-300 transition-all duration-700"
              style={{ width: `${Math.max(porcentaje, 2)}%` }}
            />
          </div>
        </div>

        {/* ─── Sección 1: Análisis (secuencial) ─── */}
        <SectionBlock num={1} label="Análisis" description="secuencial" className="w-full">
          <div className="grid grid-cols-3 gap-2">
            {ANALYSIS_AGENTS.map(id => (
              <AgentCard key={id} agentId={id} status={agentStatuses[id]} />
            ))}
          </div>
        </SectionBlock>

        {/* ─── Sección 2: Contenido + En paralelo ─── */}
        <div className="w-full flex gap-3 items-start">
          {/* Contenido (paralelo) */}
          <SectionBlock num={2} label="Contenido" description="paralelo" className="flex-1 min-w-0">
            <div className="grid grid-cols-4 gap-1.5">
              {CONTENT_AGENTS.map(id => (
                <AgentCard key={id} agentId={id} status={agentStatuses[id]} compact />
              ))}
            </div>
          </SectionBlock>

          {/* En paralelo (sin número) */}
          <SectionBlock label="En paralelo" className="w-40 flex-shrink-0">
            <div className="space-y-1.5">
              {PARALLEL_AGENTS.map(id => (
                <AgentCard key={id} agentId={id} status={agentStatuses[id]} />
              ))}
            </div>
          </SectionBlock>
        </div>

        <p className="text-xs text-white/15 text-center">
          Primera vez: ~2 min · Con caché: ~10s
        </p>
      </div>
    </div>
  )
}
