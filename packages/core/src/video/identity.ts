/**
 * Identidad visual de un reel: paleta, tipografías y ánimo que comparten las tarjetas de gráficos, los gráficos animados y los
 * subtítulos. Se define ANTES de dibujar nada (un solo acento, fondo único, neutros teñidos hacia el acento) para que el reel se vea
 * hecho por una sola mano y no como un collage de escenas con colores sueltos.
 */

export const IDENTITY_FONTS = ["montserrat", "sans", "serif"] as const
export type IdentityFont = (typeof IDENTITY_FONTS)[number]

export interface Identity {
  /** Preset de origen (informativo; los colores mandan). */
  preset: string
  bg: string
  fg: string
  accent: string
  heading_font: IdentityFont
  body_font: IdentityFont
}

export interface IdentityPreset extends Identity {
  label: string
  /** Para qué contenido va bien. */
  mood: string
}

export const IDENTITY_PRESETS: IdentityPreset[] = [
  { preset: "swiss", label: "Pulso suizo", mood: "Preciso y limpio: datos, tecnología, productos digitales", bg: "#0F1218", fg: "#F2F4F8", accent: "#2F6BFF", heading_font: "montserrat", body_font: "montserrat" },
  { preset: "velvet", label: "Terciopelo", mood: "Premium y atemporal: lujo, empresa, marca personal", bg: "#0E1220", fg: "#F3EEE2", accent: "#C9A84C", heading_font: "serif", body_font: "sans" },
  { preset: "soft", label: "Señal suave", mood: "Cálido e íntimo: bienestar, historias personales, comunidad", bg: "#F6EFE7", fg: "#2B2420", accent: "#D9714A", heading_font: "serif", body_font: "sans" },
  { preset: "maximal", label: "Tipografía fuerte", mood: "Ruidoso y enérgico: anuncios, lanzamientos, ofertas", bg: "#FFD60A", fg: "#111111", accent: "#E5173F", heading_font: "montserrat", body_font: "montserrat" },
  { preset: "drift", label: "Deriva de datos", mood: "Futurista: inteligencia artificial, ciencia, innovación", bg: "#09100F", fg: "#E6F2EF", accent: "#19C3A6", heading_font: "montserrat", body_font: "sans" },
  { preset: "shadow", label: "Corte oscuro", mood: "Dramático y cinematográfico: revelaciones, misterio, denuncia", bg: "#0C0C0D", fg: "#EEEBE6", accent: "#E03A3E", heading_font: "serif", body_font: "sans" },
]

const HEX = /^#[0-9a-fA-F]{6}$/
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all as readonly string[]).includes(v as string) ? (v as T) : d
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toUpperCase() : d)

export const DEFAULT_IDENTITY: Identity = (({ label: _l, mood: _m, ...rest }) => rest)(IDENTITY_PRESETS[0])

/** Completa lo que falte: si llega solo un `preset` conocido se parte de sus colores; cada campo válido pisa al del preset. */
export function normalizeIdentity(input?: Partial<Identity> | null): Identity {
  const base = IDENTITY_PRESETS.find((p) => p.preset === input?.preset) ?? IDENTITY_PRESETS[0]
  return {
    preset: IDENTITY_PRESETS.some((p) => p.preset === input?.preset) ? (input!.preset as string) : (input && (input.bg || input.fg || input.accent) ? "custom" : base.preset),
    bg: color(input?.bg, base.bg),
    fg: color(input?.fg, base.fg),
    accent: color(input?.accent, base.accent),
    heading_font: pick(input?.heading_font, IDENTITY_FONTS, base.heading_font),
    body_font: pick(input?.body_font, IDENTITY_FONTS, base.body_font),
  }
}

/** Luminancia relativa (WCAG) de un color #RRGGBB. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** ¿El texto se lee sobre el fondo? WCAG AA para texto grande es 3:1; se pide 4.5:1 para el cuerpo. */
export function identityIssues(id: Identity): string[] {
  const out: string[] = []
  if (contrastRatio(id.fg, id.bg) < 4.5) out.push("El color del texto casi no contrasta con el fondo.")
  if (contrastRatio(id.accent, id.bg) < 3) out.push("El color de acento casi no se distingue del fondo.")
  return out
}

export const isDarkIdentity = (id: Identity) => luminance(id.bg) < 0.25

export const FONT_STACK: Record<IdentityFont, string> = {
  montserrat: "'Montserrat','Inter','DejaVu Sans','Liberation Sans',sans-serif",
  sans: "'Inter','DejaVu Sans','Liberation Sans',Arial,sans-serif",
  serif: "'Playfair Display','DejaVu Serif','Liberation Serif',Georgia,serif",
}
