import { useState, useMemo } from 'react'
import type { NodoLesson, FeedbackOutput } from '../../types'
import { A2UIRenderer, A2UIFeedbackBanner } from '../a2ui/A2UIRenderer'
import { nodeToA2UI } from '../a2ui/nodeToA2UI'
import { useLessonStore } from '../store/lessonStore'
import { fetchWithAuth } from '../lib/fetchWithAuth'

// ─── Badges por tipo pedagógico ───────────────────────────────────────────────
const TIPO_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  concept:    { label: 'Concepto',   color: '#3b82f6', icon: '📖' },
  exercise:   { label: 'Ejercicio',  color: '#22c55e', icon: '✏️' },
  quiz:       { label: 'Quiz',       color: '#a855f7', icon: '❓' },
  challenge:  { label: 'Reto',       color: '#f59e0b', icon: '⚡' },
  milestone:  { label: 'Logro',      color: '#eab308', icon: '🏆' },
  evaluation: { label: 'Evaluación', color: '#ef4444', icon: '📝' },
}

interface Props {
  nodo: NodoLesson | null
  onClose: () => void
  onComplete: (nodo: NodoLesson, xpGanado: number) => void
}

export function NodeDetailPanel({ nodo, onClose, onComplete }: Props) {
  const { lastFeedback, setLastFeedback } = useLessonStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  const isOpen = nodo !== null

  // Generar mensajes A2UI a partir del nodo
  const a2uiMessages = useMemo(() => {
    if (!nodo) return []
    return nodeToA2UI(nodo)
  }, [nodo?.id, nodo?.contenido])

  // Handler de acciones A2UI (submit de micro-eval, check_answer, etc.)
  const handleA2UIAction = async ({ name, context }: { name: string; context: Record<string, any> }) => {
    if (name === 'check_answer' || name === 'submit_eval') {
      if (!nodo) return
      setIsSubmitting(true)
      try {
        // Extraer respuesta de las selecciones o texto
        let respuesta = context.respuesta ?? ''
        if (!respuesta && context._selections) {
          const firstSelection = Object.values(context._selections as Record<string, string[]>)[0]
          respuesta = firstSelection?.[0] ?? ''
        }
        if (!respuesta && context._textValues) {
          const firstText = Object.values(context._textValues as Record<string, string>)[0]
          respuesta = firstText ?? ''
        }

        const res = await fetchWithAuth('/api/hivelearn/feedback', {
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
  }

  const handleComplete = () => {
    if (!nodo) return
    const xp = lastFeedback?.xpGanado ?? nodo.xpRecompensa
    setIsCompleted(true)
    onComplete(nodo, xp)
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

  const cfg = nodo ? (TIPO_CONFIG[nodo.tipoPedagogico] ?? TIPO_CONFIG.concept) : null
  const isLocked = nodo?.estado === 'bloqueado'
  const isAlreadyDone = nodo?.estado === 'completado'
  const hasInteraction = nodo && ['exercise', 'quiz', 'challenge', 'evaluation'].includes(nodo.tipoPedagogico)
  const canComplete = !hasInteraction || !!lastFeedback || nodo?.tipoPedagogico === 'milestone'

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px]"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-40 flex flex-col"
        style={{
          width: '480px',
          maxWidth: '92vw',
          background: 'rgba(8,13,26,0.97)',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1.5">
              {cfg && (
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                    style={{
                      background: `${cfg.color}15`,
                      color: cfg.color,
                      border: `1px solid ${cfg.color}25`,
                    }}
                  >
                    {cfg.icon} {cfg.label}
                  </span>
                  {nodo?.xpRecompensa && nodo.xpRecompensa > 0 && (
                    <span className="text-[10px] font-bold text-amber-400/70">
                      ⭐ {nodo.xpRecompensa} XP
                    </span>
                  )}
                </div>
              )}
              <h2 className="text-white font-bold text-base leading-tight">
                {nodo?.titulo ?? ''}
              </h2>
              {nodo?.concepto && (
                <p className="text-[12px] text-white/35 leading-snug">{nodo.concepto}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-all text-sm"
            >
              ✕
            </button>
          </div>

          {/* Progress bar si el nodo tiene nivel */}
          {cfg && (
            <div className="mt-3 h-0.5 rounded-full" style={{ background: `${cfg.color}15` }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: isAlreadyDone ? '100%' : lastFeedback?.correcto ? '100%' : '0%',
                  background: cfg.color,
                }}
              />
            </div>
          )}
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLocked ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                🔒
              </div>
              <div className="space-y-1">
                <p className="text-white/60 font-semibold text-sm">Nodo bloqueado</p>
                <p className="text-white/25 text-xs">Completa los nodos anteriores para desbloquear este.</p>
              </div>
            </div>
          ) : isAlreadyDone ? (
            <>
              {/* Contenido de revisión (A2UI sin micro-eval) */}
              <A2UIRenderer messages={a2uiMessages} />
              <div
                className="rounded-2xl p-3.5 text-center"
                style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}
              >
                <span className="text-emerald-400 text-sm font-bold">✅ Nodo completado</span>
              </div>
            </>
          ) : (
            <>
              {/* Contenido A2UI dinámico */}
              <A2UIRenderer
                messages={a2uiMessages}
                onAction={handleA2UIAction}
                isLoading={a2uiMessages.length === 0}
                feedback={lastFeedback}
              />

              {/* Feedback banner (si hay respuesta evaluada) */}
              {lastFeedback && (
                <A2UIFeedbackBanner feedback={lastFeedback} />
              )}
            </>
          )}
        </div>

        {/* Footer — acciones */}
        {!isLocked && !isAlreadyDone && (
          <div
            className="flex-shrink-0 px-5 py-4 flex gap-2.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <button
              onClick={handleSkip}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white/40 hover:text-white/70 transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.07)' }}
            >
              Saltar
            </button>
            <button
              onClick={handleComplete}
              disabled={!canComplete || isCompleted || isSubmitting}
              className="flex-[2.5] py-2.5 rounded-xl text-sm font-bold transition-all disabled:cursor-not-allowed"
              style={{
                background: isCompleted
                  ? '#22c55e'
                  : canComplete
                  ? (cfg ? cfg.color : '#3b82f6')
                  : 'rgba(255,255,255,0.05)',
                color: canComplete || isCompleted ? 'white' : 'rgba(255,255,255,0.25)',
                border: !canComplete ? '1px solid rgba(255,255,255,0.07)' : 'none',
                opacity: isSubmitting ? 0.5 : 1,
                transform: isCompleted ? 'scale(0.97)' : 'scale(1)',
              }}
            >
              {isCompleted
                ? '✓ Completado'
                : nodo?.tipoPedagogico === 'milestone'
                ? '🏆 Celebrar'
                : canComplete
                ? 'Continuar →'
                : 'Responde primero'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
