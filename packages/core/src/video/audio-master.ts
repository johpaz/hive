/**
 * Pista de audio maestra del reel. En vez de recodificar el sonido en cada paso (voz → recorte → transición → subtítulos → música),
 * el video se une SIN audio y el sonido se arma UNA sola vez al final, a partir de los clips originales: cada escena se recorta a su
 * tramo, se coloca en su lugar del reel con un fundido de potencia constante en las transiciones, se mezcla con la música (que se
 * agacha sola bajo la voz) y se codifica un único AAC. Es el mismo principio con que HyperFrames arma su audio.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ffmpegRun } from "./voice"

export class MasterAudioError extends Error {
  constructor(message: string) { super(message); this.name = "MasterAudioError" }
}

export interface MasterScene {
  /** Clip original (con su audio). */
  path: string
  /** Dónde empieza la escena en el reel (segundos). */
  start: number
  /** Cuánto dura en el reel, ya recortada. */
  duration: number
  /** Tramo del clip original que se conserva. */
  from: number
  /** ¿El clip tiene pista de audio? Si no, se usa silencio. */
  hasAudio: boolean
  /** 1 = mono (se duplica a estéreo sin perder nivel). */
  channels: number
  /** Cadena de filtros del efecto de voz de esta escena ("" = sin efecto). */
  fx?: string
}

export interface MasterAudioSpec {
  total: number
  /** Segundos que se solapan las escenas (fundido de potencia constante). */
  overlap: number
  scenes: MasterScene[]
  music: { path: string; volume: number } | null
}

const SR = 48000
const num = (n: number) => n.toFixed(4)

/** Datos de audio de un clip (¿tiene pista? ¿cuántos canales?). null si no es un archivo de video legible. */
export function probeAudio(path: string): { hasAudio: boolean; channels: number } | null {
  try {
    const r = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,channels", "-of", "csv=p=0", path])
    if (r.exitCode !== 0) return null
    const lines = r.stdout.toString().split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return null // sin ninguna pista: no es un clip real
    const audio = lines.find((l) => l.startsWith("audio"))
    return audio ? { hasAudio: true, channels: Number(audio.split(",")[1]) || 2 } : { hasAudio: false, channels: 2 }
  } catch { return null }
}

export function buildMasterFilter(spec: MasterAudioSpec): { inputs: string[]; filter: string } {
  const n = spec.scenes.length
  const inputs: string[] = []
  const f: string[] = []
  const labels: string[] = []
  spec.scenes.forEach((s, i) => {
    const fadeIn = i === 0 ? 0.01 : Math.max(0.01, spec.overlap)
    const fadeOut = i === n - 1 ? 0.03 : Math.max(0.01, spec.overlap)
    const dur = Math.max(0.05, s.duration)
    const ms = Math.max(0, Math.round(s.start * 1000))
    const fx = s.fx ? `${s.fx},` : ""
    const tail =
      `${fx}afade=t=in:st=0:d=${num(Math.min(fadeIn, dur / 2))}:curve=qsin,afade=t=out:st=${num(Math.max(0, dur - Math.min(fadeOut, dur / 2)))}:d=${num(Math.min(fadeOut, dur / 2))}:curve=qsin,` +
      `adelay=${ms}|${ms}`
    if (s.hasAudio) {
      inputs.push("-i", s.path)
      const idx = inputs.filter((x) => x === "-i").length - 1
      // Mono → estéreo duplicando el canal: `aformat` solo lo baja 3 dB.
      const toStereo = s.channels === 1 ? `aresample=${SR},pan=stereo|c0=c0|c1=c0` : `aresample=${SR},aformat=channel_layouts=stereo`
      f.push(`[${idx}:a]atrim=start=${num(s.from)}:end=${num(s.from + dur)},asetpts=PTS-STARTPTS,${toStereo},${tail}[v${i}]`)
    } else {
      f.push(`anullsrc=r=${SR}:cl=stereo,atrim=0:${num(dur)},${tail}[v${i}]`)
    }
    labels.push(`[v${i}]`)
  })
  f.push(`${labels.join("")}amix=inputs=${n}:duration=longest:normalize=0:dropout_transition=0[voice]`)
  let out = "[voice]"
  if (spec.music) {
    inputs.push("-stream_loop", "-1", "-i", spec.music.path)
    const mi = inputs.filter((x) => x === "-i").length - 1
    const vol = Math.min(0.6, Math.max(0.02, spec.music.volume))
    const fo = Math.min(2.5, spec.total / 3)
    f.push(`[${mi}:a]aresample=${SR},aformat=channel_layouts=stereo,volume=${vol.toFixed(3)},afade=t=in:d=1.5,afade=t=out:st=${num(Math.max(0, spec.total - fo))}:d=${num(fo)}[m]`)
    f.push(`[voice]asplit=2[vv][sc]`)
    f.push(`[m][sc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]`)
    f.push(`[vv][duck]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[mix]`)
    out = "[mix]"
  }
  // Volumen final de redes sociales (≈−15 LUFS, picos a −2 dB): la mezcla salía a −12 LUFS pegada al techo y sonaba apretada.
  f.push(`${out}loudnorm=I=-16.5:TP=-2:LRA=11,aresample=${SR},alimiter=limit=0.85,apad=whole_dur=${num(spec.total + 0.2)},atrim=0:${num(spec.total)}[a]`)
  return { inputs, filter: f.join(";") }
}

/** Arma la pista maestra (un solo AAC de 192k) y la devuelve como bytes de un .m4a. */
export async function buildMasterAudio(spec: MasterAudioSpec): Promise<Uint8Array> {
  if (spec.scenes.length === 0) throw new MasterAudioError("No hay escenas de las que armar el audio.")
  const dir = mkdtempSync(join(tmpdir(), "hive-master-"))
  try {
    const { inputs, filter } = buildMasterFilter(spec)
    const r = await ffmpegRun(["-y", ...inputs, "-filter_complex", filter, "-map", "[a]", "-t", spec.total.toFixed(3), "-ar", String(SR), "-c:a", "aac", "-b:a", "192k", join(dir, "master.m4a")])
    if (r.code !== 0) throw new MasterAudioError(`No se pudo armar el audio final: ${r.err.slice(-240)}`)
    return new Uint8Array(readFileSync(join(dir, "master.m4a")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** Une el video (sin audio) con la pista maestra sin recodificar ninguno de los dos. */
export async function muxAudio(video: Uint8Array, audio: Uint8Array): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "hive-mux-"))
  try {
    writeFileSync(join(dir, "v.mp4"), video)
    writeFileSync(join(dir, "a.m4a"), audio)
    const r = await ffmpegRun(["-y", "-i", "v.mp4", "-i", "a.m4a", "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", "out.mp4"], dir)
    if (r.code !== 0) throw new MasterAudioError(`No se pudo unir el audio al video: ${r.err.slice(-200)}`)
    return new Uint8Array(readFileSync(join(dir, "out.mp4")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
