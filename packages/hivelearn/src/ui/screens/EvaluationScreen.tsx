import { useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import { useEvaluation } from '../hooks/useEvaluation'

export function EvaluationScreen() {
  const { program, perfil } = useLessonStore()
  const { preguntas, preguntaActual, total, esFinal, responder, finalizarEvaluacion, enviando } = useEvaluation()
  const [respuestaCorta, setRespuestaCorta] = useState('')

  if (!program || preguntas.length === 0) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">Cargando evaluación...</p>
    </div>
  )

  const pregunta = preguntas[preguntaActual]

  const handleResponder = (resp: string | number) => {
    responder(resp)
    setRespuestaCorta('')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">📝</div>
          <h2 className="text-xl font-bold text-white">Evaluación Final</h2>
          <p className="text-sm text-gray-400 mt-1">{program.tema}</p>
        </div>

        {/* Progreso */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Pregunta {preguntaActual + 1} de {total}</span>
            <span className="text-blue-400">{Math.round(((preguntaActual) / total) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${((preguntaActual) / total) * 100}%` }}
            />
          </div>
        </div>

        {/* Tarjeta de pregunta */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-4">
          <div className="flex items-start gap-2">
            <span className="shrink-0 rounded-full bg-blue-500/20 border border-blue-500 w-6 h-6 flex items-center justify-center text-xs font-bold text-blue-400">
              {preguntaActual + 1}
            </span>
            <p className="text-sm text-white font-medium">{pregunta.pregunta}</p>
          </div>

          {pregunta.tipo === 'multiple_choice' && pregunta.opciones && (
            <div className="space-y-2">
              {pregunta.opciones.map((op, i) => (
                <button
                  key={i}
                  onClick={() => handleResponder(i)}
                  className="w-full text-left rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-gray-300 hover:border-blue-500 hover:text-white transition-all"
                >
                  <span className="font-bold text-blue-400 mr-2">{String.fromCharCode(65 + i)}.</span>
                  {op}
                </button>
              ))}
            </div>
          )}

          {pregunta.tipo === 'respuesta_corta' && (
            <div className="space-y-3">
              <textarea
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-sm text-white focus:border-blue-500 outline-none resize-none h-24"
                placeholder="Escribe tu respuesta..."
                value={respuestaCorta}
                onChange={e => setRespuestaCorta(e.target.value)}
              />
              <button
                onClick={() => respuestaCorta.trim() && handleResponder(respuestaCorta.trim())}
                disabled={!respuestaCorta.trim()}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {esFinal ? '🏁 Finalizar evaluación' : 'Siguiente →'}
              </button>
            </div>
          )}

          {pregunta.tipo === 'multiple_choice' && esFinal && (
            <button
              onClick={finalizarEvaluacion}
              disabled={enviando}
              className="w-full mt-2 rounded-xl bg-green-600 py-3 text-sm font-bold text-white hover:bg-green-500 disabled:opacity-40"
            >
              {enviando ? 'Calculando resultado...' : '🏁 Ver resultado final'}
            </button>
          )}
        </div>

        {/* Tipo de pregunta */}
        <p className="text-center text-xs text-gray-600 mt-4">
          {pregunta.tipo === 'multiple_choice' ? '📊 Selección múltiple' : '✍️ Respuesta corta'}
        </p>
      </div>
    </div>
  )
}
