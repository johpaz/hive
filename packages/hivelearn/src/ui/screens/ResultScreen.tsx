import { useLessonStore } from '../store/lessonStore'
import { useGamification } from '../hooks/useGamification'

function getCalificacion(puntaje: number): { emoji: string; texto: string; color: string } {
  if (puntaje >= 90) return { emoji: '🏆', texto: '¡Excelente!', color: 'text-yellow-400' }
  if (puntaje >= 70) return { emoji: '⭐', texto: '¡Muy bien!', color: 'text-amber-400' }
  if (puntaje >= 50) return { emoji: '👍', texto: 'Bien hecho', color: 'text-blue-400' }
  return { emoji: '💪', texto: '¡Sigue practicando!', color: 'text-purple-400' }
}

export function ResultScreen() {
  const {
    program, perfil, puntajeEvaluacion, xpTotal,
    logrosDesbloqueados, nodosCompletados, tiempoInicioSesion, reset
  } = useLessonStore()
  const { nivelActual, formatXP } = useGamification()

  const puntaje = puntajeEvaluacion ?? 0
  const cal = getCalificacion(puntaje)
  const duracionMin = tiempoInicioSesion
    ? Math.round((Date.now() - tiempoInicioSesion) / 60000)
    : 0

  const logros = program?.gamificacion.logros.filter(l => logrosDesbloqueados.includes(l.id)) ?? []

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">

        {/* Resultado principal */}
        <div className="text-center space-y-3">
          <div className="text-6xl">{cal.emoji}</div>
          <h2 className={`text-3xl font-bold ${cal.color}`}>{cal.texto}</h2>
          <div className="text-6xl font-black text-white">{puntaje}%</div>
          <p className="text-gray-400 text-sm">{program?.gamificacion.mensajeCelebracion}</p>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'XP ganado', value: formatXP(xpTotal), emoji: '⚡' },
            { label: 'Nodo completado', value: `${nodosCompletados.length}/${program?.nodos.length ?? 0}`, emoji: '📚' },
            { label: 'Tiempo', value: `${duracionMin} min`, emoji: '⏱' },
          ].map(m => (
            <div key={m.label} className="rounded-xl bg-gray-900 border border-gray-800 p-3 text-center">
              <span className="text-2xl">{m.emoji}</span>
              <p className="text-sm font-bold text-white mt-1">{m.value}</p>
              <p className="text-xs text-gray-500">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Nivel */}
        <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-4 text-center">
          <p className="text-xs text-blue-400/70 uppercase tracking-widest">Nivel alcanzado</p>
          <p className="text-2xl font-black text-blue-400 mt-1">{nivelActual}</p>
        </div>

        {/* Logros */}
        {logros.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Logros desbloqueados</p>
            <div className="grid grid-cols-2 gap-2">
              {logros.map(logro => (
                <div key={logro.id} className="rounded-xl bg-gray-900 border border-gray-800 p-3 flex items-center gap-2">
                  <span className="text-2xl">{logro.emoji}</span>
                  <div>
                    <p className="text-xs font-bold text-white">{logro.nombre}</p>
                    <p className="text-[10px] text-gray-500">+{logro.xp} XP</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-500"
          >
            🐝 Nueva lección
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="flex-1 rounded-xl border border-gray-700 py-3 text-sm text-gray-400 hover:border-gray-500"
          >
            ← Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
