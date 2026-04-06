import { useCallback } from 'react'
import { useLessonStore } from '../store/lessonStore'
import type { RangoEdad } from '../../types'

const NIVELES = ['Aprendiz', 'Explorador', 'Practicante', 'Experto', 'Maestro', 'Leyenda']

function calcNivel(xp: number): string {
  if (xp < 50)   return NIVELES[0]
  if (xp < 150)  return NIVELES[1]
  if (xp < 300)  return NIVELES[2]
  if (xp < 500)  return NIVELES[3]
  if (xp < 800)  return NIVELES[4]
  return NIVELES[5]
}

function mensajeXP(xp: number, rangoEdad: RangoEdad): string {
  if (rangoEdad === 'nino') return `¡${xp} gotas de miel! 🍯`
  if (rangoEdad === 'adolescente') return `+${xp} XP 🔥`
  return `${xp} puntos ganados`
}

export function useGamification() {
  const { xpTotal, logrosDesbloqueados, program, desbloquearLogro } = useLessonStore()

  const nivelActual = calcNivel(xpTotal)
  const rangoEdad = program?.rangoEdad ?? 'adulto'

  const checkLogros = useCallback(() => {
    if (!program?.gamificacion.logros) return
    for (const logro of program.gamificacion.logros) {
      if (!logrosDesbloqueados.includes(logro.id)) {
        desbloquearLogro(logro.id)
      }
    }
  }, [program, logrosDesbloqueados, desbloquearLogro])

  const formatXP = (xp: number) => mensajeXP(xp, rangoEdad)

  const porcentajeNivel = (): number => {
    if (xpTotal < 50)  return (xpTotal / 50) * 100
    if (xpTotal < 150) return ((xpTotal - 50) / 100) * 100
    if (xpTotal < 300) return ((xpTotal - 150) / 150) * 100
    if (xpTotal < 500) return ((xpTotal - 300) / 200) * 100
    if (xpTotal < 800) return ((xpTotal - 500) / 300) * 100
    return 100
  }

  return { xpTotal, nivelActual, rangoEdad, logrosDesbloqueados, checkLogros, formatXP, porcentajeNivel }
}
