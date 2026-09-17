/**
 * Reloj de pared ↔ instante, en una zona horaria IANA.
 *
 * Es la parte difícil de un cron con zona horaria y la razón por la que no
 * alcanza con `Bun.cron.parse()`, que resuelve en una sola zona —UTC hasta Bun
 * 1.3, la local del proceso desde 1.4— y nunca en la del job. "Todos los días a
 * las 9" significa las 9 **del reloj de la pared en Bogotá**, y ese instante se
 * corre una hora dos veces al año en las zonas con horario de verano. Calcular
 * el offset una sola vez y sumarlo produce un cron que se desfasa un día al año
 * en marzo y otro en octubre — el tipo de error que aparece un domingo a las
 * 2am y nadie sabe de dónde salió.
 *
 * Acá no se guarda ningún offset: se le pregunta a `Intl` en cada conversión,
 * que es la única fuente que conoce las reglas de cada zona y sus cambios.
 */

/** Los campos que muestra un reloj colgado en la pared de esa zona. */
export interface WallClock {
  year: number
  /** 1-12, no 0-11: acá no hay meses de base cero. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Día de la semana, 0 = domingo. */
export function wallClockWeekday(wall: WallClock): number {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Valida una zona IANA. Lanza con un mensaje que dice cuál falló. */
export function assertTimeZone(timeZone: string): void {
  try {
    formatter(timeZone)
  } catch {
    throw new Error(`Zona horaria desconocida: "${timeZone}"`)
  }
}

/** Qué marca el reloj de esa zona en ese instante. */
export function toWallClock(instant: Date, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(instant)
  const campo = (tipo: string) => {
    const p = parts.find((x) => x.type === tipo)
    return p ? Number(p.value) : 0
  }
  return {
    year: campo("year"),
    month: campo("month"),
    day: campo("day"),
    hour: campo("hour"),
    minute: campo("minute"),
    second: campo("second"),
  }
}

function asUTCMillis(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
}

function mismoReloj(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year && a.month === b.month && a.day === b.day &&
    a.hour === b.hour && a.minute === b.minute && a.second === b.second
  )
}

/**
 * El instante en que el reloj de esa zona marca `wall`.
 *
 * Devuelve `null` cuando ese momento **no existe**: al adelantar el horario de
 * verano el reloj salta de 01:59 a 03:00, así que "las 2:30" no ocurre ese día.
 * Un cron agendado ahí no debe correr a una hora inventada; el que llama decide
 * si lo salta o lo corre al día siguiente.
 *
 * Cuando el reloj se atrasa, la misma hora ocurre dos veces y se devuelve la
 * primera — correr una vez es lo que espera quien agendó, no dos.
 */
export function toInstant(wall: WallClock, timeZone: string): Date | null {
  const objetivo = asUTCMillis(wall)

  // Punto de partida: tratar el reloj de pared como si fuera UTC y corregir con
  // la diferencia que reporte la zona. Dos pasadas alcanzan siempre — la primera
  // acerca al offset correcto, la segunda absorbe el caso en que la corrección
  // cruzó un cambio de horario y el offset de destino era otro.
  let ts = objetivo
  for (let i = 0; i < 3; i++) {
    const diferencia = objetivo - asUTCMillis(toWallClock(new Date(ts), timeZone))
    if (diferencia === 0) break
    ts += diferencia
  }

  // La comprobación no es defensiva: es cómo se detecta el hueco del cambio de
  // horario. Si la hora pedida no existe, ninguna corrección converge y el
  // reloj de `ts` marca otra cosa.
  if (!mismoReloj(toWallClock(new Date(ts), timeZone), wall)) return null

  // Cuando el reloj se atrasa, ese mismo reloj de pared ocurre dos veces y la
  // convergencia de arriba aterriza en la segunda. Se busca hacia atrás la
  // primera: correr al instante más temprano es lo que espera quien agendó "a
  // las 2:30", y así el job no se corre una hora ese día del año.
  for (const atras of DESFASES_POSIBLES) {
    const antes = ts - atras
    if (mismoReloj(toWallClock(new Date(antes), timeZone), wall)) return new Date(antes)
  }

  return new Date(ts)
}

/**
 * Cuánto puede saltar un reloj al cambiar de horario, de mayor a menor.
 *
 * Casi todas las zonas mueven una hora, pero no todas: Lord Howe mueve media, y
 * hubo zonas con saltos de dos. Se prueban de mayor a menor para quedarse con
 * la ocurrencia más temprana.
 */
const DESFASES_POSIBLES = [2 * 3_600_000, 3_600_000, 1_800_000]
