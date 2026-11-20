/**
 * Resuelve el archivo de entrada de las tools office_*: acepta la `ruta` de siempre
 * o el `artifact_id` que aparece en el aviso de un adjunto.
 *
 * IMPORTANTE: estas tools corren en el worker de herramientas, que no puede tocar
 * HiveDB (el bundle del worker no debe contener el binding nativo; ver
 * tool-runtime/worker-tools.ts y scripts/build-gateway.ts). Por eso el artifact se
 * localiza en disco por su id —`<hive>/artifacts/<día>/<id>.<ext>`, como lo escribe
 * artifacts/store.ts— y no consultando la colección `artifacts`.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getHiveDir } from "../../config/loader.ts"

export const ARTIFACT_ID_PARAM = {
  type: "string",
  description: "ID de un archivo adjunto por el usuario (aparece como artifact_id en el aviso del adjunto). Alternativa a 'ruta'.",
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ruta en disco del artifact `id`, o null si no existe. El id se valida como UUID: nunca forma parte de una ruta sin pasar por ahí. */
export function buscarArtifactEnDisco(id: string, raiz = join(getHiveDir(), "artifacts")): string | null {
  if (!UUID.test(id) || !existsSync(raiz)) return null
  for (const dia of readdirSync(raiz)) {
    const dir = join(raiz, dia)
    try {
      const archivo = readdirSync(dir).find((nombre) => nombre.startsWith(`${id}.`))
      if (archivo) return join(dir, archivo)
    } catch { /* no es una carpeta de día */ }
  }
  return null
}

export async function resolveOfficeInput(
  params: Record<string, unknown>,
): Promise<{ ruta: string } | { error: string }> {
  const artifactId = typeof params.artifact_id === "string" ? params.artifact_id.trim() : ""
  if (artifactId) {
    const ruta = buscarArtifactEnDisco(artifactId)
    if (!ruta) {
      return { error: `El adjunto ${artifactId} no existe o ya expiró (se conservan 7 días). Pídele al usuario que lo reenvíe.` }
    }
    return { ruta }
  }
  const ruta = typeof params.ruta === "string" ? params.ruta.trim() : ""
  if (!ruta) return { error: "Indica 'ruta' o 'artifact_id'." }
  return { ruta }
}
