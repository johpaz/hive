/**
 * Ingesta única de documentos adjuntos (pdf, docx, xlsx, pptx, csv, txt…).
 *
 * Antes cada canal mandaba el documento a un modelo de visión como si fuera una
 * imagen (falla con Word/Excel y recorta los PDF). Ahora el archivo se guarda en
 * el artifact store, se extrae una vista previa corta de forma nativa y el
 * agente recibe un manifiesto; el contenido completo lo lee bajo demanda con
 * las tools office_leer_* / fs_read usando la ruta que figura en el manifiesto.
 */
import { extname } from "node:path"
import { createArtifact } from "../artifacts/store"
import { cargarXlsx } from "../tools/office/xlsx-loader"
import { logger } from "../utils/logger"

const log = logger.child("attachment-ingest")

/** Tope duro de tamaño de un adjunto (los canales ya limitan antes, esto es la red de seguridad). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const PREVIEW_CHARS = 1500

export type AttachmentKind = "pdf" | "docx" | "xlsx" | "pptx" | "text" | "other"

export interface IngestedAttachment {
  fileName: string
  mimeType: string
  size: number
  kind: AttachmentKind
  artifactId: string
  /** Ruta absoluta en disco, con la extensión original. */
  path: string
  /** Primeros caracteres del contenido; vacío si no hay texto extraíble. */
  preview: string
  /** true si no hubo texto (PDF escaneado, formato desconocido): conviene un modelo de visión. */
  needsVision: boolean
}

const EXT_KIND: Record<string, AttachmentKind> = {
  ".pdf": "pdf", ".docx": "docx", ".xlsx": "xlsx", ".xlsm": "xlsx", ".pptx": "pptx",
  ".txt": "text", ".md": "text", ".csv": "text", ".tsv": "text", ".json": "text",
  ".xml": "text", ".yaml": "text", ".yml": "text", ".log": "text", ".html": "text",
}
const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json",
}

/** La extensión manda sobre el mime: WhatsApp, por ejemplo, declara pdf por defecto. */
export function classifyAttachment(fileName: string, mimeType: string): { kind: AttachmentKind; mimeType: string } {
  const ext = extname(fileName).toLowerCase()
  if (EXT_KIND[ext]) return { kind: EXT_KIND[ext], mimeType: EXT_MIME[ext] ?? mimeType }
  if (/pdf/i.test(mimeType)) return { kind: "pdf", mimeType }
  if (/wordprocessingml/i.test(mimeType)) return { kind: "docx", mimeType }
  if (/spreadsheetml|ms-excel/i.test(mimeType)) return { kind: "xlsx", mimeType }
  if (/presentationml/i.test(mimeType)) return { kind: "pptx", mimeType }
  if (/^text\//i.test(mimeType)) return { kind: "text", mimeType }
  return { kind: "other", mimeType }
}

function clip(text: string): string {
  const t = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim()
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS)}…` : t
}

async function extractPreview(kind: AttachmentKind, bytes: Buffer): Promise<string> {
  try {
    switch (kind) {
      case "text":
        return clip(bytes.toString("utf8"))
      case "docx": {
        const mammoth = await import("mammoth")
        return clip((await mammoth.extractRawText({ buffer: bytes })).value)
      }
      case "xlsx": {
        const XLSX = await cargarXlsx()
        const wb = XLSX.read(bytes, { type: "buffer" })
        const parts = wb.SheetNames.slice(0, 3).map((name) => {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).split("\n").slice(0, 15).join("\n")
          return `# Hoja "${name}"\n${csv}`
        })
        const extra = wb.SheetNames.length > 3 ? `\n(+${wb.SheetNames.length - 3} hojas más)` : ""
        return clip(parts.join("\n\n") + extra)
      }
      case "pdf": {
        const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs" as any).catch(() => import("pdfjs-dist" as any))
        const lib = pdfjs.default ?? pdfjs
        const doc = await lib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise
        let out = ""
        for (let i = 1; i <= Math.min(doc.numPages, 3) && out.length < PREVIEW_CHARS; i++) {
          const content = await (await doc.getPage(i)).getTextContent()
          out += content.items.map((it: any) => it.str).join(" ") + "\n"
        }
        return clip(out)
      }
      default:
        return ""
    }
  } catch (err) {
    log.warn(`No se pudo extraer vista previa (${kind}): ${(err as Error).message}`)
    return ""
  }
}

async function toBytes(input: { buffer?: Buffer; base64?: string; url?: string }): Promise<Buffer> {
  if (input.buffer) return Buffer.from(input.buffer)
  if (input.base64) return Buffer.from(input.base64.replace(/^data:[^,]+,/, ""), "base64")
  if (input.url) {
    const res = await fetch(input.url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`no se pudo descargar el archivo (HTTP ${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error("el adjunto no trae contenido (ni buffer, ni base64, ni url)")
}

export async function ingestDocument(input: {
  buffer?: Buffer
  base64?: string
  url?: string
  mimeType?: string
  fileName?: string
  userId: string
}): Promise<IngestedAttachment> {
  const bytes = await toBytes(input)
  if (bytes.byteLength === 0) throw new Error("el archivo está vacío")
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`el archivo pesa ${(bytes.byteLength / 1048576).toFixed(1)} MB y el máximo es ${MAX_ATTACHMENT_BYTES / 1048576} MB`)
  }
  const fileName = (input.fileName || "adjunto").replace(/[\\/\0]/g, "_")
  const { kind, mimeType } = classifyAttachment(fileName, input.mimeType || "application/octet-stream")
  const artifact = await createArtifact({
    bytes, mimeType, kind: "attachment", userId: input.userId, extension: extname(fileName),
  })
  const preview = await extractPreview(kind, bytes)
  return {
    fileName, mimeType: artifact.mime_type, size: bytes.byteLength, kind,
    artifactId: artifact.id, path: artifact.path, preview,
    needsVision: !preview && (kind === "pdf" || kind === "other"),
  }
}

const READER: Record<AttachmentKind, string> = {
  pdf: "office_leer_pdf", docx: "office_leer_docx", xlsx: "office_leer_xlsx",
  pptx: "office_leer_pptx", text: "fs_read", other: "",
}

/** Texto que se antepone al mensaje del usuario para que el agente sepa qué recibió y cómo leerlo. */
export function formatAttachmentManifest(a: IngestedAttachment): string {
  const kb = a.size < 1048576 ? `${Math.max(1, Math.round(a.size / 1024))} KB` : `${(a.size / 1048576).toFixed(1)} MB`
  const reader = READER[a.kind]
  const lines = [
    `[Archivo adjunto: ${a.fileName} · ${a.mimeType} · ${kb}]`,
    `Ruta: ${a.path}`,
    `artifact_id: ${a.artifactId}`,
    reader ? `Para leerlo completo usa la tool ${reader} con esa ruta.` : "Formato sin lector nativo.",
  ]
  if (a.preview) lines.push(`Vista previa:\n${a.preview}`)
  else lines.push("No se pudo extraer texto (¿escaneado o protegido?).")
  return lines.join("\n")
}
