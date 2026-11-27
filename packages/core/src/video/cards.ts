/**
 * Tarjetas de gráficos: escenas SIN personaje dibujadas localmente desde plantillas (título, cifra, lista, cita, comparación,
 * llamada a la acción). Se renderizan con el navegador integrado cuadro por cuadro y se codifican con ffmpeg, igual que hace
 * HyperFrames. Ventajas sobre pedirle el texto a un modelo de imágenes: el texto sale EXACTO (acentos, ñ), la paleta es la de la
 * identidad visual del reel, es determinista y no cuesta nada.
 *
 * Reglas de diseño (de HyperFrames «data in motion» y «house style»): un solo acento, fondo único, profundidad con elementos
 * decorativos que respiran, entradas de 0,3–0,6 s con curvas distintas, cada cifra con peso visual (barra o anillo) y nada de
 * gráficos de torta, leyendas ni cuadrículas.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findChrome, resolveWebViewEngine } from "../tools/web/browser-backend"
import { FONT_STACK, isDarkIdentity, type Identity } from "./identity"
import { VoiceError, ffmpegRun } from "./voice"

export const CARD_KINDS = ["title", "stat", "list", "quote", "compare", "cta"] as const
export type CardKind = (typeof CARD_KINDS)[number]

export interface CardColumn { label: string; text: string }

export interface SceneCard {
  kind: CardKind
  /** Texto principal: el título, lo que significa la cifra, el encabezado de la lista, la cita o la llamada a la acción. */
  title: string
  /** Texto de apoyo: subtítulo, autor de la cita, usuario/enlace de la llamada a la acción. */
  sub: string
  /** Solo «stat»: la cifra tal como se ve («73 %», «3x», «$1,2 M»). */
  value: string
  /** Solo «stat»: qué tanto llena la barra o el anillo (0–100). Si se omite y la cifra es un porcentaje, se usa ese porcentaje. */
  fill: number | null
  /** Solo «list»: hasta 5 elementos. */
  items: string[]
  /** Solo «compare»: dos columnas. */
  columns: CardColumn[]
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "")

/** Normaliza una tarjeta; null si no es una tarjeta válida (sin tipo o sin el texto mínimo que ese tipo necesita). */
export function normalizeCard(i?: Partial<SceneCard> | null): SceneCard | null {
  if (!i || !(CARD_KINDS as readonly string[]).includes(i.kind as string)) return null
  const kind = i.kind as CardKind
  const fillN = i.fill === null || i.fill === undefined || i.fill === ("" as unknown) ? NaN : Number(i.fill)
  const card: SceneCard = {
    kind,
    title: clean(i.title, 90),
    sub: clean(i.sub, 120),
    value: clean(i.value, 12),
    fill: Number.isFinite(fillN) ? Math.min(100, Math.max(0, Math.round(fillN))) : null,
    items: (Array.isArray(i.items) ? i.items : []).map((x) => clean(x, 70)).filter(Boolean).slice(0, 5),
    columns: (Array.isArray(i.columns) ? i.columns : []).slice(0, 2).map((c) => ({ label: clean(c?.label, 24), text: clean(c?.text, 90) })).filter((c) => c.label || c.text),
  }
  const ok =
    kind === "stat" ? !!card.value
      : kind === "list" ? card.items.length > 0
        : kind === "compare" ? card.columns.length === 2
          : !!card.title
  return ok ? card : null
}

/** Texto de la tarjeta, para subtítulos de respaldo y descripciones. */
export function cardText(c: SceneCard): string {
  return [c.title, c.value, c.sub, ...c.items, ...c.columns.flatMap((x) => [x.label, x.text])].filter(Boolean).join(" · ")
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Tamaño de letra según el largo, para que ningún título desborde ni quede diminuto. */
const fit = (text: string, sizes: Array<[number, number]>, fallback: number) => (sizes.find(([max]) => text.length <= max)?.[1] ?? fallback)

export interface CardCanvas { width: number; height: number }

export function canvasFor(aspect: string, short = 720): CardCanvas {
  return aspect === "16:9" ? { width: Math.round(short * 16 / 9), height: short } : { width: short, height: Math.round(short * 16 / 9) }
}

/** HTML de una tarjeta. La animación la maneja `window.__seek(t)`: no usa CSS animations, así que cada cuadro es reproducible. */
export function buildCardHtml(card: SceneCard, id: Identity, canvas: CardCanvas, seconds: number): string {
  const W = canvas.width, H = canvas.height
  const vertical = H > W
  const u = Math.min(W, H) / 720 // unidad base: todo escala con el lienzo
  const dark = isDarkIdentity(id)
  const head = FONT_STACK[id.heading_font], body = FONT_STACK[id.body_font]
  const px = (n: number) => `${Math.round(n * u)}px`
  const pad = vertical ? 64 : 96
  // Espacio abajo para los subtítulos, que van en la parte baja del reel.
  const bottomPad = vertical ? 210 : 130

  let inner = ""
  switch (card.kind) {
    case "title": {
      const size = fit(card.title, [[22, 118], [44, 96], [70, 78]], 64) * (vertical ? 1 : 0.9)
      inner = `
        <div class="bar" data-in="0.15" data-dur="0.7" data-anim="grow"></div>
        <h1 style="font-size:${px(size)}" data-in="0.3" data-dur="0.7">${esc(card.title)}</h1>
        ${card.sub ? `<p class="sub" style="font-size:${px(38)}" data-in="0.75" data-dur="0.6">${esc(card.sub)}</p>` : ""}`
      break
    }
    case "stat": {
      const m = card.value.match(/^([^\d-]*)(-?[\d.,]+)(.*)$/)
      const numeric = m ? Number(m[2].replace(/\./g, "").replace(",", ".")) : NaN
      const decimals = m && /[.,]\d+$/.test(m[2]) ? (m[2].split(/[.,]/).pop() ?? "").length : 0
      const fill = card.fill ?? (/%/.test(card.value) && Number.isFinite(numeric) ? Math.min(100, numeric) : null)
      // Una cifra nunca se parte en dos líneas: el tamaño sale del largo y del ancho útil.
      const usable = W / u - pad * 2
      const size = Math.min(fit(card.value, [[3, 250], [5, 190], [7, 150]], 112), usable / (card.value.length * 0.62)) * (vertical ? 1 : 0.8)
      const count = m && Number.isFinite(numeric) ? ` data-count="${numeric}" data-prefix="${esc(m[1])}" data-suffix="${esc(m[3])}" data-decimals="${decimals}"` : ""
      inner = `
        <div class="value" style="font-size:${px(size)}" data-in="0.2" data-dur="1.1" data-anim="pop"${count}>${esc(card.value)}</div>
        ${fill !== null ? `<div class="track" data-in="0.2" data-dur="0.4"><div class="fill" data-in="0.5" data-dur="1.1" data-anim="grow" data-to="${fill / 100}"></div></div>` : `<div class="bar" data-in="0.5" data-dur="0.6" data-anim="grow"></div>`}
        ${card.title ? `<p class="label" style="font-size:${px(46)}" data-in="0.9" data-dur="0.6">${esc(card.title)}</p>` : ""}
        ${card.sub ? `<p class="sub" style="font-size:${px(32)}" data-in="1.2" data-dur="0.6">${esc(card.sub)}</p>` : ""}`
      break
    }
    case "list": {
      const n = card.items.length
      const size = n <= 3 ? 50 : n === 4 ? 44 : 38
      inner = `
        ${card.title ? `<h2 style="font-size:${px(58)}" data-in="0.15" data-dur="0.6">${esc(card.title)}</h2><div class="bar short" data-in="0.3" data-dur="0.6" data-anim="grow"></div>` : ""}
        <ol>${card.items.map((it, k) => `
          <li data-in="${(0.55 + k * 0.38).toFixed(2)}" data-dur="0.55" data-anim="${k % 2 ? "left" : "right"}">
            <span class="num">${k + 1}</span><span class="txt" style="font-size:${px(size)}">${esc(it)}</span>
          </li>`).join("")}</ol>`
      break
    }
    case "quote": {
      const size = fit(card.title, [[50, 66], [100, 56]], 46)
      inner = `
        <div class="qmark" data-in="0.1" data-dur="0.7" data-anim="pop">“</div>
        <blockquote style="font-size:${px(size)}" data-in="0.4" data-dur="0.8">${esc(card.title)}</blockquote>
        ${card.sub ? `<p class="author" style="font-size:${px(34)}" data-in="1.2" data-dur="0.6">— ${esc(card.sub)}</p>` : ""}`
      break
    }
    case "compare": {
      const [a, b] = card.columns
      const col = (c: CardColumn, side: "left" | "right", t: number, hot: boolean) => `
        <div class="col ${hot ? "hot" : ""}" data-in="${t}" data-dur="0.7" data-anim="${side === "left" ? "right" : "left"}">
          <div class="clabel" style="font-size:${px(36)}">${esc(c.label)}</div>
          <div class="ctext" style="font-size:${px(vertical ? 40 : 34)}">${esc(c.text)}</div>
        </div>`
      inner = `
        ${card.title ? `<h2 style="font-size:${px(54)}" data-in="0.1" data-dur="0.6">${esc(card.title)}</h2>` : ""}
        <div class="vs ${vertical ? "col-dir" : ""}">
          ${col(a, "left", 0.45, false)}
          <div class="vsbadge" data-in="0.9" data-dur="0.5" data-anim="pop">VS</div>
          ${col(b, "right", 0.7, true)}
        </div>`
      break
    }
    case "cta": {
      const size = fit(card.title, [[22, 104], [44, 84]], 66) * (vertical ? 1 : 0.9)
      inner = `
        <h1 style="font-size:${px(size)}" data-in="0.2" data-dur="0.7">${esc(card.title)}</h1>
        ${card.sub ? `<div class="pill" style="font-size:${px(42)}" data-in="0.8" data-dur="0.6" data-anim="pop" data-pulse="1">${esc(card.sub)}</div>` : ""}`
      break
    }
  }

  const glowA = dark ? 0.22 : 0.16
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${id.bg}}
  body{font-family:${body};color:${id.fg};-webkit-font-smoothing:antialiased}
  #stage{position:relative;width:${W}px;height:${H}px;overflow:hidden}
  .glow{position:absolute;left:50%;top:46%;width:${px(900)};height:${px(900)};margin:${px(-450)} 0 0 ${px(-450)};border-radius:50%;
    background:radial-gradient(circle,${id.accent} 0%,transparent 62%);opacity:${glowA}}
  .ghost{position:absolute;left:${px(-30)};bottom:${px(vertical ? 150 : 40)};font-family:${head};font-weight:900;font-size:${px(vertical ? 330 : 260)};line-height:.8;
    color:${id.fg};opacity:.04;white-space:nowrap;letter-spacing:-.04em}
  .hair{position:absolute;left:${px(pad)};right:${px(pad)};top:${px(pad - 20)};height:2px;background:${id.fg};opacity:.12}
  #content{position:absolute;inset:0;padding:${px(pad)} ${px(pad)} ${px(bottomPad)};display:flex;flex-direction:column;justify-content:center;gap:${px(34)}}
  h1,h2{font-family:${head};font-weight:${id.heading_font === "serif" ? 700 : 800};line-height:1.06;letter-spacing:-.02em;overflow-wrap:anywhere}
  h2{font-weight:${id.heading_font === "serif" ? 700 : 800}}
  .sub,.label,.author{color:${id.fg};opacity:.78;line-height:1.3}
  .label{opacity:.95;font-weight:600;line-height:1.2}
  .bar{width:${px(120)};height:${px(10)};background:${id.accent};border-radius:${px(6)};transform-origin:left}
  .bar.short{width:${px(90)}}
  .value{font-family:${head};font-weight:900;line-height:.95;letter-spacing:-.04em;color:${id.accent};white-space:nowrap}
  .track{width:100%;height:${px(22)};border-radius:${px(12)};background:${id.fg};background:color-mix(in srgb,${id.fg} 14%,transparent)}
  .fill{height:100%;width:100%;border-radius:${px(12)};background:${id.accent};transform-origin:left}
  ol{list-style:none;display:flex;flex-direction:column;gap:${px(26)}}
  li{display:flex;align-items:center;gap:${px(26)}}
  .num{flex:none;width:${px(76)};height:${px(76)};border-radius:50%;background:${id.accent};color:${dark ? id.bg : "#FFFFFF"};display:flex;align-items:center;justify-content:center;
    font-family:${head};font-weight:900;font-size:${px(40)}}
  .txt{font-weight:600;line-height:1.2}
  .qmark{font-family:${FONT_STACK.serif};font-size:${px(260)};line-height:.7;color:${id.accent};height:${px(150)}}
  blockquote{font-family:${head};font-weight:${id.heading_font === "serif" ? 600 : 700};line-height:1.22;font-style:${id.heading_font === "serif" ? "italic" : "normal"}}
  .vs{display:flex;align-items:stretch;gap:${px(24)}}
  .vs.col-dir{flex-direction:column;align-items:stretch}
  .col{flex:1;border-radius:${px(26)};padding:${px(34)};background:color-mix(in srgb,${id.fg} 8%,transparent);border:2px solid color-mix(in srgb,${id.fg} 14%,transparent)}
  .col.hot{background:${id.accent};border-color:${id.accent};color:${dark ? id.bg : "#FFFFFF"}}
  .clabel{font-family:${head};font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:${px(14)};opacity:.9}
  .ctext{font-weight:600;line-height:1.25}
  .vsbadge{align-self:center;flex:none;width:${px(92)};height:${px(92)};border-radius:50%;background:${id.fg};color:${id.bg};display:flex;align-items:center;justify-content:center;
    font-family:${head};font-weight:900;font-size:${px(34)};z-index:2}
  .vs.col-dir .vsbadge{margin:${px(-34)} 0}
  .pill{align-self:flex-start;background:${id.accent};color:${dark ? id.bg : "#FFFFFF"};font-family:${head};font-weight:800;padding:${px(20)} ${px(44)};border-radius:${px(70)}}
  </style></head><body><div id="stage">
    <div class="glow" id="glow"></div>
    <div class="ghost" id="ghost">${esc(((card.title || card.value || "").split(/\s+/).find((w) => w.replace(/\W/g, "").length >= 3) ?? "").slice(0, 9).toUpperCase())}</div>
    <div class="hair"></div>
    <div id="content">${inner}</div>
  </div><script>
  const T=${seconds.toFixed(3)};
  const clamp=(x)=>Math.min(1,Math.max(0,x));
  const out=(p)=>1-Math.pow(1-p,3);
  const back=(p)=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(p-1,3)+c1*Math.pow(p-1,2)};
  const items=[...document.querySelectorAll('[data-in]')].map(e=>({e,t0:+e.dataset.in,d:+e.dataset.dur||.6,k:e.dataset.anim||'rise',to:e.dataset.to?+e.dataset.to:1,
    count:e.dataset.count!==undefined?{n:+e.dataset.count,pre:e.dataset.prefix||'',suf:e.dataset.suffix||'',dec:+e.dataset.decimals||0}:null,pulse:!!e.dataset.pulse}));
  const content=document.getElementById('content'),glow=document.getElementById('glow'),ghost=document.getElementById('ghost');
  const fmt=(n,dec)=>n.toLocaleString('es-CO',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  window.__seek=(t)=>{
    for(const it of items){
      const p=clamp((t-it.t0)/it.d),q=out(p),e=it.e;
      if(it.k==='grow'){e.style.opacity=p>0?1:0;e.style.transform='scaleX('+(q*it.to)+')';}
      else if(it.k==='pop'){const b=back(p);const pulse=it.pulse&&p>=1?1+0.035*Math.sin((t-it.t0-it.d)*5):1;e.style.opacity=clamp(p*2);e.style.transform='scale('+((0.6+0.4*b)*pulse)+')';e.style.transformOrigin='left center';}
      else if(it.k==='left'){e.style.opacity=q;e.style.transform='translateX('+((1-q)*-90)+'px)';}
      else if(it.k==='right'){e.style.opacity=q;e.style.transform='translateX('+((1-q)*90)+'px)';}
      else{e.style.opacity=q;e.style.transform='translateY('+((1-q)*46)+'px)';}
      if(it.count){e.textContent=it.count.pre+fmt(it.count.n*q,it.count.dec)+it.count.suf;}
    }
    const ex=clamp((T-t)/0.35);
    content.style.opacity=ex;content.style.transform='scale('+(1+(1-ex)*0.025)+')';
    glow.style.transform='scale('+(1+0.05*Math.sin(t*1.3))+')';
    ghost.style.transform='translateX('+(-t*10)+'px)';
    return true;
  };
  window.__seek(0);
  </script></body></html>`
}

export interface RenderCardOptions {
  aspect: string
  seconds: number
  /** 360p/720p dibujan a 720 px de lado corto; 1080p/4k a 1080. */
  resolution?: string
  fps?: number
  /** Para pruebas: en lugar del navegador integrado, recibe el HTML y devuelve los PNG de cada cuadro. */
  capture?: (html: string, canvas: CardCanvas, times: number[]) => Promise<Uint8Array[]>
}

const ENCODERS: string[][] = [
  ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"],
  ["-c:v", "libopenh264", "-b:v", "8M", "-pix_fmt", "yuv420p"],
  ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p"],
]

interface MinimalView { navigate(u: string): Promise<void>; evaluate(s: string): Promise<unknown>; screenshot(): Promise<Blob>; resize(w: number, h: number): Promise<void>; close(): void }

/** Captura con el navegador integrado de Hive (Bun.WebView). */
async function captureWithWebView(html: string, canvas: CardCanvas, times: number[]): Promise<Uint8Array[]> {
  const WebView = (globalThis as { Bun?: { WebView?: unknown } }).Bun?.WebView
  const engine = resolveWebViewEngine()
  if (typeof WebView !== "function" || !engine) {
    throw new VoiceError("No hay navegador integrado para dibujar las tarjetas: instala Chrome o define BUN_CHROME_PATH.")
  }
  const chromePath = engine === "chrome" ? findChrome() : null
  const backend = engine === "chrome" ? { type: "chrome" as const, url: false as const, stderr: "ignore" as const, ...(chromePath ? { path: chromePath } : {}) } : ("webkit" as const)
  const view = new (WebView as unknown as new (o: unknown) => MinimalView)({ backend, show: false, width: canvas.width, height: canvas.height })
  try {
    // URL `data:` en vez de un archivo temporal: no depende de que el navegador vea el /tmp del gateway
    // (Chrome empaquetado, con otro espacio de nombres o permisos → net::ERR_FILE_NOT_FOUND).
    await view.navigate(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`)
    // Algunos Chrome ignoran el tamaño del constructor: se fija con resize() tras la primera operación.
    await view.resize(canvas.width, canvas.height)
    await view.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true")
    await new Promise((r) => setTimeout(r, 120))
    const frames: Uint8Array[] = []
    for (const t of times) {
      await view.evaluate(`window.__seek(${t.toFixed(4)})`)
      frames.push(new Uint8Array(await (await view.screenshot()).arrayBuffer()))
    }
    return frames
  } finally {
    try { view.close() } catch { /* ya cerrado */ }
  }
}

/** Dibuja la tarjeta como un clip MP4 (sin audio) de `seconds` segundos. */
export async function renderCard(card: SceneCard, id: Identity, o: RenderCardOptions): Promise<Uint8Array> {
  // 24 fps: es la tasa de los clips de Gemini, así encajan en las transiciones y en la unión sin recodificar.
  const fps = o.fps ?? 24
  const seconds = Math.max(1, o.seconds)
  const big = o.resolution === "1080p" || o.resolution === "4k"
  const canvas = canvasFor(o.aspect, big ? 1080 : 720)
  // Tamaño final = el de los clips de Gemini de esa resolución (lado corto 360 / 720 / 1080 / 2160).
  const shortSide = ({ "360p": 360, "720p": 720, "1080p": 1080, "4k": 2160 } as Record<string, number>)[o.resolution ?? "720p"] ?? 720
  const target = canvasFor(o.aspect, shortSide)
  const html = buildCardHtml(card, id, canvas, seconds)
  const frameCount = Math.round(seconds * fps)
  const times = Array.from({ length: frameCount }, (_, i) => i / fps)
  const frames = await (o.capture ?? captureWithWebView)(html, canvas, times)
  if (frames.length === 0) throw new VoiceError("No se pudo dibujar la tarjeta: el navegador no devolvió cuadros.")
  const dir = mkdtempSync(join(tmpdir(), "hive-cardenc-"))
  try {
    mkdirSync(join(dir, "f"))
    frames.forEach((f, i) => writeFileSync(join(dir, "f", `${String(i).padStart(5, "0")}.png`), f))
    let last = ""
    for (const enc of ENCODERS) {
      const r = await ffmpegRun(["-y", "-framerate", String(fps), "-i", "f/%05d.png", ...(target.width !== canvas.width ? ["-vf", `scale=${target.width}:${target.height}:flags=lanczos`] : []), ...enc, "-r", String(fps), "-movflags", "+faststart", "out.mp4"], dir)
      if (r.code === 0) return new Uint8Array(readFileSync(join(dir, "out.mp4")))
      last = r.err
    }
    throw new VoiceError(`No se pudo codificar la tarjeta: ${last.slice(-200)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
