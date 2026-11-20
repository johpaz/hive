/**
 * Utilidades de PowerPoint (.pptx) sobre su XML: orden real de diapositivas,
 * texto por párrafo y notas del orador. Sin modelos.
 *
 * El número de archivo (slide7.xml) NO es la posición: al reordenar en
 * PowerPoint los archivos conservan su nombre. El orden de verdad está en
 * `ppt/presentation.xml` (sldIdLst) resuelto con `ppt/_rels/presentation.xml.rels`.
 */
import type JSZip from "jszip"

export interface SlideRef {
  /** Posición en la presentación, desde 1. */
  numero: number
  /** Ruta dentro del zip, p. ej. ppt/slides/slide7.xml. */
  archivo: string
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")

export async function listarSlides(zip: JSZip): Promise<SlideRef[]> {
  const porNumeroDeArchivo = () =>
    Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]))
      .map((archivo, i) => ({ numero: i + 1, archivo }))

  const pres = await zip.file("ppt/presentation.xml")?.async("string")
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")
  if (!pres || !rels) return porNumeroDeArchivo()

  const destinos = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1]
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) destinos.set(id, target)
  }
  const ordenados: SlideRef[] = []
  for (const m of pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const target = destinos.get(m[1])
    if (!target) continue
    const archivo = target.startsWith("/") ? target.slice(1) : `ppt/${target.replace(/^\.\//, "")}`
    if (zip.file(archivo)) ordenados.push({ numero: ordenados.length + 1, archivo })
  }
  return ordenados.length ? ordenados : porNumeroDeArchivo()
}

/** Texto de un XML de diapositiva o de notas: un párrafo por línea. */
export function textoDeXml(xml: string): string {
  const parrafos: string[] = []
  for (const p of xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)) {
    const partes = [...p[0].matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\s*\/>/g)]
      .map((m) => (m[1] === undefined ? "\n" : unescapeXml(m[1])))
    const linea = partes.join("").trim()
    if (linea) parrafos.push(linea)
  }
  return parrafos.join("\n")
}

/** Título: primer texto del shape cuyo placeholder es title/ctrTitle; si no hay, la primera línea. */
export function tituloDeXml(xml: string, texto: string): string | undefined {
  for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    if (/<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(sp[0])) {
      const t = textoDeXml(sp[0])
      if (t) return t.split("\n")[0]
    }
  }
  return texto.split("\n")[0] || undefined
}

/** Ruta del XML de notas de una diapositiva, si tiene. */
export async function archivoDeNotas(zip: JSZip, slide: SlideRef): Promise<string | null> {
  const relsPath = slide.archivo.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels")
  const rels = await zip.file(relsPath)?.async("string")
  const target = rels?.match(/<Relationship\b[^>]*\bType="[^"]*\/notesSlide"[^>]*>/)?.[0].match(/\bTarget="([^"]+)"/)?.[1]
  if (!target) return null
  const base = slide.archivo.split("/").slice(0, -1)
  const partes = target.startsWith("/") ? target.slice(1).split("/") : [...base, ...target.split("/")]
  const resueltas: string[] = []
  for (const p of partes) { if (p === "..") resueltas.pop(); else if (p !== ".") resueltas.push(p) }
  const ruta = resueltas.join("/")
  return zip.file(ruta) ? ruta : null
}
