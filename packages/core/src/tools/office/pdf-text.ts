/**
 * Extracción de texto de PDF sin modelos: solo la capa de texto del archivo
 * (pdfjs). Reconstruye renglones y columnas a partir de las posiciones, en vez
 * de aplastar todo en una línea, para que tablas y párrafos sigan legibles.
 *
 * Un PDF escaneado no tiene capa de texto: aquí se informa como tal
 * (`sinTexto`) y no se intenta adivinar con un modelo.
 */

export interface PdfTextResult {
  totalPaginas: number
  paginasLeidas: number
  titulo?: string
  texto: string
  /** Caracteres de texto por página leída (sirve para ver cuáles están vacías). */
  caracteresPorPagina: number[]
  /** true si ninguna de las páginas leídas tiene texto extraíble (PDF escaneado o solo imágenes). */
  sinTexto: boolean
  /** true si se cortó por el tope de caracteres. */
  truncado: boolean
  /** Primera página que no se llegó a leer (para continuar), si hubo corte o rango. */
  siguientePagina?: number
}

const MAX_PDF_BYTES = 100 * 1024 * 1024

/**
 * pdfjs v5 sin worker real monta uno "falso" en el mismo hilo, y para eso exige
 * `workerSrc` no vacío o el módulo ya cargado en `globalThis.pdfjsWorker`. Dejar
 * `workerSrc = ""` (como hacía la tool) lo rompe: "No GlobalWorkerOptions.workerSrc
 * specified". Registrar el módulo evita depender de rutas de archivo, que además
 * cambian en el binario empaquetado.
 */
let workerListo = false

/**
 * pdfjs hace referencia a DOMMatrix, ImageData y Path2D al cargarse. En desarrollo se
 * las presta `@napi-rs/canvas`, pero en el ejecutable compilado (app de escritorio,
 * paquete) ese módulo no existe y la carga muere con «DOMMatrix is not defined». Para
 * extraer texto no hace falta dibujar nada: bastan clases mínimas, solo si faltan.
 */
function instalarPolyfillsPdf(): void {
  const g = globalThis as any
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
      constructor(init?: ArrayLike<number> | string) {
        if (init && typeof init !== "string" && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = Array.from(init)
        }
      }
      multiplySelf(): this { return this }
      preMultiplySelf(): this { return this }
      translateSelf(): this { return this }
      scaleSelf(): this { return this }
      invertSelf(): this { return this }
    }
  }
  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData { constructor(public width = 0, public height = 0, public data: Uint8ClampedArray = new Uint8ClampedArray(0)) {} }
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {}
  }
}

async function registrarWorker(lib: any): Promise<void> {
  if (workerListo) return
  const g = globalThis as any
  if (!g.pdfjsWorker) {
    g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs" as any)
  }
  if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
    try { lib.GlobalWorkerOptions.workerSrc = import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs") } catch { /* basta con pdfjsWorker */ }
  }
  workerListo = true
}

export function textoDePagina(items: any[]): string {
  const lineas: string[] = []
  let actual = ""
  let prevY: number | null = null
  let prevFin = 0

  const cerrar = (blanco: boolean) => {
    if (actual.trim()) lineas.push(actual.replace(/[ \t]+$/g, ""))
    if (blanco && lineas.length && lineas[lineas.length - 1] !== "") lineas.push("")
    actual = ""
    prevFin = 0
  }

  for (const it of items) {
    if (typeof it?.str !== "string") continue
    const x: number | undefined = it.transform?.[4]
    const y: number | undefined = it.transform?.[5]
    const alto = Math.abs(it.transform?.[3] ?? it.height ?? 10) || 10

    if (prevY !== null && y !== undefined) {
      const salto = Math.abs(y - prevY)
      if (salto > alto * 0.5) cerrar(salto > alto * 1.9)
    }
    if (actual && x !== undefined && it.str) {
      const hueco = x - prevFin
      if (hueco > alto * 1.5) actual += "  "          // columna distinta
      else if (hueco > alto * 0.15 && !/\s$/.test(actual) && !/^\s/.test(it.str)) actual += " "
    }
    actual += it.str
    if (x !== undefined) prevFin = x + (it.width ?? 0)
    if (y !== undefined) prevY = y
    if (it.hasEOL) { cerrar(false); prevY = null }
  }
  cerrar(false)
  return lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

export async function extraerTextoPdf(
  bytes: Uint8Array,
  opts: { desde?: number; hasta?: number; maxCaracteres?: number } = {},
): Promise<PdfTextResult> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(`El PDF pesa ${(bytes.byteLength / 1048576).toFixed(0)} MB; el máximo es ${MAX_PDF_BYTES / 1048576} MB.`)
  }
  instalarPolyfillsPdf()
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs" as any).catch(() => import("pdfjs-dist" as any))
  const lib = pdfjs.default ?? pdfjs
  await registrarWorker(lib)

  let doc: any
  try {
    doc = await lib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise
  } catch (err: any) {
    if (err?.name === "PasswordException") throw new Error("El PDF está protegido con contraseña.")
    if (err?.name === "InvalidPDFException") throw new Error("El archivo no es un PDF válido o está dañado.")
    throw err
  }

  const total: number = doc.numPages
  const desde = Math.min(Math.max(1, Math.floor(opts.desde ?? 1)), total)
  const hasta = Math.min(Math.max(desde, Math.floor(opts.hasta ?? total)), total)
  const tope = opts.maxCaracteres ?? Infinity

  let titulo: string | undefined
  try { titulo = (await doc.getMetadata())?.info?.Title || undefined } catch { /* metadata opcional */ }

  const bloques: string[] = []
  const caracteres: number[] = []
  let usados = 0
  let truncado = false
  let siguiente: number | undefined
  let ultimaLeida = desde - 1

  for (let n = desde; n <= hasta; n++) {
    const texto = textoDePagina((await (await doc.getPage(n)).getTextContent()).items as any[])
    const bloque = `--- Página ${n} ---\n${texto}`
    if (usados > 0 && usados + bloque.length > tope) { truncado = true; siguiente = n; break }
    if (bloque.length > tope) {
      // Una sola página ya excede el tope: se recorta, pero siempre se entrega algo.
      bloques.push(bloque.slice(0, tope))
      caracteres.push(texto.length)
      ultimaLeida = n
      truncado = true
      siguiente = n < total ? n + 1 : undefined
      usados += tope
      break
    }
    bloques.push(bloque)
    caracteres.push(texto.length)
    usados += bloque.length
    ultimaLeida = n
  }
  if (!truncado && ultimaLeida < total) siguiente = ultimaLeida + 1

  try { await doc.destroy() } catch { /* best effort */ }

  const sinTexto = caracteres.length > 0 && caracteres.every((c) => c === 0)
  return {
    totalPaginas: total,
    paginasLeidas: caracteres.length,
    titulo,
    texto: bloques.join("\n\n"),
    caracteresPorPagina: caracteres,
    sinTexto,
    truncado,
    ...(siguiente !== undefined && siguiente <= total ? { siguientePagina: siguiente } : {}),
  }
}
