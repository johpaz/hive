/**
 * Escenas de imagen con movimiento: una imagen de Nano Banana (infografía, plano de apoyo, producto, paisaje…) a la que ffmpeg le
 * da un movimiento de cámara suave (zoom o paneo). Cuesta lo de una imagen (≈0,04 USD) en vez de ≈0,07–0,2 USD por SEGUNDO de un
 * clip de video, y el texto que lleve se pide entre comillas, que es lo que mejor lee el modelo.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IDENTITY_PRESETS, type Identity } from "./identity"
import { VoiceError, ffmpegRun } from "./voice"
import { canvasFor } from "./cards"

export const IMAGE_MOTIONS = ["zoom_in", "zoom_out", "pan_left", "pan_right"] as const
export type ImageMotion = (typeof IMAGE_MOTIONS)[number]

/** Pedido de imagen: lo que escribió el Director + la identidad visual + las reglas que mejor funcionan para texto y composición. */
export function buildImageScenePrompt(prompt: string, id: Identity, aspect: string): string {
  const mood = IDENTITY_PRESETS.find((p) => p.preset === id.preset)?.mood
  return [
    prompt.trim(),
    `Composition for a short ${aspect === "16:9" ? "horizontal" : "vertical"} video. Cohesive visual identity: background tone ${id.bg}, text color ${id.fg}, one accent color ${id.accent}${mood ? `; mood: ${mood}` : ""}.`,
    "No people or faces unless the description asks for them. Any text in the image must be exactly the text in quotes in the description, in correct Spanish with accents, large, high contrast and short; no other text, no logos, no watermarks.",
    "Keep the lower fifth of the frame calm and uncluttered (subtitles go there).",
  ].join("\n")
}

/** Movimiento de cámara de la escena n: se alternan para que las escenas seguidas no se sientan iguales. */
export const motionFor = (index: number): ImageMotion => IMAGE_MOTIONS[Math.abs(index) % IMAGE_MOTIONS.length]

const ENCODERS: string[][] = [
  ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"],
  ["-c:v", "libopenh264", "-b:v", "8M", "-pix_fmt", "yuv420p"],
  ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p"],
]

/** Filtro de ffmpeg del movimiento. `n` = cuadros totales. Se trabaja al doble de tamaño para que el zoom no tiemble. */
export function motionFilter(motion: ImageMotion, w: number, h: number, n: number, fps: number): string {
  const last = Math.max(1, n - 1)
  const z: Record<ImageMotion, string> = {
    zoom_in: `z='1+0.14*on/${last}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    zoom_out: `z='1.14-0.14*on/${last}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    pan_left: `z='1.14':x='(iw-iw/zoom)*(1-on/${last})':y='ih/2-(ih/zoom/2)'`,
    pan_right: `z='1.14':x='(iw-iw/zoom)*on/${last}':y='ih/2-(ih/zoom/2)'`,
  }
  return `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=${z[motion]}:d=${n}:s=${w}x${h}:fps=${fps},format=yuv420p`
}

/** Convierte una imagen fija en un clip MP4 (sin audio) con movimiento de cámara. */
export async function animateStill(image: Uint8Array, o: { aspect: string; seconds: number; resolution?: string; motion: ImageMotion; fps?: number }): Promise<Uint8Array> {
  const fps = o.fps ?? 24
  const shortSide = ({ "360p": 360, "720p": 720, "1080p": 1080, "4k": 2160 } as Record<string, number>)[o.resolution ?? "720p"] ?? 720
  const { width, height } = canvasFor(o.aspect, shortSide)
  const n = Math.max(1, Math.round(o.seconds * fps))
  const dir = mkdtempSync(join(tmpdir(), "hive-still-"))
  try {
    writeFileSync(join(dir, "in.img"), image)
    let last = ""
    for (const enc of ENCODERS) {
      const r = await ffmpegRun(["-y", "-i", "in.img", "-vf", motionFilter(o.motion, width, height, n, fps), "-frames:v", String(n), "-r", String(fps), ...enc, "-an", "-movflags", "+faststart", "out.mp4"], dir)
      if (r.code === 0) return new Uint8Array(readFileSync(join(dir, "out.mp4")))
      last = r.err
    }
    throw new VoiceError(`No se pudo animar la imagen: ${last.slice(-200)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
