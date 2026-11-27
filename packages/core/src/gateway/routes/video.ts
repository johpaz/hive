/**
 * Rutas del Estudio de video (pestaña /video de la web).
 *
 * Aquí vive la ÚNICA vía para aprobar un costo (`POST …/approve`): las tools de los
 * agentes no pueden. Hive es de un solo usuario, como en el resto de rutas.
 */
import { col } from "../../storage/hive"
import type { UserDoc } from "../../storage/collections"
import {
  IMAGE_COST_ESTIMATE_USD, MAX_CHARACTERS, MAX_PROJECT_SECONDS, MAX_SCENES, STUDIO_FOLDER, STUDIO_IMAGE_MODEL, StudioError,
  applyAvatar, approveProject, backfillAvatars, startMusic, startRedub, clearCharacterFace, createProject, deleteProject, generateCharacterImage, setCharacterFace, MAX_FACE_BYTES, getProject, isProducing, isVideoStudioEnabled,
  listProjects, projectCost, revokeApproval, startProduction, updateProject, type ProjectPatch, type VideoProjectDoc,
} from "../../video/studio"
import {
  MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, PRICE_PER_SECOND_USD, VIDEO_ASPECT_RATIOS, VIDEO_MODEL_ID, VIDEO_RESOLUTIONS,
} from "../../multimodal/video-generation"
import { resolveOutputDir } from "../../artifacts/store"
import { ImageGenerationError } from "../../multimodal/image-generation"
import { WriterError, improveBrief, writeScript, type ScriptCharacter } from "../../video/ai-writer"
import { applyVoiceFx, suggestVoiceFx } from "../../video/voice-fx"
import { AvatarError, deleteAvatar, listAvatars, renameAvatar, toView } from "../../video/avatars"
import { getResearchJob, startResearch } from "../../video/research"
import {
  DEFAULT_VOICE_SETTINGS, MAX_PREVIEW_CHARS, VOICE_MODELS, VoiceError, cloneVoice, isVoiceEnabled, listVoices, MAX_SAMPLE_BYTES, synthesizeLine,
} from "../../video/voice"
import { logger } from "../../utils/logger"

const log = logger.child("routes/video")
type Cors = (res: Response, req: Request) => Response

const STATUS_BY_CODE: Record<StudioError["code"], number> = {
  not_found: 404, invalid: 400, not_approved: 409, busy: 409, no_key: 412,
}

async function singleUserId(): Promise<string> {
  const user = (await (await col<UserDoc>("users")).scan({ limit: 1 }))[0]
  return user?.id ?? ""
}

function view(p: VideoProjectDoc) {
  // Efecto de voz sugerido para cada escena con voz (reglas simples, sin IA): la interfaz lo ofrece con un clic.
  return { ...p, cost: projectCost(p), producing: isProducing(p.id), fx_suggestions: p.scenes.map((s) => suggestVoiceFx(s)) }
}

function fail(req: Request, cors: Cors, err: unknown): Response {
  if (err instanceof StudioError) return cors(Response.json({ ok: false, error: err.message, code: err.code }, { status: STATUS_BY_CODE[err.code] }), req)
  if (err instanceof AvatarError) {
    return cors(Response.json({ ok: false, error: err.message, code: err.code }, { status: err.code === "not_found" ? 404 : err.code === "missing_file" ? 410 : 400 }), req)
  }
  if (err instanceof WriterError) {
    return cors(Response.json({ ok: false, error: err.message, code: err.code }, { status: err.code === "invalid" ? 400 : err.code === "no_llm" ? 412 : 502 }), req)
  }
  if (err instanceof VoiceError) {
    const status = err.code === "no_key" ? 412 : err.code === "auth" ? 502 : err.code === "plan" ? 402 : err.code === "invalid" ? 400 : 502
    return cors(Response.json({ ok: false, error: err.message, code: err.code }, { status }), req)
  }
  if (err instanceof ImageGenerationError) return cors(Response.json({ ok: false, error: err.message, code: "generation" }, { status: 502 }), req)
  log.warn(`video route: ${(err as Error).message}`)
  return cors(Response.json({ ok: false, error: (err as Error).message }, { status: 500 }), req)
}

export async function handleVideoStatus(req: Request, cors: Cors): Promise<Response> {
  return cors(Response.json({
    enabled: await isVideoStudioEnabled(),
    voice_enabled: await isVoiceEnabled(),
    voice_models: VOICE_MODELS,
    voice_defaults: DEFAULT_VOICE_SETTINGS,
    voice_preview_max_chars: MAX_PREVIEW_CHARS,
    video_model: VIDEO_MODEL_ID,
    image_model: STUDIO_IMAGE_MODEL,
    folder: `${resolveOutputDir(null)}/${STUDIO_FOLDER}`,
    aspect_ratios: VIDEO_ASPECT_RATIOS,
    resolutions: VIDEO_RESOLUTIONS,
    price_per_second_usd: PRICE_PER_SECOND_USD,
    image_cost_usd: IMAGE_COST_ESTIMATE_USD,
    limits: { min_clip_seconds: MIN_CLIP_SECONDS, max_clip_seconds: MAX_CLIP_SECONDS, max_project_seconds: MAX_PROJECT_SECONDS, max_scenes: MAX_SCENES, max_characters: MAX_CHARACTERS },
  }), req)
}

/** Despacha `/api/video/projects…`. Devuelve null si la ruta no es de este módulo. */
export async function handleVideoProjects(req: Request, cors: Cors): Promise<Response | null> {
  const url = new URL(req.url)
  // Aplicar un avatar guardado: POST /api/video/projects/:id/avatars/:avatarId[?character=<id>]
  const av = url.pathname.match(/^\/api\/video\/projects\/([^/]+)\/avatars\/([^/]+)$/)
  if (av && req.method === "POST") {
    try { return cors(Response.json({ ok: true, project: view(await applyAvatar(av[1], av[2], url.searchParams.get("character") || undefined)) }), req) }
    catch (err) { return fail(req, cors, err) }
  }
  const m = url.pathname.match(/^\/api\/video\/projects(?:\/([^/]+))?(?:\/(approve|revoke|produce|redub|music)|\/characters\/([^/]+)\/(image|face))?$/)
  if (!m) return null
  const [, id, action, characterId, characterAction] = m
  try {
    if (!id) {
      if (req.method === "GET") return cors(Response.json({ projects: (await listProjects(await singleUserId())).map(view) }), req)
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({})) as Record<string, any>
        const p = await createProject({
          userId: await singleUserId(), title: String(body.title ?? ""), brief: body.brief, aspectRatio: body.aspect_ratio,
          resolution: body.resolution, targetSeconds: body.target_seconds, avatarId: typeof body.avatar_id === "string" ? body.avatar_id : undefined,
          narrator: body.narrator && typeof body.narrator === "object" ? body.narrator : undefined,
          identity: body.identity && typeof body.identity === "object" ? body.identity : undefined,
        })
        return cors(Response.json({ ok: true, project: view(p) }, { status: 201 }), req)
      }
      return null
    }
    if (characterId && characterAction === "image" && req.method === "POST") {
      return cors(Response.json({ ok: true, project: view(await generateCharacterImage(id, characterId)) }), req)
    }
    if (characterId && characterAction === "face") {
      if (req.method === "POST") {
        // Cuerpo = bytes de la imagen; el consentimiento viaja en `?consent=1` (la UI lo exige con una casilla).
        const declared = Number(req.headers.get("content-length") ?? 0)
        if (declared > MAX_FACE_BYTES + 1024) throw new StudioError("La imagen pesa más de 10 MB.")
        const bytes = new Uint8Array(await req.arrayBuffer())
        const consent = url.searchParams.get("consent") === "1"
        return cors(Response.json({ ok: true, project: view(await setCharacterFace(id, characterId, { bytes, consent })) }), req)
      }
      if (req.method === "DELETE") return cors(Response.json({ ok: true, project: view(await clearCharacterFace(id, characterId)) }), req)
    }
    if (action && req.method === "POST") {
      if (action === "approve") return cors(Response.json({ ok: true, project: view(await approveProject(id)) }), req)
      if (action === "revoke") return cors(Response.json({ ok: true, project: view(await revokeApproval(id)) }), req)
      if (action === "music") return cors(Response.json({ ok: true, project: view(await startMusic(id)) }, { status: 202 }), req)
      if (action === "redub") return cors(Response.json({ ok: true, project: view(await startRedub(id)) }, { status: 202 }), req)
      return cors(Response.json({ ok: true, project: view(await startProduction(id)) }, { status: 202 }), req)
    }
    if (req.method === "GET") return cors(Response.json({ project: view(await getProject(id)) }), req)
    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({})) as ProjectPatch
      return cors(Response.json({ ok: true, project: view(await updateProject(id, body)) }), req)
    }
    if (req.method === "DELETE") {
      await deleteProject(id)
      return cors(Response.json({ ok: true }), req)
    }
    return null
  } catch (err) {
    return fail(req, cors, err)
  }
}

/** `/api/video/voices` (listar las voces de ElevenLabs) y `/api/video/voices/clone` (clonar desde una muestra). */
export async function handleVideoVoices(req: Request, cors: Cors): Promise<Response | null> {
  const url = new URL(req.url)
  try {
    if (url.pathname === "/api/video/voices" && req.method === "GET") {
      if (!(await isVoiceEnabled())) return cors(Response.json({ enabled: false, voices: [] }), req)
      return cors(Response.json({ enabled: true, voices: await listVoices() }), req)
    }
    if (url.pathname === "/api/video/voices/preview" && req.method === "POST") {
      // Prueba corta de una voz con sus ajustes. Gasta unos pocos caracteres del plan de ElevenLabs.
      const body = await req.json().catch(() => ({})) as { voice_id?: unknown; text?: unknown; settings?: Record<string, unknown> }
      const voiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : ""
      const text = typeof body.text === "string" ? body.text.trim() : ""
      if (!voiceId) throw new VoiceError("Elige una voz para probarla.", "invalid")
      if (!text) throw new VoiceError("Escribe una frase corta para probar la voz.", "invalid")
      if (text.length > MAX_PREVIEW_CHARS) throw new VoiceError(`La prueba admite hasta ${MAX_PREVIEW_CHARS} caracteres.`, "invalid")
      const audio = await synthesizeLine({ voiceId, text, settings: body.settings as never })
      // El efecto elegido se oye ya en la prueba (en el reel se aplica al armar el audio).
      const heard = await applyVoiceFx(audio.bytes, typeof body.settings?.fx === "string" ? body.settings.fx : "none")
      return cors(new Response(heard as BodyInit, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Model": audio.modelId } }), req)
    }
    if (url.pathname === "/api/video/voices/clone" && req.method === "POST") {
      const declared = Number(req.headers.get("content-length") ?? 0)
      if (declared > MAX_SAMPLE_BYTES + 1024) throw new VoiceError("La muestra pesa más de 25 MB.", "invalid")
      const bytes = new Uint8Array(await req.arrayBuffer())
      const voice = await cloneVoice({
        name: url.searchParams.get("name") ?? "", bytes, mimeType: req.headers.get("content-type") ?? "audio/mpeg",
        consent: url.searchParams.get("consent") === "1",
      })
      return cors(Response.json({ ok: true, voice }, { status: 201 }), req)
    }
    return null
  } catch (err) {
    return fail(req, cors, err)
  }
}

/** `POST /api/video/improve`: propone un título y una idea mejores a partir del borrador (una llamada al modelo de texto). */
export async function handleVideoImprove(req: Request, cors: Cors): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== "/api/video/improve" || req.method !== "POST") return null
  try {
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const result = await improveBrief({
      title: typeof body.title === "string" ? body.title : "", brief: typeof body.brief === "string" ? body.brief : "",
      aspect_ratio: body.aspect_ratio, target_seconds: body.target_seconds === undefined ? undefined : Number(body.target_seconds),
      characters: Array.isArray(body.characters) ? body.characters.filter((c: unknown): c is string => typeof c === "string") : [],
    })
    return cors(Response.json({ ok: true, ...result }), req)
  } catch (err) {
    return fail(req, cors, err)
  }
}

/** `POST /api/video/research` (empieza «Investigar y escribir») y `GET /api/video/research/:id` (estado y resultado). */
export async function handleVideoResearch(req: Request, cors: Cors): Promise<Response | null> {
  const url = new URL(req.url)
  const m = url.pathname.match(/^\/api\/video\/research(?:\/([^/]+))?$/)
  if (!m) return null
  try {
    if (!m[1] && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, any>
      const job = await startResearch({
        title: typeof body.title === "string" ? body.title : "", brief: typeof body.brief === "string" ? body.brief : "",
        aspect_ratio: body.aspect_ratio, target_seconds: body.target_seconds === undefined ? undefined : Number(body.target_seconds),
        characters: Array.isArray(body.characters) ? body.characters.filter((c: unknown): c is string => typeof c === "string") : [],
      })
      return cors(Response.json({ ok: true, job }, { status: 202 }), req)
    }
    if (m[1] && req.method === "GET") {
      const job = getResearchJob(m[1])
      if (!job) return cors(Response.json({ ok: false, error: "La investigación no existe o ya caducó.", code: "not_found" }, { status: 404 }), req)
      return cors(Response.json({ ok: true, job }), req)
    }
    return null
  } catch (err) {
    return fail(req, cors, err)
  }
}

/** `POST /api/video/script`: escribe el guion y propone las escenas (vestuario, escenografía y diálogo) a partir del título y la idea. */
export async function handleVideoScript(req: Request, cors: Cors): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== "/api/video/script" || req.method !== "POST") return null
  try {
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const detail: ScriptCharacter[] = (Array.isArray(body.characters) ? body.characters : [])
      .filter((c: any) => c && typeof c.id === "string" && typeof c.name === "string")
      .slice(0, 4)
      .map((c: any) => ({ id: c.id, name: c.name.slice(0, 60), description: typeof c.description === "string" ? c.description.slice(0, 400) : "", voice_expressive: c.voice_expressive === true }))
    const result = await writeScript({
      title: typeof body.title === "string" ? body.title : "", brief: typeof body.brief === "string" ? body.brief : "",
      aspect_ratio: body.aspect_ratio, target_seconds: body.target_seconds === undefined ? undefined : Number(body.target_seconds),
      characters_detail: detail,
      mode: body.mode === "voiceover" ? "voiceover" : "avatar",
    })
    return cors(Response.json({ ok: true, ...result }), req)
  } catch (err) {
    return fail(req, cors, err)
  }
}

/** `GET /api/video/avatars` (la biblioteca), `PATCH` (renombrar) y `DELETE /api/video/avatars/:id` (quitar de la biblioteca; la foto se queda). */
export async function handleVideoAvatars(req: Request, cors: Cors): Promise<Response | null> {
  const url = new URL(req.url)
  const m = url.pathname.match(/^\/api\/video\/avatars(?:\/([^/]+))?$/)
  if (!m) return null
  try {
    if (!m[1] && req.method === "GET") {
      const userId = await singleUserId()
      await backfillAvatars(userId).catch(() => 0) // recoge los rostros subidos antes de que existiera la biblioteca
      return cors(Response.json({ avatars: await listAvatars(userId) }), req)
    }
    if (m[1] && req.method === "PATCH") {
      const body = await req.json().catch(() => ({})) as { name?: string; description?: string }
      return cors(Response.json({ ok: true, avatar: toView(await renameAvatar(m[1], body)) }), req)
    }
    if (m[1] && req.method === "DELETE") {
      await deleteAvatar(m[1])
      return cors(Response.json({ ok: true }), req)
    }
    return null
  } catch (err) {
    return fail(req, cors, err)
  }
}
