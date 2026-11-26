/**
 * Biblioteca «Mis avatares» del Estudio de video.
 *
 * Cada rostro que el usuario sube se guarda aquí con su nombre y su voz, para elegirlo en cualquier reel sin volver a subir la
 * foto. La entrada solo apunta al archivo que ya vive en `estudio-videos/imagenes`: no duplica nada, y borrar un avatar de la
 * biblioteca no borra la foto del disco.
 */
import { existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { col } from "../storage/hive"
import type { ArtifactDoc } from "../storage/collections"
import { normalizeVoiceSettings, type VoiceSettings } from "./voice"

const COLLECTION = "studioAvatars"

export interface AvatarDoc {
  id: string
  user_id: string
  name: string
  description: string
  /** Foto de rostro (artifact) y su ruta en el disco. */
  face_artifact_id: string
  face_path: string
  voice_id: string | null
  voice_name: string | null
  voice_settings: VoiceSettings
  created_at: number
  updated_at: number
}

/** Lo que se necesita de un personaje de un proyecto para guardarlo como avatar. */
export interface AvatarSource {
  name: string
  description: string
  face_artifact_id: string | null
  face_path: string | null
  face_consent: boolean
  voice_id: string | null
  voice_name: string | null
  voice_settings: VoiceSettings
}

export class AvatarError extends Error {
  constructor(message: string, readonly code: "not_found" | "invalid" | "missing_file" = "invalid") {
    super(message)
    this.name = "AvatarError"
  }
}

async function avatars() {
  return col<AvatarDoc>(COLLECTION)
}

/** Avatar listo para la interfaz: indica si la foto sigue en el disco. */
export type AvatarView = AvatarDoc & { available: boolean }

export const toView = (a: AvatarDoc): AvatarView => ({ ...a, voice_settings: normalizeVoiceSettings(a.voice_settings), available: existsSync(a.face_path) })

export async function listAvatars(userId: string): Promise<AvatarView[]> {
  const all = (await (await avatars()).scan({})).map((e) => e.doc).filter((a) => a.user_id === userId)
  return all.sort((a, b) => b.updated_at - a.updated_at).map(toView)
}

export async function getAvatar(id: string): Promise<AvatarDoc> {
  const e = await (await avatars()).get(id)
  if (!e) throw new AvatarError(`No existe el avatar ${id}.`, "not_found")
  return e.doc
}

/** Huella del contenido de la foto: la misma imagen subida en varios reels cuenta como un solo avatar. */
async function sha256Of(artifactId: string): Promise<string | null> {
  return (await (await col<ArtifactDoc>("artifacts")).get(artifactId))?.doc.sha256 ?? null
}

/**
 * Guarda (o actualiza) el avatar de un rostro. Se identifica por el CONTENIDO de la foto: subir el mismo rostro en varios reels
 * nunca duplica la entrada, y el último nombre y voz elegidos pasan a ser los de la biblioteca. Exige el consentimiento.
 */
export async function upsertAvatar(userId: string, src: AvatarSource): Promise<AvatarDoc | null> {
  if (!src.face_artifact_id || !src.face_path || !src.face_consent) return null
  const c = await avatars()
  const mine = (await c.scan({})).filter((e) => e.doc.user_id === userId)
  const hash = await sha256Of(src.face_artifact_id)
  let existing = mine.find((e) => e.doc.face_artifact_id === src.face_artifact_id)
  if (!existing && hash) {
    for (const e of mine) {
      if ((await sha256Of(e.doc.face_artifact_id)) === hash) { existing = e; break }
    }
  }
  const now = Date.now()
  // Si ya había un avatar con esa misma foto se conserva su archivo mientras siga en el disco.
  const keepFile = existing && existsSync(existing.doc.face_path)
  const doc: AvatarDoc = {
    id: existing?.doc.id ?? randomUUID(), user_id: userId,
    name: (src.name.trim() || existing?.doc.name || "Mi avatar").slice(0, 60),
    description: (src.description ?? "").slice(0, 2000),
    face_artifact_id: keepFile ? existing!.doc.face_artifact_id : src.face_artifact_id, face_path: keepFile ? existing!.doc.face_path : src.face_path,
    voice_id: src.voice_id, voice_name: src.voice_id ? src.voice_name : null,
    voice_settings: normalizeVoiceSettings(src.voice_settings),
    created_at: existing?.doc.created_at ?? now, updated_at: now,
  }
  await c.put(doc.id, doc, existing ? { expectedVersion: existing.version } : undefined)
  return doc
}

export async function renameAvatar(id: string, patch: { name?: string; description?: string }): Promise<AvatarDoc> {
  const c = await avatars()
  const e = await c.get(id)
  if (!e) throw new AvatarError(`No existe el avatar ${id}.`, "not_found")
  const name = patch.name === undefined ? e.doc.name : patch.name.trim()
  if (!name) throw new AvatarError("El avatar necesita un nombre.")
  const doc = { ...e.doc, name: name.slice(0, 60), description: patch.description === undefined ? e.doc.description : patch.description.slice(0, 2000), updated_at: Date.now() }
  await c.put(id, doc, { expectedVersion: e.version })
  return doc
}

/** Quita el avatar de la biblioteca. La foto sigue en tu carpeta. */
export async function deleteAvatar(id: string): Promise<void> {
  const c = await avatars()
  if (!(await c.get(id))) throw new AvatarError(`No existe el avatar ${id}.`, "not_found")
  await c.delete(id)
}
