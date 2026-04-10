/**
 * RatingModal — Se muestra al completar la lección final.
 * Permite al alumno calificar de 1-5 estrellas y dejar un comentario.
 */
import { useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import { fetchWithAuth } from '../lib/fetchWithAuth'

interface Props {
  onClose: () => void
}

export function RatingModal({ onClose }: Props) {
  const { sessionId } = useLessonStore()
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comentario, setComentario] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!rating || !sessionId) { onClose(); return }
    setSubmitting(true)
    try {
      await fetchWithAuth('/api/hivelearn/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, rating, comentario: comentario.trim() || undefined }),
      })
      setSubmitted(true)
      setTimeout(onClose, 1800)
    } catch {
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const displayRating = hovered || rating

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(8,13,26,0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative flex flex-col items-center gap-5 rounded-3xl px-8 py-8 w-full max-w-sm"
        style={{
          background: 'rgba(8,13,26,0.97)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        }}
      >
        {submitted ? (
          <>
            <span className="text-5xl">🎉</span>
            <p className="text-white font-bold text-lg text-center">¡Gracias por tu calificación!</p>
            <p className="text-white/40 text-sm text-center">Esto nos ayuda a mejorar la experiencia.</p>
          </>
        ) : (
          <>
            {/* Trophy */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl">🏆</span>
              <h2 className="text-white font-bold text-xl">¡Lección completada!</h2>
              <p className="text-white/40 text-sm text-center">¿Cómo fue tu experiencia de aprendizaje?</p>
            </div>

            {/* Stars */}
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(0)}
                  className="text-3xl transition-transform hover:scale-110 active:scale-95"
                  style={{ filter: n <= displayRating ? 'none' : 'grayscale(1) opacity(0.3)' }}
                >
                  ⭐
                </button>
              ))}
            </div>

            {rating > 0 && (
              <p className="text-white/50 text-xs -mt-2">
                {['', '¡Puedes mejorar!', 'Regular', 'Bien', 'Muy bien', '¡Excelente!'][rating]}
              </p>
            )}

            {/* Comentario */}
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Comentario opcional... ¿qué mejorarías?"
              maxLength={200}
              rows={2}
              className="w-full text-xs text-white/70 rounded-xl px-3 py-2 resize-none outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            />

            {/* Buttons */}
            <div className="flex gap-2.5 w-full">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm text-white/35 hover:text-white/60 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.07)' }}
              >
                Omitir
              </button>
              <button
                onClick={handleSubmit}
                disabled={!rating || submitting}
                className="flex-[2] py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                style={{ background: rating ? '#3b82f6' : 'rgba(255,255,255,0.05)' }}
              >
                {submitting ? 'Guardando...' : 'Enviar calificación'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
