import { useState } from 'react'
import type { NodoLesson, FeedbackOutput } from '../../types'
import { NodeContentRenderer } from './NodeContentRenderer'
import { MicroEvalPanel } from './MicroEvalPanel'
import { useLessonStore } from '../store/lessonStore'

const TIPO_BADGE: Record<string, { label: string; color: string }> = {
  concept:    { label: 'Concepto',   color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  exercise:   { label: 'Ejercicio',  color: 'bg-green-500/20 text-green-300 border-green-500/30' },
  quiz:       { label: 'Quiz',       color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  challenge:  { label: 'Reto',       color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  milestone:  { label: 'Logro',      color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  evaluation: { label: 'Evaluación', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
}

interface Props {
  nodo: NodoLesson | null
  onClose: () => void
  onComplete: (nodo: NodoLesson, xpGanado: number) => void
}

export function NodeDetailPanel({ nodo, onClose, onComplete }: Props) {
  const { lastFeedback, setLastFeedback, selectedProviderId, selectedModelId } = useLessonStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  const isOpen = nodo !== null

  const handleSubmitMicroEval = async (respuesta: string) => {
    if (!nodo) return
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/hivelearn/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodoId: nodo.id,
          concepto: nodo.concepto,
          respuesta,
          rangoEdad: nodo.rangoEdad,
          tipoPedagogico: nodo.tipoPedagogico,
        }),
      })
      const fb: FeedbackOutput = await res.json()
      setLastFeedback(fb)
    } catch {
      setLastFeedback({ correcto: false, mensajePrincipal: 'Error al evaluar. Intenta de nuevo.', xpGanado: 0 })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleComplete = () => {
    if (!nodo) return
    const xp = lastFeedback?.xpGanado ?? nodo.xpRecompensa
    setIsCompleted(true)
    onComplete(nodo, xp)
    // Limpiar estado local
    setTimeout(() => {
      setIsCompleted(false)
      setLastFeedback(null)
      onClose()
    }, 600)
  }

  const handleSkip = () => {
    if (!nodo) return
    onComplete(nodo, 0)
    setLastFeedback(null)
    onClose()
  }

  const badge = nodo ? (TIPO_BADGE[nodo.tipoPedagogico] ?? TIPO_BADGE.concept) : null
  const isInteractive = nodo && ['exercise', 'quiz', 'challenge'].includes(nodo.tipoPedagogico)
  const canComplete = !nodo?.contenido?.microEval || !!lastFeedback || nodo.tipoPedagogico === 'milestone'
  const isLocked = nodo?.estado === 'bloqueado'

  return (
    <>
      {/* Overlay para cerrar al hacer click fuera */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={onClose}
        />
      )}

      {/* Panel lateral */}
      <div className={`
        fixed top-0 right-0 h-full z-40 w-[420px] max-w-[90vw]
        bg-gray-900 border-l border-gray-700 shadow-2xl
        flex flex-col
        transition-transform duration-300 ease-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-700/60">
          <div className="space-y-1 min-w-0 flex-1">
            {badge && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${badge.color}`}>
                {badge.label}
              </span>
            )}
            <h2 className="text-white font-bold text-base leading-tight pr-2">
              {nodo?.titulo ?? ''}
            </h2>
            <p className="text-gray-400 text-xs">{nodo?.concepto ?? ''}</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all flex items-center justify-center text-sm ml-2"
          >
            ✕
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLocked ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3 text-center">
              <span className="text-4xl">🔒</span>
              <p className="text-gray-400 text-sm">Completa los nodos anteriores para desbloquear este.</p>
            </div>
          ) : (
            <>
              {/* Contenido del nodo */}
              {nodo && <NodeContentRenderer nodo={nodo} />}

              {/* XP badge */}
              {nodo && nodo.xpRecompensa > 0 && !lastFeedback && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400/60">
                  <span>⭐</span>
                  <span>+{nodo.xpRecompensa} XP al completar</span>
                </div>
              )}

              {/* Micro-evaluación */}
              {nodo && nodo.estado !== 'completado' && (
                <MicroEvalPanel
                  nodo={nodo}
                  feedback={lastFeedback}
                  isSubmitting={isSubmitting}
                  onSubmit={handleSubmitMicroEval}
                />
              )}

              {/* Si ya está completado */}
              {nodo?.estado === 'completado' && (
                <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-3 text-center">
                  <span className="text-green-400 text-sm font-bold">✅ Nodo completado</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — botones de acción */}
        {!isLocked && nodo?.estado !== 'completado' && (
          <div className="p-4 border-t border-gray-700/60 flex gap-2">
            <button
              onClick={handleSkip}
              className="flex-1 py-2.5 rounded-lg border border-gray-600 text-gray-400 text-sm hover:border-gray-400 hover:text-gray-200 transition-all"
            >
              Saltar →
            </button>
            <button
              onClick={handleComplete}
              disabled={!canComplete || isCompleted}
              className={`flex-[2] py-2.5 rounded-lg text-sm font-bold transition-all
                ${isCompleted ? 'bg-green-500 text-white scale-95' :
                  canComplete
                    ? 'bg-amber-500 text-black hover:bg-amber-400'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'}
              `}
            >
              {isCompleted ? '✓ Completado' :
               nodo?.tipoPedagogico === 'milestone' ? '🏆 Celebrar' :
               canComplete ? 'Continuar ✓' : 'Responde primero'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
