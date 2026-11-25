/**
 * Imágenes incrustadas en un PDF, sin renderizar páginas.
 *
 * Un PDF escaneado es, por dentro, una imagen por página; una factura con logo,
 * un informe con gráficos pegados, igual. pdfjs las decodifica a píxeles crudos
 * sin necesitar canvas, y aquí se codifican a PNG (con tope de tamaño) para que
 * el modelo de visión las lea. No cubre el contenido vectorial (un gráfico
 * dibujado con trazos no es una imagen): eso exigiría renderizar la página, y
 * `@napi-rs/canvas` no existe en el ejecutable de escritorio.
 *
 * Sin estado ni HiveDB: seguro tanto en el worker como en el hilo principal.
 */
import { deflateSync } from "node:zlib"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { instalarPolyfillsPdf, registrarWorker } from "./pdf-text.ts"

/** Por debajo de esto es un ícono, una viñeta o un filete: no vale una llamada al modelo. */
export const MIN_LADO_PX = 64
export const MIN_AREA_PX = 20_000
/** Lado mayor al enviar al modelo: una hoja A4 escaneada a 300 ppp mide 3508 px y casi todo ese detalle sobra. */
export const MAX_LADO_PX = 2000
const MAX_PDF_BYTES = 100 * 1024 * 1024

export interface PdfImagenRef {
  /** Posición entre las imágenes útiles del PDF, desde 1. */
  numero: number
  pagina: number
  objId: string
  ancho: number
  alto: number
  /** "Página 3" (más "· imagen 2 de 3" si la página tiene varias). */
  ubicacion: string
}

export interface ListadoPdf {
  imagenes: PdfImagenRef[]
  omitidas: number
  totalPaginas: number
}

// ── PNG mínimo ───────────────────────────────────────────────────────────────

const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(...partes: Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of partes) for (let i = 0; i < p.length; i++) c = TABLA_CRC[(c ^ p[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(tipo: string, datos: Uint8Array): Buffer {
  const cabecera = Buffer.alloc(8)
  cabecera.writeUInt32BE(datos.length, 0)
  cabecera.write(tipo, 4, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cabecera.subarray(4), datos), 0)
  return Buffer.concat([cabecera, datos, crc])
}

/** Codifica píxeles de 8 bits (1 canal = gris, 3 = RGB) como PNG. */
export function codificarPng(ancho: number, alto: number, canales: 1 | 3, pixeles: Uint8Array): Buffer {
  const fila = ancho * canales
  const crudo = Buffer.alloc((fila + 1) * alto) // cada fila lleva un byte de filtro (0 = ninguno)
  for (let y = 0; y < alto; y++) {
    crudo[y * (fila + 1)] = 0
    crudo.set(pixeles.subarray(y * fila, (y + 1) * fila), y * (fila + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0)
  ihdr.writeUInt32BE(alto, 4)
  ihdr[8] = 8
  ihdr[9] = canales === 1 ? 0 : 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(crudo, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ])
}

interface ImagenPdfjs { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray }

/** pdfjs ImageKind: 1 = gris de 1 bit empaquetado, 2 = RGB, 3 = RGBA. Todo sale a 8 bits, sobre blanco si hay alfa. */
export function aPixeles(img: ImagenPdfjs): { canales: 1 | 3; pixeles: Uint8Array } {
  const { width: w, height: h, data } = img
  if (img.kind === 1) {
    const salida = new Uint8Array(w * h)
    const bytesFila = Math.ceil(w / 8)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) salida[y * w + x] = data[y * bytesFila + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0
    }
    return { canales: 1, pixeles: salida }
  }
  if (img.kind === 2) return { canales: 3, pixeles: new Uint8Array(data.buffer, data.byteOffset, w * h * 3) }
  if (img.kind === 3) {
    const salida = new Uint8Array(w * h * 3)
    for (let i = 0, j = 0; i < w * h * 4; i += 4, j += 3) {
      const a = data[i + 3] / 255
      salida[j] = Math.round(data[i] * a + 255 * (1 - a))
      salida[j + 1] = Math.round(data[i + 1] * a + 255 * (1 - a))
      salida[j + 2] = Math.round(data[i + 2] * a + 255 * (1 - a))
    }
    return { canales: 3, pixeles: salida }
  }
  throw new Error(`formato de imagen de PDF no soportado (kind ${img.kind})`)
}

/** Reduce por promedio de bloques hasta que el lado mayor no pase de `max`. Conserva la legibilidad del texto mejor que el vecino más cercano. */
export function reducir(ancho: number, alto: number, canales: 1 | 3, px: Uint8Array, max = MAX_LADO_PX) {
  const factor = Math.max(ancho, alto) / max
  if (factor <= 1) return { ancho, alto, pixeles: px }
  const nw = Math.max(1, Math.round(ancho / factor))
  const nh = Math.max(1, Math.round(alto / factor))
  const salida = new Uint8Array(nw * nh * canales)
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * alto) / nh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * alto) / nh))
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * ancho) / nw)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * ancho) / nw))
      for (let c = 0; c < canales; c++) {
        let suma = 0
        let n = 0
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { suma += px[(yy * ancho + xx) * canales + c]; n++ }
        salida[(y * nw + x) * canales + c] = Math.round(suma / n)
      }
    }
  }
  return { ancho: nw, alto: nh, pixeles: salida }
}

// ── pdfjs ────────────────────────────────────────────────────────────────────

/** Carpeta `wasm/` de pdfjs (decodificador JBIG2/CCITT de los escaneados en blanco y negro), si existe en disco. */
function carpetaWasm(): string | undefined {
  try {
    return `${dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")))}/wasm/`
  } catch { return undefined }
}

export interface PdfAbierto {
  listar(): Promise<ListadoPdf>
  /** PNG listo para el modelo. Lanza si pdfjs no puede decodificar esa imagen. */
  extraer(ref: PdfImagenRef): Promise<Buffer>
  cerrar(): Promise<void>
}

export async function abrirPdf(bytes: Uint8Array): Promise<PdfAbierto> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(`El PDF pesa ${(bytes.byteLength / 1048576).toFixed(0)} MB; el máximo es ${MAX_PDF_BYTES / 1048576} MB.`)
  }
  instalarPolyfillsPdf()
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs" as any).catch(() => import("pdfjs-dist" as any))
  const lib = pdfjs.default ?? pdfjs
  await registrarWorker(lib)

  let doc: any
  try {
    doc = await lib.getDocument({ data: new Uint8Array(bytes), disableWorker: true, wasmUrl: carpetaWasm() }).promise
  } catch (err: any) {
    if (err?.name === "PasswordException") throw new Error("El PDF está protegido con contraseña.")
    if (err?.name === "InvalidPDFException") throw new Error("El archivo no es un PDF válido o está dañado.")
    throw err
  }
  const OPS = lib.OPS
  const paginas = new Map<number, any>()
  const pagina = async (n: number) => {
    if (!paginas.has(n)) paginas.set(n, await doc.getPage(n))
    return paginas.get(n)
  }

  return {
    async listar() {
      const imagenes: PdfImagenRef[] = []
      const vistos = new Set<string>()
      let omitidas = 0
      for (let n = 1; n <= doc.numPages; n++) {
        const ops = await (await pagina(n)).getOperatorList()
        const dePagina: Array<Omit<PdfImagenRef, "numero" | "ubicacion">> = []
        for (let i = 0; i < ops.fnArray.length; i++) {
          if (ops.fnArray[i] !== OPS.paintImageXObject) continue
          const [objId, ancho, alto] = ops.argsArray[i] as [string, number, number]
          if (vistos.has(objId)) continue // el mismo recurso dibujado varias veces, o compartido entre páginas
          vistos.add(objId)
          if (Math.min(ancho, alto) < MIN_LADO_PX || ancho * alto < MIN_AREA_PX) { omitidas++; continue }
          dePagina.push({ pagina: n, objId, ancho, alto })
        }
        dePagina.forEach((d, k) => imagenes.push({
          ...d,
          numero: imagenes.length + 1,
          ubicacion: dePagina.length > 1 ? `Página ${n} · imagen ${k + 1} de ${dePagina.length}` : `Página ${n}`,
        }))
      }
      return { imagenes, omitidas, totalPaginas: doc.numPages }
    },

    async extraer(ref) {
      const p = await pagina(ref.pagina)
      const almacen = ref.objId.startsWith("g_") ? p.commonObjs : p.objs
      const img = await new Promise<ImagenPdfjs | null>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("pdfjs no entregó la imagen a tiempo")), 20_000)
        almacen.get(ref.objId, (v: ImagenPdfjs | null) => { clearTimeout(t); resolve(v) })
      })
      if (!img?.data) {
        throw new Error(
          "no se pudo decodificar la imagen (los escaneados en blanco y negro JBIG2/CCITT necesitan el módulo wasm de pdfjs, que no está disponible aquí)",
        )
      }
      const { canales, pixeles } = aPixeles(img)
      const r = reducir(img.width, img.height, canales, pixeles)
      return codificarPng(r.ancho, r.alto, canales, r.pixeles)
    },

    async cerrar() { try { await doc.destroy() } catch { /* best effort */ } },
  }
}
