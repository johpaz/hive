import { useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import type { StudentProfile, RangoEdad, NivelPrevio, EstiloAprendizaje } from '../../types'

function calcRangoEdad(edad: number): RangoEdad {
  if (edad <= 12) return 'nino'
  if (edad <= 17) return 'adolescente'
  return 'adulto'
}

export function ProfileScreen() {
  const { setPerfil, setScreen } = useLessonStore()

  const [form, setForm] = useState({
    nombre: '',
    edad: 16,
    tiempoSesion: 30 as 15 | 30 | 45,
    nivelPrevio: 'principiante' as NivelPrevio,
    estilo: 'balanceado' as EstiloAprendizaje,
  })

  const handleSubmit = () => {
    if (!form.nombre.trim()) return
    const perfil: StudentProfile = {
      alumnoId: `alumno-${Date.now()}`,
      nombre: form.nombre.trim(),
      edad: form.edad,
      rangoEdad: calcRangoEdad(form.edad),
      tiempoSesion: form.tiempoSesion,
      nivelPrevio: form.nivelPrevio,
      estilo: form.estilo,
      sesionesTotal: 0,
      xpAcumulado: 0,
      nivelActual: 'Aprendiz',
    }
    setPerfil(perfil)
    setScreen('goal')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🐝</div>
          <h1 className="text-3xl font-bold text-amber-400">HiveLearn</h1>
          <p className="text-gray-400 mt-1">Aprendizaje adaptativo, 100% offline</p>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-5">
          <h2 className="text-lg font-bold text-white">¿Quién va a aprender hoy?</h2>

          {/* Nombre */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tu nombre</label>
            <input
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
              placeholder="Ej: Valeria"
              value={form.nombre}
              onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          {/* Edad */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Edad: <span className="text-amber-400 font-bold">{form.edad} años</span>
              {' '}({calcRangoEdad(form.edad) === 'nino' ? '🐣 Niño' : calcRangoEdad(form.edad) === 'adolescente' ? '🚀 Adolescente' : '🎯 Adulto'})
            </label>
            <input
              type="range" min={6} max={60} value={form.edad}
              onChange={e => setForm(f => ({ ...f, edad: Number(e.target.value) }))}
              className="w-full accent-amber-500"
            />
          </div>

          {/* Tiempo de sesión */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">Tiempo disponible</label>
            <div className="flex gap-2">
              {([15, 30, 45] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setForm(f => ({ ...f, tiempoSesion: t }))}
                  className={`flex-1 rounded-lg py-2 text-sm font-bold border transition-all
                    ${form.tiempoSesion === t
                      ? 'bg-amber-500 border-amber-500 text-black'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-amber-500/50'}`}
                >
                  {t} min
                </button>
              ))}
            </div>
          </div>

          {/* Nivel */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">Nivel de experiencia</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['principiante', '🌱', 'Principiante'],
                ['principiante_base', '🌿', 'Con bases'],
                ['intermedio', '🌳', 'Intermedio'],
              ] as const).map(([val, emoji, label]) => (
                <button
                  key={val}
                  onClick={() => setForm(f => ({ ...f, nivelPrevio: val }))}
                  className={`rounded-lg py-2 text-xs font-medium border transition-all
                    ${form.nivelPrevio === val
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  <span className="block text-lg">{emoji}</span>{label}
                </button>
              ))}
            </div>
          </div>

          {/* Estilo */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">¿Cómo aprendes mejor?</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['visual', '🎨', 'Visual'],
                ['lectura', '📖', 'Leyendo'],
                ['retos', '🏆', 'Con retos'],
                ['balanceado', '⚖️', 'Balanceado'],
              ] as const).map(([val, emoji, label]) => (
                <button
                  key={val}
                  onClick={() => setForm(f => ({ ...f, estilo: val }))}
                  className={`rounded-lg py-2 text-xs font-medium border transition-all flex items-center gap-2 px-3
                    ${form.estilo === val
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  <span>{emoji}</span>{label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!form.nombre.trim()}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Continuar →
          </button>
        </div>
      </div>
    </div>
  )
}
