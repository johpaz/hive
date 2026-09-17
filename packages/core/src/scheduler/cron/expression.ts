/**
 * Parseo de expresiones cron.
 *
 * Acepta 5 campos (`min hora dom mes dow`) y 6 (con segundos adelante), que es
 * lo que aceptaba croner y por lo tanto lo que puede haber guardado en
 * `cronJobDoc.cron_expression` de instalaciones anteriores. `Bun.cron` sólo
 * admite 5 y rechaza el sexto con un error, así que no sirve como reemplazo
 * directo.
 *
 * Cada campo se expande a la lista ordenada de valores que casa. Expandir por
 * adelantado —en vez de evaluar la expresión en cada comparación— hace que
 * buscar la próxima corrida sea recorrer números, y es lo que permite saltar de
 * un match al siguiente sin probar minuto por minuto.
 */

export interface CronFields {
  second: number[]
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  /** 1-12. */
  month: number[]
  /** 0-6, 0 = domingo. */
  dayOfWeek: number[]
  /** `false` cuando el campo es `*`: no restringe qué días casan. */
  domRestricted: boolean
  dowRestricted: boolean
  /** La expresión trae campo de segundos. */
  hasSeconds: boolean
}

const MESES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DIAS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

interface Rango {
  min: number
  max: number
  nombre: string
  /** Alias por nombre (ENE, LUN…), en minúsculas. */
  nombres?: string[]
}

function traducirNombre(texto: string, rango: Rango): string {
  if (!rango.nombres) return texto
  const i = rango.nombres.indexOf(texto.toLowerCase())
  return i >= 0 ? String(i + rango.min) : texto
}

function entero(texto: string, rango: Rango, expr: string): number {
  const n = Number(texto)
  if (!Number.isInteger(n)) {
    throw new Error(`campo ${rango.nombre}: "${texto}" no es un número (en "${expr}")`)
  }
  return n
}

/** Expande un campo (`*`, `5`, `1-5`, `*​/2`, `1-9/3`, `a,b`) a sus valores. */
function expandirCampo(campo: string, rango: Rango, expr: string): { valores: number[]; restringe: boolean } {
  // `?` es sinónimo de `*` en los dialectos que lo traen; aceptarlo evita
  // rechazar expresiones que en otro scheduler funcionaban.
  const texto = campo.trim() === "?" ? "*" : campo.trim()
  if (texto === "") throw new Error(`campo ${rango.nombre} vacío (en "${expr}")`)

  const valores = new Set<number>()
  let restringe = false

  for (const parte of texto.split(",")) {
    const [base, pasoTexto] = parte.split("/")
    if (pasoTexto !== undefined && parte.split("/").length > 2) {
      throw new Error(`campo ${rango.nombre}: "${parte}" tiene más de un "/" (en "${expr}")`)
    }

    const paso = pasoTexto === undefined ? 1 : entero(pasoTexto, rango, expr)
    if (paso < 1) throw new Error(`campo ${rango.nombre}: el paso debe ser ≥ 1 (en "${expr}")`)

    let desde: number
    let hasta: number

    if (base === "*" || base === "") {
      desde = rango.min
      hasta = rango.max
    } else if (base.includes("-")) {
      restringe = true
      const [a, b] = base.split("-")
      desde = entero(traducirNombre(a, rango), rango, expr)
      hasta = entero(traducirNombre(b, rango), rango, expr)
    } else {
      restringe = true
      desde = entero(traducirNombre(base, rango), rango, expr)
      // `5/15` significa "desde 5, cada 15" — sin paso es un valor suelto.
      hasta = pasoTexto === undefined ? desde : rango.max
    }

    for (const v of [desde, hasta]) {
      if (v < rango.min || v > rango.max) {
        throw new Error(
          `campo ${rango.nombre}: ${v} fuera de rango ${rango.min}-${rango.max} (en "${expr}")`,
        )
      }
    }

    if (desde > hasta) {
      // Un rango que da la vuelta (`22-4` en horas) se lee como las dos puntas.
      for (let v = desde; v <= rango.max; v += paso) valores.add(v)
      for (let v = rango.min; v <= hasta; v += paso) valores.add(v)
    } else {
      for (let v = desde; v <= hasta; v += paso) valores.add(v)
    }
  }

  return { valores: [...valores].sort((a, b) => a - b), restringe }
}

/**
 * Parsea la expresión. Lanza con un mensaje que dice **qué campo** falló y por
 * qué: el mensaje va a parar a la respuesta de `cron.create`, así que lo lee el
 * modelo —o la persona— que se equivocó al escribirla.
 */
export function parseCronExpression(expr: string): CronFields {
  const campos = expr.trim().split(/\s+/)
  if (campos.length !== 5 && campos.length !== 6) {
    throw new Error(
      `una expresión cron lleva 5 campos (min hora día mes día-semana) o 6 con segundos adelante; ` +
        `"${expr}" tiene ${campos.length}`,
    )
  }

  const hasSeconds = campos.length === 6
  const [seg, min, hora, dom, mes, dow] = hasSeconds
    ? campos
    : ["0", ...campos]

  const segundo = expandirCampo(seg, { min: 0, max: 59, nombre: "segundos" }, expr)
  const minuto = expandirCampo(min, { min: 0, max: 59, nombre: "minutos" }, expr)
  const horas = expandirCampo(hora, { min: 0, max: 23, nombre: "horas" }, expr)
  const diaMes = expandirCampo(dom, { min: 1, max: 31, nombre: "día del mes" }, expr)
  const meses = expandirCampo(mes, { min: 1, max: 12, nombre: "mes", nombres: MESES }, expr)
  const diaSemana = expandirCampo(dow, { min: 0, max: 7, nombre: "día de la semana", nombres: DIAS }, expr)

  // 7 y 0 son ambos domingo: se normaliza a 0 para que `0-7` no deje un valor
  // que después no casa con ningún `getUTCDay()`.
  const dowNormalizado = [...new Set(diaSemana.valores.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b)

  return {
    second: segundo.valores,
    minute: minuto.valores,
    hour: horas.valores,
    dayOfMonth: diaMes.valores,
    month: meses.valores,
    dayOfWeek: dowNormalizado,
    domRestricted: diaMes.restringe,
    dowRestricted: diaSemana.restringe,
    hasSeconds,
  }
}

/** `true` si la expresión parsea. Para validar sin construir un job. */
export function isValidCronExpression(expr: string): boolean {
  try {
    parseCronExpression(expr)
    return true
  } catch {
    return false
  }
}
