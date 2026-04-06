import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function QuizTextNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const quiz = data.contenido?.quiz
  const [seleccion, setSeleccion] = useState<number | null>(null)
  const [enviado, setEnviado] = useState(false)

  const handleSubmit = () => {
    if (seleccion === null) return
    setEnviado(true)
    data.onInteract?.(data, String(seleccion))
  }

  return (
    <BaseNode {...props} data={data}>
      {quiz ? (
        <div className="mt-1 space-y-1.5">
          <p className="text-xs font-medium text-gray-200">{quiz.pregunta}</p>
          <div className="space-y-1">
            {quiz.opciones.map((op, i) => {
              const isSelected = seleccion === i
              const isCorrect = enviado && i === quiz.indicesCorrecto
              const isWrong = enviado && isSelected && i !== quiz.indicesCorrecto
              return (
                <button
                  key={i}
                  disabled={enviado}
                  onClick={() => !enviado && setSeleccion(i)}
                  className={`w-full text-left rounded px-2 py-1 text-xs border transition-all
                    ${isCorrect ? 'border-green-500 bg-green-500/20 text-green-300' :
                      isWrong ? 'border-red-500 bg-red-500/20 text-red-300' :
                      isSelected ? 'border-amber-500 bg-amber-500/10 text-white' :
                      'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-500'}`}
                >
                  {String.fromCharCode(65 + i)}. {op}
                </button>
              )
            })}
          </div>
          {!enviado && seleccion !== null && (
            <button
              onClick={handleSubmit}
              className="w-full rounded bg-amber-500 px-2 py-1 text-xs font-bold text-black hover:bg-amber-400"
            >
              Confirmar
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-6 rounded bg-gray-800 animate-pulse" />)}
        </div>
      )}
    </BaseNode>
  )
}
