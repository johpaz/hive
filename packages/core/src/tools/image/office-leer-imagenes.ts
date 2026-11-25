/**
 * office_leer_imagenes — lee las imágenes DENTRO de un Word, PowerPoint o PDF.
 *
 * `office_leer_docx`, `office_leer_pptx` y `office_leer_pdf` solo devuelven texto:
 * una captura, un gráfico, un diagrama o un escaneo dentro del documento no existe
 * para el agente. Esta tool las extrae del propio archivo (Word y PowerPoint son
 * ZIP; en un PDF se decodifican las imágenes incrustadas, que en un escaneado son
 * la página entera) y las describe/transcribe con el modelo analizador del sistema
 * (Providers → Imagen), que es independiente del modelo de chat.
 *
 * Corre en el hilo principal, no en el worker de office: el analizador lee su
 * modelo de HiveDB y el worker no puede tocarlo.
 *
 * @category image
 * @seedId office_leer_imagenes
 * @spanish leer imágenes de un documento, ocr de pdf escaneado, ocr de word, ocr de powerpoint, capturas dentro de un documento
 */
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { Tool } from "../types"
import { resolveOfficeInput, ARTIFACT_ID_PARAM } from "../office/resolve-input"
import { listarImagenes } from "../office/office-images"
import { abrirPdf } from "../office/office-pdf-images"
import { multimodalService } from "../../multimodal"
import { logger } from "../../utils/logger"

const log = logger.child("office-leer-imagenes")

const POR_DEFECTO = 8
const MAXIMO = 20
const EN_PARALELO = 3
const CACHE_MAX = 300

/**
 * Resultados ya obtenidos, por hash de la imagen. Releer el mismo documento (o un
 * logo repetido en varios) no vuelve a pagar una llamada al modelo. Vive en
 * memoria: se pierde al reiniciar el gateway, que es aceptable.
 */
const cache = new Map<string, string>()
function recordar(hash: string, texto: string): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(hash, texto)
}

async function mapaConLimite<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length)
  let siguiente = 0
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++
      salida[i] = await fn(items[i])
    }
  }))
  return salida
}

interface RefImagen { numero: number; ubicacion: string; mimeType: string }
interface Fuente {
  imagenes: Array<RefImagen & Record<string, unknown>>
  omitidas: number
  bytes(ref: RefImagen & Record<string, unknown>): Promise<Buffer>
  cerrar?: () => Promise<void>
}

/** Word y PowerPoint (ZIP) o PDF, detrás de la misma forma: lista de imágenes + cómo obtener los bytes de cada una. */
async function abrirFuente(ext: string, contenido: Buffer): Promise<Fuente> {
  if (ext === ".pdf") {
    const pdf = await abrirPdf(new Uint8Array(contenido))
    try {
      const { imagenes, omitidas } = await pdf.listar()
      return {
        imagenes: imagenes.map((i) => ({ ...i, mimeType: "image/png" })),
        omitidas,
        bytes: (ref) => pdf.extraer(ref as never),
        cerrar: () => pdf.cerrar(),
      }
    } catch (err) {
      await pdf.cerrar()
      throw err
    }
  }
  const formato = ext === ".docx" ? "docx" : "pptx"
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(contenido).catch(() => {
    throw new Error(`El archivo no es un .${formato} válido o está dañado.`)
  })
  const { imagenes, omitidas } = await listarImagenes(zip, formato)
  return {
    imagenes: imagenes as never,
    omitidas,
    bytes: async (ref) => Buffer.from(await zip.file((ref as { archivo?: string }).archivo as string)!.async("uint8array")),
  }
}

export const officeLeerImagenesTool: Tool = {
  name: "office_leer_imagenes",
  timeoutMs: 180_000,
  description:
    "Read the IMAGES inside a Word (.docx), PowerPoint (.pptx) or PDF file — screenshots, charts, diagrams, photos and SCANNED pages — " +
    "which office_leer_docx / office_leer_pptx / office_leer_pdf cannot see because they only return text. Each image is described and its text " +
    "transcribed with the vision model chosen in Providers → Imagen, and comes with where it was in the document (slide, page, nearby text). " +
    "Use it when the document mentions figures, its text looks incomplete, or a PDF has no extractable text (scanned). In a PDF each page image " +
    "is one model call. Returns up to max_imagenes per call; continue with desde_imagen. Vector drawings inside a PDF are not images and are not covered. " +
    "Spanish: leer imágenes de un documento, ocr de pdf escaneado, ocr de word, ocr de powerpoint, capturas dentro de un documento, gráficos de una presentación",
  parameters: {
    type: "object",
    properties: {
      artifact_id: ARTIFACT_ID_PARAM,
      ruta: { type: "string", description: "Ruta absoluta o relativa al archivo .docx, .pptx o .pdf" },
      desde_imagen: { type: "number", description: "Número de imagen desde el que empezar (default 1), para continuar tras un corte." },
      max_imagenes: { type: "number", description: `Cuántas imágenes analizar en esta llamada (default ${POR_DEFECTO}, máximo ${MAXIMO}). Cada una es una llamada al modelo.` },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>) => {
    const entrada = await resolveOfficeInput(params)
    if ("error" in entrada) return { ok: false, error: entrada.error }
    const rutaAbsoluta = path.resolve(entrada.ruta)
    if (!fs.existsSync(rutaAbsoluta)) return { ok: false, error: `Archivo no encontrado: ${rutaAbsoluta}` }

    const ext = path.extname(rutaAbsoluta).toLowerCase()
    if (ext !== ".docx" && ext !== ".pptx" && ext !== ".pdf") {
      return { ok: false, error: `Solo se admiten .docx, .pptx y .pdf (recibí ${ext || "un archivo sin extensión"}). Para una imagen suelta no hace falta esta herramienta.` }
    }
    const desde = Math.max(1, Math.floor(Number(params.desde_imagen) || 1))
    const cuantas = Math.min(Math.max(Math.floor(Number(params.max_imagenes) || POR_DEFECTO), 1), MAXIMO)
    let cerrar: (() => Promise<void>) | undefined

    try {
      const fuente = await abrirFuente(ext, fs.readFileSync(rutaAbsoluta))
      cerrar = fuente.cerrar
      const { imagenes, omitidas } = fuente
      if (imagenes.length === 0) {
        return {
          ok: true, ruta: rutaAbsoluta, totalImagenes: 0, imagenes: [],
          aviso: omitidas
            ? `El documento no tiene imágenes que valga la pena analizar (${omitidas} descartadas por ser íconos muy pequeños o de un formato que el modelo no lee, como EMF o SVG).`
            : "El documento no contiene imágenes.",
        }
      }

      const lote = imagenes.filter((i) => i.numero >= desde).slice(0, cuantas)
      if (lote.length === 0) {
        return { ok: false, error: `Hay ${imagenes.length} imágenes y pediste desde la ${desde}. Usa un número entre 1 y ${imagenes.length}.` }
      }

      const resultados = await mapaConLimite(lote, EN_PARALELO, async (ref) => {
        let bytes: Buffer
        try { bytes = await fuente.bytes(ref) } catch (err) { return { ref, error: (err as Error).message } }
        const hash = createHash("sha256").update(bytes).digest("hex")
        const previo = cache.get(hash)
        if (previo !== undefined) return { ref, texto: previo }
        try {
          const texto = (await multimodalService.ocrImage({
            type: "buffer", data: bytes, mimeType: ref.mimeType, caption: `Estaba en el documento: ${ref.ubicacion}.`,
          })).trim()
          recordar(hash, texto)
          return { ref, texto }
        } catch (err) {
          return { ref, error: (err as Error).message }
        }
      })

      const analizadas = resultados.filter((r) => "texto" in r)
      if (analizadas.length === 0) {
        const motivo = (resultados[0] as { error: string }).error
        log.warn(`No se pudo analizar ninguna imagen de ${path.basename(rutaAbsoluta)}: ${motivo}`)
        return {
          ok: false,
          error: `No se pudo analizar las imágenes: ${motivo} Revisa que haya un modelo con visión elegido en Providers → Imagen.`,
        }
      }

      const ultima = lote[lote.length - 1].numero
      log.info(`Imágenes de ${path.basename(rutaAbsoluta)}: ${analizadas.length}/${lote.length} analizadas (total ${imagenes.length})`)
      return {
        ok: true,
        ruta: rutaAbsoluta,
        totalImagenes: imagenes.length,
        ...(omitidas ? { omitidas } : {}),
        imagenes: resultados.map((r) => ({
          numero: r.ref.numero,
          ubicacion: r.ref.ubicacion,
          ...("texto" in r ? { descripcion: r.texto } : { error: r.error }),
        })),
        ...(ultima < imagenes.length
          ? { truncado: true, siguiente_imagen: ultima + 1, aviso: `Quedan ${imagenes.length - ultima} imágenes: vuelve a llamar con desde_imagen=${ultima + 1}.` }
          : {}),
      }
    } catch (error) {
      log.error(`Error leyendo imágenes: ${(error as Error).message}`)
      return { ok: false, error: `No se pudieron leer las imágenes: ${(error as Error).message}` }
    } finally {
      await cerrar?.()
    }
  },
}
