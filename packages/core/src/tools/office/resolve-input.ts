/**
 * Resuelve el archivo de entrada de las tools office_leer_*: acepta la `ruta`
 * de siempre o el `artifact_id` que aparece en el manifiesto de un adjunto.
 */
import { col } from "../../storage/hive"
import type { ArtifactDoc } from "../../storage/collections"

export const ARTIFACT_ID_PARAM = {
  type: "string",
  description: "ID de un archivo adjunto por el usuario (aparece como artifact_id en el aviso del adjunto). Alternativa a 'ruta'.",
} as const

export async function resolveOfficeInput(
  params: Record<string, unknown>,
): Promise<{ ruta: string } | { error: string }> {
  const artifactId = typeof params.artifact_id === "string" ? params.artifact_id.trim() : ""
  if (artifactId) {
    const entry = await (await col<ArtifactDoc>("artifacts")).get(artifactId)
    if (!entry || entry.doc.status !== "active") {
      return { error: `El adjunto ${artifactId} no existe o ya expiró (se conservan 7 días). Pídele al usuario que lo reenvíe.` }
    }
    return { ruta: entry.doc.path }
  }
  const ruta = typeof params.ruta === "string" ? params.ruta.trim() : ""
  if (!ruta) return { error: "Indica 'ruta' o 'artifact_id'." }
  return { ruta }
}
