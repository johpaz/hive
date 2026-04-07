import { useState, useMemo } from 'react'
import type { NodoLesson, FeedbackOutput } from '../../types'
import { A2UIRenderer, A2UIFeedbackBanner } from '../a2ui/A2UIRenderer'
import { nodeToA2UI } from '../a2ui/nodeToA2UI'
import { useLessonStore } from '../store/lessonStore'

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
  position: { left: number; top: number } | null
  onClose: () => void
  onComplete: (nodo: NodoLesson, xpGanado: number) => void
}

export function NodeContentPopover({ nodo, position, onClose, onComplete }: Props) {
  const { lastFeedback, setLastFeedback } = useLessonStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  const isOpen = nodo !== null && position !== null

  const a2uiMessages = useMemo(() => {
    if (!nodo) return []
    return nodeToA2UI(nodo)
  }, [nodo?.id, nodo?.contenido])

  const handleA2UIAction = async ({ name, context }: { name: string; context: Record<string, any> }) => {
    if (name === 'play_audio') {
      if (!('speechSynthesis' in window)) return
      window.speechSynthesis.cancel()
      const utt = new SpeechSynthesisUtterance(context.narration_text ?? '')
      const speedMap: Record<string, number> = { slow: 0.8, normal: 1.0, fast: 1.3 }
      utt.rate = speedMap[context.speed ?? 'normal'] ?? 1.0
      utt.lang = 'es-ES'
      window.speechSynthesis.speak(utt)
      return
    }
    if (name === 'check_answer' || name === 'submit_eval') {
      if (!nodo) return
      setIsSubmitting(true)
      try {
        let respuesta = context.respuesta ?? ''
        if (!respuesta && context._selections) {
          const first = Object.values(context._selections as Record<string, string[]>)[0]
          respuesta = first?.[0] ?? ''
        }
        if (!respuesta && context._textValues) {
          const first = Object.values(context._textValues as Record<string, string>)[0]
          respuesta = first ?? ''
        }
        const { sessionId } = useLessonStore.getState()
        const res = await fetch('/api/hivelearn/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
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
    }, 500)
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
      {/* Canvas backdrop — dims el grafo sin bloquear el canvas */}
      {isOpen && (
        <div
          className="absolute inset-0 z-30"
          style={{ background: 'rgba(8,13,26,0.55)', backdropFilter: 'blur(1px)' }}
          onClick={onClose}
        />
      )}

      {/* Popover anclado al nodo */}
      <div
        className="absolute z-40 flex flex-col"
        style={{
          left: position?.left ?? 0,
          top: position?.top ?? 0,
          width: '460px',
          maxHeight: '75vh',
          // Animación de entrada
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(8px)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
          pointerEvents: isOpen ? 'auto' : 'none',
          // Estilo del popover
          background: 'rgba(8,13,26,0.97)',
          border: cfg ? `1px solid ${cfg.color}22` : '1px solid rgba(255,255,255,0.07)',
          borderRadius: '20px',
          boxShadow: cfg
            ? `0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px ${cfg.color}10, 0 0 40px ${cfg.color}08`
            : '0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Línea de color en el top */}
        {cfg && (
          <div
            style={{ height: '3px', background: cfg.color, borderRadius: '20px 20px 0 0', opacity: 0.7 }}
          />
        )}

        {/* Header */}
        <div
          className="flex-shrink-0 px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1.5">
              {cfg && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                    style={{ background: `${cfg.color}15`, color: cfg.color, border: `1px solid ${cfg.color}25` }}
                  >
                    {cfg.icon} {cfg.label}
                  </span>
                  {nodo?.xpRecompensa && nodo.xpRecompensa > 0 && (
                    <span className="text-[10px] font-bold text-amber-400/70">
                      ⭐ {nodo.xpRecompensa} XP
                    </span>
                  )}
                  {isAlreadyDone && (
                    <span className="text-[10px] font-bold text-emerald-400/70 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
                      ✅ Completado
                    </span>
                  )}
                </div>
              )}
              <h2 className="text-white font-bold text-[15px] leading-tight">
                {nodo?.titulo ?? ''}
              </h2>
              {nodo?.concepto && (
                <p className="text-[11px] text-white/35 leading-snug">{nodo.concepto}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-white/35 hover:text-white/80 hover:bg-white/5 transition-all text-sm"
            >
              ✕
            </button>
          </div>

          {/* Barra de progreso */}
          {cfg && (
            <div className="mt-3 h-0.5 rounded-full" style={{ background: `${cfg.color}12` }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: isAlreadyDone || lastFeedback?.correcto ? '100%' : '0%',
                  background: cfg.color,
                }}
              />
            </div>
          )}
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {isLocked ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-3 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                🔒
              </div>
              <p className="text-white/50 font-semibold text-sm">Nodo bloqueado</p>
              <p className="text-white/25 text-xs">Completa los nodos anteriores primero.</p>
            </div>
          ) : (
            <>
              <A2UIRenderer
                messages={a2uiMessages}
                onAction={handleA2UIAction}
                isLoading={a2uiMessages.length === 0}
                feedback={lastFeedback}
              />
              {lastFeedback && <A2UIFeedbackBanner feedback={lastFeedback} />}
              {isAlreadyDone && !lastFeedback && (
                <div
                  className="rounded-2xl p-3 text-center"
                  style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.18)' }}
                >
                  <span className="text-emerald-400 text-sm font-semibold">✅ Ya completaste este nodo</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
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
                  ? (cfg?.color ?? '#3b82f6')
                  : 'rgba(255,255,255,0.05)',
                color: canComplete || isCompleted ? 'white' : 'rgba(255,255,255,0.25)',
                border: !canComplete ? '1px solid rgba(255,255,255,0.07)' : 'none',
                opacity: isSubmitting ? 0.5 : 1,
                transform: isCompleted ? 'scale(0.97)' : undefined,
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
