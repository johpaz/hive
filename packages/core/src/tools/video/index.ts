/**
 * Video tools — estudio de reels. Las usa el agente Director de video, que solo
 * está activo mientras haya una API key de Gemini (ver storage/video-capabilities).
 *
 * Los agentes pueden planear y preparar; producir exige que el USUARIO apruebe el
 * costo en la pestaña «Estudio de video». Ninguna tool puede aprobar.
 */
import type { Tool } from "../types";
import { getWorkspace } from "../filesystem/workspace-guard";
import { publishNarration } from "../../events/narration";
import { listAvatars } from "../../video/avatars";
import { backfillAvatars } from "../../video/studio";
import {
  StudioError, createProject, generateCharacterImage, getProject, projectCost, startProduction, updateProject,
  type ProjectPatch, type VideoProjectDoc,
} from "../../video/studio";

function userOf(config: any): string {
  return String(config?.configurable?.user_id ?? "");
}

function summarize(p: VideoProjectDoc) {
  const cost = projectCost(p);
  return {
    project_id: p.id,
    title: p.title,
    status: p.status,
    aspect_ratio: p.aspect_ratio,
    resolution: p.resolution,
    target_seconds: p.target_seconds,
    script: p.script || null,
    characters: p.characters.map((c) => ({
      id: c.id, name: c.name, has_image: !!c.image_path, image_path: c.image_path,
      has_face_reference: !!c.face_path, voice: c.voice_name ?? c.voice_id ?? null,
    })),
    scenes: p.scenes.map((s, i) => ({
      n: i + 1, id: s.id, seconds: s.seconds, status: s.status, prompt: s.prompt, characters: s.character_ids,
      wardrobe: s.wardrobe || null, setting: s.setting || null, dialogue: s.dialogue || null,
      graphic: s.graphic.kind === "none" ? null : s.graphic,
      path: s.path, error: s.error,
    })),
    style: p.style,
    total_seconds: cost.total_seconds,
    estimated_cost_usd: cost.total_usd,
    cost_breakdown: { clips_usd: cost.estimated_usd, scene_images_usd: cost.images_usd, scene_images: cost.looks_pending },
    dialogue_chars: cost.dialogue_chars,
    spent_usd: p.spent_usd,
    cost_approved: p.approved_cost_usd !== null,
    final_path: p.final_path,
    subtitles: p.subtitles,
    // Lo último que pasó en la producción: úsalo para contarle al usuario cómo va, sin inventar.
    now: p.phase ? { doing: p.phase.label, since_seconds: Math.round((Date.now() - p.phase.since) / 1000) } : null,
    recent_activity: p.activity.slice(-6).map((a) => ({ scene: a.scene, kind: a.kind, text: a.text })),
    error: p.error,
  };
}

async function guarded(fn: () => Promise<object>): Promise<object> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StudioError) {
      return { ok: false, error: err.message, code: err.code,
        hint: err.code === "not_approved" ? "Pídele al usuario que abra la pestaña «Estudio de video», revise el costo y pulse Aprobar y producir. No puedes aprobarlo tú." : undefined };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const sceneSchema = {
  type: "object",
  properties: {
    seconds: { type: "number", description: "Duración del clip, 3 a 15 s (10 si usa dos personajes)." },
    prompt: { type: "string", description: "Qué se ve y qué pasa: sujeto, acción, cámara, luz, ambiente y, si hay voz o sonido, qué se oye." },
    character_ids: { type: "array", items: { type: "string" }, description: "Ids de personajes que salen (máximo 2)." },
    wardrobe: { type: "string", description: "Vestuario del personaje en ESTA escena (prendas, colores, accesorios). Decídelo tú según el guion y el tono; el rostro no cambia." },
    setting: { type: "string", description: "Escenografía y ambiente de ESTA escena (lugar, época, decorado, luz, clima). Decídelo tú según el guion." },
    graphic: {
      type: "object",
      description: "Gráfico animado sobre la escena: kind = title (gancho arriba, primera escena), lower_third (nombre en text y cargo en sub, cuando un personaje aparece), stat (cifra grande en text y su significado en sub; solo con datos reales) o cta (llamada a la acción abajo, última escena); none si no aporta. text corto (máx. 32 caracteres).",
      properties: { kind: { type: "string", enum: ["none", "title", "lower_third", "stat", "cta"] }, text: { type: "string" }, sub: { type: "string" } },
    },
    dialogue: { type: "string", description: "Lo que dice el personaje en esta escena, tal cual se narrará con su voz (déjalo vacío si no habla). Máximo 14 caracteres por cada segundo de la escena (3 s = 42 caracteres); si no cabe, alarga la escena o divide el diálogo en dos." },
  },
  required: ["seconds", "prompt"],
};

export const videoProjectCreateTool: Tool = {
  name: "video_project_create",
  description:
    "Create a new video (reel) project in the Video Studio. Set title, brief, aspect ratio (9:16 vertical default for reels, or 16:9) and target duration in seconds. " +
    "This costs nothing; it only prepares the project. Next: video_project_update with script, characters and scenes. " +
    "Spanish: crear reel, nuevo proyecto de video, crear video, estudio de video",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título corto del reel." },
      brief: { type: "string", description: "Idea, público, tono y mensaje del video." },
      aspect_ratio: { type: "string", enum: ["9:16", "16:9"], description: "9:16 para reels/shorts/TikTok (por defecto), 16:9 horizontal." },
      target_seconds: { type: "number", description: "Duración total deseada, 3 a 90 s." },
      resolution: { type: "string", enum: ["360p", "720p", "1080p", "4k"], description: "720p por defecto; más resolución cuesta más." },
      avatar_id: { type: "string", description: "Id de un avatar guardado (ver video_avatar_list): el reel empieza con su rostro y su voz, sin pedirle la foto de nuevo al usuario." },
    },
    required: ["title"],
  },
  execute: async (params, config) => guarded(async () => {
    const p = await createProject({
      userId: userOf(config), title: String(params.title ?? ""), brief: typeof params.brief === "string" ? params.brief : "",
      aspectRatio: typeof params.aspect_ratio === "string" ? params.aspect_ratio : undefined,
      resolution: typeof params.resolution === "string" ? params.resolution : undefined,
      targetSeconds: params.target_seconds === undefined ? undefined : Number(params.target_seconds),
      avatarId: typeof params.avatar_id === "string" && params.avatar_id ? params.avatar_id : undefined,
      workspace: getWorkspace(config) ?? null,
    });
    return { ok: true, ...summarize(p), next: "Define guion, personajes y escenas con video_project_update." };
  }),
};

export const videoProjectUpdateTool: Tool = {
  name: "video_project_update",
  description:
    "Edit a video project: script text, characters (name + visual description) and scenes (each a clip of 3-15 s with a prompt). " +
    "Send the complete list of scenes/characters you want (replaces the previous list); pass the existing id to keep an already generated clip. " +
    "Scene seconds should add up to roughly the target duration. YOU decide each scene's wardrobe and setting (scenography); the face of a character comes from the reference photo the user uploaded and never changes. " +
    "Changing scenes, format or resolution withdraws any cost approval. Free; nothing is generated here. " +
    "Spanish: guion, escenas, personajes, editar reel",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      title: { type: "string" },
      brief: { type: "string" },
      script: { type: "string", description: "Guion completo en texto (narración, diálogos, acciones)." },
      aspect_ratio: { type: "string", enum: ["9:16", "16:9"] },
      resolution: { type: "string", enum: ["360p", "720p", "1080p", "4k"] },
      target_seconds: { type: "number" },
      style: {
        type: "object",
        description: "Acabado del reel (gratis; se aplica al unir los clips): subtitles {preset classic|karaoke|box|pop|minimal, position bottom|middle|top, size s|m|l, uppercase, color #RRGGBB, highlight #RRGGBB}, transition {type fade|fadeblack|dissolve|wipeleft|slideleft|circleopen|zoomin|none…, duration 0.2-1 s} y graphics {enabled, accent #RRGGBB, progress_bar}.",
      },
      characters: {
        type: "array",
        description: "Personajes recurrentes (máximo 4). Descríbelos en detalle: aspecto, ropa, estilo.",
        items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, voice_id: { type: "string", description: "voice_id de ElevenLabs para sus diálogos (opcional)." } }, required: ["name", "description"] },
      },
      scenes: { type: "array", description: "Escenas en orden.", items: { ...sceneSchema, properties: { ...sceneSchema.properties, id: { type: "string" } } } as any },
    },
    required: ["project_id"],
  },
  execute: async (params) => guarded(async () => {
    const { project_id, ...patch } = params as Record<string, unknown> & { project_id: string };
    const p = await updateProject(String(project_id), patch as ProjectPatch);
    return { ok: true, ...summarize(p) };
  }),
};

export const videoCharacterImageTool: Tool = {
  name: "video_character_image",
  description:
    "Generate the reference image of a project character with Nano Banana (Gemini). The image is saved in the workspace folder estudio-videos/imagenes and is reused as reference so the character looks the same in every clip. " +
    "Costs about 0.04 USD per image. Regenerating it resets the clips of the scenes where the character appears. " +
    "Spanish: imagen del personaje, nano banana, diseñar personaje",
  parameters: {
    type: "object",
    properties: { project_id: { type: "string" }, character_id: { type: "string" } },
    required: ["project_id", "character_id"],
  },
  timeoutMs: 150_000,
  execute: async (params) => guarded(async () => {
    const p = await generateCharacterImage(String(params.project_id), String(params.character_id));
    const c = p.characters.find((x) => x.id === params.character_id);
    return { ok: true, character: c?.name, image_path: c?.image_path, ...summarize(p) };
  }),
};

export const videoProjectStatusTool: Tool = {
  name: "video_project_status",
  description:
    "Read a video project: script, characters, scenes with their status, estimated cost, spend so far, whether the user approved the cost, and the final reel path. " +
    "Use it before producing and to follow progress while it is being produced. Spanish: estado del reel, cuánto cuesta el video, progreso",
  parameters: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] },
  execute: async (params) => guarded(async () => ({ ok: true, ...summarize(await getProject(String(params.project_id))) })),
};

export const videoProjectProduceTool: Tool = {
  name: "video_project_produce",
  description:
    "Start producing the video clips and the final reel in the background. SPENDS MONEY, so it only works if the USER already approved the estimated cost in the Video Studio tab; " +
    "you cannot approve it. If it answers not_approved, tell the user the estimated cost and ask them to approve it in the Video Studio tab. " +
    "Returns right away; each step (scene image, clip, voice, subtitles, final join) is narrated to the user as it happens; follow progress with video_project_status. Spanish: producir video, generar reel, empezar producción",
  parameters: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] },
  execute: async (params, config) => guarded(async () => {
    const projectId = String(params.project_id);
    // Principio de narración de Hive: cada paso de la producción también se le cuenta al usuario en el chat.
    const c = config?.configurable ?? {};
    const turnId = typeof c.turn_id === "string" ? c.turn_id : "";
    let seq = 0;
    const narrate = turnId
      ? async (n: { kind: "step" | "done" | "warn" | "error"; scene: number | null; label: string }) => {
          await publishNarration({
            turnId, threadId: String(c.thread_id ?? ""), channel: (c.channel as string | undefined) ?? null,
            userId: (c.user_id as string | undefined) ?? null, sessionId: (c.session_id as string | undefined) ?? null,
            agentId: "video_director_agent", agentName: "Director de video",
            kind: n.kind === "error" ? "failed" : "tool_result",
            status: n.kind === "error" ? "error" : n.kind === "step" ? "running" : "done",
            label: n.label, dedupeKey: `video:${projectId}:${Date.now()}:${seq++}`,
          });
        }
      : undefined;
    const p = await startProduction(projectId, { narrate });
    return { ok: true, ...summarize(p), note: "Producción en marcha. Cada paso se le va narrando al usuario; revisa con video_project_status." };
  }),
};

export const videoAvatarListTool: Tool = {
  name: "video_avatar_list",
  description:
    "List the user's saved avatars (face + name + voice) from «Mis avatares» in the Video Studio. If the user already has an avatar for the person who appears in the video, create the project with that avatar_id instead of asking for the photo again. " +
    "Spanish: mis avatares, avatares guardados, personajes guardados, usar mi avatar",
  parameters: { type: "object", properties: {} },
  execute: async (_params, config) => guarded(async () => {
    await backfillAvatars(userOf(config)).catch(() => 0);
    const list = await listAvatars(userOf(config));
    return {
      ok: true,
      avatars: list.map((a) => ({ avatar_id: a.id, name: a.name, description: a.description || null, voice: a.voice_name ?? null, photo_available: a.available })),
      hint: list.length === 0 ? "No hay avatares guardados: el usuario sube su foto en la pestaña Estudio de video al crear el reel." : "Usa avatar_id en video_project_create.",
    };
  }),
};

export function createTools(): Tool[] {
  return [videoAvatarListTool, videoProjectCreateTool, videoProjectUpdateTool, videoCharacterImageTool, videoProjectStatusTool, videoProjectProduceTool];
}
