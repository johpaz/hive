/**
 * Efectos de voz del reel. Se aplican a la voz de cada escena al armar el audio final (pista maestra), así que cambiar de efecto
 * es gratis: no regenera video ni voz, solo vuelve a armar el reel. Cada preset es una cadena de filtros de ffmpeg.
 */

export const VOICE_FX_IDS = ["none", "studio", "podcast", "intimate", "radio", "telephone", "megaphone", "cinematic", "hall"] as const
export type VoiceFxId = (typeof VOICE_FX_IDS)[number]

export interface VoiceFxPreset {
  id: VoiceFxId
  label: string
  /** Para qué sirve, en una línea. */
  hint: string
  /** Cadena de filtros de audio de ffmpeg ("" = sin efecto). */
  filter: string
}

/** Todos los filtros usados existen en cualquier ffmpeg ≥ 4.4 (equalizer, deesser, acompressor, aecho, asoftclip, bass…). */
export const VOICE_FX: VoiceFxPreset[] = [
  { id: "none", label: "Sin efecto", hint: "La voz tal cual sale.", filter: "" },
  {
    id: "studio", label: "Micrófono de estudio", hint: "Voz cercana, limpia y con presencia, como grabada con un buen micrófono.",
    // Pensada para voces clonadas, que suelen salir oscuras («de huevo»): quita la caja de 220–700 Hz (el sonido «de tarro»), sube la presencia y el aire, y
    // comprime SUAVE (ratio 2) para no aplastar los cambios de intensidad que hacen viva una locución.
    filter: "highpass=f=100,equalizer=f=220:t=q:w=0.9:g=-2.5,equalizer=f=380:t=q:w=1:g=-5,equalizer=f=650:t=q:w=1:g=-3,equalizer=f=1100:t=q:w=1:g=-0.5,equalizer=f=2800:t=q:w=1:g=5,equalizer=f=4500:t=q:w=1:g=3.5,treble=g=5:f=7000,aexciter=amount=3:drive=8:blend=0:freq=5000,deesser=i=0.3,acompressor=threshold=0.18:ratio=2:attack=20:release=220:makeup=1",
  },
  {
    id: "podcast", label: "Podcast", hint: "Voz cálida y compacta, de conversación.",
    filter: "highpass=f=70,equalizer=f=120:t=q:w=1:g=2.5,equalizer=f=300:t=q:w=1:g=-2,equalizer=f=3000:t=q:w=1.2:g=3,treble=g=3.5:f=6500,deesser=i=0.3,acompressor=threshold=0.14:ratio=2.5:attack=15:release=180:makeup=2,alimiter=limit=0.92",
  },
  {
    id: "intimate", label: "Íntima (micrófono pegado)", hint: "Cercana y suave, como un susurro a la oreja.",
    filter: "highpass=f=60,bass=g=4:f=150,equalizer=f=320:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=3,treble=g=4:f=7000,acompressor=threshold=0.1:ratio=2.5:attack=12:release=170:makeup=2.5",
  },
  {
    id: "radio", label: "Radio / noticiero", hint: "Voz de locución: recortada y con cuerpo en los medios.",
    filter: "highpass=f=320,lowpass=f=4200,equalizer=f=1800:t=q:w=1:g=3,acompressor=threshold=0.07:ratio=6:attack=4:release=80:makeup=4,alimiter=limit=0.9",
  },
  {
    id: "telephone", label: "Llamada telefónica", hint: "Suena a través de un teléfono.",
    filter: "highpass=f=400,lowpass=f=3000,acrusher=bits=11:mode=log:aa=1:mix=0.25,acompressor=threshold=0.08:ratio=5:makeup=4,alimiter=limit=0.9",
  },
  {
    id: "megaphone", label: "Megáfono", hint: "Voz estridente y comprimida, de altavoz.",
    filter: "highpass=f=600,lowpass=f=3800,acompressor=threshold=0.05:ratio=10:attack=2:release=60:makeup=6,asoftclip=type=tanh",
  },
  {
    id: "cinematic", label: "Cinematográfica (tráiler)", hint: "Voz grave y épica, con un poco de eco.",
    filter: "bass=g=5:f=110,equalizer=f=4500:t=q:w=1:g=1.5,aecho=0.8:0.85:55|110:0.25|0.15,acompressor=threshold=0.08:ratio=3:makeup=2",
  },
  {
    id: "hall", label: "Sala amplia (eco)", hint: "Como hablar en un salón o una catedral.",
    filter: "highpass=f=90,aecho=0.8:0.88:40|85|130:0.35|0.25|0.18",
  },
]

const BY_ID = new Map(VOICE_FX.map((f) => [f.id, f]))

// ─── «Micrófono de estudio» adaptativo ───────────────────────────────────────

export interface ToneLevels { low: number; pres: number; air: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Nivel medio (dB) de la voz en 3 zonas: cuerpo (200–500 Hz), claridad (2–4 kHz) y aire (5–9 kHz). null si no se pudo medir. */
export async function measureTone(path: string, from = 0): Promise<ToneLevels | null> {
  const level = async (lo: number, hi: number): Promise<number | null> => {
    const p = Bun.spawn(["ffmpeg", "-hide_banner", "-ss", String(from), "-i", path, "-vn", "-af",
      `highpass=f=${lo}:p=2,lowpass=f=${hi}:p=2,silenceremove=stop_periods=-1:stop_threshold=-50dB:stop_duration=0.1,volumedetect`, "-f", "null", "-"], { stdout: "ignore", stderr: "pipe" })
    const err = await new Response(p.stderr).text()
    await p.exited
    const m = /mean_volume: (-?[\d.]+) dB/.exec(err)
    return m ? Number(m[1]) : null
  }
  const [low, pres, air] = await Promise.all([level(200, 500), level(2000, 4000), level(5000, 9000)])
  return low === null || pres === null || air === null ? null : { low, pres, air }
}

/**
 * Filtro de estudio ajustado a ESTA voz. Una voz clonada oscura necesita mucha claridad y aire; una que ya trae agudos suena a
 * siseo metálico si se le aplica lo mismo. Se corta el cuerpo y se sube la claridad hasta dejar graves y claridad parejos, y el
 * aire queda unos 4 dB por debajo de la claridad (como una voz natural).
 */
export function studioFilterFor(t: ToneLevels): string {
  const gap = t.low - t.pres
  const gL = -clamp(gap * 0.45, 1.5, 7)
  const gP = clamp(gL + gap - 1, 1.5, 8)
  const gA = clamp(gP - 7 - (t.air - t.pres), -2, 9)
  const f = (n: number) => n.toFixed(1)
  return [
    "highpass=f=100",
    `equalizer=f=220:t=q:w=0.9:g=${f(gL * 0.5)}`,
    `equalizer=f=380:t=q:w=1:g=${f(gL)}`,
    `equalizer=f=650:t=q:w=1:g=${f(gL * 0.6)}`,
    `equalizer=f=2800:t=q:w=1:g=${f(gP)}`,
    `equalizer=f=4500:t=q:w=1:g=${f(gP * 0.6)}`,
    `treble=g=${f(gA)}:f=7000`,
    "deesser=i=0.3",
    "acompressor=threshold=0.18:ratio=2:attack=20:release=220:makeup=1",
  ].join(",")
}

/** Filtro del efecto para un archivo: el de estudio se adapta a la voz; los demás son fijos. */
export async function fxFilterFor(id: string | null | undefined, path: string, from = 0): Promise<string> {
  if (normalizeVoiceFx(id, "none") === "studio") {
    const tone = await measureTone(path, from).catch(() => null)
    if (tone) return studioFilterFor(tone)
  }
  return fxFilter(id)
}

/**
 * Aplica un efecto a un audio (para la prueba de voz de la interfaz). Devuelve el mismo audio si el efecto es «none» o si ffmpeg
 * no lo puede aplicar: una prueba sin efecto es mejor que ningún sonido.
 */
export async function applyVoiceFx(audio: Uint8Array, id: string | null | undefined): Promise<Uint8Array> {
  if (!fxFilter(id)) return audio
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = mkdtempSync(join(tmpdir(), "hive-fxp-"))
  try {
    writeFileSync(join(dir, "in.mp3"), audio)
    const filter = await fxFilterFor(id, join(dir, "in.mp3"))
    const p = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-i", join(dir, "in.mp3"), "-af", `${filter},alimiter=limit=0.95`, "-c:a", "libmp3lame", "-b:a", "192k", join(dir, "out.mp3")], { stdout: "ignore", stderr: "ignore" })
    return (await p.exited) === 0 ? new Uint8Array(readFileSync(join(dir, "out.mp3"))) : audio
  } catch { return audio } finally { rmSync(dir, { recursive: true, force: true }) }
}

export function normalizeVoiceFx(v: unknown, fallback: VoiceFxId = "none"): VoiceFxId {
  return typeof v === "string" && BY_ID.has(v as VoiceFxId) ? (v as VoiceFxId) : fallback
}

/** Cadena de filtros de ffmpeg de un efecto ("" si no hay). */
export function fxFilter(id: string | null | undefined): string {
  return BY_ID.get(normalizeVoiceFx(id))?.filter ?? ""
}

export interface FxSuggestion { id: VoiceFxId; reason: string }

const RULES: Array<{ id: VoiceFxId; re: RegExp; reason: string }> = [
  { id: "telephone", re: /llamada|tel[eé]fono|contest[oó]|al otro lado|phone call|on the phone/i, reason: "se habla de una llamada" },
  { id: "radio", re: /noticia|[uú]ltima hora|titular|bolet[ií]n|reporte|urgente|breaking|news|locutor/i, reason: "tono de noticiero" },
  { id: "megaphone", re: /meg[aá]fono|altavoz|protesta|manifestaci[oó]n|megaphone|rally/i, reason: "se pide atención a una multitud" },
  { id: "intimate", re: /susurr|secreto|confesi[oó]n|entre nosotros|te cuento un|[ií]ntim|whisper|secret/i, reason: "es un secreto o una confesión" },
  { id: "hall", re: /catedral|templo|cueva|ec[oó]|sal[oó]n enorme|vac[ií]o|cathedral|cave|echo/i, reason: "el lugar tiene eco" },
  { id: "cinematic", re: /imagina|el futuro|[eé]pic|destino|todo cambiar[aá]|pel[ií]cula|tr[aá]iler|nunca m[aá]s|cinematic|trailer|legado/i, reason: "tono épico o de tráiler" },
  { id: "podcast", re: /podcast|entrevista|conversaci[oó]n|charla|interview|episodio/i, reason: "formato de conversación" },
]

/**
 * Sugiere un efecto para una escena según lo que se dice y lo que se ve (no usa IA: reglas simples y predecibles).
 * null si la escena no tiene voz. Por omisión, quien habla a cámara o narra suena a «micrófono de estudio».
 */
export function suggestVoiceFx(scene: { dialogue: string; prompt?: string; setting?: string }): FxSuggestion | null {
  const spoken = scene.dialogue?.trim()
  if (!spoken) return null
  if (/\[(whispering|susurrando)\]/i.test(spoken)) return { id: "intimate", reason: "la línea va susurrada" }
  const text = `${spoken} ${scene.prompt ?? ""} ${scene.setting ?? ""}`
  for (const r of RULES) if (r.re.test(text)) return { id: r.id, reason: r.reason }
  return { id: "studio", reason: "voz limpia y cercana, como con un buen micrófono" }
}
