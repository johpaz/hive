/**
 * Próxima corrida de una expresión cron, en la zona horaria del job.
 *
 * La búsqueda avanza **día por día** en el reloj de pared de la zona y, dentro
 * del día que casa, recorre las horas/minutos/segundos que casan. Podría
 * hacerse aritmética de campos con acarreo y sería algo más rápido, pero acá
 * cada job calcula esto una vez por corrida: la claridad vale más que los
 * microsegundos, y el acarreo es justo donde se esconden los errores de fin de
 * mes y de año bisiesto.
 *
 * Avanzar el día con `Date.UTC(y, m-1, d+1)` es deliberado: deja que el runtime
 * resuelva el largo de cada mes y los bisiestos, así que un 31 de febrero nunca
 * llega a probarse.
 */

import type { CronFields } from "./expression"
import { toInstant, toWallClock, wallClockWeekday, type WallClock } from "./zoned-time"

/**
 * Tope de la búsqueda.
 *
 * Hay expresiones válidas que no ocurren nunca: `0 0 30 2 *` —30 de febrero—
 * parsea bien y no casa jamás. Sin tope, buscarle la próxima corrida cuelga el
 * proceso. Cinco años cubre de sobra cualquier expresión que sí ocurra, incluida
 * la del 29 de febrero, que puede tardar hasta ocho.
 */
const MAX_DIAS = 366 * 8

/** ¿Casa el día (mes + día del mes/semana) según la semántica de `domAndDow`? */
function diaCasa(fields: CronFields, wall: WallClock, domAndDow: boolean): boolean {
  if (!fields.month.includes(wall.month)) return false

  const porMes = fields.dayOfMonth.includes(wall.day)
  const porSemana = fields.dayOfWeek.includes(wallClockWeekday(wall))

  // Ninguno de los dos restringe (`* *`): casa cualquier día.
  if (!fields.domRestricted && !fields.dowRestricted) return true

  // Los dos restringen: es el caso raro del cron clásico, donde por defecto la
  // lógica es O y no Y — `0 9 15 * 1` es "los 15 **o** los lunes". `domAndDow`
  // existe para pedir la otra.
  if (fields.domRestricted && fields.dowRestricted) {
    return domAndDow ? porMes && porSemana : porMes || porSemana
  }

  return fields.domRestricted ? porMes : porSemana
}

/** Las horas del día que casan, de la más temprana a la más tarde, desde un piso. */
function* horasDelDia(
  fields: CronFields,
  piso: { hour: number; minute: number; second: number } | null,
): Generator<{ hour: number; minute: number; second: number }> {
  for (const hour of fields.hour) {
    if (piso && hour < piso.hour) continue
    for (const minute of fields.minute) {
      if (piso && hour === piso.hour && minute < piso.minute) continue
      for (const second of fields.second) {
        if (piso && hour === piso.hour && minute === piso.minute && second < piso.second) continue
        yield { hour, minute, second }
      }
    }
  }
}

/** El día siguiente en el calendario, a las 00:00:00. */
function diaSiguiente(wall: WallClock): WallClock {
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  }
}

export interface NextOccurrenceOptions {
  timeZone: string
  domAndDow?: boolean
}

/**
 * La próxima vez que la expresión casa, **estrictamente después** de `from`.
 * `null` si no ocurre dentro del horizonte de búsqueda.
 */
export function nextOccurrence(
  fields: CronFields,
  from: Date,
  opts: NextOccurrenceOptions,
): Date | null {
  const { timeZone, domAndDow = false } = opts

  // Un segundo después: sin esto, pedirle la próxima corrida a un job justo
  // cuando acaba de correr devolvería el mismo instante y el scheduler se
  // reprogramaría con demora cero, en bucle.
  let cursor = toWallClock(new Date(from.getTime() + 1000), timeZone)
  let piso: { hour: number; minute: number; second: number } | null = {
    hour: cursor.hour,
    minute: cursor.minute,
    second: cursor.second,
  }

  for (let dia = 0; dia < MAX_DIAS; dia++) {
    if (diaCasa(fields, cursor, domAndDow)) {
      for (const hora of horasDelDia(fields, piso)) {
        const instante = toInstant({ ...cursor, ...hora }, timeZone)
        // `null` = esa hora no existe hoy en esta zona porque el reloj saltó
        // hacia adelante. Se prueba la siguiente que casa en vez de inventar un
        // instante: correr "a las 2:30" el día que 2:30 no existió sería correr
        // a una hora que nadie agendó.
        if (instante) return instante
      }
    }
    cursor = diaSiguiente(cursor)
    piso = null
  }

  return null
}
