import { useState } from 'react'
import { useLessonStore } from '../store/lessonStore'
import type { StudentProfile, RangoEdad, NivelPrevio, EstiloAprendizaje } from '../../types'

function calcRangoEdad(edad: number): RangoEdad {
  if (edad <= 12) return 'nino'
  if (edad <= 17) return 'adolescente'
  return 'adulto'
}

// ─── Design Tokens — "Digital Nocturne / Luminous Scholar" ──────────────────
const dt = {
  surfaceDim:             '#0b1326',
  surfaceContainerLowest: '#060e20',
  surfaceContainerLow:    '#131b2e',
  surfaceContainerHigh:   '#222a3d',
  surfaceContainerHighest:'#2d3449',
  primary:                '#adc6ff',
  primaryContainer:       '#4d8eff',
  secondary:              '#ddb7ff',
  secondaryContainer:     '#6f00be',
  onSurface:              '#dae2fd',
  onSurfaceVariant:       '#c2c6d6',
  onPrimaryFixed:         '#001a42',
  onPrimaryContainer:     '#00285d',
  outlineVariant:         '#424754',
  outline:                '#8c909f',
}

// ─── Left Brand Panel ────────────────────────────────────────────────────────
function BrandPanel() {
  return (
    <section
      className="flex w-[38%] xl:w-[40%] relative overflow-hidden flex-shrink-0 flex-col justify-between p-10 xl:p-12"
      style={{ backgroundColor: dt.surfaceContainerLowest }}
    >
      {/* Background orbs */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div
          className="absolute top-[-10%] right-[-10%] w-4/5 h-4/5 rounded-full"
          style={{
            background: `radial-gradient(circle, ${dt.primary}1a 0%, transparent 70%)`,
            filter: 'blur(120px)',
          }}
        />
        <div
          className="absolute bottom-[-10%] left-[-10%] w-3/5 h-3/5 rounded-full"
          style={{
            background: `radial-gradient(circle, ${dt.secondary}1a 0%, transparent 70%)`,
            filter: 'blur(100px)',
          }}
        />
        {/* Artwork */}
        <img
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuBGkgnfwJu1-vMqP18oBByE9qATAqmHAP3bSVLJ3EbK2jMB_AzAJgpyhYwBp5H5qcaJ7yjI-KwcyJtKLA1Jrvr4ETMSd-rkoqNfZws67nyBf_Plr9drWFQ5eGXP6asG_25PI6ihYhrKTqcUqaLpHdaMQNPKOOoPzJGAEddbDCawKI32IcTMgTeNusNLroHRO5mU90Ay0u0A-rAXYpNXUU9-AY2WhGSjsjhkaaVWlW9KxVrCPRJkN7rPGutl7bQtxPJCOmu23Icx224"
          alt="Abstract 3D digital sculpture of interconnected glowing nodes"
          className="w-full h-full object-cover scale-110"
          style={{ opacity: 0.35, mixBlendMode: 'lighten' }}
        />
        {/* Right blend to merge with form panel */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to right, transparent 55%, ${dt.surfaceContainerLowest}ee 100%)`,
          }}
        />
      </div>

      {/* Top — Logo */}
      <div className="relative z-10 flex items-center gap-2">
        <span
          className="text-2xl font-extrabold tracking-tight"
          style={{
            fontFamily: "'Manrope', 'Inter', sans-serif",
            color: dt.onSurface,
          }}
        >
          🐝 HiveLearn
        </span>
      </div>

      {/* Center — Value proposition */}
      <div className="relative z-10 max-w-sm">
        <h2
          className="text-4xl font-extrabold leading-tight mb-6"
          style={{
            fontFamily: "'Manrope', 'Inter', sans-serif",
            color: dt.onSurface,
            letterSpacing: '-0.02em',
          }}
        >
          Eleva tu{' '}
          <span style={{ color: dt.primary }}>curiosidad</span>{' '}
          al siguiente nivel.
        </h2>
        <p
          className="text-lg leading-relaxed font-light"
          style={{ color: dt.onSurfaceVariant }}
        >
          Únete a la red de conocimiento más avanzada, diseñada para
          adaptarse a tu ritmo y estilo único de aprendizaje.
        </p>
      </div>

      {/* Bottom — Footer badge */}
      <div
        className="relative z-10 flex items-center gap-3 text-sm font-medium"
        style={{ color: `${dt.onSurfaceVariant}77` }}
      >
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: dt.secondary }}
        />
        Digital Nocturne Experience v1.0
      </div>
    </section>
  )
}

// ─── ProfileScreen ───────────────────────────────────────────────────────────
export function ProfileScreen() {
  const { setPerfil, setScreen } = useLessonStore()

  const [form, setForm] = useState({
    nombre: '',
    edad: 16,
    tiempoSesion: 30 as 15 | 30 | 45,
    nivelPrevio: 'principiante' as NivelPrevio,
    estilo: 'balanceado' as EstiloAprendizaje,
  })

  const [focusedField, setFocusedField] = useState<string | null>(null)

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

  const rango = calcRangoEdad(form.edad)
  const rangoEmoji =
    rango === 'nino' ? '🐣' : rango === 'adolescente' ? '🚀' : '🎯'
  const rangoLabel =
    rango === 'nino' ? 'Niño' : rango === 'adolescente' ? 'Adolescente' : 'Adulto'

  // Shared input ring style
  const inputStyle = (id: string) => ({
    backgroundColor: dt.surfaceContainerLowest,
    border: 'none',
    outline: 'none',
    boxShadow: focusedField === id
      ? `0 0 0 2px ${dt.primary}`
      : `0 0 0 1px ${dt.outlineVariant}33`,
    color: dt.onSurface,
    transition: 'box-shadow 200ms ease',
  })

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ backgroundColor: dt.surfaceDim }}
    >
      {/* Left brand panel */}
      <BrandPanel />

      {/* ── Right: Onboarding Form (60%) ── */}
      <section
        className="w-full lg:w-[60%] flex flex-col overflow-y-auto"
        style={{ backgroundColor: dt.surfaceDim }}
      >
        <div className="w-full max-w-xl mx-auto px-6 pt-8 pb-10 sm:px-10 sm:pt-10">

          {/* Mobile logo */}
          <div
            className="hidden"
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 700,
              fontSize: '1.25rem',
              color: dt.onSurface,
            }}
          >
            🐝 <span>HiveLearn</span>
          </div>

          {/* Header */}
          <header className="mb-10">
            <h1
              className="text-3xl md:text-4xl font-black tracking-tight mb-3"
              style={{
                fontFamily: "'Manrope', 'Inter', sans-serif",
                color: dt.onSurface,
                letterSpacing: '-0.02em',
              }}
            >
              ¿Quién va a aprender hoy?
            </h1>
            <p
              className="text-base md:text-lg"
              style={{ color: dt.onSurfaceVariant }}
            >
              Configura tu perfil de Scholar para comenzar la exploración.
            </p>
          </header>

          {/* ── Glass form card ── */}
          <div
            className="rounded-2xl p-7 sm:p-9 space-y-7"
            style={{
              backgroundColor: `${dt.surfaceContainerLow}99`,
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: `0 0 60px -12px ${dt.primary}1f`,
            }}
          >
            {/* ── Row 1: Nombre + Edad ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Nombre */}
              <div className="space-y-2">
                <label
                  className="block text-xs font-bold uppercase tracking-widest"
                  style={{ color: dt.primary, fontFamily: "'Inter', sans-serif" }}
                >
                  Nombre del Scholar
                </label>
                <input
                  className="w-full rounded-xl px-4 py-3 text-sm placeholder:text-opacity-40 transition-all"
                  style={{
                    ...inputStyle('nombre'),
                    fontFamily: 'inherit',
                  }}
                  placeholder="Ej. Alex Rivera"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  onFocus={() => setFocusedField('nombre')}
                  onBlur={() => setFocusedField(null)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              {/* Edad */}
              <div className="space-y-2">
                <label
                  className="block text-xs font-bold uppercase tracking-widest"
                  style={{ color: dt.primary, fontFamily: "'Inter', sans-serif" }}
                >
                  Edad
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={6}
                    max={60}
                    value={form.edad}
                    onChange={e => setForm(f => ({ ...f, edad: Number(e.target.value) }))}
                    className="flex-1"
                    style={{ accentColor: dt.primary }}
                  />
                  <div
                    className="text-right flex-shrink-0"
                    style={{ minWidth: '72px' }}
                  >
                    <p
                      className="text-sm font-bold"
                      style={{ color: dt.primary }}
                    >
                      {form.edad} años
                    </p>
                    <p
                      className="text-[10px]"
                      style={{ color: dt.onSurfaceVariant }}
                    >
                      {rangoEmoji} {rangoLabel}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Row 2: Tiempo de sesión + Nivel ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Tiempo de sesión */}
              <div className="space-y-2">
                <label
                  className="block text-xs font-bold uppercase tracking-widest"
                  style={{ color: dt.primary, fontFamily: "'Inter', sans-serif" }}
                >
                  Tiempo de Sesión
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([15, 30, 45] as const).map(t => {
                    const active = form.tiempoSesion === t
                    return (
                      <button
                        key={t}
                        onClick={() => setForm(f => ({ ...f, tiempoSesion: t }))}
                        className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                        style={{
                          backgroundColor: active
                            ? `${dt.primary}22`
                            : `${dt.surfaceContainerHighest}66`,
                          color: active ? dt.primary : dt.onSurfaceVariant,
                          boxShadow: active
                            ? `0 0 0 1px ${dt.primary}55, 0 0 14px ${dt.primary}18`
                            : `0 0 0 1px ${dt.outlineVariant}20`,
                        }}
                      >
                        {t} min
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Nivel de experiencia */}
              <div className="space-y-2">
                <label
                  className="block text-xs font-bold uppercase tracking-widest"
                  style={{ color: dt.primary, fontFamily: "'Inter', sans-serif" }}
                >
                  Experiencia Previa
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['principiante', '🌱', 'Explorador'],
                    ['principiante_base', '🌿', 'Practicante'],
                    ['intermedio', '🌳', 'Maestro'],
                  ] as const).map(([val, emoji, label]) => {
                    const active = form.nivelPrevio === val
                    return (
                      <button
                        key={val}
                        onClick={() => setForm(f => ({ ...f, nivelPrevio: val }))}
                        className="py-3 rounded-xl text-xs font-medium flex flex-col items-center gap-1 transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                        style={{
                          backgroundColor: active
                            ? `${dt.secondaryContainer}22`
                            : `${dt.surfaceContainerHighest}66`,
                          color: active ? dt.secondary : dt.onSurfaceVariant,
                          boxShadow: active
                            ? `0 0 0 1px ${dt.secondary}55`
                            : `0 0 0 1px ${dt.outlineVariant}18`,
                        }}
                      >
                        <span className="text-lg">{emoji}</span>
                        <span>{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── Estilo de Aprendizaje ── */}
            <div className="space-y-3">
              <label
                className="block text-xs font-bold uppercase tracking-widest"
                style={{ color: dt.primary, fontFamily: "'Inter', sans-serif" }}
              >
                Estilo de Aprendizaje
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  ['visual', '🎨', 'Visual'],
                  ['lectura', '📖', 'Leyendo'],
                  ['retos', '🏆', 'Con retos'],
                  ['balanceado', '⚖️', 'Balanceado'],
                ] as const).map(([val, emoji, label]) => {
                  const active = form.estilo === val
                  return (
                    <button
                      key={val}
                      onClick={() => setForm(f => ({ ...f, estilo: val }))}
                      className="flex flex-col items-center justify-center p-4 rounded-xl text-xs font-semibold transition-all duration-300 group hover:-translate-y-0.5 active:scale-95"
                      style={{
                        backgroundColor: active
                          ? `${dt.secondaryContainer}22`
                          : `${dt.surfaceContainerHighest}44`,
                        color: active ? dt.secondary : dt.onSurfaceVariant,
                        boxShadow: active
                          ? `0 0 0 1px ${dt.secondary}77, 0 0 18px ${dt.secondary}14`
                          : `0 0 0 1px ${dt.outlineVariant}18`,
                      }}
                    >
                      <span
                        className="text-2xl mb-2 transition-transform duration-300 group-hover:scale-110"
                        style={{ display: 'block' }}
                      >
                        {emoji}
                      </span>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── CTA ── */}
            <div className="pt-2">
              <button
                onClick={handleSubmit}
                disabled={!form.nombre.trim()}
                className="w-full py-4 px-8 rounded-full font-bold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:scale-[1.02] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{
                  background: `linear-gradient(135deg, ${dt.primary}, ${dt.primaryContainer})`,
                  color: dt.onPrimaryFixed,
                  boxShadow: `0 8px 30px ${dt.primary}2a, 0 4px 12px ${dt.primaryContainer}33`,
                  fontFamily: "'Manrope', 'Inter', sans-serif",
                }}
                onMouseEnter={e => {
                  if (!form.nombre.trim()) return
                  ;(e.currentTarget as HTMLButtonElement).style.boxShadow =
                    `0 12px 40px ${dt.primary}44, 0 4px 16px ${dt.primaryContainer}44`
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.boxShadow =
                    `0 8px 30px ${dt.primary}2a, 0 4px 12px ${dt.primaryContainer}33`
                }}
              >
                Comenzar Expedición
                <span aria-hidden>→</span>
              </button>
            </div>
          </div>

          {/* ── Step Indicator ── */}
          <div className="mt-8 flex items-center justify-center gap-8">
            {/* Step 1 — Active */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: dt.primary,
                  boxShadow: `0 0 0 4px ${dt.primary}33`,
                }}
              />
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: dt.primary }}
              >
                Perfil
              </span>
            </div>
            <div
              className="w-12 h-px"
              style={{ backgroundColor: `${dt.outlineVariant}33` }}
            />
            {/* Step 2 */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: `${dt.outlineVariant}55` }}
              />
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: `${dt.onSurfaceVariant}55` }}
              >
                Intereses
              </span>
            </div>
            <div
              className="w-12 h-px"
              style={{ backgroundColor: `${dt.outlineVariant}33` }}
            />
            {/* Step 3 */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: `${dt.outlineVariant}55` }}
              />
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: `${dt.onSurfaceVariant}55` }}
              >
                Plan
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Floating orb — decorative */}
      <div
        className="fixed bottom-8 right-8 w-16 h-16 rounded-full pointer-events-none animate-pulse"
        style={{
          background: `radial-gradient(circle, ${dt.secondary}, ${dt.secondaryContainer})`,
          filter: 'blur(24px)',
          opacity: 0.35,
        }}
      />
    </div>
  )
}
