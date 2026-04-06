import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ExerciseCodeNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const ej = data.contenido?.ejercicio
  const [codigo, setCodigo] = useState('')

  const handleSubmit = () => {
    if (codigo.trim() && data.onInteract) {
      data.onInteract(data, codigo.trim())
    }
  }

  return (
    <BaseNode {...props} data={data}>
      {ej ? (
        <div className="mt-1 space-y-2">
          <p className="text-xs text-gray-200">{ej.enunciado}</p>
          <textarea
            className="w-full rounded bg-black/70 border border-gray-600 p-2 text-xs font-mono text-green-300 focus:border-blue-500 outline-none resize-none h-20"
            placeholder="// Escribe tu código aquí..."
            value={codigo}
            onChange={e => setCodigo(e.target.value)}
          />
          <button
            onClick={handleSubmit}
            className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-500"
          >
            Ejecutar ▶
          </button>
        </div>
      ) : (
        <div className="h-20 rounded bg-gray-800 animate-pulse" />
      )}
    </BaseNode>
  )
}
