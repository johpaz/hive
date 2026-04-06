import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { NodoLesson, EstadoNodo } from '../../../types'

export interface LessonNodeData extends NodoLesson {
  onInteract?: (nodo: NodoLesson, respuesta: string) => void
  isActive?: boolean
}

const ESTADO_STYLES: Record<EstadoNodo, string> = {
  bloqueado:   'opacity-40 cursor-not-allowed bg-gray-800 border-gray-600',
  disponible:  'cursor-pointer bg-gray-900 border-blue-500 hover:border-blue-400 hover:shadow-blue-500/20 hover:shadow-lg transition-all',
  completado:  'bg-gray-900 border-green-500 border-2',
  incorrecto:  'bg-gray-900 border-red-500 border-2',
}

const TIPO_EMOJI: Record<string, string> = {
  concept:    '💡',
  exercise:   '✏️',
  quiz:       '❓',
  challenge:  '🏆',
  milestone:  '⭐',
  evaluation: '📝',
}

interface BaseNodeProps extends Omit<NodeProps, 'data'> {
  data: LessonNodeData
  children?: React.ReactNode
}

export function BaseNode({ data, children }: BaseNodeProps) {
  const estado = data.estado ?? 'bloqueado'
  const emoji = TIPO_EMOJI[data.tipoPedagogico] ?? '📌'

  return (
    <div
      className={`relative rounded-xl border p-4 w-64 min-h-24 transition-all ${ESTADO_STYLES[estado]}`}
      style={{ animation: estado === 'disponible' ? 'fadeInUp 0.3s ease-out' : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-500 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-blue-500 !w-2 !h-2" />

      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-xl shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-widest text-blue-500/70 font-bold">{data.tipoPedagogico}</p>
          <h3 className="text-sm font-bold text-white truncate">{data.titulo}</h3>
        </div>
        {/* Badge XP */}
        {estado === 'completado' && (
          <span className="shrink-0 rounded-full bg-green-500/20 border border-green-500 px-2 py-0.5 text-[10px] font-bold text-green-400">
            +{data.xpRecompensa} XP ✓
          </span>
        )}
        {estado !== 'completado' && (
          <span className="shrink-0 rounded-full bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-[10px] text-blue-400">
            {data.xpRecompensa} XP
          </span>
        )}
      </div>

      {/* Contenido específico del tipo de nodo */}
      {estado !== 'bloqueado' && children}

      {/* Estado bloqueado */}
      {estado === 'bloqueado' && (
        <p className="text-xs text-gray-500 mt-1">Completa el nodo anterior para desbloquear</p>
      )}

      {/* Indicador completado */}
      {estado === 'completado' && (
        <div className="absolute top-2 right-2 text-green-400 text-lg">✓</div>
      )}
    </div>
  )
}
