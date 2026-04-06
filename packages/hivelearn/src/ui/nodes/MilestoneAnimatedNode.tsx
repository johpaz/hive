import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function MilestoneAnimatedNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData

  return (
    <BaseNode {...props} data={data}>
      <div className="mt-2 text-center space-y-1">
        <div className="text-3xl" style={{ animation: 'bounce 1s infinite' }}>⭐</div>
        <p className="text-xs font-bold text-blue-400">{data.titulo}</p>
        <p className="text-xs text-gray-400">¡Punto de control alcanzado!</p>
        {data.estado === 'disponible' && (
          <button
            onClick={() => data.onInteract?.(data, 'milestone_reached')}
            className="mt-1 w-full rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-500"
          >
            ¡Seguir adelante! →
          </button>
        )}
      </div>
    </BaseNode>
  )
}
