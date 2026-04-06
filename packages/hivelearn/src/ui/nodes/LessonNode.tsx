import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { NodoLesson, TipoPedagogico } from '../../types'

// ─── Config visual por tipo pedagógico ───────────────────────────────────────
const TIPO_CONFIG: Record<TipoPedagogico | string, {
  band: string; bg: string; border: string; text: string; icon: string; label: string
}> = {
  concept:    { band: '#3b82f6', bg: 'rgba(59,130,246,0.07)',  border: 'rgba(59,130,246,0.25)',  text: '#93c5fd', icon: '📖', label: 'Concepto'   },
  exercise:   { band: '#22c55e', bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.25)',   text: '#86efac', icon: '✏️',  label: 'Ejercicio'  },
  quiz:       { band: '#a855f7', bg: 'rgba(168,85,247,0.07)',  border: 'rgba(168,85,247,0.25)',  text: '#d8b4fe', icon: '❓',  label: 'Quiz'       },
  challenge:  { band: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.25)',  text: '#fcd34d', icon: '⚡',  label: 'Reto'       },
  milestone:  { band: '#eab308', bg: 'rgba(234,179,8,0.09)',   border: 'rgba(234,179,8,0.30)',   text: '#fef08a', icon: '🏆',  label: 'Logro'      },
  evaluation: { band: '#ef4444', bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.25)',   text: '#fca5a5', icon: '📝',  label: 'Evaluación' },
}

export interface HLNodeData extends Record<string, unknown> {
  nodo: NodoLesson
  isActive: boolean
  onClick: (nodo: NodoLesson) => void
}

export function LessonNode({ data }: NodeProps) {
  const { nodo, isActive, onClick } = data as HLNodeData
  const cfg = TIPO_CONFIG[nodo.tipoPedagogico] ?? TIPO_CONFIG.concept
  const isLocked    = nodo.estado === 'bloqueado'
  const isCompleted = nodo.estado === 'completado'
  const isAvailable = nodo.estado === 'disponible'

  // Colores dinámicos del estado
  const borderColor = isCompleted
    ? '#22c55e'
    : isActive && isAvailable
    ? cfg.band
    : cfg.border

  const glowColor = isActive && isAvailable ? cfg.band : isCompleted ? '#22c55e' : 'transparent'

  return (
    <div
      className="relative select-none transition-all duration-300"
      style={{
        width: '200px',
        opacity: isLocked ? 0.42 : 1,
      }}
    >
      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !border-2 !bg-transparent hover:!bg-white/20 transition-colors"
        style={{ borderColor: borderColor, opacity: 0.5 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !bg-transparent hover:!bg-white/20 transition-colors"
        style={{ borderColor: borderColor, opacity: 0.5 }}
      />

      {/* Card */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: isCompleted ? 'rgba(34,197,94,0.06)' : cfg.bg,
          border: `1.5px solid ${borderColor}`,
          boxShadow: isActive && isAvailable
            ? `0 0 0 3px ${glowColor}20, 0 0 20px ${glowColor}25, 0 4px 24px rgba(0,0,0,0.4)`
            : isCompleted
            ? '0 0 14px rgba(34,197,94,0.15), 0 4px 16px rgba(0,0,0,0.3)'
            : '0 4px 16px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Color band top */}
        <div style={{ height: '3px', background: isCompleted ? '#22c55e' : cfg.band, opacity: isLocked ? 0.3 : 1 }} />

        {/* Content */}
        <div className="px-3 py-2.5 space-y-2">
          {/* Top row: badge + XP */}
          <div className="flex items-center justify-between">
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
              style={{ background: `${cfg.band}18`, color: cfg.text, border: `1px solid ${cfg.band}25` }}
            >
              {cfg.label}
            </span>
            <div className="flex items-center gap-1">
              {isActive && isAvailable && (
                <span
                  className="text-[8px] font-bold px-1.5 py-0.5 rounded-full animate-pulse"
                  style={{ background: `${cfg.band}25`, color: cfg.band, border: `1px solid ${cfg.band}40` }}
                >
                  ACTUAL
                </span>
              )}
              {nodo.xpRecompensa > 0 && !isLocked && (
                <span className="text-[9px] font-bold text-amber-400/70">⭐{nodo.xpRecompensa}</span>
              )}
            </div>
          </div>

          {/* Icon + title row */}
          <div className="flex items-start gap-2">
            <span
              className={`text-[22px] leading-none flex-shrink-0 mt-0.5 ${isLocked ? 'grayscale' : ''}`}
            >
              {isLocked ? '🔒' : isCompleted ? '✅' : cfg.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-[12px] font-bold leading-tight line-clamp-2 ${
                isLocked ? 'text-white/35' : isCompleted ? 'text-emerald-300' : 'text-white/90'
              }`}>
                {nodo.titulo}
              </p>
              <p className="text-[10px] text-white/30 mt-0.5 line-clamp-1 leading-snug">
                {nodo.concepto}
              </p>
            </div>
          </div>

          {/* Footer */}
          {!isLocked && (
            <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: `${borderColor}30` }}>
              {/* Status chip */}
              <div className="flex items-center gap-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${isActive ? 'animate-pulse' : ''}`}
                  style={{ background: isCompleted ? '#22c55e' : isActive ? cfg.band : 'rgba(255,255,255,0.2)' }}
                />
                <span className="text-[9px] text-white/30">
                  {isCompleted ? 'Completado' : isActive ? 'En curso' : 'Disponible'}
                </span>
              </div>

              {/* Action button */}
              <button
                onClick={(e) => { e.stopPropagation(); onClick(nodo) }}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all active:scale-95 ${
                  isCompleted
                    ? 'text-emerald-400 hover:bg-emerald-500/15'
                    : 'text-white/70 hover:text-white hover:bg-white/8'
                }`}
                style={isCompleted ? {} : { background: `${cfg.band}15`, border: `1px solid ${cfg.band}25` }}
              >
                {isCompleted ? '↻ Revisar' : 'Abrir →'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active pulse ring (only when active + available) */}
      {isActive && isAvailable && (
        <div
          className="absolute inset-[-3px] rounded-[18px] animate-ping pointer-events-none"
          style={{ border: `1px solid ${cfg.band}30`, animationDuration: '2s' }}
        />
      )}
    </div>
  )
}
