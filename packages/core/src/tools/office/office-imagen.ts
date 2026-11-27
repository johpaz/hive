/**
 * Imágenes para las tools office_escribir_* / office_editar_*: se piden por
 * `artifact_id` (p. ej. lo que devolvió image_generate) o por `ruta` del workspace.
 *
 * Solo PNG, JPEG y GIF: son los formatos que Word, PowerPoint, Excel y PDF incrustan
 * sin recodificar. Las dimensiones se leen de la cabecera para conservar la proporción.
 * Corre en el worker de herramientas: el artifact se busca en disco, no en HiveDB.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { getWorkspace, resolveInWorkspace } from "../filesystem/workspace-guard.ts"
import { buscarArtifactEnDisco } from "./resolve-input.ts"

export type TipoImagen = "png" | "jpg" | "gif"

export interface ImagenCargada {
  bytes: Buffer
  tipo: TipoImagen
  /** Dimensiones en píxeles. */
  ancho: number
  alto: number
  /** De dónde salió, para los mensajes de error. */
  origen: string
}

export const IMAGEN_PARAM = {
  type: "object",
  description:
    "Imagen a insertar: {artifact_id | ruta, ancho (cm, opcional), alineacion (left|center|right), pie (texto bajo la imagen), alt (texto alternativo)}. artifact_id es el que devolvió image_generate u otra tool; ruta es un archivo del workspace. Formatos PNG, JPEG o GIF.",
} as const

/** Lee tipo y dimensiones de la cabecera. null si no es PNG/JPEG/GIF. */
export function inspeccionarImagen(b: Buffer): { tipo: TipoImagen; ancho: number; alto: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { tipo: "png", ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) }
  }
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") {
    return { tipo: "gif", ancho: b.readUInt16LE(6), alto: b.readUInt16LE(8) }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marca = b[i + 1]!
      if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue }
      const largo = b.readUInt16BE(i + 2)
      // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC): llevan el tamaño del cuadro.
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        return { tipo: "jpg", alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) }
      }
      i += 2 + largo
    }
  }
  return null
}

/** `ref` puede ser el objeto {artifact_id|ruta} o un string (ruta). */
export function cargarImagen(ref: unknown, config?: any): { imagen: ImagenCargada } | { error: string } {
  const o = typeof ref === "string" ? { ruta: ref } : (ref && typeof ref === "object" ? ref as Record<string, unknown> : {})
  const id = typeof o.artifact_id === "string" ? o.artifact_id.trim() : ""
  const ruta = typeof o.ruta === "string" ? o.ruta.trim() : typeof o.path === "string" ? o.path.trim() : ""
  let archivo: string
  if (id) {
    const enDisco = buscarArtifactEnDisco(id)
    if (!enDisco) return { error: `La imagen ${id} no existe o ya expiró. Usa el artifact_id exacto que devolvió la tool que la generó.` }
    archivo = enDisco
  } else if (ruta) {
    try { archivo = path.resolve(resolveInWorkspace(ruta, getWorkspace(config))) } catch (e) { return { error: (e as Error).message } }
    if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) return { error: `No existe la imagen ${ruta}.` }
  } else {
    return { error: "Cada imagen necesita artifact_id o ruta." }
  }
  const bytes = fs.readFileSync(archivo)
  const info = inspeccionarImagen(bytes)
  if (!info || !info.ancho || !info.alto) {
    return { error: `${id || ruta} no es PNG, JPEG ni GIF (los formatos que Office y PDF incrustan).` }
  }
  return { imagen: { bytes, ...info, origen: id || ruta } }
}

/** Ancho y alto en cm: `ancho` pedido (o el máximo) sin pasar de maxAncho/maxAlto, con la proporción original. */
export function ajustarCm(img: { ancho: number; alto: number }, anchoPedido: number | undefined, maxAncho: number, maxAlto: number): { w: number; h: number } {
  const ratio = img.alto / img.ancho
  let w = Math.min(anchoPedido && anchoPedido > 0 ? anchoPedido : maxAncho, maxAncho)
  let h = w * ratio
  if (h > maxAlto) { h = maxAlto; w = h / ratio }
  return { w, h }
}
