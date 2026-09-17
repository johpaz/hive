/**
 * Motor de cron propio: parser, próxima corrida con zona horaria, y el job.
 *
 * Reemplazó a `croner`, así que estos tests son lo único que separa al
 * scheduler de agendar mal. Los casos que importan no son los felices —"cada
 * día a las 9" lo acierta cualquier implementación— sino los tres donde un cron
 * escrito a mano se rompe callado: el desborde de `setTimeout`, el cambio de
 * horario de verano, y la lógica O/Y entre día del mes y día de semana.
 */

import { describe, test, expect, afterEach } from "bun:test"
import { Cron } from "./job"
import { parseCronExpression, isValidCronExpression } from "./expression"
import { nextOccurrence } from "./next-run"
import { toInstant, toWallClock } from "./zoned-time"

const UTC = { timeZone: "UTC" }
const iso = (d: Date | null) => d?.toISOString() ?? null

/**
 * Los jobs con función se registran acá para pararlos pase lo que pase.
 *
 * Un timer armado mantiene vivo el proceso, así que un test que falle antes de
 * llegar a su `stop()` deja colgado el archivo entero en lugar de reportar el
 * fallo: un test roto se convierte en un CI que no termina nunca.
 */
const vivos: Cron[] = []
function job(pattern: string | Date, options: any, fn: any): Cron {
  const c = new Cron(pattern, options, fn)
  vivos.push(c)
  return c
}
afterEach(() => {
  while (vivos.length) vivos.pop()!.stop()
})

describe("parser de expresiones", () => {
  test("acepta las cinco formas que documenta la skill", () => {
    for (const e of ["0 9 * * *", "0 7 * * 1-5", "0 */2 * * *", "0 0 * * 0", "0 0 1 * *"]) {
      expect(isValidCronExpression(e)).toBe(true)
    }
  })

  test("acepta 6 campos, que es lo que puede haber guardado de antes", () => {
    // croner los aceptaba, así que hay bases con expresiones de segundos.
    // `Bun.cron` las rechaza; por eso no sirve como reemplazo directo.
    const f = parseCronExpression("*/30 * * * * *")
    expect(f.hasSeconds).toBe(true)
    expect(f.second).toEqual([0, 30])
  })

  test("entiende nombres de mes y de día", () => {
    const f = parseCronExpression("0 0 * JAN-MAR MON,FRI")
    expect(f.month).toEqual([1, 2, 3])
    expect(f.dayOfWeek).toEqual([1, 5])
  })

  test("7 y 0 son el mismo domingo", () => {
    expect(parseCronExpression("0 0 * * 7").dayOfWeek).toEqual([0])
    expect(parseCronExpression("0 0 * * 0-7").dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  test("un rango que da la vuelta son las dos puntas", () => {
    expect(parseCronExpression("0 22-2 * * *").hour).toEqual([0, 1, 2, 22, 23])
  })

  test("el error dice qué campo falló", () => {
    // El mensaje va a la respuesta de `cron.create`: lo lee quien se equivocó.
    expect(() => parseCronExpression("0 25 * * *")).toThrow(/horas.*25.*0-23/)
    expect(() => parseCronExpression("70 * * * *")).toThrow(/minutos.*70/)
    expect(() => parseCronExpression("0 0 * * 8")).toThrow(/día de la semana.*8/)
    expect(() => parseCronExpression("0 9 * *")).toThrow(/5 campos.*o 6/)
  })
})

describe("zona horaria", () => {
  test("ida y vuelta conserva el instante", () => {
    const d = new Date("2026-08-29T22:00:00.000Z")
    const wall = toWallClock(d, "America/Bogota")
    expect(wall.hour).toBe(17) // UTC-5
    expect(iso(toInstant(wall, "America/Bogota"))).toBe("2026-08-29T22:00:00.000Z")
  })

  test("una hora que no existe devuelve null", () => {
    // 29/3/2026 Madrid adelanta: el reloj salta de 01:59 a 03:00.
    // Sin esta comprobación, el cron correría a una hora que nadie vivió.
    expect(toInstant({ year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 }, "Europe/Madrid")).toBeNull()
    expect(iso(toInstant({ year: 2026, month: 3, day: 29, hour: 3, minute: 30, second: 0 }, "Europe/Madrid")))
      .toBe("2026-03-29T01:30:00.000Z")
  })

  test("una hora repetida devuelve la primera", () => {
    // 25/10/2026 Madrid atrasa: las 02:30 ocurren dos veces. Correr una sola vez
    // es lo que espera quien agendó.
    expect(iso(toInstant({ year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 }, "Europe/Madrid")))
      .toBe("2026-10-25T00:30:00.000Z")
  })

  test("una zona inventada se rechaza nombrándola", () => {
    expect(() => new Cron("0 9 * * *", { timezone: "Marte/Olympus" })).toThrow(/Marte\/Olympus/)
  })
})

describe("próxima corrida", () => {
  const desde = new Date("2026-08-29T22:00:00.000Z") // sábado, 17:00 en Bogotá

  test("respeta la zona del job, no la del proceso", () => {
    // 09:00 en Bogotá (UTC-5) son las 14:00Z. Si la zona se ignorara —como hace
    // `Bun.cron.parse`— daría 09:00Z y el job correría cinco horas antes.
    expect(iso(nextOccurrence(parseCronExpression("0 9 * * *"), desde, { timeZone: "America/Bogota" })))
      .toBe("2026-08-30T14:00:00.000Z")
    expect(iso(nextOccurrence(parseCronExpression("0 9 * * *"), desde, UTC)))
      .toBe("2026-08-30T09:00:00.000Z")
  })

  test("salta el fin de semana con un rango de días", () => {
    // Desde un sábado, "lun-vie a las 7" cae el lunes.
    expect(iso(nextOccurrence(parseCronExpression("0 7 * * 1-5"), desde, UTC)))
      .toBe("2026-08-31T07:00:00.000Z")
  })

  test("cruza el fin de mes y el fin de año", () => {
    expect(iso(nextOccurrence(parseCronExpression("0 0 1 * *"), new Date("2026-08-31T23:00:00Z"), UTC)))
      .toBe("2026-09-01T00:00:00.000Z")
    expect(iso(nextOccurrence(parseCronExpression("0 4 1 1 *"), new Date("2026-08-29T00:00:00Z"), UTC)))
      .toBe("2027-01-01T04:00:00.000Z")
  })

  test("encuentra el 29 de febrero aunque falten años", () => {
    expect(iso(nextOccurrence(parseCronExpression("0 0 29 2 *"), new Date("2026-03-01T00:00:00Z"), UTC)))
      .toBe("2028-02-29T00:00:00.000Z")
  })

  test("una expresión imposible devuelve null en vez de colgarse", () => {
    // `0 0 30 2 *` parsea bien y no ocurre nunca. Sin tope de búsqueda, pedirle
    // la próxima corrida bloquea el proceso entero.
    expect(nextOccurrence(parseCronExpression("0 0 30 2 *"), desde, UTC)).toBeNull()
  })

  test("día del mes y de semana: O por defecto, Y con domAndDow", () => {
    const f = parseCronExpression("0 9 15 * 1")
    const base = new Date("2026-09-01T00:00:00Z")
    // O: el primer lunes llega antes que el 15.
    expect(iso(nextOccurrence(f, base, UTC))).toBe("2026-09-07T09:00:00.000Z")
    // Y: hay que esperar a un 15 que además sea lunes.
    const y = nextOccurrence(f, base, { timeZone: "UTC", domAndDow: true })!
    expect(y.getUTCDate()).toBe(15)
    expect(y.getUTCDay()).toBe(1)
  })

  test("es estrictamente posterior: no devuelve el instante que se le pasa", () => {
    // Si devolviera el mismo instante, el scheduler se re-agendaría con demora
    // cero y giraría en vacío.
    const justo = new Date("2026-08-30T09:00:00.000Z")
    expect(iso(nextOccurrence(parseCronExpression("0 9 * * *"), justo, UTC)))
      .toBe("2026-08-31T09:00:00.000Z")
  })

  test("se saltea el día que el cambio de horario borró la hora", () => {
    // "Todos los días a las 2:30" en Madrid: el 29/3/2026 esa hora no existe
    // (el reloj salta de 01:59 a 03:00). El job no corre ese día a una hora
    // inventada: corre el 30.
    const f = parseCronExpression("30 2 * * *")
    const v = nextOccurrence(f, new Date("2026-03-28T12:00:00Z"), { timeZone: "Europe/Madrid" })!
    const wall = toWallClock(v, "Europe/Madrid")
    expect(wall.day).toBe(30)
    expect(`${wall.hour}:${wall.minute}`).toBe("2:30")
    expect(iso(v)).toBe("2026-03-30T00:30:00.000Z")
  })
})

describe("el job", () => {
  test("sin función no agenda nada: es la forma de validar", () => {
    const c = new Cron("0 9 * * *")
    expect(c.isRunning()).toBe(false)
    expect(c.nextRun()).not.toBeNull()
  })

  test("una espera larga no dispara de inmediato", async () => {
    // `setTimeout` con más de 2^31-1 ms desborda y dispara YA. Un job anual
    // correría al instante y en bucle. Es el error clásico del scheduler
    // artesanal, y sólo se ve en producción meses después.
    let corrio = 0
    const anual = job("0 4 1 1 *", {}, () => { corrio++ })
    await Bun.sleep(60)
    expect(corrio).toBe(0)
    expect(anual.isRunning()).toBe(true)
    anual.stop()
  })

  test("corre en el segundo agendado y para en maxRuns", async () => {
    let n = 0
    const c = job("*/1 * * * * *", { maxRuns: 2 }, () => { n++ })
    await Bun.sleep(2600)
    expect(n).toBe(2)
    expect(c.isRunning()).toBe(false)
    c.stop()
  }, 10_000)

  test("protect no deja que dos corridas se solapen", async () => {
    let activas = 0
    let solapes = 0
    const c = job("*/1 * * * * *", { protect: true }, async () => {
      activas++
      if (activas > 1) solapes++
      await Bun.sleep(1600)
      activas--
    })
    await Bun.sleep(3600)
    c.stop()
    expect(solapes).toBe(0)
  }, 10_000)

  test("un error no apaga el job", async () => {
    // Si el re-agendado quedara después del await, una sola excepción dejaría
    // el job muerto para siempre.
    let intentos = 0
    const errores: string[] = []
    const c = job("*/1 * * * * *", { catch: (e) => errores.push(e.message) }, () => {
      intentos++
      throw new Error("explotó")
    })
    await Bun.sleep(2600)
    c.stop()
    expect(intentos).toBeGreaterThanOrEqual(2)
    expect(errores.length).toBe(intentos)
  }, 10_000)

  test("pause detiene, resume vuelve a agendar, stop es definitivo", async () => {
    let n = 0
    const c = job("*/1 * * * * *", {}, () => { n++ })
    expect(c.isRunning()).toBe(true)

    c.pause()
    expect(c.isRunning()).toBe(false)
    await Bun.sleep(1200)
    expect(n).toBe(0)

    c.resume()
    expect(c.isRunning()).toBe(true)
    await Bun.sleep(1200)
    expect(n).toBeGreaterThan(0)

    c.stop()
    expect(c.isRunning()).toBe(false)
    expect(c.resume()).toBe(false)
    expect(c.nextRun()).toBeNull()
  }, 10_000)

  test("una fecha como patrón agenda una sola corrida", async () => {
    // Es como se agendan los jobs one_shot: el patrón es su `fire_at`.
    // `Bun.cron` rechaza esto, y sin ello no habría one-shots.
    const cuando = new Date(Date.now() + 1000)
    let n = 0
    const c = job(cuando.toISOString(), {}, () => { n++ })
    expect(iso(c.nextRun())).toBe(cuando.toISOString())
    await Bun.sleep(1800)
    expect(n).toBe(1)
    expect(c.nextRun()).toBeNull()
    c.stop()
  }, 10_000)

  test("trigger corre ya, sin tocar la agenda", async () => {
    let n = 0
    const c = job("0 4 1 1 *", {}, () => { n++ })
    const agendada = iso(c.nextRun())
    c.trigger()
    await Bun.sleep(50)
    expect(n).toBe(1)
    expect(iso(c.nextRun())).toBe(agendada)
    c.stop()
  })

  test("startAt y stopAt acotan la ventana", () => {
    const dentro = new Cron("0 9 * * *", {
      startAt: "2027-01-01T00:00:00Z",
      stopAt: "2027-12-31T23:59:59Z",
    })
    const v = dentro.nextRun(new Date("2026-06-01T00:00:00Z"))!
    expect(v.getTime()).toBeGreaterThanOrEqual(new Date("2027-01-01T00:00:00Z").getTime())

    const vencido = new Cron("0 9 * * *", { stopAt: "2026-01-01T00:00:00Z" })
    expect(vencido.nextRun(new Date("2026-06-01T00:00:00Z"))).toBeNull()
  })

  test("interval pone un piso entre corridas", async () => {
    // `*/1 * * * * *` con interval de 3s corre cada 3 segundos, no cada uno.
    let n = 0
    const c = job("*/1 * * * * *", { interval: 3 }, () => { n++ })
    await Bun.sleep(4200)
    c.stop()
    expect(n).toBeLessThanOrEqual(2)
    expect(n).toBeGreaterThan(0)
  }, 10_000)
})
