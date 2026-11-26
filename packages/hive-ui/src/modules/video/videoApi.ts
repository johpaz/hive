import { apiClient } from "@/lib/api";
import { loader } from "@/stores/useLoaderStore";
import { getApiBaseUrl } from "@/lib/gateway-url";

export type AspectRatio = "9:16" | "16:9";
export type Resolution = "360p" | "720p" | "1080p" | "4k";
export type SceneStatus = "pending" | "generating" | "done" | "failed";

/** Controles de ElevenLabs de una voz (espejo de video/voice.ts del backend). */
export type VoiceMode = "sync" | "convert" | "narration";

export interface VoiceSettings {
  /** sync: tu voz (texto a voz) ajustada a los labios de Gemini; convert: cambio de voz; narration: narración sobre el clip. */
  mode: VoiceMode;
  model_id: string;
  stability: number;
  similarity: number;
  style: number;
  speed: number;
  speaker_boost: boolean;
  /** Ganancia de la voz en la mezcla (0,5 a 2). Lo aplica Hive; ElevenLabs no tiene volumen. */
  volume: number;
  /** Nivel del sonido ambiente del clip bajo la voz (0 a 1). */
  ambient_volume: number;
}

export interface VoiceModel { id: string; label: string; expressive: boolean }

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  mode: "sync", model_id: "eleven_v4", stability: 0.5, similarity: 0.75, style: 0, speed: 1, speaker_boost: true, volume: 1, ambient_volume: 0.3,
};

export type SubtitlePreset = "classic" | "karaoke" | "box" | "pop" | "minimal";
export interface SubtitleStyle {
  preset: SubtitlePreset; position: "bottom" | "middle" | "top"; size: "s" | "m" | "l"; uppercase: boolean;
  color: string; highlight: string; font: "montserrat" | "sans" | "serif";
}
export type TransitionType = "none" | "fade" | "fadeblack" | "fadewhite" | "dissolve" | "wipeleft" | "wiperight" | "slideleft" | "slideright" | "circleopen" | "circleclose" | "zoomin" | "pixelize" | "radial" | "smoothleft";
export interface ReelStyle {
  subtitles: SubtitleStyle;
  transition: { type: TransitionType; duration: number };
  graphics: { enabled: boolean; accent: string; progress_bar: boolean };
}
export type GraphicKind = "none" | "title" | "lower_third" | "stat" | "cta";
export interface SceneGraphic { kind: GraphicKind; text: string; sub: string }

export const DEFAULT_REEL_STYLE: ReelStyle = {
  subtitles: { preset: "classic", position: "bottom", size: "m", uppercase: false, color: "#FFFFFF", highlight: "#FACC15", font: "montserrat" },
  transition: { type: "fade", duration: 0.4 },
  graphics: { enabled: true, accent: "#2563EB", progress_bar: false },
};

export interface ActivityEvent { at: number; scene: number | null; kind: "step" | "done" | "warn" | "error"; text: string }

export interface StudioStatus {
  enabled: boolean;
  /** Hay clave de ElevenLabs: se pueden asignar y clonar voces. */
  voice_enabled: boolean;
  voice_models: VoiceModel[];
  voice_defaults: VoiceSettings;
  voice_preview_max_chars: number;
  video_model: string;
  image_model: string;
  folder: string;
  aspect_ratios: AspectRatio[];
  resolutions: Resolution[];
  price_per_second_usd: Record<Resolution, number>;
  image_cost_usd: number;
  limits: { min_clip_seconds: number; max_clip_seconds: number; max_project_seconds: number; max_scenes: number; max_characters: number };
}

export interface Character {
  id: string;
  name: string;
  description: string;
  image_artifact_id: string | null;
  image_path: string | null;
  /** Foto de rostro subida por el usuario (identidad). */
  face_artifact_id: string | null;
  face_path: string | null;
  face_consent: boolean;
  voice_id: string | null;
  voice_name: string | null;
  voice_settings: VoiceSettings;
}

export interface Scene {
  id: string;
  seconds: number;
  prompt: string;
  character_ids: string[];
  status: SceneStatus;
  artifact_id: string | null;
  path: string | null;
  cost_usd: number;
  error: string | null;
  /** Vestuario y escenografía: los decide el Director de video, el usuario puede editarlos. */
  wardrobe: string;
  setting: string;
  dialogue: string;
  look_artifact_id: string | null;
  look_path: string | null;
  graphic: SceneGraphic;
}

export interface Project {
  id: string;
  title: string;
  brief: string;
  script: string;
  aspect_ratio: AspectRatio;
  resolution: Resolution;
  target_seconds: number;
  characters: Character[];
  scenes: Scene[];
  status: "draft" | "ready" | "producing" | "done" | "failed";
  approved_cost_usd: number | null;
  spent_usd: number;
  final_artifact_id: string | null;
  final_path: string | null;
  error: string | null;
  /** Subtítulos grabados en el reel (se graban al unir los clips). */
  subtitles: boolean;
  /** Acabado del reel (subtítulos, transición, gráficos): se aplica al unir los clips y no cuesta nada. */
  style: ReelStyle;
  /** Bitácora de la producción (la más reciente al final) y lo que se hace ahora. */
  activity: ActivityEvent[];
  phase: { label: string; scene: number | null; since: number } | null;
  updated_at: number;
  cost: {
    pending_scenes: number; pending_seconds: number; total_seconds: number;
    estimated_usd: number; looks_pending: number; images_usd: number; total_usd: number; dialogue_chars: number;
  };
  producing: boolean;
}

/** Un avatar guardado en «Mis avatares»: rostro, nombre y voz para reutilizar en cualquier reel. */
export interface Avatar {
  id: string; name: string; description: string; face_artifact_id: string; face_path: string;
  voice_id: string | null; voice_name: string | null; voice_settings: VoiceSettings;
  /** false si la foto ya no está en el disco. */
  available: boolean; updated_at: number;
}

export interface Voice { voice_id: string; name: string; category: string; preview_url: string | null }

/** POST de un archivo crudo (rostro o muestra de voz): apiClient solo habla JSON. */
async function uploadRaw<T>(endpoint: string, file: Blob, fallbackType: string, loaderMessage: string): Promise<T> {
  const token = localStorage.getItem("hive-auth-token");
  // Loader de abeja de la app (como el resto de operaciones largas); se quita siempre, haya error o no.
  loader.show(loaderMessage);
  try {
    const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": file.type || fallbackType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
    return data as T;
  } finally {
    loader.hide();
  }
}

export const artifactUrl = (id: string) => `${getApiBaseUrl()}/api/artifacts/${id}/download`;

export const videoApi = {
  status: () => apiClient<StudioStatus>("/api/video/status"),
  list: () => apiClient<{ projects: Project[] }>("/api/video/projects").then((r) => r.projects),
  get: (id: string) => apiClient<{ project: Project }>(`/api/video/projects/${id}`).then((r) => r.project),
  create: (body: { title: string; brief?: string; aspect_ratio: AspectRatio; resolution: Resolution; target_seconds: number; avatar_id?: string }) =>
    apiClient<{ project: Project }>("/api/video/projects", { method: "POST", body }).then((r) => r.project),
  update: (id: string, body: Partial<Pick<Project, "title" | "brief" | "script" | "aspect_ratio" | "resolution" | "target_seconds" | "subtitles">> & {
    scenes?: Array<{ id?: string; seconds: number; prompt: string; character_ids?: string[]; wardrobe?: string; setting?: string; dialogue?: string; graphic?: SceneGraphic }>;
    style?: { subtitles?: Partial<SubtitleStyle>; transition?: Partial<ReelStyle["transition"]>; graphics?: Partial<ReelStyle["graphics"]> };
    characters?: Array<{ id?: string; name: string; description: string; voice_id?: string | null; voice_name?: string | null; voice_settings?: VoiceSettings }>;
  }) => apiClient<{ project: Project }>(`/api/video/projects/${id}`, { method: "PATCH", body }).then((r) => r.project),
  remove: (id: string) => apiClient<{ ok: true }>(`/api/video/projects/${id}`, { method: "DELETE" }),
  characterImage: (id: string, characterId: string) =>
    apiClient<{ project: Project }>(`/api/video/projects/${id}/characters/${characterId}/image`, { method: "POST", showLoader: "Generando imagen con Nano Banana..." })
      .then((r) => r.project),
  uploadFace: (id: string, characterId: string, file: File) =>
    uploadRaw<{ project: Project }>(`/api/video/projects/${id}/characters/${characterId}/face?consent=1`, file, "image/jpeg", "Subiendo el rostro de referencia...").then((r) => r.project),
  removeFace: (id: string, characterId: string) =>
    apiClient<{ project: Project }>(`/api/video/projects/${id}/characters/${characterId}/face`, { method: "DELETE" }).then((r) => r.project),
  voices: () => apiClient<{ enabled: boolean; voices: Voice[] }>("/api/video/voices", { showError: false }),
  /** Prueba corta de una voz con sus ajustes (gasta unos pocos caracteres de ElevenLabs). Devuelve una URL de audio local. */
  previewVoice: async (voiceId: string, text: string, settings: VoiceSettings): Promise<string> => {
    const token = localStorage.getItem("hive-auth-token");
    loader.show("Generando la voz con ElevenLabs...");
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/video/voices/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ voice_id: voiceId, text, settings }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`);
      return URL.createObjectURL(await res.blob());
    } finally {
      loader.hide();
    }
  },
  cloneVoice: (name: string, file: File) =>
    uploadRaw<{ voice: Voice }>(`/api/video/voices/clone?name=${encodeURIComponent(name)}&consent=1`, file, "audio/mpeg", "Clonando la voz en ElevenLabs...").then((r) => r.voice),
  /** Propone un título y una idea mejores (una llamada al modelo de texto; no gasta saldo de Gemini para medios). */
  improve: (body: { title: string; brief: string; aspect_ratio: AspectRatio; target_seconds: number; characters?: string[] }) =>
    apiClient<{ ok: true; title: string; brief: string }>("/api/video/improve", { method: "POST", body, showLoader: "Mejorando tu título y tu idea con IA..." }),
  /** Escribe el guion y propone las escenas (vestuario, escenografía y diálogo) a partir del título y la idea. */
  script: (body: {
    title: string; brief: string; aspect_ratio: AspectRatio; target_seconds: number;
    characters: Array<{ id: string; name: string; description: string; voice_expressive: boolean }>;
  }) => apiClient<{ ok: true; script: string; scenes: Array<{ seconds: number; prompt: string; wardrobe: string; setting: string; dialogue: string; character_ids: string[]; graphic: SceneGraphic }> }>(
    "/api/video/script", { method: "POST", body, showLoader: "Escribiendo el guion y las escenas..." }),
  avatars: () => apiClient<{ avatars: Avatar[] }>("/api/video/avatars", { showError: false }).then((r) => r.avatars),
  removeAvatar: (id: string) => apiClient<{ ok: true }>(`/api/video/avatars/${id}`, { method: "DELETE" }),
  /** Pone un avatar guardado en el proyecto (rostro y voz incluidos, sin volver a subir la foto). */
  applyAvatar: (projectId: string, avatarId: string, characterId?: string) =>
    apiClient<{ project: Project }>(`/api/video/projects/${projectId}/avatars/${avatarId}${characterId ? `?character=${encodeURIComponent(characterId)}` : ""}`, { method: "POST" }).then((r) => r.project),
  approve: (id: string) => apiClient<{ project: Project }>(`/api/video/projects/${id}/approve`, { method: "POST" }).then((r) => r.project),
  revoke: (id: string) => apiClient<{ project: Project }>(`/api/video/projects/${id}/revoke`, { method: "POST" }).then((r) => r.project),
  produce: (id: string) => apiClient<{ project: Project }>(`/api/video/projects/${id}/produce`, { method: "POST" }).then((r) => r.project),
};
