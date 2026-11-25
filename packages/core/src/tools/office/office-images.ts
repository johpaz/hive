/**
 * Imágenes incrustadas en Word (.docx) y PowerPoint (.pptx).
 *
 * Ambos formatos son ZIP: las imágenes ya están dentro (`word/media/*`,
 * `ppt/media/*`), no hay que renderizar nada. Este módulo solo las localiza,
 * en el orden en que aparecen, con una pista de dónde estaban; el análisis con
 * el modelo de visión lo hace quien lo llama. Sin estado ni acceso a HiveDB, así
 * que sirve tanto en el worker de herramientas como en el hilo principal.
 */
import type JSZip from "jszip"
import { listarSlides } from "./pptx-slides.ts"

/** Por debajo de esto casi siempre es un ícono, una viñeta o un fondo: no aporta al análisis. */
export const MIN_BYTES_IMAGEN = 5_000

const MIME_POR_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
}

export interface ImagenRef {
  /** Posición entre las imágenes útiles, desde 1. */
  numero: number
  /** Ruta dentro del zip, p. ej. ppt/media/image3.png. */
  archivo: string
  mimeType: string
  /** Dónde estaba: "Diapositiva 4" o "Después de: «…»". */
  ubicacion: string
}

export interface ListadoImagenes {
  imagenes: ImagenRef[]
  /** Imágenes descartadas por ser demasiado pequeñas o de un formato que el modelo no lee (emf, svg…). */
  omitidas: number
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")

/** Resuelve un Target relativo de un .rels contra la carpeta de la parte que lo declara. */
function resolverRuta(carpetaBase: string[], target: string): string {
  const partes = target.startsWith("/") ? target.slice(1).split("/") : [...carpetaBase, ...target.split("/")]
  const resueltas: string[] = []
  for (const p of partes) { if (p === "..") resueltas.pop(); else if (p !== ".") resueltas.push(p) }
  return resueltas.join("/")
}

/** Relaciones de tipo imagen de un .rels: rId → ruta absoluta dentro del zip. */
async function relacionesDeImagen(zip: JSZip, relsPath: string, carpetaBase: string[]): Promise<Map<string, string>> {
  const rels = await zip.file(relsPath)?.async("string")
  const mapa = new Map<string, string>()
  if (!rels) return mapa
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (!/\bType="[^"]*\/image"/.test(m[0]) || /\bTargetMode="External"/.test(m[0])) continue
    const id = m[0].match(/\bId="([^"]+)"/)?.[1]
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) mapa.set(id, resolverRuta(carpetaBase, target))
  }
  return mapa
}

/** Tamaño sin descomprimir si JSZip lo conoce; undefined si no (entonces no se filtra por tamaño aquí). */
function tamanoDe(zip: JSZip, archivo: string): number | undefined {
  const size = (zip.file(archivo) as unknown as { _data?: { uncompressedSize?: number } } | null)?._data?.uncompressedSize
  return typeof size === "number" ? size : undefined
}

function mimeDe(archivo: string): string | null {
  return MIME_POR_EXT[archivo.split(".").pop()?.toLowerCase() ?? ""] ?? null
}

/** Acumula referencias sin repetir el mismo archivo (un logo en cada diapositiva cuenta una sola vez). */
class Acumulador {
  readonly imagenes: ImagenRef[] = []
  omitidas = 0
  private vistos = new Map<string, ImagenRef>()
  private descartados = new Set<string>()

  constructor(private zip: JSZip) {}

  agregar(archivo: string, ubicacion: string): void {
    const previo = this.vistos.get(archivo)
    if (previo) {
      if (!previo.ubicacion.includes(ubicacion) && previo.ubicacion.split(" · ").length < 3) previo.ubicacion += ` · ${ubicacion}`
      return
    }
    if (this.descartados.has(archivo)) return
    const mimeType = mimeDe(archivo)
    const tamano = tamanoDe(this.zip, archivo)
    if (!this.zip.file(archivo) || !mimeType || (tamano !== undefined && tamano < MIN_BYTES_IMAGEN)) {
      this.descartados.add(archivo)
      this.omitidas++
      return
    }
    const ref: ImagenRef = { numero: this.imagenes.length + 1, archivo, mimeType, ubicacion }
    this.imagenes.push(ref)
    this.vistos.set(archivo, ref)
  }
}

async function imagenesDocx(zip: JSZip): Promise<ListadoImagenes> {
  const xml = await zip.file("word/document.xml")?.async("string")
  if (!xml) return { imagenes: [], omitidas: 0 }
  const rels = await relacionesDeImagen(zip, "word/_rels/document.xml.rels", ["word"])
  const acc = new Acumulador(zip)
  let ultimoTexto = ""
  for (const p of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const texto = [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unescapeXml(m[1])).join("").trim()
    const recorte = texto.length > 80 ? `${texto.slice(0, 80)}…` : texto
    for (const e of p[0].matchAll(/\br:embed="([^"]+)"/g)) {
      const archivo = rels.get(e[1])
      if (!archivo) continue
      const ubicacion = recorte ? `Junto a: «${recorte}»` : ultimoTexto ? `Después de: «${ultimoTexto}»` : "Al inicio del documento"
      acc.agregar(archivo, ubicacion)
    }
    if (recorte) ultimoTexto = recorte
  }
  return { imagenes: acc.imagenes, omitidas: acc.omitidas }
}

async function imagenesPptx(zip: JSZip): Promise<ListadoImagenes> {
  const acc = new Acumulador(zip)
  for (const slide of await listarSlides(zip)) {
    const xml = await zip.file(slide.archivo)!.async("string")
    const relsPath = slide.archivo.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels")
    const rels = await relacionesDeImagen(zip, relsPath, slide.archivo.split("/").slice(0, -1))
    for (const e of xml.matchAll(/\br:embed="([^"]+)"/g)) {
      const archivo = rels.get(e[1])
      if (archivo) acc.agregar(archivo, `Diapositiva ${slide.numero}`)
    }
  }
  return { imagenes: acc.imagenes, omitidas: acc.omitidas }
}

/** Localiza las imágenes útiles de un .docx o .pptx, en el orden en que aparecen. */
export async function listarImagenes(zip: JSZip, formato: "docx" | "pptx"): Promise<ListadoImagenes> {
  return formato === "docx" ? imagenesDocx(zip) : imagenesPptx(zip)
}
