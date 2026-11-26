/**
 * Estudio de video: proyectos de reel con guion, escenas, personajes y producción.
 *
 * Un proyecto es un documento (`videoProjects`) con el brief, las escenas (cada una
 * un clip de 3–15 s) y los personajes (imagen de Nano Banana que sirve de referencia
 * para que el personaje se vea igual en todos los clips). Producir cuesta dinero, así
 * que sigue una regla dura: solo se produce un proyecto cuyo costo estimado fue
 * APROBADO por el usuario desde la interfaz (`approveProject`). Las tools de los
 * agentes no pueden aprobar; cualquier cambio que altere el costo retira la aprobación.
 *
 * La producción corre en segundo plano (un clip tarda más de un minuto) y deja su
 * avance en el propio documento: la interfaz lo consulta con sondeo.
 */
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { col } from "../storage/hive"
import { createArtifact } from "../artifacts/store"
import { generateImage, apiKeyFor, type ReferenceImage } from "../multimodal/image-generation"
import {
  MAX_CLIP_SECONDS, MAX_FRAME_CLIP_SECONDS, MIN_CLIP_SECONDS, VIDEO_ASPECT_RATIOS, VIDEO_RESOLUTIONS,
  estimateClipCostUsd, generateVideoClip, VideoGenerationError,
  type VideoAspectRatio, type VideoResolution,
} from "../multimodal/video-generation"
import {
  DEFAULT_VOICE_SETTINGS, alignWords, burnSubtitles, convertVoice, durationOf, extractAudio, isVoiceEnabled, mixDialogue, normalizeVoiceSettings, replaceAudio,
  speechSpan, spreadWords, stripAudioTags, synthesizeLine, synthesizeLineTimed, warpToTiming, type VoiceSettings, type WordTiming,
} from "./voice"
import {
  burnOverlays, effectiveTransition, joinWithTransitions, normalizeGraphic, normalizeReelStyle, sceneStarts,
  type GraphicsStyle, type OverlaySpec, type ReelStyle, type SceneGraphic, type SubtitleStyle, type TransitionStyle,
} from "./render"
import { AvatarError, getAvatar, upsertAvatar } from "./avatars"
import { logger } from "../utils/logger"

const log = logger.child("video-studio")

const COLLECTION = "videoProjects"
export const STUDIO_IMAGE_MODEL = "gemini-nano-banana-2.1"
/** Carpeta del estudio dentro del workspace del agente (o ~/Hive): una subcarpeta por tipo. */
export const STUDIO_FOLDER = "estudio-videos"
export const STUDIO_IMAGES_FOLDER = `${STUDIO_FOLDER}/imagenes`
export const STUDIO_VIDEOS_FOLDER = `${STUDIO_FOLDER}/videos`
/** Estimado por imagen de personaje (Nano Banana). Aproximado: la factura de Google manda. */
export const IMAGE_COST_ESTIMATE_USD = 0.04
export const MAX_SCENES = 20
export const MAX_CHARACTERS = 4
/** Tolerancia entre el estimado aprobado y el costo real (los tokens varían un poco por clip). */
const APPROVAL_TOLERANCE = 1.25
/** Duración máxima de un reel (suma de escenas). */
export const MAX_PROJECT_SECONDS = 90

export type SceneStatus = "pending" | "generating" | "done" | "failed"
export type ProjectStatus = "draft" | "ready" | "producing" | "done" | "failed"

export interface StudioCharacter {
  id: string
  name: string
  description: string
  /** Avatar generado con Nano Banana (hoja de referencia del personaje). */
  image_artifact_id: string | null
  image_path: string | null
  /** Foto de rostro subida por el usuario: ancla de identidad. El vestuario y la escena los decide el Director. */
  face_artifact_id: string | null
  face_path: string | null
  /** El usuario confirmó que el rostro es suyo o tiene permiso de la persona. Sin esto no se acepta la foto. */
  face_consent: boolean
  /** Voz de ElevenLabs para los diálogos del personaje (voice_id de su cuenta, propia o clonada). */
  voice_id: string | null
  voice_name: string | null
  /** Controles de ElevenLabs de esta voz: modelo (v4 por omisión), estabilidad, similitud y, según el modelo, estilo y velocidad. */
  voice_settings: VoiceSettings
}

export interface StudioScene {
  id: string
  seconds: number
  prompt: string
  character_ids: string[]
  status: SceneStatus
  artifact_id: string | null
  path: string | null
  interaction_id: string | null
  cost_usd: number
  error: string | null
  /** Vestuario del personaje en esta escena (lo decide el Director de video; el rostro no cambia). */
  wardrobe: string
  /** Escenografía y ambiente de esta escena (la decide el Director de video). */
  setting: string
  /** Lo que dice el personaje: se narra con su voz de ElevenLabs y se mezcla sobre el clip. */
  dialogue: string
  /** Imagen de la escena: la identidad de referencia vestida y ubicada según vestuario y escenografía. */
  look_artifact_id: string | null
  look_path: string | null
  /** Huella de lo que produjo el look; si cambia vestuario, escenografía o identidad, se rehace. */
  look_key: string | null
  /** Tiempos de cada palabra del diálogo dentro del clip (para los subtítulos del reel). Vacío si no hay diálogo. */
  captions: WordTiming[]
  /** Gráfico animado sobre esta escena (título, tercio inferior, dato destacado, llamada a la acción). Lo decide el Director. */
  graphic: SceneGraphic
}

/** Un paso de la producción, para contárselo al usuario en vivo («Escena 2 · Gemini está grabando el clip…»). */
export interface ActivityEvent {
  at: number
  /** Número de escena (1…n) o null si es del reel completo. */
  scene: number | null
  kind: "step" | "done" | "warn" | "error"
  text: string
}

export interface VideoProjectDoc {
  id: string
  user_id: string
  title: string
  brief: string
  script: string
  aspect_ratio: VideoAspectRatio
  resolution: VideoResolution
  /** Duración que el usuario quiere (guía para el guion); el costo sale de las escenas. */
  target_seconds: number
  characters: StudioCharacter[]
  scenes: StudioScene[]
  status: ProjectStatus
  /** Costo aprobado por el usuario en la interfaz (null = sin aprobar). */
  approved_cost_usd: number | null
  approved_at: number | null
  spent_usd: number
  final_artifact_id: string | null
  final_path: string | null
  error: string | null
  /** Subtítulos grabados en el reel (se graban al unir los clips, así que cambiarlo no cuesta nada). */
  subtitles: boolean
  /** Acabado del reel: estilo de subtítulos, transición entre escenas y gráficos. Se aplica al unir los clips (gratis). */
  style: ReelStyle
  /** Bitácora de la producción, la más reciente al final (máx. 80). */
  activity: ActivityEvent[]
  /** Lo que se está haciendo ahora y desde cuándo. */
  phase: { label: string; scene: number | null; since: number } | null
  workspace: string | null
  created_at: number
  updated_at: number
}

export { AvatarError }

export class StudioError extends Error {
  constructor(message: string, readonly code: "not_found" | "invalid" | "not_approved" | "busy" | "no_key" = "invalid") {
    super(message)
    this.name = "StudioError"
  }
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000
const shortId = () => randomUUID().slice(0, 8)

// ─── Estado y costos ─────────────────────────────────────────────────────────

/** ¿Hay clave de Gemini? Es lo que activa el estudio y al agente Director de video. */
export async function isVideoStudioEnabled(): Promise<boolean> {
  return !!(await apiKeyFor("gemini"))
}

export interface ProjectCost {
  /** Clips que aún faltan por generar. */
  pending_scenes: number
  pending_seconds: number
  total_seconds: number
  /** Costo estimado de los clips pendientes. */
  estimated_usd: number
  /** Imágenes de escena (look) que faltan por generar con Nano Banana. */
  looks_pending: number
  /** Costo estimado de esas imágenes. */
  images_usd: number
  /** Lo que se aprueba y se tope: clips + imágenes de escena. */
  total_usd: number
  /** Caracteres de diálogo que se narrarán con ElevenLabs (se cobra aparte, por caracteres). */
  dialogue_chars: number
}

type CostInput = Pick<VideoProjectDoc, "scenes" | "resolution" | "characters" | "aspect_ratio">

/** Imagen de identidad del personaje: la foto de rostro del usuario o, si no hay, su avatar generado. */
export const identityPath = (c: StudioCharacter | undefined): string | null => c?.face_path ?? c?.image_path ?? null

function identityOf(p: Pick<VideoProjectDoc, "characters">, s: StudioScene): StudioCharacter[] {
  return s.character_ids
    .map((cid) => p.characters.find((c) => c.id === cid))
    .filter((c): c is StudioCharacter => !!c && !!identityPath(c))
}

/** Huella del look: cambia si cambia el vestuario, la escena, el formato o la identidad usada. */
export function lookKeyFor(p: Pick<VideoProjectDoc, "characters" | "aspect_ratio">, s: StudioScene): string {
  const who = identityOf(p, s).map((c) => `${c.id}:${c.face_artifact_id ?? c.image_artifact_id}:${c.description}`).join("|")
  return createHash("sha256").update(`${s.wardrobe}\n${s.setting}\n${p.aspect_ratio}\n${who}`).digest("hex").slice(0, 16)
}

/** ¿La escena necesita una imagen de escena? Sí si hay identidad de referencia y alguien decidió vestuario o escenografía. */
export function sceneNeedsLook(p: Pick<VideoProjectDoc, "characters" | "aspect_ratio">, s: StudioScene): boolean {
  return (s.wardrobe.trim() !== "" || s.setting.trim() !== "") && identityOf(p, s).length > 0
}

function lookIsCurrent(p: Pick<VideoProjectDoc, "characters" | "aspect_ratio">, s: StudioScene): boolean {
  return !!s.look_path && s.look_key === lookKeyFor(p, s)
}

export function projectCost(p: CostInput): ProjectCost {
  const pending = p.scenes.filter((s) => s.status !== "done")
  const estimated = pending.reduce((sum, s) => sum + estimateClipCostUsd(p.resolution, s.seconds), 0)
  const looks = pending.filter((s) => sceneNeedsLook(p, s) && !lookIsCurrent(p, s)).length
  const images = round4(looks * IMAGE_COST_ESTIMATE_USD)
  return {
    pending_scenes: pending.length,
    pending_seconds: pending.reduce((sum, s) => sum + s.seconds, 0),
    total_seconds: p.scenes.reduce((sum, s) => sum + s.seconds, 0),
    estimated_usd: round4(estimated),
    looks_pending: looks,
    images_usd: images,
    total_usd: round4(estimated + images),
    dialogue_chars: pending.reduce((sum, s) => sum + (s.dialogue?.trim().length ?? 0), 0),
  }
}

/** Documentos guardados antes de añadir rostro, vestuario o voz: se completan con valores por omisión. */
function normalize(doc: VideoProjectDoc): VideoProjectDoc {
  for (const c of doc.characters) {
    c.face_artifact_id ??= null
    c.face_path ??= null
    c.face_consent ??= false
    c.voice_id ??= null
    c.voice_name ??= null
    c.voice_settings = normalizeVoiceSettings(c.voice_settings ?? DEFAULT_VOICE_SETTINGS)
  }
  for (const s of doc.scenes) {
    s.wardrobe ??= ""
    s.setting ??= ""
    s.dialogue ??= ""
    s.look_artifact_id ??= null
    s.look_path ??= null
    s.look_key ??= null
    s.captions ??= []
    s.graphic = normalizeGraphic(s.graphic)
  }
  doc.subtitles ??= true
  doc.style = normalizeReelStyle(doc.style)
  doc.activity ??= []
  doc.phase ??= null
  return doc
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

async function projects() {
  return col<VideoProjectDoc>(COLLECTION)
}

export async function getProject(id: string): Promise<VideoProjectDoc> {
  const entry = await (await projects()).get(id)
  if (!entry) throw new StudioError(`No existe el proyecto de video ${id}.`, "not_found")
  return normalize(entry.doc)
}

export async function listProjects(userId: string): Promise<VideoProjectDoc[]> {
  const all = (await (await projects()).scan({})).map((e) => normalize(e.doc)).filter((p) => p.user_id === userId)
  return all.sort((a, b) => b.updated_at - a.updated_at)
}

/** Guarda con control de versión; reintenta si la producción en segundo plano escribió en medio. */
async function mutate(id: string, fn: (p: VideoProjectDoc) => void): Promise<VideoProjectDoc> {
  const c = await projects()
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await c.get(id)
    if (!entry) throw new StudioError(`No existe el proyecto de video ${id}.`, "not_found")
    const next: VideoProjectDoc = normalize(structuredClone(entry.doc))
    fn(next)
    next.updated_at = Date.now()
    try {
      await c.put(id, next, { expectedVersion: entry.version })
      return next
    } catch (err) {
      if (attempt === 4) throw err
    }
  }
  throw new StudioError("No se pudo guardar el proyecto.")
}

function checkAspect(v: unknown): VideoAspectRatio {
  if ((VIDEO_ASPECT_RATIOS as readonly string[]).includes(v as string)) return v as VideoAspectRatio
  throw new StudioError(`Formato inválido: usa ${VIDEO_ASPECT_RATIOS.join(" o ")}.`)
}
function checkResolution(v: unknown): VideoResolution {
  if ((VIDEO_RESOLUTIONS as readonly string[]).includes(v as string)) return v as VideoResolution
  throw new StudioError(`Resolución inválida: usa ${VIDEO_RESOLUTIONS.join(", ")}.`)
}
function checkSeconds(v: unknown, what: string, max = MAX_CLIP_SECONDS): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < MIN_CLIP_SECONDS || n > max) {
    throw new StudioError(`${what}: la duración debe estar entre ${MIN_CLIP_SECONDS} y ${max} s.`)
  }
  return Math.round(n)
}

export async function createProject(input: {
  userId: string
  title: string
  brief?: string
  aspectRatio?: string
  resolution?: string
  targetSeconds?: number
  workspace?: string | null
  /** Empieza el reel con este avatar guardado como personaje (rostro y voz incluidos). */
  avatarId?: string
}): Promise<VideoProjectDoc> {
  const title = input.title?.trim()
  if (!title) throw new StudioError("Falta el título del reel.")
  const target = input.targetSeconds === undefined ? 15 : Number(input.targetSeconds)
  if (!Number.isFinite(target) || target < MIN_CLIP_SECONDS || target > MAX_PROJECT_SECONDS) {
    throw new StudioError(`La duración del reel debe estar entre ${MIN_CLIP_SECONDS} y ${MAX_PROJECT_SECONDS} s.`)
  }
  const now = Date.now()
  const doc: VideoProjectDoc = {
    id: randomUUID(),
    user_id: input.userId,
    title: title.slice(0, 120),
    brief: (input.brief ?? "").slice(0, 5000),
    script: "",
    aspect_ratio: input.aspectRatio ? checkAspect(input.aspectRatio) : "9:16",
    resolution: input.resolution ? checkResolution(input.resolution) : "720p",
    target_seconds: Math.round(target),
    characters: [],
    scenes: [],
    status: "draft",
    approved_cost_usd: null,
    approved_at: null,
    spent_usd: 0,
    final_artifact_id: null,
    final_path: null,
    error: null,
    subtitles: true,
    style: normalizeReelStyle(),
    activity: [],
    phase: null,
    workspace: input.workspace ?? null,
    created_at: now,
    updated_at: now,
  }
  await (await projects()).put(doc.id, doc)
  if (input.avatarId) {
    try { return await applyAvatar(doc.id, input.avatarId) }
    catch (err) { await (await projects()).delete(doc.id).catch(() => {}); throw err }
  }
  return doc
}

export interface ScenePatch {
  id?: string
  seconds: number
  prompt: string
  character_ids?: string[]
  wardrobe?: string
  setting?: string
  dialogue?: string
  graphic?: Partial<SceneGraphic>
}
export interface CharacterPatch {
  id?: string
  name: string
  description: string
  voice_id?: string | null
  voice_name?: string | null
  voice_settings?: Partial<VoiceSettings>
}

export interface ProjectPatch {
  title?: string
  brief?: string
  script?: string
  aspect_ratio?: string
  resolution?: string
  target_seconds?: number
  scenes?: ScenePatch[]
  characters?: CharacterPatch[]
  subtitles?: boolean
  style?: { subtitles?: Partial<SubtitleStyle>; transition?: Partial<TransitionStyle>; graphics?: Partial<GraphicsStyle> }
}

function assertEditable(p: VideoProjectDoc) {
  if (p.status === "producing") throw new StudioError("El proyecto se está produciendo; espera a que termine.", "busy")
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<VideoProjectDoc> {
  assertEditable(await getProject(id))
  const out = await mutate(id, (p) => {
    assertEditable(p)
    let costChanged = false
    let finalStale = false
    if (patch.title !== undefined) p.title = patch.title.trim().slice(0, 120) || p.title
    if (patch.brief !== undefined) p.brief = patch.brief.slice(0, 5000)
    if (patch.script !== undefined) p.script = patch.script.slice(0, 20_000)
    if (patch.style !== undefined) {
      // El acabado se aplica al unir los clips: cambiarlo solo rehace la unión (gratis), no los clips.
      const next = normalizeReelStyle({
        subtitles: { ...p.style.subtitles, ...patch.style.subtitles }, transition: { ...p.style.transition, ...patch.style.transition },
        graphics: { ...p.style.graphics, ...patch.style.graphics },
      })
      if (JSON.stringify(next) !== JSON.stringify(p.style)) { p.style = next; p.final_artifact_id = null; p.final_path = null }
    }
    if (patch.subtitles !== undefined && typeof patch.subtitles === "boolean" && patch.subtitles !== p.subtitles) {
      // Los subtítulos se graban al unir los clips: cambiarlos solo rehace la unión (gratis), no los clips.
      p.subtitles = patch.subtitles
      p.final_artifact_id = null
      p.final_path = null
    }
    if (patch.target_seconds !== undefined) {
      const t = Number(patch.target_seconds)
      if (!Number.isFinite(t) || t < MIN_CLIP_SECONDS || t > MAX_PROJECT_SECONDS) {
        throw new StudioError(`La duración del reel debe estar entre ${MIN_CLIP_SECONDS} y ${MAX_PROJECT_SECONDS} s.`)
      }
      p.target_seconds = Math.round(t)
    }
    if (patch.aspect_ratio !== undefined) {
      const a = checkAspect(patch.aspect_ratio)
      if (a !== p.aspect_ratio) {
        // Un clip ya generado en otro formato no sirve para el reel: se rehace.
        p.aspect_ratio = a
        for (const s of p.scenes) Object.assign(s, { status: "pending", artifact_id: null, path: null, interaction_id: null, error: null, captions: [] })
        costChanged = true
      }
    }
    if (patch.resolution !== undefined) {
      const r = checkResolution(patch.resolution)
      if (r !== p.resolution) {
        p.resolution = r
        for (const s of p.scenes) Object.assign(s, { status: "pending", artifact_id: null, path: null, interaction_id: null, error: null, captions: [] })
        costChanged = true
      }
    }
    if (patch.characters !== undefined) {
      if (patch.characters.length > MAX_CHARACTERS) throw new StudioError(`Máximo ${MAX_CHARACTERS} personajes.`)
      const byId = new Map(p.characters.map((c) => [c.id, c]))
      p.characters = patch.characters.map((c) => {
        const name = c.name?.trim()
        if (!name) throw new StudioError("Cada personaje necesita un nombre.")
        const prev = c.id ? byId.get(c.id) : undefined
        const description = (c.description ?? "").slice(0, 2000)
        // Si cambia la descripción, la imagen ya no corresponde y se vuelve a generar.
        const sameLook = prev && prev.description === description
        const voiceId = c.voice_id === undefined ? (prev?.voice_id ?? null) : (c.voice_id || null)
        return {
          id: prev?.id ?? shortId(), name: name.slice(0, 60), description,
          image_artifact_id: sameLook ? prev.image_artifact_id : null,
          image_path: sameLook ? prev.image_path : null,
          // El rostro del usuario es la identidad: no depende de la descripción y no se pierde al editarla.
          face_artifact_id: prev?.face_artifact_id ?? null,
          face_path: prev?.face_path ?? null,
          face_consent: prev?.face_consent ?? false,
          voice_id: voiceId,
          voice_name: voiceId ? (c.voice_name === undefined ? (prev?.voice_name ?? null) : (c.voice_name || null)) : null,
          voice_settings: normalizeVoiceSettings(c.voice_settings === undefined ? prev?.voice_settings : { ...prev?.voice_settings, ...c.voice_settings }),
        }
      })
      const valid = new Set(p.characters.map((c) => c.id))
      for (const s of p.scenes) s.character_ids = s.character_ids.filter((cid) => valid.has(cid))
    }
    if (patch.scenes !== undefined) {
      if (patch.scenes.length > MAX_SCENES) throw new StudioError(`Máximo ${MAX_SCENES} escenas.`)
      const byId = new Map(p.scenes.map((s) => [s.id, s]))
      const valid = new Set(p.characters.map((c) => c.id))
      const next = patch.scenes.map((s, i) => {
        const prompt = s.prompt?.trim()
        if (!prompt) throw new StudioError(`La escena ${i + 1} no tiene descripción.`)
        const ids = (s.character_ids ?? []).filter((cid) => valid.has(cid)).slice(0, 2)
        const maxSeconds = ids.length === 2 ? MAX_FRAME_CLIP_SECONDS : MAX_CLIP_SECONDS
        const seconds = checkSeconds(s.seconds, `Escena ${i + 1}`, maxSeconds)
        const prev = s.id ? byId.get(s.id) : undefined
        const wardrobe = (s.wardrobe ?? prev?.wardrobe ?? "").trim().slice(0, 1000)
        const setting = (s.setting ?? prev?.setting ?? "").trim().slice(0, 1000)
        const dialogue = (s.dialogue ?? prev?.dialogue ?? "").trim().slice(0, 1500)
        const graphic = normalizeGraphic(s.graphic ?? prev?.graphic)
        const unchanged = prev && prev.prompt === prompt && prev.seconds === seconds
          && prev.character_ids.join() === ids.join() && prev.status === "done"
          && prev.wardrobe === wardrobe && prev.setting === setting && prev.dialogue === dialogue
        // Una escena que no cambió conserva su clip (no se paga dos veces). El gráfico se dibuja al unir: cambiarlo no invalida el clip.
        if (unchanged) {
          if (JSON.stringify(prev.graphic) !== JSON.stringify(graphic)) { finalStale = true; return { ...prev, graphic } }
          return prev
        }
        // El look (imagen de escena) se conserva mientras su huella siga igual; si no, se rehace al producir.
        return {
          id: prev?.id ?? shortId(), seconds, prompt: prompt.slice(0, 4000), character_ids: ids,
          status: "pending" as SceneStatus, artifact_id: null, path: null, interaction_id: null, cost_usd: 0, error: null,
          wardrobe, setting, dialogue,
          look_artifact_id: prev?.look_artifact_id ?? null, look_path: prev?.look_path ?? null, look_key: prev?.look_key ?? null,
          captions: [], graphic,
        }
      })
      p.scenes = next
      costChanged = true
    }
    const total = p.scenes.reduce((sum, s) => sum + s.seconds, 0)
    if (total > MAX_PROJECT_SECONDS) throw new StudioError(`El reel suma ${total} s; el máximo es ${MAX_PROJECT_SECONDS} s.`)
    if (finalStale) { p.final_artifact_id = null; p.final_path = null }
    if (costChanged) {
      p.approved_cost_usd = null
      p.approved_at = null
      p.final_artifact_id = null
      p.final_path = null
    }
    p.status = p.scenes.length > 0 ? (p.scenes.every((s) => s.status === "done") && p.final_path ? "done" : "ready") : "draft"
    p.error = null
  })
  // El nombre y la voz que se elijan para un rostro propio pasan a ser los de su avatar guardado.
  if (patch.characters !== undefined) await syncAvatars(out)
  return out
}

export async function deleteProject(id: string): Promise<void> {
  const p = await getProject(id)
  assertEditable(p)
  await (await projects()).delete(id)
}

// ─── Aprobación de costo (solo desde la interfaz) ────────────────────────────

export async function approveProject(id: string): Promise<VideoProjectDoc> {
  if (!(await isVideoStudioEnabled())) throw new StudioError("Conecta una API key de Gemini en Providers.", "no_key")
  const p = await getProject(id)
  if (p.scenes.length === 0) throw new StudioError("El proyecto no tiene escenas: pide el guion primero.")
  const cost = projectCost(p)
  if (cost.pending_scenes === 0) throw new StudioError("No hay clips pendientes: todo está generado.")
  return mutate(id, (d) => {
    assertEditable(d)
    d.approved_cost_usd = projectCost(d).total_usd
    d.approved_at = Date.now()
  })
}

export async function revokeApproval(id: string): Promise<VideoProjectDoc> {
  return mutate(id, (d) => {
    d.approved_cost_usd = null
    d.approved_at = null
  })
}

// ─── Personajes (Nano Banana) ────────────────────────────────────────────────

export const MAX_FACE_BYTES = 10 * 1024 * 1024

function readReference(path: string | null): ReferenceImage | null {
  if (!path) return null
  try {
    const bytes = new Uint8Array(readFileSync(path))
    const mimeType = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg"
    return { bytes, mimeType }
  } catch { return null }
}

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp"
  return null
}

function characterPrompt(c: StudioCharacter, hasFace: boolean): string {
  if (hasFace) {
    return `Character reference sheet for a short vertical video, based on the person in the attached reference photo. ` +
      `Keep their face, skin tone, hair and facial features EXACTLY identical to the photo; do not beautify or alter the face. ` +
      `Full body, centered, clean simple background, neutral standing pose. ` +
      `Character: ${c.name}. Base outfit and style: ${c.description}`.trim()
  }
  return `Character reference sheet image for a short vertical video. Single character, full body, centered, clean simple background, ` +
    `consistent design that can be reused across many scenes. Character: ${c.name}. ${c.description}`.trim()
}

/** Rehace lo que dependía de la identidad de un personaje: clips de sus escenas, reel final y aprobación. */
function invalidateCharacter(d: VideoProjectDoc, characterId: string) {
  for (const s of d.scenes) {
    if (s.character_ids.includes(characterId)) {
      Object.assign(s, { status: "pending", artifact_id: null, path: null, interaction_id: null, error: null, captions: [] })
    }
  }
  d.final_artifact_id = null
  d.final_path = null
  d.approved_cost_usd = null
  d.approved_at = null
}

export async function generateCharacterImage(
  projectId: string, characterId: string, opts: { fetchImpl?: typeof fetch } = {},
): Promise<VideoProjectDoc> {
  const p = await getProject(projectId)
  assertEditable(p)
  const character = p.characters.find((c) => c.id === characterId)
  if (!character) throw new StudioError(`El proyecto no tiene el personaje ${characterId}.`, "not_found")
  if (!(await isVideoStudioEnabled())) throw new StudioError("Conecta una API key de Gemini en Providers.", "no_key")
  const face = readReference(character.face_path)
  const img = await generateImage({
    prompt: characterPrompt(character, !!face),
    aspectRatio: p.aspect_ratio === "9:16" ? "portrait" : "landscape",
    modelId: STUDIO_IMAGE_MODEL,
    referenceImages: face ? [face] : undefined,
  }, opts)
  const artifact = await createArtifact({
    bytes: img.bytes, mimeType: img.mimeType, kind: "generated_image", userId: p.user_id, expiresAt: null,
    visible: { workspace: p.workspace, folder: STUDIO_IMAGES_FOLDER, label: `${p.title} ${character.name}` },
  })
  return mutate(projectId, (d) => {
    const c = d.characters.find((x) => x.id === characterId)
    if (!c) return
    c.image_artifact_id = artifact.id
    c.image_path = artifact.path
    d.spent_usd = round4(d.spent_usd + IMAGE_COST_ESTIMATE_USD)
    // Con foto de rostro la identidad sigue siendo la foto; sin ella, el avatar es la identidad y las escenas hechas con otro se rehacen.
    if (!c.face_path) invalidateCharacter(d, characterId)
  })
}

/**
 * Guarda la foto de rostro que sube el usuario como identidad del personaje.
 * Exige confirmar que el rostro es suyo o que tiene permiso de la persona: es lo que evita
 * suplantaciones. Solo acepta JPEG, PNG o WebP (por contenido, no por extensión).
 */
export async function setCharacterFace(
  projectId: string, characterId: string, input: { bytes: Uint8Array; consent: boolean },
): Promise<VideoProjectDoc> {
  const p = await getProject(projectId)
  assertEditable(p)
  const character = p.characters.find((c) => c.id === characterId)
  if (!character) throw new StudioError(`El proyecto no tiene el personaje ${characterId}.`, "not_found")
  if (!input.consent) {
    throw new StudioError("Confirma que el rostro es tuyo o que tienes permiso de la persona para usarlo antes de subir la foto.")
  }
  if (input.bytes.byteLength === 0) throw new StudioError("La imagen está vacía.")
  if (input.bytes.byteLength > MAX_FACE_BYTES) throw new StudioError("La imagen pesa más de 10 MB.")
  const mimeType = sniffImage(input.bytes)
  if (!mimeType) throw new StudioError("Sube una imagen JPEG, PNG o WebP.")
  const artifact = await createArtifact({
    bytes: input.bytes, mimeType, kind: "uploaded_image", userId: p.user_id, expiresAt: null,
    visible: { workspace: p.workspace, folder: STUDIO_IMAGES_FOLDER, label: `${p.title} ${character.name} rostro` },
  })
  const updated = await mutate(projectId, (d) => {
    const c = d.characters.find((x) => x.id === characterId)
    if (!c) return
    c.face_artifact_id = artifact.id
    c.face_path = artifact.path
    c.face_consent = true
    invalidateCharacter(d, characterId)
  })
  // El rostro se guarda en «Mis avatares» para elegirlo en cualquier reel sin volver a subirlo.
  await syncAvatars(updated, [characterId])
  return updated
}

const backfilled = new Set<string>()

/**
 * Recoge en «Mis avatares» los rostros que el usuario subió antes de que existiera la biblioteca. Corre una vez por proceso y
 * usuario (la primera vez que se abre la biblioteca) y es idempotente: un rostro ya guardado no se duplica.
 */
export async function backfillAvatars(userId: string): Promise<number> {
  if (backfilled.has(userId)) return 0
  backfilled.add(userId)
  let added = 0
  // Del más viejo al más nuevo: si un mismo rostro está en varios reels, queda el nombre y la voz del último.
  const mine = (await listProjects(userId)).sort((a, b) => a.updated_at - b.updated_at)
  for (const p of mine) {
    for (const c of p.characters) {
      if (!c.face_artifact_id || !c.face_path || !c.face_consent || !existsSync(c.face_path)) continue
      const before = await upsertAvatarCount(userId)
      await upsertAvatar(userId, c).catch(() => null)
      if ((await upsertAvatarCount(userId)) > before) added++
    }
  }
  return added
}
const upsertAvatarCount = async (userId: string) => (await (await import("./avatars")).listAvatars(userId)).length

/** Guarda en la biblioteca los personajes con rostro propio (o solo los indicados). Nunca falla el flujo principal. */
async function syncAvatars(p: VideoProjectDoc, only?: string[]): Promise<void> {
  for (const c of p.characters) {
    if (only && !only.includes(c.id)) continue
    await upsertAvatar(p.user_id, c).catch((err) => log.warn(`No se pudo guardar el avatar de ${c.name}: ${(err as Error).message}`))
  }
}

/**
 * Pone un avatar guardado en el proyecto: su rostro (sin volver a subirlo), su nombre y su voz con sus ajustes.
 * Con `characterId` reemplaza a ese personaje; sin él agrega uno nuevo.
 */
export async function applyAvatar(projectId: string, avatarId: string, characterId?: string): Promise<VideoProjectDoc> {
  const p = await getProject(projectId)
  assertEditable(p)
  const avatar = await getAvatar(avatarId)
  if (avatar.user_id !== p.user_id) throw new StudioError("Ese avatar no es de este usuario.", "not_found")
  if (!existsSync(avatar.face_path)) {
    throw new StudioError(`La foto de «${avatar.name}» ya no está en tu carpeta (${avatar.face_path}). Súbela de nuevo.`, "invalid")
  }
  if (characterId && !p.characters.some((c) => c.id === characterId)) throw new StudioError(`El proyecto no tiene el personaje ${characterId}.`, "not_found")
  if (!characterId && p.characters.length >= MAX_CHARACTERS) throw new StudioError(`Máximo ${MAX_CHARACTERS} personajes.`)
  return mutate(projectId, (d) => {
    const fill = (c: StudioCharacter) => {
      c.face_artifact_id = avatar.face_artifact_id
      c.face_path = avatar.face_path
      c.face_consent = true
      c.voice_id = avatar.voice_id
      c.voice_name = avatar.voice_name
      c.voice_settings = normalizeVoiceSettings(avatar.voice_settings)
    }
    if (characterId) {
      const c = d.characters.find((x) => x.id === characterId)!
      fill(c)
      // El nombre del avatar sustituye al provisional; uno que el usuario ya escribió se respeta.
      if (!c.name.trim() || c.name === "Protagonista") c.name = avatar.name
      if (!c.description.trim()) c.description = avatar.description
      invalidateCharacter(d, characterId)
    } else {
      const c: StudioCharacter = {
        id: shortId(), name: avatar.name, description: avatar.description, image_artifact_id: null, image_path: null,
        face_artifact_id: null, face_path: null, face_consent: false, voice_id: null, voice_name: null, voice_settings: normalizeVoiceSettings(avatar.voice_settings),
      }
      fill(c)
      d.characters.push(c)
    }
  })
}

export async function clearCharacterFace(projectId: string, characterId: string): Promise<VideoProjectDoc> {
  assertEditable(await getProject(projectId))
  return mutate(projectId, (d) => {
    const c = d.characters.find((x) => x.id === characterId)
    if (!c) throw new StudioError(`El proyecto no tiene el personaje ${characterId}.`, "not_found")
    c.face_artifact_id = null
    c.face_path = null
    c.face_consent = false
    invalidateCharacter(d, characterId)
  })
}

// ─── Imagen de escena (look) ─────────────────────────────────────────────────

function lookPrompt(p: VideoProjectDoc, s: StudioScene, who: StudioCharacter[]): string {
  const names = who.map((c) => c.name).join(" and ")
  return `Keyframe for a ${p.aspect_ratio} video scene. The attached reference image(s) define the exact identity of ${names}: ` +
    `keep their face, skin tone, hair, body proportions and visual style EXACTLY as in the reference(s); never alter or beautify the face. ` +
    `Change only what is described here.\n` +
    (s.wardrobe.trim() ? `Wardrobe: ${s.wardrobe.trim()}.\n` : "") +
    (s.setting.trim() ? `Set and environment: ${s.setting.trim()}.\n` : "") +
    `Moment of the scene: ${s.prompt.trim()}\n` +
    `Compose it as the opening frame of the shot, framed for ${p.aspect_ratio}.`
}

/** Genera (o reutiliza) la imagen de escena: identidad de referencia + vestuario + escenografía decididos por el Director. */
async function ensureLook(
  projectId: string, sceneId: string, opts: { fetchImpl?: typeof fetch },
): Promise<{ look: StudioScene; generated: boolean }> {
  const p = await getProject(projectId)
  const scene = p.scenes.find((x) => x.id === sceneId)!
  if (!sceneNeedsLook(p, scene) || lookIsCurrent(p, scene)) return { look: scene, generated: false }
  const who = identityOf(p, scene).slice(0, 4)
  const refs = who.map((c) => readReference(identityPath(c))).filter((r): r is ReferenceImage => !!r)
  if (refs.length === 0) return { look: scene, generated: false }
  const img = await generateImage({
    prompt: lookPrompt(p, scene, who),
    aspectRatio: p.aspect_ratio === "9:16" ? "portrait" : "landscape",
    modelId: STUDIO_IMAGE_MODEL,
    referenceImages: refs,
  }, opts)
  const index = p.scenes.findIndex((x) => x.id === sceneId) + 1
  const artifact = await createArtifact({
    bytes: img.bytes, mimeType: img.mimeType, kind: "generated_image", userId: p.user_id, expiresAt: null,
    visible: { workspace: p.workspace, folder: STUDIO_IMAGES_FOLDER, label: `${p.title} escena ${index} look` },
  })
  const key = lookKeyFor(p, scene)
  const updated = await mutate(projectId, (d) => {
    const s2 = d.scenes.find((x) => x.id === sceneId)
    if (!s2) return
    Object.assign(s2, { look_artifact_id: artifact.id, look_path: artifact.path, look_key: key })
    d.spent_usd = round4(d.spent_usd + IMAGE_COST_ESTIMATE_USD)
  })
  return { look: updated.scenes.find((x) => x.id === sceneId)!, generated: true }
}

// ─── Producción ──────────────────────────────────────────────────────────────

const running = new Set<string>()
export const isProducing = (id: string) => running.has(id)

/**
 * Cómo suena la escena: «speak» = el personaje habla la línea con los labios sincronizados (la voz de Gemini se
 * conserva o se cambia después por la de ElevenLabs); «silent» = narración aparte, sin que hable.
 */
type SceneVoice = "speak" | "silent"

function scenePrompt(p: VideoProjectDoc, s: StudioScene, voice: SceneVoice): string {
  const who = s.character_ids
    .map((cid) => p.characters.find((c) => c.id === cid))
    .filter((c): c is StudioCharacter => !!c)
    .map((c) => `${c.name}: ${c.description}`)
  const parts = [s.prompt]
  if (s.wardrobe.trim()) parts.push(`Wardrobe: ${s.wardrobe.trim()}.`)
  if (s.setting.trim()) parts.push(`Set: ${s.setting.trim()}.`)
  if (who.length) parts.push(`Keep the character(s) exactly as in the reference image(s), same face and look. ${who.join(" ")}`)
  const line = stripAudioTags(s.dialogue)
  if (line) {
    parts.push(voice === "speak"
      // El personaje HABLA: los labios se mueven con la voz. Sin música ni otras voces para que el audio quede limpio
      // (el cambio de voz de ElevenLabs lo agradece) y empezando pronto para que los subtítulos y la acción coincidan.
      ? `The character speaks directly to the viewer, in the same language as this line, saying exactly: "${line}". ` +
        "Natural lip movements perfectly in sync with the speech, starting to speak within the first half second, with gestures and expression that match the words. No background music, no other voices."
      : "No spoken dialogue in this shot: ambient sound and effects only. The character does not speak.")
  }
  return parts.join("\n")
}

/**
 * Une los clips en el orden de las escenas con ffmpeg y devuelve los bytes del reel.
 *
 * Primero copia los flujos sin recodificar: todos los clips salen del mismo modelo con los
 * mismos parámetros, así que es rápido, sin pérdida y no depende de qué codificadores trae el
 * ffmpeg de la máquina (el de Fedora, por ejemplo, no incluye libx264). Si la copia falla se
 * recodifica con el primer codificador H.264 disponible.
 */
export async function concatClips(paths: string[]): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "hive-reel-"))
  try {
    const list = join(dir, "list.txt")
    writeFileSync(list, paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"))
    const out = join(dir, "reel.mp4")
    const attempts: string[][] = [
      ["-c", "copy"],
      ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      ["-c:v", "libopenh264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      ["-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac"],
    ]
    let lastError = ""
    for (const codec of attempts) {
      rmSync(out, { force: true })
      let proc: ReturnType<typeof Bun.spawn>
      try {
        proc = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, ...codec, "-movflags", "+faststart", out],
          { stdout: "ignore", stderr: "pipe" })
      } catch {
        throw new Error("No se encontró ffmpeg: instálalo para poder unir los clips en un solo reel.")
      }
      const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()])
      if (code === 0) return new Uint8Array(readFileSync(out))
      lastError = err.slice(0, 300)
    }
    throw new Error(`ffmpeg falló al unir los clips: ${lastError}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface NarrationNote {
  kind: ActivityEvent["kind"]
  scene: number | null
  label: string
}

interface ProductionOptions {
  fetchImpl?: typeof fetch
  concat?: typeof concatClips
  /** Cada paso de la producción, para contárselo al usuario también en el chat cuando la inició el Director. */
  narrate?: (note: NarrationNote) => void | Promise<void>
  /** Sustitutos de ElevenLabs y de ffmpeg (tests). */
  voice?: {
    enabled?: boolean
    synthesize?: (input: { voiceId: string; text: string; settings?: Partial<VoiceSettings> }) => Promise<{ bytes: Uint8Array }>
    mix?: (clip: Uint8Array, voice: Uint8Array, mix?: { voiceGain?: number; ambientGain?: number }) => Promise<Uint8Array>
    extract?: (clip: Uint8Array) => Promise<Uint8Array>
    convert?: (input: { voiceId: string; audio: Uint8Array; settings?: Partial<VoiceSettings> }) => Promise<{ bytes: Uint8Array }>
    replace?: (clip: Uint8Array, audio: Uint8Array, gain?: number) => Promise<Uint8Array>
    align?: (input: { audio: Uint8Array; mimeType?: string; text: string }) => Promise<WordTiming[]>
    span?: (audio: Uint8Array) => Promise<{ start: number; end: number; duration: number }>
    synthTimed?: (input: { voiceId: string; text: string; settings?: Partial<VoiceSettings> }) => Promise<{ bytes: Uint8Array; words: WordTiming[] }>
    warp?: (tts: Uint8Array, from: WordTiming[], to: WordTiming[], totalSec: number) => Promise<Uint8Array>
  }
  /** Graba subtítulos y gráficos en el reel (tests). */
  burn?: (reel: Uint8Array, spec: OverlaySpec) => Promise<Uint8Array>
  /** Une los clips con transición (tests). */
  join?: (paths: string[], durations: number[], t: TransitionStyle) => Promise<Uint8Array>
  /** Duración real de un clip en segundos (tests). */
  duration?: (path: string) => Promise<number>
}

const MAX_ACTIVITY = 80

/** Anota un paso en la bitácora del proyecto (lo que ve el usuario en vivo) y lo manda a la narración del chat. */
async function note(id: string, opts: ProductionOptions, kind: ActivityEvent["kind"], scene: number | null, label: string): Promise<void> {
  const now = Date.now()
  await mutate(id, (d) => {
    d.activity.push({ at: now, scene, kind, text: label })
    if (d.activity.length > MAX_ACTIVITY) d.activity.splice(0, d.activity.length - MAX_ACTIVITY)
    // «done» y «warn» no cambian lo que se está haciendo ahora; «step» sí.
    if (kind === "step") d.phase = { label, scene, since: now }
  }).catch(() => { /* proyecto borrado */ })
  try { await opts.narrate?.({ kind, scene, label }) } catch (err) { log.warn(`Narración del estudio falló: ${(err as Error).message}`) }
}

const sceneLabel = (n: number, total: number) => `Escena ${n} de ${total}`

/**
 * Pone voz y tiempos a un clip que tiene diálogo.
 *  · «sync»: Gemini habló la línea (labios sincronizados) y ElevenLabs cambia esa voz por la del personaje
 *    conservando el tiempo; si falla, se queda la voz de Gemini y se avisa.
 *  · «narration»: ElevenLabs narra la línea sobre un clip en el que el personaje no habla.
 * Devuelve el clip y los tiempos de cada palabra para los subtítulos.
 */
async function dressClip(
  id: string, opts: ProductionOptions,
  ctx: { bytes: Uint8Array; scene: StudioScene; speaker: StudioCharacter | undefined; voiceOk: boolean; n: number; total: number },
): Promise<{ bytes: Uint8Array; words: WordTiming[] }> {
  const { scene, speaker, voiceOk, n, total } = ctx
  const label = sceneLabel(n, total)
  const text = stripAudioTags(scene.dialogue)
  const v = opts.voice
  let bytes = ctx.bytes
  let voiceAudio: Uint8Array | null = null
  let voiceMime = "audio/wav"
  const settings = speaker?.voice_settings

  if (speaker?.voice_id && voiceOk && settings?.mode === "narration") {
    await note(id, opts, "step", n, `${label} · Narrando con la voz «${speaker.voice_name ?? "del personaje"}» (ElevenLabs ${settings.model_id})…`)
    const line = await (v?.synthesize ?? synthesizeLine)({ voiceId: speaker.voice_id, text: scene.dialogue, settings })
    bytes = await (v?.mix ?? mixDialogue)(bytes, line.bytes, { voiceGain: settings.volume, ambientGain: settings.ambient_volume })
    voiceAudio = line.bytes
    voiceMime = "audio/mpeg"
  } else {
    // El habla de Gemini es el punto de partida: da los labios y el tiempo.
    voiceAudio = await (v?.extract ?? extractAudio)(bytes).catch(() => null)
    const who = speaker?.voice_name ?? "la del personaje"
    if (speaker?.voice_id && voiceOk && voiceAudio && settings?.mode === "convert") {
      await note(id, opts, "step", n, `${label} · Cambiando la voz de Gemini por «${who}» (ElevenLabs, cambio de voz)…`)
      try {
        const conv = await (v?.convert ?? convertVoice)({ voiceId: speaker.voice_id, audio: voiceAudio, settings })
        bytes = await (v?.replace ?? replaceAudio)(bytes, conv.bytes, settings?.volume ?? 1)
        voiceAudio = conv.bytes
        voiceMime = "audio/mpeg"
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        await note(id, opts, "warn", n, `${label} · No se pudo cambiar la voz (${why.slice(0, 140)}). Se conserva la voz de Gemini en esta escena.`)
      }
    } else if (speaker?.voice_id && voiceOk && voiceAudio && settings) {
      // Modo «sync»: TU voz (texto a voz) ajustada palabra por palabra a los tiempos del habla de Gemini, que es donde se mueven los labios.
      await note(id, opts, "step", n, `${label} · Generando la voz «${who}» (ElevenLabs ${settings.model_id}) y ajustándola palabra por palabra a los labios…`)
      try {
        // 1) cuándo dice Gemini cada palabra (los labios)
        let target: WordTiming[]
        try { target = await (v?.align ?? alignWords)({ audio: voiceAudio, mimeType: "audio/wav", text }) }
        catch { target = spreadWords(text, await (v?.span ?? speechSpan)(voiceAudio)) }
        // 2) la voz de ElevenLabs con sus propios tiempos
        const timed = await (v?.synthTimed ?? synthesizeLineTimed)({ voiceId: speaker.voice_id, text: scene.dialogue, settings })
        let own = timed.words
        if (own.length === 0) {
          try { own = await (v?.align ?? alignWords)({ audio: timed.bytes, mimeType: "audio/mpeg", text }) }
          catch { own = spreadWords(text, await (v?.span ?? speechSpan)(timed.bytes)) }
        }
        // 3) cada palabra de la voz cae en la ventana de la palabra de Gemini
        const warped = await (v?.warp ?? warpToTiming)(timed.bytes, own, target, scene.seconds)
        bytes = await (v?.replace ?? replaceAudio)(bytes, warped, settings.volume)
        return { bytes, words: target }
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        await note(id, opts, "warn", n, `${label} · No se pudo poner tu voz ajustada a los labios (${why.slice(0, 140)}). Se conserva la voz de Gemini en esta escena.`)
      }
    } else if (speaker?.voice_id && !voiceOk) {
      await note(id, opts, "warn", n, `${label} · ElevenLabs no está conectado: se usa la voz de Gemini.`)
    }
  }

  // Tiempos de cada palabra: alineado forzado de ElevenLabs; si no está disponible, detección del habla.
  let words: WordTiming[] = []
  if (voiceAudio && text) {
    await note(id, opts, "step", n, `${label} · Calculando cuándo se dice cada palabra para los subtítulos…`)
    try {
      words = await (v?.align ?? alignWords)({ audio: voiceAudio, mimeType: voiceMime, text })
    } catch {
      try { words = spreadWords(text, await (v?.span ?? speechSpan)(voiceAudio)) } catch { words = [] }
    }
  }
  return { bytes, words }
}

/**
 * Une los clips con la transición elegida y graba encima los subtítulos, los gráficos y la barra de progreso. Todo esto es
 * acabado y no cuesta nada: si algo falla, el reel se entrega igual con lo que sí se pudo y se avisa.
 */
async function assembleReel(p: VideoProjectDoc, opts: ProductionOptions): Promise<{ bytes: Uint8Array | null; parts: string[]; warnings: string[] }> {
  const clips = p.scenes.filter((s) => !!s.path)
  const paths = clips.map((s) => s.path!)
  const durs = await Promise.all(clips.map(async (s) => {
    const d = await (opts.duration ?? durationOf)(s.path!).catch(() => 0)
    return d > 0 ? d : s.seconds
  }))
  const st = p.style
  const warnings: string[] = []
  const parts: string[] = []
  const wantsSubs = p.subtitles && p.scenes.some((s) => s.captions.length > 0)
  const wantsGraphics = st.graphics.enabled && (p.scenes.some((s) => s.graphic.kind !== "none") || st.graphics.progress_bar)
  const overlay = wantsSubs || wantsGraphics
  let overlap = effectiveTransition(st.transition, durs)
  if (paths.length === 1 && !overlay) return { bytes: null, parts, warnings }

  let reel: Uint8Array
  if (overlap > 0) {
    try {
      reel = await (opts.join ?? joinWithTransitions)(paths, durs, st.transition)
      parts.push("transiciones")
    } catch (err) {
      warnings.push(`No se pudieron aplicar las transiciones (${(err instanceof Error ? err.message : String(err)).slice(0, 120)}). Las escenas se unen con corte directo.`)
      overlap = 0
      reel = await (opts.concat ?? concatClips)(paths)
    }
  } else {
    reel = paths.length === 1 ? new Uint8Array(readFileSync(paths[0])) : await (opts.concat ?? concatClips)(paths)
  }
  if (!overlay) return { bytes: reel, parts, warnings }

  const starts = sceneStarts(durs, overlap)
  const total = durs.reduce((a, d) => a + d, 0) - Math.max(0, durs.length - 1) * overlap
  const spec: OverlaySpec = {
    total, subtitles: wantsSubs ? st.subtitles : null, graphics: st.graphics,
    scenes: clips.map((s, i) => ({ start: starts[i], duration: durs[i], words: wantsSubs ? s.captions : [], graphic: s.graphic })),
  }
  try {
    reel = await (opts.burn ?? burnOverlays)(reel, spec)
    if (wantsSubs) parts.unshift("subtítulos")
    if (wantsGraphics) parts.splice(wantsSubs ? 1 : 0, 0, "gráficos")
  } catch (err) {
    warnings.push(`No se pudieron grabar los subtítulos y gráficos (${(err instanceof Error ? err.message : String(err)).slice(0, 120)}). El reel se entrega sin ellos.`)
  }
  return { bytes: reel, parts, warnings }
}

async function runProduction(id: string, opts: ProductionOptions): Promise<void> {
  try {
    let p = await getProject(id)
    const approved = p.approved_cost_usd ?? 0
    const budget = approved * APPROVAL_TOLERANCE
    let spentThisRun = 0
    const total = p.scenes.length
    const voiceOk = opts.voice?.enabled ?? await isVoiceEnabled()
    const pending = p.scenes.filter((s) => s.status !== "done").length
    if (pending > 0) await note(id, opts, "step", null, `Empiezo a producir ${pending} de ${total} escenas. Cada clip de Gemini tarda de 30 s a 2 min.`)
    for (const scene of p.scenes) {
      if (scene.status === "done") continue
      const n = p.scenes.findIndex((s) => s.id === scene.id) + 1
      const label = sceneLabel(n, total)
      // Tope duro: lo aprobado más una tolerancia pequeña por variación de tokens.
      const sceneEstimate = estimateClipCostUsd(p.resolution, scene.seconds)
        + (sceneNeedsLook(p, scene) && !lookIsCurrent(p, scene) ? IMAGE_COST_ESTIMATE_USD : 0)
      if (spentThisRun + sceneEstimate > budget) {
        throw new StudioError(`Se alcanzó el costo aprobado (${approved.toFixed(2)} USD). Revisa el proyecto y vuelve a aprobar.`, "not_approved")
      }
      await mutate(id, (d) => {
        const s = d.scenes.find((x) => x.id === scene.id)
        if (s) Object.assign(s, { status: "generating", error: null })
      })
      try {
        // Primero la imagen de escena: rostro de referencia + vestuario y escenografía que decidió el Director.
        if (sceneNeedsLook(p, scene) && !lookIsCurrent(p, scene)) {
          await note(id, opts, "step", n, `${label} · Creando la imagen de la escena: tu rostro con el vestuario y la escenografía elegidos (Nano Banana)…`)
        }
        const { look, generated } = await ensureLook(id, scene.id, opts)
        if (generated) {
          spentThisRun += IMAGE_COST_ESTIMATE_USD
          await note(id, opts, "done", n, `${label} · Imagen de la escena lista.`)
        }
        const lookRef = readReference(look.look_path)
        const refs = lookRef && lookIsCurrent(p, look)
          ? [lookRef]
          : scene.character_ids
              .map((cid) => readReference(identityPath(p.characters.find((c) => c.id === cid))))
              .filter((r): r is ReferenceImage => !!r)
        const speaker = scene.dialogue.trim()
          ? scene.character_ids.map((cid) => p.characters.find((c) => c.id === cid)).find((c) => !!c?.voice_id) ?? scene.character_ids.map((cid) => p.characters.find((c) => c.id === cid)).find(Boolean)
          : undefined
        // Con voz de ElevenLabs en modo narración el personaje no habla; en cualquier otro caso habla y mueve los labios.
        const voiceMode: SceneVoice = speaker?.voice_id && voiceOk && speaker.voice_settings.mode === "narration" ? "silent" : "speak"
        await note(id, opts, "step", n, `${label} · Gemini está grabando el clip de ${scene.seconds} s${scene.dialogue.trim() && voiceMode === "speak" ? " con el personaje hablando" : ""}… (puede tardar de 30 s a 2 min)`)
        const clip = await generateVideoClip({
          prompt: scenePrompt(p, scene, voiceMode), aspectRatio: p.aspect_ratio, resolution: p.resolution,
          durationSeconds: scene.seconds, referenceImages: refs,
        }, opts)
        spentThisRun += clip.costUsd
        await note(id, opts, "done", n, `${label} · Clip grabado (${scene.seconds} s, ${clip.costUsd.toFixed(3)} USD).`)

        let words: WordTiming[] = []
        if (scene.dialogue.trim()) {
          const dressed = await dressClip(id, opts, { bytes: clip.bytes, scene, speaker, voiceOk, n, total })
          clip.bytes = dressed.bytes
          words = dressed.words
        }
        const artifact = await createArtifact({
          bytes: clip.bytes, mimeType: clip.mimeType, kind: "generated_video", userId: p.user_id, expiresAt: null, extension: "mp4",
          visible: { workspace: p.workspace, folder: STUDIO_VIDEOS_FOLDER, label: `${p.title} escena ${n}` },
        })
        await mutate(id, (d) => {
          const s = d.scenes.find((x) => x.id === scene.id)
          if (!s) return
          Object.assign(s, { status: "done", artifact_id: artifact.id, path: artifact.path, interaction_id: clip.interactionId, cost_usd: clip.costUsd, error: null, captions: words })
          d.spent_usd = round4(d.spent_usd + clip.costUsd)
        })
        await note(id, opts, "done", n, `${label} · Lista.`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await mutate(id, (d) => {
          const s = d.scenes.find((x) => x.id === scene.id)
          if (s) Object.assign(s, { status: "failed", error: message })
        })
        await note(id, opts, "error", n, `${label} · Falló: ${message.slice(0, 200)}`)
        throw err
      }
      p = await getProject(id)
    }
    // Reel final: todos los clips, en orden, con los subtítulos si el proyecto los pide.
    p = await getProject(id)
    const extras = [p.subtitles && p.scenes.some((s) => s.captions.length > 0) ? "subtítulos" : "", p.style.graphics.enabled && (p.style.graphics.progress_bar || p.scenes.some((s) => s.graphic.kind !== "none")) ? "gráficos" : "", p.style.transition.type !== "none" && total > 1 ? "transiciones" : ""].filter(Boolean)
    await note(id, opts, "step", null, extras.length ? `Uniendo ${total} clips con ${extras.join(", ").replace(/, ([^,]*)$/, " y $1")}…` : `Uniendo ${total} clips en el reel…`)
    const assembled = await assembleReel(p, opts)
    for (const w of assembled.warnings) await note(id, opts, "warn", null, w)
    let finalArtifact: { id: string; path: string }
    if (assembled.bytes === null) {
      finalArtifact = { id: p.scenes[0].artifact_id!, path: p.scenes[0].path! }
    } else {
      const a = await createArtifact({
        bytes: assembled.bytes, mimeType: "video/mp4", kind: "generated_video", userId: p.user_id, expiresAt: null, extension: "mp4",
        visible: { workspace: p.workspace, folder: STUDIO_VIDEOS_FOLDER, label: `${p.title} reel` },
      })
      finalArtifact = { id: a.id, path: a.path }
    }
    await mutate(id, (d) => {
      d.status = "done"
      d.final_artifact_id = finalArtifact.id
      d.final_path = finalArtifact.path
      d.approved_cost_usd = null
      d.approved_at = null
      d.error = null
      d.phase = null
    })
    await note(id, opts, "done", null, `Reel terminado${assembled.parts.length ? ` con ${assembled.parts.join(", ").replace(/, ([^,]*)$/, " y $1")}` : ""}. Gastado en total: ${p.spent_usd.toFixed(2)} USD.`)
    log.info(`Reel «${p.title}» listo (${p.scenes.length} clips, ${p.spent_usd} USD acumulados)`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn(`Producción de ${id} se detuvo: ${message}`)
    await mutate(id, (d) => {
      d.status = "failed"
      d.error = message
      d.phase = null
      // Para reintentar hay que volver a aprobar el costo de lo que falta.
      d.approved_cost_usd = null
      d.approved_at = null
    }).catch(() => { /* proyecto borrado */ })
    await note(id, opts, "error", null, `La producción se detuvo: ${message.slice(0, 200)}`)
  } finally {
    running.delete(id)
  }
}

/**
 * Empieza la producción en segundo plano. Exige costo aprobado desde la interfaz.
 * Devuelve cuando la producción ya quedó en marcha (no cuando termina).
 */
export async function startProduction(
  id: string,
  opts: ProductionOptions & { wait?: boolean } = {},
): Promise<VideoProjectDoc> {
  if (running.has(id)) throw new StudioError("Este proyecto ya se está produciendo.", "busy")
  if (!(await isVideoStudioEnabled())) throw new StudioError("Conecta una API key de Gemini en Providers.", "no_key")
  const p = await getProject(id)
  if (p.scenes.length === 0) throw new StudioError("El proyecto no tiene escenas: pide el guion primero.")
  const cost = projectCost(p)
  if (cost.pending_scenes === 0 && p.final_path) throw new StudioError("El reel ya está terminado.")
  // Unir clips ya generados no cuesta nada: solo se exige aprobación cuando falta generar alguno.
  if (cost.total_usd > 0 && (p.approved_cost_usd === null || p.approved_cost_usd + 1e-9 < cost.total_usd)) {
    throw new StudioError(
      `Falta que el usuario apruebe el costo (${cost.total_usd.toFixed(2)} USD) en la pestaña Estudio de video.`, "not_approved")
  }
  running.add(id)
  const started = await mutate(id, (d) => {
    d.status = "producing"
    d.error = null
  }).catch((err) => { running.delete(id); throw err })
  const job = runProduction(id, opts)
  if (opts.wait) await job
  else void job
  return opts.wait ? getProject(id) : started
}

export { VideoGenerationError }
