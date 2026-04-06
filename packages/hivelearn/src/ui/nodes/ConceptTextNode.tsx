import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ConceptTextNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const exp = data.contenido?.explicacion
  return (
    <BaseNode {...props} data={data}>
      {exp ? (
        <div className="text-xs text-gray-300 space-y-1">
          <p>{exp.explicacion}</p>
          {exp.ejemploConcreto && (
            <p className="text-amber-400/80 italic">Ej: {exp.ejemploConcreto}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500 italic">Cargando explicación...</p>
      )}
    </BaseNode>
  )
}
