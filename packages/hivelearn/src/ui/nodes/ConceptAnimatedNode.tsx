import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ConceptAnimatedNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const exp = data.contenido?.explicacion
  return (
    <BaseNode {...props} data={data}>
      <div className="mt-1 animate-pulse-slow">
        {exp ? (
          <p className="text-xs text-gray-200">{exp.explicacion}</p>
        ) : (
          <div className="h-8 rounded bg-amber-500/10 animate-pulse" />
        )}
      </div>
    </BaseNode>
  )
}
