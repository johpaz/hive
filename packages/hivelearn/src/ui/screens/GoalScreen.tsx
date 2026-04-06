import { useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import { useLessonSwarm } from '../hooks/useLessonSwarm'

const SUGERENCIAS = [
  { emoji: '🟨', text: 'Quiero aprender JavaScript básico' },
  { emoji: '🐍', text: 'Aprenderme Python desde cero' },
  { emoji: '🤖', text: 'Entender qué es la inteligencia artificial' },
  { emoji: '🎨', text: 'Aprender HTML y CSS para crear páginas web' },
  { emoji: '🗃️', text: 'Entender SQL y bases de datos' },
  { emoji: '🌐', text: 'Aprender a hacer APIs con Node.js' },
  { emoji: '🎮', text: 'Quiero crear videojuegos sencillos' },
  { emoji: '📦', text: 'Aprender a usar Git y GitHub' },
  { emoji: '🔗', text: 'Entender cómo funciona Internet' },
  { emoji: '📱', text: 'Quiero hacer mi primera app móvil' },
]

// ─── Design Tokens ─────────────────────────────────────────────────────────
const dt = {
  surfaceDim:             '#0b1326',
  surfaceContainerLowest: '#060e20',
  surfaceContainerLow:    '#131b2e',
  surfaceContainerHigh:   '#222a3d',
  primary:                '#adc6ff',
  primaryContainer:       '#4d8eff',
  secondary:              '#ddb7ff',
  secondaryContainer:     '#6f00be',
  onSurface:              '#dae2fd',
  onSurfaceVariant:       '#c2c6d6',
  onPrimaryFixed:         '#001a42',
  outlineVariant:         '#424754',
}

// ─── GoalScreen ─────────────────────────────────────────────────────────────
export function GoalScreen() {
  const { perfil, setMeta, setScreen } = useLessonStore()
  const { generateLesson } = useLessonSwarm()
  const [meta, setMetaLocal] = useState('')
  const [isFocused, setIsFocused] = useState(false)

  const handleStart = async () => {
    if (!meta.trim() || !perfil) return
    setMeta(meta.trim())
    await generateLesson(perfil, meta.trim())
  }

  const handleSugerencia = (s: string) => setMetaLocal(s)

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ backgroundColor: dt.surfaceDim }}
    >
      {/* ══════════════════════════════════════════════
          LEFT PANEL — Atmospheric Visual
          (hidden on mobile — sidebar already present)
          ══════════════════════════════════════════════ */}
      <section
        className="relative hidden md:flex md:w-5/12 lg:w-[42%] overflow-hidden flex-col"
        style={{ backgroundColor: dt.surfaceContainerLowest }}
      >
        {/* Background artwork */}
        <div className="absolute inset-0 z-0">
          <img
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBMUREpKV8QsPXhDYP2w2gnatPE1oMbXvbnisHvxsXKW1A09Qg-9JrPzSIgWUh5CFkN-RsfMBfjsd4YvqZh9V91eY-NUCTpfkabjwNp-CWJnvLNv-WLHIBtYpsheV2Mdr0_IOD0fuMvZpz8-KIKtozeo_OC-7P-hq9sMcvxcW2_ziiAamb7MwCid-LPKVGFXo_n2C44jdqXHxlVgdDVwpDyz9afCwfUyTKnAL4Kz4R4loFI5_ZF8qfmJBMWultN3H9yORp6Sj5uktE"
            alt="Ethereal nebula — deep indigo space"
            className="w-full h-full object-cover"
            style={{ opacity: 0.5 }}
          />
          {/* Bottom fade into surface */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, ${dt.surfaceContainerLowest} 0%, ${dt.surfaceContainerLowest}55 30%, transparent 65%)`,
            }}
          />
          {/* Right edge blend into right panel */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to right, transparent 50%, ${dt.surfaceContainerLowest}cc 100%)`,
            }}
          />
        </div>

        {/* Ambient orbital orbs */}
        <div
          className="absolute top-1/3 left-1/4 w-72 h-72 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${dt.secondaryContainer}44 0%, transparent 70%)`,
            filter: 'blur(55px)',
          }}
        />
        <div
          className="absolute bottom-1/4 right-1/3 w-56 h-56 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${dt.primaryContainer}2a 0%, transparent 70%)`,
            filter: 'blur(45px)',
          }}
        />

        {/* ── Content — TOP aligned ── */}
        <div className="relative z-10 flex flex-col p-8 xl:p-10 pt-8 h-full">
          {/* HiveLearn branding — top */}
          <div className="flex items-center gap-3 mb-8">
            <div
              className="h-10 w-10 rounded-2xl flex items-center justify-center text-xl"
              style={{ backgroundColor: `${dt.primary}1a`, backdropFilter: 'blur(8px)' }}
            >
              🐝
            </div>
            <div>
              <p
                className="font-bold text-base tracking-tight leading-tight"
                style={{
                  color: dt.onSurface,
                  fontFamily: "'Manrope', 'Inter', sans-serif",
                }}
              >
                HiveLearn
              </p>
              <p
                className="text-[11px]"
                style={{ color: `${dt.onSurfaceVariant}70` }}
              >
                Aprendizaje adaptativo · 100% privado
              </p>
            </div>
          </div>

          {/* Agent badge */}
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 self-start"
            style={{
              backgroundColor: `${dt.secondaryContainer}2a`,
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: dt.secondary }}
            />
            <span
              className="text-sm font-medium tracking-wide"
              style={{
                color: dt.secondary,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              16 agentes listos para enseñarte
            </span>
          </div>

          {/* Main Headline */}
          <h1
            className="text-4xl xl:text-5xl font-extrabold leading-[1.07] mb-4"
            style={{
              fontFamily: "'Manrope', 'Inter', sans-serif",
              letterSpacing: '-0.02em',
              color: dt.onSurface,
            }}
          >
            Expande tu{' '}
            <span
              style={{
                background: `linear-gradient(135deg, ${dt.primary}, ${dt.secondary})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              horizonte.
            </span>
          </h1>

          {/* Subtitle */}
          <p
            className="text-base leading-relaxed max-w-xs"
            style={{ color: dt.onSurfaceVariant }}
          >
            Nuestra red neuronal de expertos está lista para sintetizar
            cualquier conocimiento para ti.
          </p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          RIGHT PANEL — Form / Action
          ══════════════════════════════════════════════ */}
      <main
        className="flex-1 flex flex-col overflow-y-auto"
        style={{ backgroundColor: dt.surfaceDim }}
      >
        {/* Inner content — TOP aligned, compact padding */}
        <div className="w-full max-w-lg mx-auto px-6 pt-8 pb-10 md:px-10 md:pt-8">

          {/* Greeting */}
          <header className="mb-8">
            <h2
              className="text-2xl md:text-3xl font-bold mb-1"
              style={{
                fontFamily: "'Manrope', 'Inter', sans-serif",
                color: dt.onSurface,
              }}
            >
              ¡Hola,{' '}
              <span
                style={{
                  background: `linear-gradient(135deg, ${dt.primary}, ${dt.primaryContainer})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {perfil?.nombre ?? 'alumno'}
              </span>
              ! 👋
            </h2>
            <p
              className="text-lg"
              style={{ color: dt.onSurfaceVariant }}
            >
              ¿Qué quieres aprender hoy?
            </p>
          </header>

          {/* Textarea with gradient glow */}
          <div className="relative mb-6">
            {/* Ambient glow ring */}
            <div
              className="absolute -inset-px rounded-2xl pointer-events-none transition-opacity duration-500"
              style={{
                background: `linear-gradient(135deg, ${dt.primary}44, ${dt.secondary}22)`,
                filter: 'blur(6px)',
                opacity: isFocused ? 1 : 0.2,
              }}
            />
            <textarea
              className="relative w-full min-h-[160px] rounded-2xl p-5 text-base leading-relaxed outline-none resize-none transition-all duration-300"
              style={{
                backgroundColor: dt.surfaceContainerLow,
                color: dt.onSurface,
                border: `1px solid ${isFocused ? `${dt.primary}55` : `${dt.outlineVariant}22`}`,
                boxShadow: isFocused
                  ? `0 0 0 3px ${dt.primary}0c, 0 6px 30px ${dt.primaryContainer}18`
                  : 'none',
                fontFamily: 'inherit',
              }}
              placeholder="Escribe tu meta de aprendizaje... Por ejemplo: 'Quiero entender los fundamentos de la mecánica cuántica' o 'Cómo crear una API con Node.js'"
              value={meta}
              onChange={e => setMetaLocal(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
            />
          </div>

          {/* Suggestion Pills */}
          <div className="space-y-3 mb-8">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ color: `${dt.onSurfaceVariant}77` }}
            >
              Sugerencias para ti
            </span>
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map(s => {
                const isSelected = meta === s.text
                return (
                  <button
                    key={s.text}
                    onClick={() => handleSugerencia(s.text)}
                    className="px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                    style={{
                      backgroundColor: isSelected
                        ? `${dt.primary}20`
                        : `${dt.surfaceContainerHigh}bb`,
                      color: isSelected ? dt.primary : dt.onSurfaceVariant,
                      border: isSelected
                        ? `1px solid ${dt.primary}44`
                        : `1px solid ${dt.outlineVariant}20`,
                      boxShadow: isSelected ? `0 0 14px ${dt.primary}18` : 'none',
                    }}
                  >
                    <span className="mr-1">{s.emoji}</span>
                    {s.text}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3">
            {/* Ghost back */}
            <button
              onClick={() => setScreen('profile')}
              className="px-5 py-3 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-95"
              style={{ color: dt.onSurfaceVariant }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = dt.onSurface
                ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = `${dt.surfaceContainerHigh}88`
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = dt.onSurfaceVariant
                ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
              }}
            >
              ← Atrás
            </button>

            {/* Primary CTA */}
            <button
              onClick={handleStart}
              disabled={!meta.trim()}
              className="px-8 py-3.5 rounded-full font-bold text-sm transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: `linear-gradient(135deg, ${dt.primary}, ${dt.primaryContainer})`,
                color: dt.onPrimaryFixed,
                boxShadow: `0 6px 24px ${dt.primary}28, 0 3px 10px ${dt.primaryContainer}33`,
                fontFamily: "'Manrope', sans-serif",
              }}
              onMouseEnter={e => {
                if (!meta.trim()) return
                ;(e.currentTarget as HTMLButtonElement).style.boxShadow =
                  `0 10px 36px ${dt.primary}44, 0 4px 14px ${dt.primaryContainer}44`
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.boxShadow =
                  `0 6px 24px ${dt.primary}28, 0 3px 10px ${dt.primaryContainer}33`
              }}
            >
              🐝 Iniciar Aprendizaje
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
