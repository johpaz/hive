import { useState, useCallback } from 'react'
import { useLessonStore } from '../store/lessonStore'
import type { PreguntaEvaluacion } from '../../types'
import { fetchWithAuth } from '../lib/fetchWithAuth'

export function useEvaluation() {
  const { program, responderEvaluacion, respuestasEvaluacion, setPuntajeEvaluacion, setScreen, sessionId, xpTotal, logrosDesbloqueados } = useLessonStore()
  const [preguntaActual, setPreguntaActual] = useState(0)
  const [enviando, setEnviando] = useState(false)

  const preguntas: PreguntaEvaluacion[] = program?.evaluacion.preguntas ?? []
  const total = preguntas.length
  const esFinal = preguntaActual === total - 1

  const responder = useCallback((respuesta: string | number) => {
    responderEvaluacion(preguntaActual, respuesta)
    if (!esFinal) {
      setPreguntaActual(prev => prev + 1)
    }
  }, [preguntaActual, esFinal, responderEvaluacion])

  const finalizarEvaluacion = useCallback(async () => {
    setEnviando(true)
    try {
      let correctas = 0
      preguntas.forEach((p, idx) => {
        const resp = respuestasEvaluacion[idx]
        if (p.tipo === 'multiple_choice' && resp === p.indiceCorrecto) correctas++
        if (p.tipo === 'respuesta_corta' && resp) correctas++ // FeedbackAgent califica luego
      })
      const puntaje = Math.round((correctas / total) * 100)
      setPuntajeEvaluacion(puntaje)

      // Marcar sesión como completada en el backend
      if (sessionId) {
        fetchWithAuth('/api/hivelearn/complete-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            puntajeEvaluacion: puntaje,
            xpTotal,
            logrosJson: JSON.stringify(logrosDesbloqueados),
          }),
        }).catch(() => { /* non-critical */ })
      }

      setScreen('result')
    } finally {
      setEnviando(false)
    }
  }, [preguntas, respuestasEvaluacion, total, setPuntajeEvaluacion, setScreen, sessionId, xpTotal, logrosDesbloqueados])

  return {
    preguntas,
    preguntaActual,
    total,
    esFinal,
    respuestasEvaluacion,
    responder,
    finalizarEvaluacion,
    enviando,
  }
}
