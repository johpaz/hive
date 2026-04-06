import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ExerciseTextNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const ej = data.contenido?.ejercicio
  const [respuesta, setRespuesta] = useState('')
  const [mostrarPista, setMostrarPista] = useState(false)

  const handleSubmit = () => {
    if (respuesta.trim() && data.onInteract) {
      data.onInteract(data, respuesta.trim())
    }
  }

  return (
    <BaseNode {...props} data={data}>
      {ej ? (
        <div className="mt-1 space-y-2">
          <p className="text-xs text-gray-200">{ej.enunciado}</p>
          {data.estado === 'disponible' && (
            <>
              <input
                className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-xs text-white focus:border-blue-500 outline-none"
                placeholder="Tu respuesta..."
                value={respuesta}
                onChange={e => setRespuesta(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              <div className="flex gap-1">
                <button
                  onClick={handleSubmit}
                  className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-500"
                >
                  Enviar
                </button>
                {ej.pistaOpcional && (
                  <button
                    onClick={() => setMostrarPista(!mostrarPista)}
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-400 hover:border-blue-500"
                  >
                    💡
                  </button>
                )}
              </div>
              {mostrarPista && ej.pistaOpcional && (
                <p className="text-xs text-gray-300/80 italic">{ej.pistaOpcional}</p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="h-12 rounded bg-gray-800 animate-pulse" />
      )}
    </BaseNode>
  )
}
