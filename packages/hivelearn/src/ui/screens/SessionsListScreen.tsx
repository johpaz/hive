import { useEffect, useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import { fetchWithAuth } from '../lib/fetchWithAuth'
import type { LessonProgram, RangoEdad, EstiloAprendizaje, NivelPrevio } from '../../types'

interface SessionRow {
  session_id: string
  alumno_id: string
  curriculo_id: number
  xp_total: number
  nivel_alcanzado: string
  nodos_completados: number
  evaluacion_puntaje: number | null
  completada: number
  created_at: string
  meta: string
  total_nodos: number
  rango_edad: string
  nombre: string
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 60)  return `hace ${mins} min`
  if (hours < 24) return `hace ${hours} h`
  return `hace ${days} día${days !== 1 ? 's' : ''}`
}

export function SessionsListScreen() {
  const { reset, setScreen, restoreSession, sessionId: currentSessionId, program: currentProgram } = useLessonStore()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchSessions = async () => {
    try {
      const res = await fetchWithAuth('/api/hivelearn/sessions')
      const data = await res.json()
      setSessions(Array.isArray(data) ? data : [])
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSessions() }, [])

  const handleNew = () => {
    reset()
    setScreen('profile')
  }

  const handleContinue = async (session: SessionRow) => {
    setRestoring(session.session_id)
    try {
      // Si la sesión está en memoria (localStorage match), reutilizar
      if (currentSessionId === session.session_id && currentProgram) {
        setScreen(session.completada ? 'result' : 'canvas')
        return
      }

      // Cargar desde DB
      const res = await fetchWithAuth(`/api/hivelearn/sessions/${session.session_id}`)
      if (!res.ok) throw new Error('Session not found')
      const data = await res.json()

      const nodos = JSON.parse(data.nodos_json || '[]')
      const program: LessonProgram = {
        sessionId: data.session_id,
        alumnoId:  data.alumno_id,
        tema:      data.meta ?? '',
        topicSlug: data.topic_slug ?? null,
        rangoEdad: data.rango_edad,
        nodos,
        gamificacion: {
          xpRecompensa: data.xp_total ?? 0,
          logros: [],
          mensajeCelebracion: '¡Lección completada!',
        },
        evaluacion: { preguntas: [] },
        perfilAdaptacion: {
          rangoEdad:          (data.rango_edad ?? 'adulto') as RangoEdad,
          duracionSesion:     data.tiempo_sesion ?? 20,
          nodosRecomendados:  data.total_nodos ?? nodos.length,
          estilo:             (data.estilo ?? 'visual') as EstiloAprendizaje,
          nivelPrevio:        (data.nivel_previo ?? 'principiante') as NivelPrevio,
          tono:               'amigable',
        },
      }

      restoreSession(program, {
        sessionId:        data.session_id,
        xpTotal:          data.xp_total ?? 0,
        nodosCompletados: [],
      })

      // restoreSession ya hace setScreen('canvas'), pero si estaba completada vamos a result
      if (data.completada) setScreen('result')
    } catch (err) {
      console.error('[SessionsListScreen] handleContinue error:', err)
    } finally {
      setRestoring(null)
    }
  }

  const handleDelete = async (sessionId: string) => {
    if (!window.confirm('¿Eliminar esta sesión? No se puede deshacer.')) return
    setDeleting(sessionId)
    try {
      await fetchWithAuth(`/api/hivelearn/sessions/${sessionId}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.session_id !== sessionId))
    } catch {
      // silently fail
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950 p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🐝</span>
          <div>
            <h1 className="text-xl font-bold text-white">HiveLearn</h1>
            <p className="text-xs text-gray-500">Tus sesiones de aprendizaje</p>
          </div>
        </div>
        <button
          onClick={handleNew}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
        >
          + Nueva lección
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-3 animate-pulse">🐝</div>
            <p className="text-gray-400 text-sm">Cargando sesiones...</p>
          </div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-6xl">📚</div>
            <h2 className="text-lg font-bold text-white">Sin sesiones aún</h2>
            <p className="text-gray-500 text-sm">Crea tu primera lección personalizada</p>
            <button
              onClick={handleNew}
              className="px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-all"
            >
              + Nueva lección
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map(session => {
            const isCompleted = !!session.completada
            const progress = session.total_nodos > 0
              ? Math.round((session.nodos_completados / session.total_nodos) * 100)
              : 0
            const isBusy = restoring === session.session_id || deleting === session.session_id

            return (
              <div
                key={session.session_id}
                className="rounded-2xl bg-gray-900 border border-gray-800 p-5 flex flex-col gap-4 hover:border-gray-700 transition-colors"
              >
                {/* Status badge */}
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    isCompleted
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-blue-500/15 text-blue-400'
                  }`}>
                    {isCompleted ? '✅ Completada' : '🔵 En progreso'}
                  </span>
                  <span className="text-[11px] text-gray-600">{timeAgo(session.created_at)}</span>
                </div>

                {/* Topic */}
                <div>
                  <p className="text-white font-semibold text-sm leading-snug line-clamp-2">
                    {session.meta || 'Sin tema'}
                  </p>
                  <p className="text-gray-500 text-xs mt-1">{session.nombre || session.alumno_id}</p>
                </div>

                {/* Progress */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{session.nodos_completados}/{session.total_nodos} nodos</span>
                    {isCompleted && session.evaluacion_puntaje != null && (
                      <span className="text-amber-400 font-bold">{session.evaluacion_puntaje}%</span>
                    )}
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* XP */}
                <div className="flex items-center gap-1.5">
                  <span className="text-yellow-400 text-sm">⚡</span>
                  <span className="text-xs text-gray-400">{session.xp_total} XP · {session.nivel_alcanzado}</span>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-auto pt-2 border-t border-gray-800">
                  <button
                    onClick={() => handleContinue(session)}
                    disabled={isBusy}
                    className="flex-1 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {restoring === session.session_id
                      ? 'Cargando...'
                      : isCompleted ? 'Ver resultado' : 'Continuar'}
                  </button>
                  <button
                    onClick={() => handleDelete(session.session_id)}
                    disabled={isBusy}
                    className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs transition-colors disabled:opacity-50"
                    title="Eliminar sesión"
                  >
                    {deleting === session.session_id ? '...' : '🗑'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
