import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ConceptInfographicNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const info = data.contenido?.infografia

  return (
    <BaseNode {...props} data={data}>
      {info?.secciones ? (
        <div className="mt-1 grid grid-cols-2 gap-1">
          {info.secciones.map((s, i) => (
            <div key={i} className="rounded bg-gray-800/60 p-1.5 text-center">
              <span className="text-base">{s.emoji}</span>
              <p className="text-[10px] font-bold text-amber-400">{s.titulo}</p>
              <p className="text-[10px] text-gray-300">{s.valor}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-16 rounded bg-gray-800 animate-pulse" />
      )}
    </BaseNode>
  )
}
