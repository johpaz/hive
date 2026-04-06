import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ChallengeCodeNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const reto = data.contenido?.reto
  const [pasoActual, setPasoActual] = useState(0)
  const [codigo, setCodigo] = useState('')

  const handleSubmit = () => {
    if (codigo.trim()) {
      data.onInteract?.(data, codigo.trim())
    }
  }

  return (
    <BaseNode {...props} data={data}>
      {reto ? (
        <div className="mt-1 space-y-2">
          <p className="text-xs font-bold text-blue-400">{reto.titulo}</p>
          <p className="text-xs text-gray-400">{reto.contexto}</p>
          {/* Stepper de pasos */}
          <div className="space-y-1">
            {reto.pasos.map((paso, i) => (
              <div
                key={i}
                className={`flex items-start gap-1.5 text-xs ${i <= pasoActual ? 'text-white' : 'text-gray-600'}`}
              >
                <span className={`shrink-0 rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold border
                  ${i < pasoActual ? 'bg-green-500 border-green-500 text-black' :
                    i === pasoActual ? 'border-blue-500 text-blue-400' :
                    'border-gray-700 text-gray-600'}`}
                >
                  {i < pasoActual ? '✓' : i + 1}
                </span>
                <span>{paso}</span>
              </div>
            ))}
          </div>
          <textarea
            className="w-full rounded bg-black/70 border border-gray-600 p-2 text-xs font-mono text-green-300 focus:border-blue-500 outline-none resize-none h-16"
            placeholder="// Tu solución..."
            value={codigo}
            onChange={e => setCodigo(e.target.value)}
          />
          <div className="flex gap-1">
            {pasoActual < reto.pasos.length - 1 && (
              <button
                onClick={() => setPasoActual(p => p + 1)}
                className="flex-1 rounded border border-blue-500/50 px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/10"
              >
                Sig. paso →
              </button>
            )}
            <button
              onClick={handleSubmit}
              className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-500"
            >
              🏆 Completar
            </button>
          </div>
        </div>
      ) : (
        <div className="h-24 rounded bg-gray-800 animate-pulse" />
      )}
    </BaseNode>
  )
}
