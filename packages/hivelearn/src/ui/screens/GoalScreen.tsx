import { useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import { useLessonSwarm } from '../hooks/useLessonSwarm'

const SUGERENCIAS = [
  'Quiero aprender JavaScript básico',
  'Aprenderme Python desde cero',
  'Entender qué es la inteligencia artificial',
  'Aprender HTML y CSS para crear páginas web',
  'Entender SQL y bases de datos',
  'Aprender a hacer APIs con Node.js',
]

export function GoalScreen() {
  const { perfil, setMeta, setScreen } = useLessonStore()
  const { generateLesson } = useLessonSwarm()
  const [meta, setMetaLocal] = useState('')

  const handleStart = async () => {
    if (!meta.trim() || !perfil) return
    setMeta(meta.trim())
    await generateLesson(perfil, meta.trim())
  }

  const handleSugerencia = (s: string) => {
    setMetaLocal(s)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white">
            ¡Hola, <span className="text-amber-400">{perfil?.nombre}</span>! 👋
          </h2>
          <p className="text-gray-400 mt-1">¿Qué quieres aprender hoy?</p>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-4">
          <textarea
            className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-sm focus:border-amber-500 outline-none resize-none h-24"
            placeholder="Ej: Quiero aprender JavaScript básico para crear mis primeros programas..."
            value={meta}
            onChange={e => setMetaLocal(e.target.value)}
          />

          {/* Sugerencias rápidas */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Sugerencias rápidas:</p>
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSugerencia(s)}
                  className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:border-amber-500/50 hover:text-amber-400 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setScreen('profile')}
              className="rounded-xl border border-gray-700 px-4 py-2.5 text-sm text-gray-400 hover:border-gray-500"
            >
              ← Atrás
            </button>
            <button
              onClick={handleStart}
              disabled={!meta.trim()}
              className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              🐝 ¡Empezar a aprender!
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
