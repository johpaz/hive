import { useCallback, useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import type { FeedbackOutput, NodoLesson } from '../../types'
import { fetchWithAuth } from '../lib/fetchWithAuth'

export function useNodeInteraction() {
  const { completarNodo, setLastFeedback, setNodoActual, program } = useLessonStore()
  const [loadingFeedback, setLoadingFeedback] = useState(false)

  const submitRespuesta = useCallback(async (nodo: NodoLesson, respuesta: string) => {
    setLoadingFeedback(true)
    try {
      const res = await fetchWithAuth('/api/hivelearn/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodoId: nodo.id,
          tipoPedagogico: nodo.tipoPedagogico,
          concepto: nodo.concepto,
          respuesta,
          rangoEdad: nodo.rangoEdad,
        }),
      })

      const feedback: FeedbackOutput = res.ok
        ? await res.json()
        : { correcto: false, mensajePrincipal: '¡Sigue intentando! 💪', pistaSiIncorrecto: respuesta, xpGanado: 0 }

      setLastFeedback(feedback)

      if (feedback.correcto) {
        completarNodo(nodo.id, feedback.xpGanado)
        // Avanzar al siguiente nodo
        if (program) {
          const idx = program.nodos.findIndex(n => n.id === nodo.id)
          const siguiente = program.nodos[idx + 1]
          if (siguiente) setNodoActual(siguiente.id)
        }
      }

      return feedback
    } finally {
      setLoadingFeedback(false)
    }
  }, [completarNodo, setLastFeedback, setNodoActual, program])

  const saltarNodo = useCallback((nodo: NodoLesson) => {
    completarNodo(nodo.id, 0)
    if (program) {
      const idx = program.nodos.findIndex(n => n.id === nodo.id)
      const siguiente = program.nodos[idx + 1]
      if (siguiente) setNodoActual(siguiente.id)
    }
  }, [completarNodo, setNodoActual, program])

  return { submitRespuesta, saltarNodo, loadingFeedback }
}
