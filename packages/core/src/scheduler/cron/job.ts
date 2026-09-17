/**
 * `Cron` — un job agendado, sin dependencias.
 *
 * Reemplaza a `croner` conservando la superficie que el scheduler ya usaba
 * (`nextRun`, `pause`, `resume`, `stop`, y las opciones `timezone`, `protect`,
 * `catch`, `name`, `domAndDow`, `maxRuns`, `interval`, `startAt`, `stopAt`),
 * porque esas opciones son campos persistidos de `CronJobDoc` y cambiarlas
 * habría sido migrar la base para no ganar nada.
 *
 * No usa `Bun.cron()`: ese sólo acepta 5 campos, no admite una fecha ISO como
 * patrón —que es como se agendan los jobs `one_shot`—, no toma una zona por job
 * (usa la local del proceso desde Bun 1.4; antes era UTC) y
 * su handle no expone la próxima corrida, que es de donde sale `next_run_at` y
 * con lo que el scheduler detecta las corridas perdidas al arrancar. Lo que sí
 * se usa de Bun es el runtime pelado: `setTimeout` e `Intl`.
 */

import { parseCronExpression, type CronFields } from "./expression"
import { nextOccurrence } from "./next-run"
import { assertTimeZone } from "./zoned-time"

/**
 * Tope de `setTimeout`.
 *
 * Un delay mayor a 2^31-1 ms desborda a 32 bits y el timer dispara **de
 * inmediato**, no tarde. Un job anual programado de una sola vez correría al
 * instante, y otra vez, y otra: es el error clásico de escribir un scheduler a
 * mano. Los esperas largas se encadenan en tramos de ~24 días.
 */
const MAX_DELAY_MS = 2_147_483_647

export type CronFunction = (job: Cron) => void | Promise<void>

export interface CronOptions {
  /** Zona IANA en la que se interpreta la expresión. Por defecto, UTC. */
  timezone?: string
  /** No arrancar una corrida si la anterior sigue en curso. */
  protect?: boolean
  /** Qué hacer si la función lanza. Una función la recibe; `true` la traga. */
  catch?: boolean | ((error: Error, job: Cron) => void)
  name?: string
  /** Exigir que casen día del mes **y** día de semana, en vez de cualquiera. */
  domAndDow?: boolean
  /** Dejar de correr después de estas corridas. */
  maxRuns?: number
  /** Segundos mínimos entre el arranque de una corrida y la siguiente. */
  interval?: number
  /** No correr antes de esta fecha. */
  startAt?: string | Date
  /** No correr después de esta fecha. */
  stopAt?: string | Date
  /** Nace pausado. */
  paused?: boolean
}

function aFecha(valor: string | Date | undefined, campo: string): Date | null {
  if (valor === undefined || valor === null) return null
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) throw new Error(`${campo} no es una fecha válida: "${String(valor)}"`)
  return d
}

export class Cron {
  /** El patrón tal como se recibió. */
  readonly pattern: string
  readonly name: string

  private readonly fields: CronFields | null
  /** Instante único, cuando el patrón es una fecha en vez de una expresión. */
  private readonly fireAt: Date | null
  private readonly fn: CronFunction | null
  private readonly timeZone: string
  private readonly protect: boolean
  private readonly onError: boolean | ((error: Error, job: Cron) => void)
  private readonly domAndDow: boolean
  private readonly maxRuns: number | null
  private readonly intervalMs: number
  private readonly startAt: Date | null
  private readonly stopAt: Date | null

  private timer: ReturnType<typeof setTimeout> | null = null
  private paused: boolean
  private detenido = false
  private ocupado = false
  private corridas = 0
  private ultimoArranque: Date | null = null
  /** La corrida para la que está armado el timer. */
  private proxima: Date | null = null

  constructor(pattern: string | Date, options?: CronOptions | null, fn?: CronFunction) {
    const opts = options ?? {}

    this.timeZone = opts.timezone || "UTC"
    assertTimeZone(this.timeZone)

    this.protect = opts.protect === true
    this.onError = opts.catch ?? false
    this.domAndDow = opts.domAndDow === true
    this.maxRuns = opts.maxRuns ?? null
    this.intervalMs = (opts.interval ?? 0) * 1000
    this.startAt = aFecha(opts.startAt, "startAt")
    this.stopAt = aFecha(opts.stopAt, "stopAt")
    this.paused = opts.paused === true
    this.fn = fn ?? null

    // Una fecha —o una cadena que lo sea— agenda una sola corrida. Es como se
    // agendan los jobs `one_shot`, que pasan su `fire_at` como patrón.
    if (pattern instanceof Date || esFechaISO(pattern)) {
      const cuando = aFecha(pattern, "el patrón")!
      this.pattern = pattern instanceof Date ? pattern.toISOString() : pattern
      this.fireAt = cuando
      this.fields = null
    } else {
      this.pattern = pattern
      this.fireAt = null
      this.fields = parseCronExpression(pattern)
    }

    this.name = opts.name ?? this.pattern

    // Sin función no hay nada que correr: `new Cron(expr)` es la forma de
    // validar una expresión, y no debe dejar un timer suelto.
    if (this.fn) this.armar()
  }

  /** La próxima corrida, o `null` si ya no queda ninguna. */
  nextRun(from?: Date): Date | null {
    if (this.detenido) return null
    if (this.maxRuns !== null && this.corridas >= this.maxRuns) return null

    const desde = from ?? new Date()
    let candidata: Date | null

    if (this.fireAt) {
      candidata = this.fireAt.getTime() > desde.getTime() ? this.fireAt : null
    } else {
      candidata = nextOccurrence(this.fields!, desde, {
        timeZone: this.timeZone,
        domAndDow: this.domAndDow,
      })
    }
    if (!candidata) return null

    // `startAt` corre la primera corrida hacia adelante en vez de saltearla: un
    // job con ventana de arranque futura debe correr cuando la ventana abre.
    if (this.startAt && candidata.getTime() < this.startAt.getTime()) {
      candidata = this.fireAt
        ? this.fireAt
        : nextOccurrence(this.fields!, new Date(this.startAt.getTime() - 1000), {
            timeZone: this.timeZone,
            domAndDow: this.domAndDow,
          })
      if (!candidata || candidata.getTime() < this.startAt.getTime()) return null
    }

    if (this.stopAt && candidata.getTime() > this.stopAt.getTime()) return null

    // `interval` es un piso entre arranques: con `*/1 * * * *` e `interval: 300`
    // el job corre cada cinco minutos, no cada uno.
    if (this.intervalMs > 0 && this.ultimoArranque) {
      const piso = this.ultimoArranque.getTime() + this.intervalMs
      if (candidata.getTime() < piso) {
        // El piso se redondea hacia arriba al segundo antes de buscar desde él.
        // `nextOccurrence` trabaja en segundos enteros —descarta los
        // milisegundos al leer el reloj de pared—, así que buscar desde un piso
        // con milisegundos devuelve el segundo redondeado hacia ABAJO, que
        // sigue siendo menor que el piso. Reintentar con el mismo valor recursa
        // para siempre y cuelga el proceso sin un error que lo explique.
        const pisoEnSegundos = Math.ceil(piso / 1000) * 1000
        candidata = nextOccurrence(this.fields!, new Date(pisoEnSegundos - 1000), {
          timeZone: this.timeZone,
          domAndDow: this.domAndDow,
        })
        if (!candidata) return null
        if (this.stopAt && candidata.getTime() > this.stopAt.getTime()) return null
      }
    }

    return candidata
  }

  /** Las próximas `n` corridas. Útil para mostrar una agenda. */
  nextRuns(n: number, from?: Date): Date[] {
    const salida: Date[] = []
    let cursor = from ?? new Date()
    for (let i = 0; i < n; i++) {
      const siguiente = this.nextRun(cursor)
      if (!siguiente) break
      salida.push(siguiente)
      cursor = siguiente
    }
    return salida
  }

  /** Suspende las corridas sin perder el job. `true` si quedó pausado. */
  pause(): boolean {
    if (this.detenido) return false
    this.paused = true
    this.desarmar()
    return true
  }

  /** Reanuda un job pausado. `true` si quedó corriendo. */
  resume(): boolean {
    if (this.detenido) return false
    this.paused = false
    if (this.fn) this.armar()
    return true
  }

  /** Termina el job para siempre. No se puede reanudar. */
  stop(): void {
    this.detenido = true
    this.paused = false
    this.desarmar()
  }

  /** ¿Está agendado y sin pausar? */
  isRunning(): boolean {
    return !this.detenido && !this.paused && this.timer !== null
  }

  /** ¿Hay una corrida en curso ahora mismo? */
  isBusy(): boolean {
    return this.ocupado
  }

  /**
   * Corre la función ahora mismo, fuera de agenda, sin tocar la programación.
   *
   * Es lo que hace la tool `cron.trigger` ("corre esto ya"). Ignora `protect` a
   * propósito: quien dispara a mano está pidiendo una corrida, no sugiriéndola,
   * y devolver silencio porque la anterior sigue en curso se ve como que el
   * botón no funciona.
   */
  trigger(): void {
    if (this.detenido) return
    void (async () => {
      this.ocupado = true
      this.corridas++
      this.ultimoArranque = new Date()
      try {
        await this.fn?.(this)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (typeof this.onError === "function") this.onError(error, this)
        else if (!this.onError) throw error
      } finally {
        this.ocupado = false
      }
    })()
  }

  /** Cuántas veces corrió. */
  runCount(): number {
    return this.corridas
  }

  /** Cuándo arrancó la última corrida. */
  previousRun(): Date | null {
    return this.ultimoArranque
  }

  // ── Interno ────────────────────────────────────────────────────────────────

  private desarmar(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.proxima = null
  }

  private armar(): void {
    this.desarmar()
    if (this.detenido || this.paused) return

    const siguiente = this.nextRun()
    if (!siguiente) return

    this.proxima = siguiente
    this.programar()
  }

  /** Arma el timer, encadenando tramos cuando la espera excede el tope. */
  private programar(): void {
    if (!this.proxima) return
    const falta = this.proxima.getTime() - Date.now()

    if (falta > MAX_DELAY_MS) {
      this.timer = setTimeout(() => this.programar(), MAX_DELAY_MS)
      return
    }

    this.timer = setTimeout(() => {
      this.timer = null
      void this.disparar()
    }, Math.max(0, falta))
  }

  private async disparar(): Promise<void> {
    if (this.detenido || this.paused) return

    // `protect` se comprueba acá y no al agendar: lo que importa es si la
    // anterior sigue corriendo **ahora**, no si lo estaba cuando se armó.
    // La corrida se saltea pero el job se re-agenda igual; si no, un job lento
    // se apagaría solo al primer solapamiento.
    if (this.protect && this.ocupado) {
      this.armar()
      return
    }

    this.ocupado = true
    this.corridas++
    this.ultimoArranque = new Date()

    try {
      await this.fn?.(this)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (typeof this.onError === "function") this.onError(error, this)
      else if (!this.onError) throw error
    } finally {
      this.ocupado = false
      // Re-agendar va en el `finally`: si quedara después del `await` y la
      // función lanzara con `catch: false`, el job dejaría de correr para
      // siempre por un error de una sola corrida.
      this.armar()
    }
  }
}

/** ¿Es una fecha ISO en vez de una expresión cron? */
function esFechaISO(valor: string): boolean {
  // Una expresión cron nunca lleva "-" en la primera posición ni ":" en ningún
  // lado, así que alcanza con exigir la forma de fecha antes de intentar
  // parsearla — `new Date("0 9 * * *")` en algunos runtimes no da NaN.
  if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(valor.trim())) return false
  return !Number.isNaN(new Date(valor).getTime())
}
