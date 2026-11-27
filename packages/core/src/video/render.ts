/**
 * Acabado del reel: estilos de subtítulos, gráficos animados y transiciones entre escenas.
 *
 * Todo lo que se dibuja sobre el video (subtítulos, títulos, tercios inferiores, datos destacados, llamadas a la acción y la
 * barra de progreso) sale de un solo archivo ASS que ffmpeg graba con libass, sin imágenes ni plantillas externas. Las
 * transiciones se hacen con `xfade` (video) y `acrossfade` (audio).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { VoiceError, ffmpegRun, probeDims, stripAudioTags, type WordTiming } from "./voice"

// ─── Estilos ─────────────────────────────────────────────────────────────────

export const SUBTITLE_PRESETS = ["classic", "karaoke", "box", "pop", "minimal"] as const
export type SubtitlePreset = (typeof SUBTITLE_PRESETS)[number]
export const SUBTITLE_POSITIONS = ["bottom", "middle", "top"] as const
export const SUBTITLE_SIZES = ["s", "m", "l"] as const
export const SUBTITLE_FONTS = ["montserrat", "sans", "serif"] as const

export interface SubtitleStyle {
  preset: SubtitlePreset
  position: (typeof SUBTITLE_POSITIONS)[number]
  size: (typeof SUBTITLE_SIZES)[number]
  uppercase: boolean
  /** Color del texto (#RRGGBB). */
  color: string
  /** Color de la palabra activa (karaoke), del texto «pop» y de acentos (#RRGGBB). */
  highlight: string
  font: (typeof SUBTITLE_FONTS)[number]
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  preset: "classic", position: "bottom", size: "m", uppercase: false, color: "#FFFFFF", highlight: "#FACC15", font: "montserrat",
}

export const TRANSITIONS = [
  "none", "fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "circleopen", "circleclose", "zoomin", "pixelize", "radial", "smoothleft",
] as const
export type TransitionType = (typeof TRANSITIONS)[number]

export interface TransitionStyle {
  type: TransitionType
  /** Segundos que dura el efecto entre dos escenas (0,2 a 1). */
  duration: number
}

export const GRAPHIC_KINDS = ["none", "title", "lower_third", "stat", "cta"] as const
export type GraphicKind = (typeof GRAPHIC_KINDS)[number]

export interface SceneGraphic {
  kind: GraphicKind
  /** Texto principal (título, nombre, cifra o llamada a la acción). */
  text: string
  /** Línea secundaria opcional (cargo, etiqueta de la cifra…). */
  sub: string
}

export interface GraphicsStyle {
  enabled: boolean
  /** Color de las cajas y acentos de los gráficos (#RRGGBB). */
  accent: string
  /** Barra fina arriba que avanza durante todo el reel. */
  progress_bar: boolean
}

/** Recorte del aire muerto: cada escena con diálogo se corta a su tramo hablado (con un pequeño margen antes y después). */
export interface TrimStyle {
  enabled: boolean
  /** Segundos que se dejan antes de la primera palabra. */
  lead: number
  /** Segundos que se dejan después de la última palabra. */
  tail: number
}

/** Música de fondo generada con Lyria: volumen bajo, se agacha sola cuando alguien habla. */
export interface MusicStyle {
  enabled: boolean
  /** 0,02–0,6 (ganancia sobre la canción; 0,14 queda suave bajo la voz). */
  volume: number
  /** Ánimo o estilo que pide el usuario (vacío = el que encaje con el tema). */
  mood: string
}

export interface ReelStyle {
  subtitles: SubtitleStyle
  transition: TransitionStyle
  graphics: GraphicsStyle
  trim: TrimStyle
  music: MusicStyle
}

export const DEFAULT_REEL_STYLE: ReelStyle = {
  subtitles: DEFAULT_SUBTITLE_STYLE,
  transition: { type: "fade", duration: 0.4 },
  graphics: { enabled: true, accent: "#2563EB", progress_bar: false },
  trim: { enabled: true, lead: 0.2, tail: 0.35 },
  music: { enabled: true, volume: 0.14, mood: "" },
}

const HEX = /^#[0-9a-fA-F]{6}$/
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all as readonly string[]).includes(v as string) ? (v as T) : d
const clampNum = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v.toUpperCase() : d)

export function normalizeSubtitleStyle(i?: Partial<SubtitleStyle> | null): SubtitleStyle {
  const d = DEFAULT_SUBTITLE_STYLE
  return {
    preset: pick(i?.preset, SUBTITLE_PRESETS, d.preset), position: pick(i?.position, SUBTITLE_POSITIONS, d.position),
    size: pick(i?.size, SUBTITLE_SIZES, d.size), uppercase: typeof i?.uppercase === "boolean" ? i.uppercase : d.uppercase,
    color: color(i?.color, d.color), highlight: color(i?.highlight, d.highlight), font: pick(i?.font, SUBTITLE_FONTS, d.font),
  }
}

export function normalizeReelStyle(i?: { subtitles?: Partial<SubtitleStyle>; transition?: Partial<TransitionStyle>; graphics?: Partial<GraphicsStyle>; trim?: Partial<TrimStyle>; music?: Partial<MusicStyle> } | null): ReelStyle {
  const d = DEFAULT_REEL_STYLE
  const dur = Number(i?.transition?.duration)
  return {
    subtitles: normalizeSubtitleStyle(i?.subtitles),
    transition: { type: pick(i?.transition?.type, TRANSITIONS, d.transition.type), duration: Number.isFinite(dur) ? Math.min(1, Math.max(0.2, dur)) : d.transition.duration },
    graphics: {
      enabled: typeof i?.graphics?.enabled === "boolean" ? i.graphics.enabled : d.graphics.enabled,
      accent: color(i?.graphics?.accent, d.graphics.accent),
      progress_bar: typeof i?.graphics?.progress_bar === "boolean" ? i.graphics.progress_bar : d.graphics.progress_bar,
    },
    trim: {
      enabled: typeof i?.trim?.enabled === "boolean" ? i.trim.enabled : d.trim.enabled,
      lead: clampNum(i?.trim?.lead, 0, 1, d.trim.lead),
      tail: clampNum(i?.trim?.tail, 0, 1.5, d.trim.tail),
    },
    music: {
      enabled: typeof i?.music?.enabled === "boolean" ? i.music.enabled : d.music.enabled,
      volume: clampNum(i?.music?.volume, 0.02, 0.6, d.music.volume),
      mood: typeof i?.music?.mood === "string" ? i.music.mood.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : d.music.mood,
    },
  }
}

export function normalizeGraphic(i?: Partial<SceneGraphic> | null): SceneGraphic {
  const kind = pick(i?.kind, GRAPHIC_KINDS, "none")
  const clean = (t: unknown, max: number) => (typeof t === "string" ? t.replace(/[{}\\]/g, "").replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "")
  const text = clean(i?.text, 60)
  return kind === "none" || !text ? { kind: "none", text: "", sub: "" } : { kind, text, sub: clean(i?.sub, 60) }
}

// ─── ASS ─────────────────────────────────────────────────────────────────────

const ass = (hex: string, alpha = 0) => `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase()
const fmt = (sec: number) => {
  const s = Math.max(0, sec)
  const whole = Math.floor(s)
  return `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}.${String(Math.min(99, Math.round((s % 1) * 100))).padStart(2, "0")}`
}
const esc = (t: string) => t.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim()
const FONT_NAME: Record<SubtitleStyle["font"], string> = { montserrat: "Montserrat", sans: "DejaVu Sans", serif: "DejaVu Serif" }

export interface OverlayScene {
  /** Segundo del reel en que empieza la escena (ya descontadas las transiciones). */
  start: number
  duration: number
  /** Palabras del diálogo con tiempos relativos al inicio de la escena. */
  words: WordTiming[]
  graphic?: SceneGraphic
}

export interface OverlaySpec {
  scenes: OverlayScene[]
  total: number
  subtitles: SubtitleStyle | null
  graphics: GraphicsStyle
}

/** Agrupa las palabras en líneas de hasta `maxWords`, cortando en la puntuación; cada una dura hasta que empieza la siguiente. */
export function groupWords(words: WordTiming[], maxWords = 4): WordTiming[][] {
  const out: WordTiming[][] = []
  let cur: WordTiming[] = []
  for (const w of words) {
    cur.push(w)
    if (cur.length >= maxWords || /[.!?…;,]$/.test(w.text)) { out.push(cur); cur = [] }
  }
  if (cur.length) out.push(cur)
  return out
}

/** Construye el archivo ASS con subtítulos, gráficos y barra de progreso para un reel de `width`×`height`. */
export function buildOverlayAss(spec: OverlaySpec, dims: { width: number; height: number }): string {
  const { width: W, height: H } = dims
  const vertical = H >= W
  const sub = spec.subtitles
  const g = spec.graphics
  const base = Math.round(H * (vertical ? 0.042 : 0.06))
  const subSize = Math.round(base * ({ s: 0.8, m: 1, l: 1.3 } as const)[sub?.size ?? "m"] * (sub?.preset === "minimal" ? 0.85 : sub?.preset === "pop" ? 1.15 : 1))
  const outline = Math.max(2, Math.round(subSize * 0.09))
  const align = { bottom: 2, middle: 5, top: 8 }[sub?.position ?? "bottom"]
  const marginV = Math.round(H * ({ bottom: vertical ? 0.17 : 0.09, middle: 0, top: vertical ? 0.12 : 0.08 })[sub?.position ?? "bottom"])
  const mH = Math.round(W * 0.07)
  const font = FONT_NAME[sub?.font ?? "montserrat"]
  const text = ass(sub?.color ?? "#FFFFFF")
  const hl = ass(sub?.highlight ?? "#FACC15")
  const accent = ass(g.accent)
  const boxed = sub?.preset === "box"
  const bold = sub?.preset === "minimal" ? 0 : -1
  const styles = [
    // subtítulos: «box» pinta una caja detrás del texto (BorderStyle 3, el color de la caja es OutlineColour con algo de transparencia)
    `Style: Sub,${font},${subSize},${sub?.preset === "pop" ? hl : text},${text},${boxed ? ass("#000000", 0x66) : ass("#000000")},${ass("#000000", 0x80)},${bold},0,0,0,100,100,0,0,${boxed ? 3 : 1},${boxed ? Math.round(subSize * 0.3) : outline},${sub?.preset === "minimal" ? 0 : 1},${align},${mH},${mH},${marginV},1`,
    // gráficos: cajas del color de acento
    `Style: GTitle,${font},${Math.round(base * 1.35)},&H00FFFFFF,&H00FFFFFF,${accent},${accent},-1,0,0,0,100,100,0,0,3,${Math.round(base * 0.35)},0,8,${mH},${mH},${Math.round(H * 0.1)},1`,
    `Style: GName,${font},${Math.round(base * 1.05)},&H00FFFFFF,&H00FFFFFF,${accent},${accent},-1,0,0,0,100,100,0,0,3,${Math.round(base * 0.28)},0,1,${mH},${mH},${Math.round(H * 0.3)},1`,
    `Style: GRole,${font},${Math.round(base * 0.78)},&H00FFFFFF,&H00FFFFFF,${ass("#000000", 0x4d)},${ass("#000000", 0x4d)},0,0,0,0,100,100,0,0,3,${Math.round(base * 0.2)},0,1,${mH},${mH},${Math.round(H * 0.3) - Math.round(base * 1.9)},1`,
    `Style: GStat,${font},${Math.round(base * 3.2)},${accent},${accent},&H00FFFFFF,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(base * 0.16))},1,5,${mH},${mH},0,1`,
    `Style: GStatLabel,${font},${Math.round(base * 1.0)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},1,5,${mH},${mH},0,1`,
    `Style: GCta,${font},${Math.round(base * 1.1)},&H00FFFFFF,&H00FFFFFF,${accent},${accent},-1,0,0,0,100,100,0,0,3,${Math.round(base * 0.4)},0,2,${mH},${mH},${Math.round(H * (vertical ? 0.3 : 0.22))},1`,
  ]
  const ev: string[] = []
  const line = (layer: number, a: number, b: number, style: string, t: string) => ev.push(`Dialogue: ${layer},${fmt(a)},${fmt(Math.max(a + 0.05, b))},${style},,0,0,0,,${t}`)

  // Barra de progreso: un rectángulo arriba que crece de 0 a 100 % durante todo el reel.
  if (g.enabled && g.progress_bar && spec.total > 0) {
    const bh = Math.max(4, Math.round(H * 0.008))
    line(0, 0, spec.total, "Sub", `{\\an7\\pos(0,0)\\bord0\\shad0\\1c${accent}\\fscx0\\t(0,${Math.round(spec.total * 1000)},\\fscx100)\\p1}m 0 0 l ${W} 0 l ${W} ${bh} l 0 ${bh}{\\p0}`)
  }

  for (const sc of spec.scenes) {
    const end = sc.start + sc.duration
    // Gráfico de la escena
    const gr = g.enabled ? sc.graphic : undefined
    if (gr && gr.kind !== "none" && gr.text) {
      const t = esc(gr.kind === "title" || gr.kind === "cta" ? gr.text : gr.text)
      if (gr.kind === "title") line(1, sc.start + 0.25, Math.min(sc.start + 3, end - 0.25), "GTitle", `{\\fad(250,250)\\move(${Math.round(W / 2)},${Math.round(H * 0.07)},${Math.round(W / 2)},${Math.round(H * 0.1)},0,300)}${t}`.replace("\\move", "\\an8\\move"))
      if (gr.kind === "lower_third") {
        const a = sc.start + 0.5, b = Math.min(sc.start + 4.2, end - 0.2)
        line(1, a, b, "GName", `{\\fad(250,250)\\move(${-Math.round(W * 0.4)},${Math.round(H * 0.7)},${mH},${Math.round(H * 0.7)},0,350)\\an1}${t}`)
        if (gr.sub) line(1, a + 0.1, b, "GRole", `{\\fad(250,250)\\move(${-Math.round(W * 0.4)},${Math.round(H * 0.7) + Math.round(base * 1.9)},${mH},${Math.round(H * 0.7) + Math.round(base * 1.9)},0,350)\\an1}${esc(gr.sub)}`)
      }
      if (gr.kind === "stat") {
        const a = sc.start + 0.3, b = Math.min(sc.start + 3.6, end - 0.2)
        line(1, a, b, "GStat", `{\\an5\\pos(${Math.round(W / 2)},${Math.round(H * 0.38)})\\fad(150,250)\\fscx40\\fscy40\\t(0,260,\\fscx108\\fscy108)\\t(260,420,\\fscx100\\fscy100)}${t}`)
        if (gr.sub) line(1, a + 0.15, b, "GStatLabel", `{\\an5\\pos(${Math.round(W / 2)},${Math.round(H * 0.38) + Math.round(base * 2.4)})\\fad(200,250)}${esc(gr.sub)}`)
      }
      if (gr.kind === "cta") {
        const a = Math.max(sc.start + 0.4, end - 3.4), b = end - 0.15
        line(1, a, b, "GCta", `{\\an2\\pos(${Math.round(W / 2)},${Math.round(H * (vertical ? 0.7 : 0.78))})\\fad(300,200)\\fscx85\\fscy85\\t(0,300,\\fscx100\\fscy100)}${t}  ➜`)
      }
    }
    // Subtítulos
    if (sub && sc.words.length) {
      const up = (x: string) => (sub.uppercase || sub.preset === "pop" ? x.toUpperCase() : x)
      const groups = groupWords(sc.words.map((w) => ({ ...w, text: stripAudioTags(w.text) })).filter((w) => w.text))
      groups.forEach((grp, gi) => {
        const nextStart = groups[gi + 1]?.[0]?.start
        const gEnd = Math.min(grp[grp.length - 1].end + 0.2, nextStart ?? Infinity)
        if (sub.preset === "karaoke") {
          // una línea por palabra: la palabra activa va del color de resalte
          grp.forEach((w, wi) => {
            const a = sc.start + w.start
            const b = sc.start + (wi + 1 < grp.length ? grp[wi + 1].start : gEnd)
            const txt = grp.map((x, xi) => (xi === wi ? `{\\c${hl}}${up(esc(x.text))}{\\c${text}}` : up(esc(x.text)))).join(" ")
            line(2, a, b, "Sub", txt)
          })
        } else {
          const pop = sub.preset === "pop" ? "{\\fscx70\\fscy70\\t(0,110,\\fscx104\\fscy104)\\t(110,200,\\fscx100\\fscy100)}" : ""
          line(2, sc.start + grp[0].start, sc.start + gEnd, "Sub", `${pop}${grp.map((w) => up(esc(w.text))).join(" ")}`)
        }
      })
    }
  }
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles, "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...ev, "",
  ].join("\n")
}

const ENCODERS: string[][] = [
  ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"],
  ["-c:v", "libopenh264", "-b:v", "6M", "-pix_fmt", "yuv420p"],
  ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p"],
]

/**
 * Ventana [start, end] de un clip que conviene conservar: desde un poco antes de la primera palabra hasta un poco después de la
 * última. null si no hay nada que recortar (sin palabras o el recorte ahorraría menos de 0,3 s).
 */
export function trimWindow(words: WordTiming[], duration: number, t: TrimStyle): { start: number; end: number } | null {
  if (!t.enabled || words.length === 0 || !(duration > 0)) return null
  const start = Math.max(0, words[0].start - t.lead)
  const end = Math.min(duration, words[words.length - 1].end + t.tail)
  if (end - start < 1) return null
  return duration - (end - start) < 0.3 ? null : { start, end }
}

/** Corta un clip a [start, end] y lo escribe en `out` (recodifica para cortar en el fotograma exacto). */
export async function trimClipFile(src: string, out: string, start: number, end: number, o: { audio?: boolean } = {}): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "hive-trim-"))
  try {
    let last = ""
    for (const enc of ENCODERS) {
      const r = await ffmpegRun(["-y", "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", src, ...enc, ...(o.audio === false ? ["-an"] : ["-c:a", "aac", "-b:a", "256k"]), "-movflags", "+faststart", out], dir)
      if (r.code === 0) return
      last = r.err
    }
    throw new VoiceError(`No se pudo recortar el clip: ${last.slice(-200)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** Graba subtítulos, gráficos y barra de progreso sobre el reel (recodifica el video; el audio no se toca). */
export async function burnOverlays(clip: Uint8Array, spec: OverlaySpec): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "hive-overlay-"))
  try {
    writeFileSync(join(dir, "in.mp4"), clip)
    writeFileSync(join(dir, "o.ass"), buildOverlayAss(spec, await probeDims(join(dir, "in.mp4"))))
    let last = ""
    for (const enc of ENCODERS) {
      rmSync(join(dir, "out.mp4"), { force: true })
      const r = await ffmpegRun(["-y", "-i", "in.mp4", "-vf", "ass=o.ass", ...enc, "-c:a", "copy", "-movflags", "+faststart", "out.mp4"], dir)
      if (r.code === 0) return new Uint8Array(readFileSync(join(dir, "out.mp4")))
      last = r.err
    }
    throw new VoiceError(`No se pudieron grabar los subtítulos y gráficos: ${last}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ─── Transiciones ────────────────────────────────────────────────────────────

/** Segundos que se solapan dos escenas: el efecto no puede ser más largo que ~40 % de la más corta. */
export function effectiveTransition(t: TransitionStyle, durations: number[]): number {
  if (t.type === "none" || durations.length < 2) return 0
  return Math.max(0, Math.min(t.duration, Math.min(...durations) * 0.4))
}

/** Inicio de cada escena en el reel: la suma de las anteriores menos lo que se solapa en cada transición. */
export function sceneStarts(durations: number[], overlap: number): number[] {
  const starts: number[] = []
  let acc = 0
  durations.forEach((d, i) => { starts.push(Math.max(0, acc - i * overlap)); acc += d })
  return starts
}

/** Une los clips con una transición (`xfade`/`acrossfade`) entre cada par. Recodifica el video. */
export async function joinWithTransitions(paths: string[], durations: number[], t: TransitionStyle, o: { audio?: boolean } = {}): Promise<Uint8Array> {
  const T = effectiveTransition(t, durations)
  if (T <= 0 || paths.length < 2) throw new VoiceError("No hay transición que aplicar.")
  const dir = mkdtempSync(join(tmpdir(), "hive-xfade-"))
  try {
    const inputs = paths.flatMap((p) => ["-i", p])
    const build = (audio: boolean) => {
      const f: string[] = []
      let acc = durations[0]
      // xfade exige misma base de tiempo, fps, formato y SAR en todas las entradas: las tarjetas y los clips
      // de Gemini vienen con bases distintas (p. ej. 1/12288 frente a 1/24).
      for (let i = 0; i < paths.length; i++) f.push(`[${i}:v]settb=AVTB,fps=24,setsar=1,format=yuv420p[n${i}]`)
      let vl = "[n0]"
      let al = "[0:a]"
      for (let i = 1; i < paths.length; i++) {
        const off = acc - T
        f.push(`${vl}[n${i}]xfade=transition=${t.type}:duration=${T.toFixed(3)}:offset=${off.toFixed(3)}[v${i}]`)
        vl = `[v${i}]`
        if (audio) { f.push(`${al}[${i}:a]acrossfade=d=${T.toFixed(3)}[a${i}]`); al = `[a${i}]` }
        acc = off + durations[i]
      }
      return { filter: f.join(";"), vl, al }
    }
    let last = ""
    for (const withAudio of o.audio === false ? [false] : [true, false]) {
      const { filter, vl, al } = build(withAudio)
      for (const enc of ENCODERS) {
        rmSync(join(dir, "out.mp4"), { force: true })
        const r = await ffmpegRun(["-y", ...inputs, "-filter_complex", filter, "-map", vl, ...(withAudio ? ["-map", al, "-c:a", "aac", "-b:a", "256k"] : ["-an"]), ...enc, "-movflags", "+faststart", join(dir, "out.mp4")])
        if (r.code === 0) return new Uint8Array(readFileSync(join(dir, "out.mp4")))
        last = r.err
      }
    }
    throw new VoiceError(`No se pudieron unir los clips con transiciones: ${last}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
