import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, Clapperboard, Download, Film, FolderOpen, KeyRound, Loader2, Mic, Plus, Shirt, Sparkles, Trash2,
  Upload, UserRound, Wand2, Mountain, RefreshCw, Settings2, Play,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { AuthImage } from "@/components/AuthImage";
import { swal } from "@/lib/swal";
import { AuthVideo } from "./AuthVideo";
import {
  CARD_KINDS, DEFAULT_REEL_STYLE, DEFAULT_VOICE_SETTINGS, IDENTITY_PRESETS, VOICE_FX, artifactUrl, videoApi, type Avatar, type AspectRatio, type GraphicKind, type Identity, type Project, type SceneCard, type SceneSource, type ReelStyle, type Resolution, type Scene, type SceneGraphic, type StudioStatus, type SubtitlePreset, type TransitionType, type Voice, type VoiceSettings,
} from "./videoApi";

const usd = (n: number) => `${n.toFixed(n < 1 ? 3 : 2)} USD`;
/** Referencia para que el diálogo quepa en el clip (ver MAX_DIALOGUE_CHARS_PER_SECOND en el backend). */
const DIALOGUE_CHARS_PER_SECOND = 14;

const SCENE_TAG: Record<Scene["status"], { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "hive-tag hive-tag--disabled" },
  generating: { label: "Generando", cls: "hive-tag hive-tag--tone" },
  done: { label: "Listo", cls: "hive-tag hive-tag--provider" },
  failed: { label: "Falló", cls: "hive-tag border-red-500/30 bg-red-500/10 text-red-300" },
};

interface DraftCharacter {
  key: string; id?: string; name: string; description: string; voiceId: string | null; voiceName: string | null
  voiceSettings: VoiceSettings
  /** Tarjeta de bienvenida que aún nadie tocó: no se guarda hasta que el usuario la use. */
  pristine?: boolean
}
interface DraftScene { key: string; id?: string; seconds: number; prompt: string; characterKeys: string[]; wardrobe: string; setting: string; dialogue: string; graphic: SceneGraphic; fx: string | null; source: SceneSource; card: SceneCard | null }
const EMPTY_CARD: SceneCard = { kind: "title", title: "", sub: "", value: "", fill: null, items: [], columns: [{ label: "", text: "" }, { label: "", text: "" }] };
interface DraftNarrator { voiceId: string | null; voiceName: string | null; settings: VoiceSettings }
const narratorDraft = (p: Project): DraftNarrator => ({ voiceId: p.narrator?.voice_id ?? null, voiceName: p.narrator?.voice_name ?? null, settings: { ...(p.narrator?.voice_settings ?? DEFAULT_VOICE_SETTINGS), mode: "narration" } });
const fxLabel = (id: string) => VOICE_FX.find((f) => f.id === id)?.label ?? id;
const NO_GRAPHIC: SceneGraphic = { kind: "none", text: "", sub: "" };

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const starterCharacter = (): DraftCharacter => ({ key: newKey(), name: "Protagonista", description: "", voiceId: null, voiceName: null, voiceSettings: DEFAULT_VOICE_SETTINGS, pristine: true });

function toDraft(p: Project): { characters: DraftCharacter[]; scenes: DraftScene[] } {
  const saved = p.characters.length > 0;
  return {
    // Sin personajes guardados se muestra una tarjeta lista para subir el rostro y elegir la voz: así no hay que descubrir "+ Personaje".
    characters: !saved ? [starterCharacter()] : p.characters.map((c) => ({ key: c.id, id: c.id, name: c.name, description: c.description, voiceId: c.voice_id, voiceName: c.voice_name, voiceSettings: c.voice_settings ?? DEFAULT_VOICE_SETTINGS })),
    scenes: p.scenes.map((s) => ({
      key: s.id, id: s.id, seconds: s.seconds, prompt: s.prompt, characterKeys: s.character_ids,
      wardrobe: s.wardrobe ?? "", setting: s.setting ?? "", dialogue: s.dialogue ?? "", graphic: s.graphic ?? NO_GRAPHIC, fx: s.fx ?? null,
      source: s.source ?? "clip", card: s.card ?? null,
    })),
  };
}

// ─── Piezas de diseño (mismo lenguaje que Canales, Providers y Reuniones) ─────

function SectionCard({ step, title, hint, action, children }: { step: number; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="hive-card">
      <div className="hive-card-body space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="hive-title-section flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-500/15 text-[10px] text-blue-300">{step}</span>
              {title}
            </h3>
            {hint && <p className="mt-1.5 text-xs leading-relaxed text-white/40">{hint}</p>}
          </div>
          {action}
        </div>
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="hive-label--field">{label}</span>
      {children}
    </label>
  );
}

const ghostBtn = "hive-btn hive-btn--ghost px-3 py-1.5 text-xs disabled:pointer-events-none disabled:opacity-40";
const primaryBtn = "hive-btn hive-btn--primary disabled:pointer-events-none disabled:opacity-40";
const inputCls = "hive-input";
/** Las opciones de un <select> las pinta el navegador: sin fondo y color propios salen blanco sobre blanco. */
const OPTION_CLS = "bg-zinc-900 text-white";

// ─── Escribir con IA ─────────────────────────────────────────────────────────

/**
 * «Mejorar con IA»: pide una versión mejor del título y la idea y la muestra al lado.
 * Nunca reemplaza lo escrito: el usuario elige qué usar.
 */
function AiImprove({ title, brief, aspect, seconds, characters, onApply }: {
  title: string; brief: string; aspect: AspectRatio; seconds: number; characters?: string[];
  onApply: (next: { title?: string; brief?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ title: string; brief: string } | null>(null);
  const empty = !title.trim() && !brief.trim();

  const ask = async () => {
    setBusy(true);
    try {
      const r = await videoApi.improve({ title, brief, aspect_ratio: aspect, target_seconds: seconds, characters });
      setProposal({ title: r.title, brief: r.brief });
    } catch { /* apiClient ya mostró el error */ } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={ghostBtn} onClick={ask} disabled={busy || empty}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-blue-300" />}
          {proposal ? "Otra versión" : "Mejorar con IA"}
        </button>
        <span className="text-[11px] text-white/30">{empty ? "Escribe unas palabras del título o la idea y la IA las desarrolla." : "Usa tu modelo de texto; no gasta saldo de Gemini para video."}</span>
      </div>
      {proposal && (
        <div className="hive-info-card space-y-3 !border-blue-500/25">
          <div className="hive-label flex items-center gap-1.5 !text-blue-300"><Sparkles className="h-3 w-3" />Propuesta de la IA</div>
          <div className="space-y-1"><span className="hive-label--field">Título</span><p className="text-sm font-semibold text-white">{proposal.title}</p></div>
          <div className="space-y-1"><span className="hive-label--field">Idea</span><p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{proposal.brief}</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${primaryBtn} !px-4 !py-1.5 !text-xs`} onClick={() => { onApply({ title: proposal.title, brief: proposal.brief }); setProposal(null); }}>Usar título e idea</button>
            <button type="button" className={ghostBtn} onClick={() => { onApply({ brief: proposal.brief }); setProposal(null); }}>Solo la idea</button>
            <button type="button" className={ghostBtn} onClick={() => { onApply({ title: proposal.title }); setProposal(null); }}>Solo el título</button>
            <button type="button" className={ghostBtn} onClick={ask} disabled={busy}><RefreshCw className="h-3 w-3" />Otra</button>
            <button type="button" className={ghostBtn} onClick={() => setProposal(null)}>Descartar</button>
          </div>
        </div>
      )}
    </div>
  );
}

type ScriptProposal = { script: string; scenes: Array<{ seconds: number; prompt: string; wardrobe: string; setting: string; dialogue: string; character_ids: string[]; graphic?: SceneGraphic; source?: SceneSource; card?: SceneCard | null }> };

/**
 * «Escribir guion y escenas con IA»: a partir del título y la idea propone el guion y las escenas con
 * vestuario, escenografía y diálogo. Muestra la propuesta al lado; el usuario decide si la usa.
 */
function AiScript({ title, brief, aspect, seconds, people, hasContent, disabled, ensureSaved, onApply, mode }: {
  title: string; brief: string; aspect: AspectRatio; seconds: number;
  /** «voiceover»: reel sin personaje (imágenes + voz en off). */
  mode: "avatar" | "voiceover";
  people: Array<{ id: string; name: string; description: string; voice_expressive: boolean }>;
  hasContent: boolean; disabled: boolean;
  /** Guarda lo pendiente (para que los personajes nuevos tengan id) y devuelve los personajes con id. */
  ensureSaved: () => Promise<Array<{ id: string; name: string; description: string; voice_expressive: boolean }>>;
  onApply: (p: ScriptProposal, what: "all" | "script") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<(ScriptProposal & { names: Map<string, string> }) | null>(null);
  const empty = !title.trim() && !brief.trim();

  const ask = async () => {
    setBusy(true);
    try {
      const chars = await ensureSaved();
      const r = await videoApi.script({ title, brief, aspect_ratio: aspect, target_seconds: seconds, characters: chars, mode });
      setProposal({ script: r.script, scenes: r.scenes, names: new Map(chars.map((c) => [c.id, c.name])) });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg && !msg.startsWith("API Error")) void swal.fire({ title: "No se pudo escribir el guion", text: msg, icon: "error" });
    } finally { setBusy(false); }
  };

  const total = proposal?.scenes.reduce((n, s) => n + s.seconds, 0) ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={ghostBtn} onClick={ask} disabled={disabled || busy || empty}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-blue-300" />}
          {proposal || hasContent ? "Escribir otra versión del guion y las escenas" : "Escribir guion y escenas con IA"}
        </button>
        <span className="text-[11px] text-white/30">
          {empty ? "Escribe el título o la idea primero." : `Parte del título y la idea; propone ${seconds} s en escenas con vestuario, escenografía y diálogo. No gasta saldo de Gemini para video.`}
        </span>
      </div>
      {busy && <p className="text-xs text-white/40">Escribiendo el guion… puede tardar unos segundos.</p>}
      {proposal && (
        <div className="hive-info-card space-y-3 !border-blue-500/25">
          <div className="hive-label flex items-center gap-1.5 !text-blue-300"><Sparkles className="h-3 w-3" />Propuesta de guion y escenas</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{proposal.script}</p>
          <div className="space-y-2">
            {proposal.scenes.map((s, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs leading-relaxed text-white/60">
                <div className="mb-1 flex items-center gap-2 text-white/80"><span className="hive-label">Escena {i + 1}</span><span className="font-mono text-blue-300">{s.seconds} s</span>
                  {s.character_ids.length > 0 && <span className="text-white/40">· {s.character_ids.map((id) => proposal.names.get(id) ?? "").filter(Boolean).join(", ")}</span>}</div>
                <p>{s.prompt}</p>
                {s.wardrobe && <p><span className="text-white/35">Vestuario:</span> {s.wardrobe}</p>}
                {s.setting && <p><span className="text-white/35">Escenografía:</span> {s.setting}</p>}
                {s.dialogue && <p><span className="text-white/35">Diálogo:</span> “{s.dialogue}”</p>}
              </div>
            ))}
            <p className={`text-[11px] ${total === seconds ? "text-emerald-300" : "text-amber-300"}`}>Suman {total} s de {seconds} s.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${primaryBtn} !px-4 !py-1.5 !text-xs`} onClick={() => { onApply(proposal, "all"); setProposal(null); }}>Usar guion y escenas</button>
            <button type="button" className={ghostBtn} onClick={() => { onApply(proposal, "script"); setProposal(null); }}>Solo el guion</button>
            <button type="button" className={ghostBtn} onClick={ask} disabled={busy}><RefreshCw className="h-3 w-3" />Otra versión</button>
            <button type="button" className={ghostBtn} onClick={() => setProposal(null)}>Descartar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Disponibilidad ──────────────────────────────────────────────────────────

function NotEnabled() {
  return (
    <div className="hive-card mx-auto mt-16 max-w-lg">
      <div className="hive-card-body space-y-4 p-8 text-center">
        <div className="hive-icon-wrap hive-icon-wrap--primary mx-auto"><KeyRound className="h-5 w-5" /></div>
        <h2 className="text-lg font-bold text-white">El estudio necesita una API key de Gemini</h2>
        <p className="text-sm leading-relaxed text-white/50">
          El Director de video y este estudio se activan solos cuando conectas Gemini en Providers. Las imágenes (Nano Banana) y los clips
          (Gemini Omni) se cobran por uso: la API requiere saldo prepagado en Google AI Studio; tu suscripción de Google AI Pro no lo cubre.
        </p>
        <Link to="/providers" className={`${primaryBtn} mx-auto w-fit`}>Conectar Gemini en Providers</Link>
      </div>
    </div>
  );
}

// ─── Nuevo proyecto ──────────────────────────────────────────────────────────

function NewProjectForm({ status, avatars, onCreated, onAvatarsChange }: { status: StudioStatus; avatars: Avatar[]; onCreated: (p: Project) => void; onAvatarsChange: () => void }) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [seconds, setSeconds] = useState(15);
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [busy, setBusy] = useState(false);
  // Protagonista (opcional): rostro de referencia y voz, desde el primer paso.
  const [heroName, setHeroName] = useState("Protagonista");
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(status.voice_defaults ?? DEFAULT_VOICE_SETTINGS);
  // Avatar guardado elegido: trae su rostro, su nombre y su voz, así que no hay que subir nada.
  const [avatarId, setAvatarId] = useState<string | null>(null);
  // «avatar»: con protagonista que habla a cámara · «voiceover»: sin personaje, un narrador cuenta la historia sobre las imágenes.
  const [kind, setKind] = useState<"avatar" | "voiceover">("avatar");
  const avatar = avatars.find((a) => a.id === avatarId) ?? null;
  const estimate = status.price_per_second_usd[resolution] * seconds;
  const wantsHero = kind === "avatar" && (!!faceFile || !!voiceId || !!avatar);

  const pickAvatar = (a: Avatar) => {
    setAvatarId(a.id); setFaceFile(null); setConsent(true);
    setHeroName(a.name); setVoiceId(a.voice_id); setVoiceName(a.voice_name);
    setVoiceSettings(a.voice_settings ?? DEFAULT_VOICE_SETTINGS);
  };
  const removeAvatar = async (a: Avatar) => {
    const ok = await swal.fire({ title: `¿Quitar a ${a.name} de Mis avatares?`, text: "La foto se queda en tu carpeta; solo sale de la biblioteca.", icon: "question", showCancelButton: true, confirmButtonText: "Quitar", cancelButtonText: "Cancelar" });
    if (!ok.isConfirmed) return;
    await videoApi.removeAvatar(a.id).catch(() => {});
    if (avatarId === a.id) setAvatarId(null);
    onAvatarsChange();
  };

  useEffect(() => {
    if (!faceFile) { setFacePreview(null); return; }
    const url = URL.createObjectURL(faceFile);
    setFacePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [faceFile]);

  const create = async () => {
    if (!title.trim()) return;
    if (kind === "avatar" && !avatar && faceFile && !consent) {
      void swal.fire({ title: "Falta una confirmación", text: "Marca que el rostro es tuyo o que tienes permiso de la persona para usarlo.", icon: "info" });
      return;
    }
    setBusy(true);
    try {
      if (kind === "voiceover") {
        onCreated(await videoApi.create({
          title: title.trim(), brief, aspect_ratio: aspect, resolution, target_seconds: seconds,
          narrator: voiceId ? { voice_id: voiceId, voice_name: voiceName, voice_settings: { ...voiceSettings, mode: "narration" } } : undefined,
        }));
        return;
      }
      let project = await videoApi.create({ title: title.trim(), brief, aspect_ratio: aspect, resolution, target_seconds: seconds, avatar_id: avatar?.id });
      if (avatar && project.characters[0]) {
        // El avatar ya trae rostro y voz; solo se aplican los cambios de nombre y de voz hechos en este formulario.
        project = await videoApi.update(project.id, {
          characters: [{ id: project.characters[0].id, name: heroName.trim() || avatar.name, description: project.characters[0].description, voice_id: voiceId, voice_name: voiceName, voice_settings: voiceSettings }],
        });
      } else if (wantsHero) {
        project = await videoApi.update(project.id, {
          characters: [{ name: heroName.trim() || "Protagonista", description: "", voice_id: voiceId, voice_name: voiceName, voice_settings: voiceSettings }],
        });
        if (faceFile && project.characters[0]) {
          try { project = await videoApi.uploadFace(project.id, project.characters[0].id, faceFile); }
          catch (e) { void swal.fire({ title: "El proyecto se creó, pero no se pudo subir el rostro", text: (e as Error).message, icon: "warning" }); }
        }
      }
      onAvatarsChange();
      onCreated(project);
    } finally { setBusy(false); }
  };

  const choice = (active: boolean) => `${ghostBtn} ${active ? "!border-blue-500/40 !bg-blue-500/15 !text-blue-200" : ""}`;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="hive-card">
        <div className="hive-card-body space-y-5">
          <div>
            <h2 className="text-xl font-black tracking-tight text-white">Nuevo reel</h2>
            <p className="hive-subtitle !mt-1">Define la idea y la duración. Después armas el guion, los personajes y las escenas, o se lo pides al Director de video en el chat.</p>
          </div>
          <Field label="Título"><Input className={inputCls} placeholder="Título del reel" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
          <Field label="Idea"><Textarea className={`${inputCls} !h-auto`} placeholder="Idea, público, tono y mensaje del video…" value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} /></Field>
          <AiImprove title={title} brief={brief} aspect={aspect} seconds={seconds} characters={wantsHero ? [heroName.trim() || "Protagonista"] : undefined}
            onApply={(n) => { if (n.title !== undefined) setTitle(n.title); if (n.brief !== undefined) setBrief(n.brief); }} />
          <div>
            <div className="mb-1.5 flex justify-between"><span className="hive-label--field">Duración</span><span className="font-mono text-sm text-blue-300">{seconds} s</span></div>
            <input type="range" className="w-full accent-blue-500" min={status.limits.min_clip_seconds} max={status.limits.max_project_seconds}
              value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
            <div className="mt-1 flex justify-between text-[11px] text-white/30"><span>{status.limits.min_clip_seconds} s</span><span>{status.limits.max_project_seconds} s</span></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="hive-label--field">Formato</span>
              <div className="flex flex-wrap gap-2">
                {status.aspect_ratios.map((a) => (
                  <button key={a} type="button" className={choice(aspect === a)} onClick={() => setAspect(a)}>{a === "9:16" ? "9:16 · Reel" : "16:9 · Horizontal"}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="hive-label--field">Resolución</span>
              <div className="flex flex-wrap gap-2">
                {status.resolutions.map((r) => <button key={r} type="button" className={choice(resolution === r)} onClick={() => setResolution(r)}>{r}</button>)}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="hive-label--field">Tipo de reel</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={choice(kind === "avatar")} onClick={() => setKind("avatar")}><UserRound className="h-3 w-3" />Con protagonista</button>
              <button type="button" className={choice(kind === "voiceover")} onClick={() => setKind("voiceover")}><Film className="h-3 w-3" />Sin personaje · voz en off</button>
            </div>
            <p className="text-[11px] text-white/35">{kind === "avatar" ? "Alguien (tú o un avatar) habla a cámara." : "Imágenes, producto, paisajes o animación con un narrador. No hace falta rostro."}</p>
          </div>
          {kind === "avatar" ? (
          <div className="hive-info-card space-y-3">
            <div>
              <span className="hive-label--field flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />Protagonista <span className="font-normal normal-case text-white/30">(opcional)</span></span>
              <p className="mt-1 text-xs leading-relaxed text-white/40">Sube una foto de tu rostro como referencia: la identidad no cambia nunca. El Director de video decide el vestuario y la escenografía de cada escena.</p>
            </div>
            {avatars.length > 0 && (
              <div className="space-y-2">
                <span className="hive-label--field">Mis avatares</span>
                <div className="flex flex-wrap gap-2">
                  {avatars.map((a) => (
                    <div key={a.id} className="relative">
                      <button type="button" disabled={!a.available} onClick={() => pickAvatar(a)} title={a.available ? `Usar a ${a.name}` : "La foto ya no está en tu carpeta"}
                        className={`flex items-center gap-2 rounded-xl border p-1.5 pr-3 text-left transition-colors ${avatarId === a.id ? "border-blue-500/50 bg-blue-500/10" : "border-white/10 hover:bg-white/5"} ${!a.available ? "opacity-40" : ""}`}>
                        <span className="h-12 w-10 shrink-0 overflow-hidden rounded-md bg-black/30">
                          {a.available ? <AuthImage src={artifactUrl(a.face_artifact_id)} alt={a.name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center"><UserRound className="h-4 w-4 text-white/20" /></span>}
                        </span>
                        <span className="min-w-0"><span className="block max-w-[8rem] truncate text-sm text-white/90">{a.name}</span><span className="block max-w-[8rem] truncate text-[11px] text-white/40">{a.voice_name ?? "sin voz"}</span></span>
                      </button>
                      <button type="button" aria-label={`Quitar a ${a.name} de Mis avatares`} onClick={() => void removeAvatar(a)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-zinc-900 text-white/50 hover:text-red-300"><Trash2 className="h-2.5 w-2.5" /></button>
                    </div>
                  ))}
                  <button type="button" className={`${ghostBtn} self-center ${!avatar ? "!border-blue-500/40 !text-blue-200" : ""}`} onClick={() => { setAvatarId(null); setConsent(false); }}><Upload className="h-3 w-3" />Subir un rostro nuevo</button>
                </div>
              </div>
            )}
            <div className="flex gap-4">
              <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                {avatar?.available
                  ? <AuthImage src={artifactUrl(avatar.face_artifact_id)} alt={`Rostro de ${avatar.name}`} className="h-full w-full object-cover" />
                  : facePreview
                    ? <img src={facePreview} alt="Rostro de referencia" className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center"><UserRound className="h-7 w-7 text-white/15" /></div>}
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <Input className={`${inputCls} !h-9`} value={heroName} maxLength={60} placeholder="Nombre del protagonista" onChange={(e) => setHeroName(e.target.value)} />
                {avatar ? (
                  <p className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-2.5 text-[11px] leading-relaxed text-white/60">
                    Usando tu avatar guardado <span className="font-semibold text-white">{avatar.name}</span>: el rostro y la voz ya están, no hay que subir nada.
                    Si cambias el nombre o la voz aquí, el avatar se actualiza con esos cambios.
                  </p>
                ) : (
                  <>
                    <label className="flex items-start gap-2 text-[11px] text-white/55">
                      <input type="checkbox" className="mt-0.5 accent-blue-500" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      El rostro es mío, o tengo permiso de la persona para usarlo.
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className={`${ghostBtn} cursor-pointer ${!consent ? "pointer-events-none opacity-40" : ""}`}>
                        <Upload className="h-3 w-3" />{faceFile ? "Cambiar rostro" : "Subir rostro"}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFaceFile(f); }} />
                      </label>
                      {faceFile && <button type="button" className={ghostBtn} onClick={() => setFaceFile(null)}>Quitar</button>}
                      {faceFile && <span className="max-w-[12rem] truncate text-[11px] text-white/40">{faceFile.name}</span>}
                    </div>
                    {!consent && <span className="block text-[11px] text-blue-300/80">Marca la casilla de arriba para activar «Subir rostro».</span>}
                    <span className="block text-[11px] text-white/30">JPEG, PNG o WebP de hasta 10 MB. Se guarda en Mis avatares para no volver a subirlo.</span>
                  </>
                )}
              </div>
            </div>
            {!status.voice_enabled && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-white/60">
                <span className="flex items-center gap-2"><Mic className="h-3.5 w-3.5 text-blue-300" />ElevenLabs no está conectado: sin él no puedes elegir ni clonar la voz.</span>
                <Link to="/providers" className={`${ghostBtn} !border-blue-500/30 !text-blue-200`}>Conectar ElevenLabs en Providers</Link>
              </div>
            )}
            <VoicePicker enabled={status.voice_enabled} voiceId={voiceId} voiceName={voiceName} disabled={false} status={status}
              settings={voiceSettings} onSettings={setVoiceSettings} onPick={(id, name) => { setVoiceId(id); setVoiceName(name); }} />
          </div>
          ) : (
          <div className="hive-info-card space-y-3">
            <div>
              <span className="hive-label--field flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" />Voz en off <span className="font-normal normal-case text-white/30">(opcional)</span></span>
              <p className="mt-1 text-xs leading-relaxed text-white/40">Un narrador cuenta la historia sobre las imágenes del reel. Elige su voz y, si quieres, un efecto (micrófono de estudio, radio, tráiler…).</p>
            </div>
            {!status.voice_enabled && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-white/60">
                <span className="flex items-center gap-2"><Mic className="h-3.5 w-3.5 text-blue-300" />ElevenLabs no está conectado: sin él no puedes elegir la voz del narrador.</span>
                <Link to="/providers" className={`${ghostBtn} !border-blue-500/30 !text-blue-200`}>Conectar ElevenLabs en Providers</Link>
              </div>
            )}
            <VoicePicker hideMode enabled={status.voice_enabled} voiceId={voiceId} voiceName={voiceName} disabled={false} status={status}
              settings={{ ...voiceSettings, mode: "narration" }} onSettings={(v) => setVoiceSettings({ ...v, mode: "narration" })} onPick={(id, name) => { setVoiceId(id); setVoiceName(name); }} />
          </div>
          )}
          <div className="hive-info-card text-sm text-white/50">
            Costo aproximado de los clips: <span className="font-bold text-blue-300">{usd(estimate)}</span>. Nada se cobra hasta que apruebes el costo en el paso final.
          </div>
          <button className={primaryBtn} onClick={create} disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Crear proyecto
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tarjeta de gráficos ──────────────────────────────────────────────────────

/** Editor del contenido de una tarjeta: el tipo decide qué campos se piden. Los textos son cortos a propósito (lo que mejor se lee en un reel). */
function CardEditor({ card, onChange, disabled }: { card: SceneCard; onChange: (c: SceneCard) => void; disabled: boolean }) {
  const set = (patch: Partial<SceneCard>) => onChange({ ...card, ...patch });
  const k = card.kind;
  const cols = [card.columns[0] ?? { label: "", text: "" }, card.columns[1] ?? { label: "", text: "" }];
  const labels: Record<SceneCard["kind"], { title: string; sub?: string }> = {
    title: { title: "Título (30 a 45 caracteres rinde mejor)", sub: "Subtítulo (opcional)" },
    stat: { title: "Qué significa la cifra", sub: "Fuente o aclaración (opcional)" },
    list: { title: "Encabezado (opcional)" },
    quote: { title: "La cita", sub: "Autor (opcional)" },
    compare: { title: "Encabezado (opcional)" },
    cta: { title: "Qué quieres que hagan", sub: "@usuario o enlace" },
  };
  return (
    <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inputCls} rounded-md px-2 !h-8 text-xs text-white [color-scheme:dark]`} value={k} disabled={disabled} onChange={(e) => set({ kind: e.target.value as SceneCard["kind"] })}>
          {CARD_KINDS.map((c) => <option key={c.id} className={OPTION_CLS} value={c.id}>{c.label}</option>)}
        </select>
        <span className="text-[11px] text-white/35">{CARD_KINDS.find((c) => c.id === k)?.hint}</span>
      </div>
      {k === "stat" && (
        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
          <Field label="Cifra (solo datos reales)"><Input className={`${inputCls} !h-9`} value={card.value} maxLength={12} disabled={disabled} placeholder="73 %" onChange={(e) => set({ value: e.target.value })} /></Field>
          <Field label="Barra (0-100, opcional)"><Input type="number" className={`${inputCls} !h-9`} min={0} max={100} value={card.fill ?? ""} disabled={disabled} placeholder="auto"
            onChange={(e) => set({ fill: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        </div>
      )}
      {k !== "list" || labels.list.title ? (
        <Field label={labels[k].title}><Input className={`${inputCls} !h-9`} value={card.title} maxLength={90} disabled={disabled} onChange={(e) => set({ title: e.target.value })} /></Field>
      ) : null}
      {k === "list" && (
        <Field label="Elementos (uno por línea, hasta 5)">
          <Textarea className={`${inputCls} !h-auto`} rows={4} disabled={disabled} value={card.items.join("\n")}
            onChange={(e) => set({ items: e.target.value.split("\n").slice(0, 5) })} />
        </Field>
      )}
      {k === "compare" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-1.5">
              <Input className={`${inputCls} !h-9`} value={cols[i].label} maxLength={24} disabled={disabled} placeholder={i === 0 ? "Antes" : "Ahora"}
                onChange={(e) => { const next = [...cols]; next[i] = { ...next[i], label: e.target.value }; set({ columns: next }); }} />
              <Input className={`${inputCls} !h-9`} value={cols[i].text} maxLength={90} disabled={disabled} placeholder="Una frase corta"
                onChange={(e) => { const next = [...cols]; next[i] = { ...next[i], text: e.target.value }; set({ columns: next }); }} />
            </div>
          ))}
        </div>
      )}
      {labels[k].sub && <Field label={labels[k].sub!}><Input className={`${inputCls} !h-9`} value={card.sub} maxLength={120} disabled={disabled} onChange={(e) => set({ sub: e.target.value })} /></Field>}
    </div>
  );
}

// ─── Voz de un personaje (ElevenLabs) ────────────────────────────────────────

/** Control deslizante con etiqueta y valor, en el estilo de Hive. */
function Slider({ label, value, min, max, step, format, disabled, hint, onChange }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; disabled?: boolean; hint?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between"><span className="hive-label--field">{label}</span><span className="font-mono text-xs text-blue-300">{format(value)}</span></div>
      <input type="range" className="w-full accent-blue-500 disabled:opacity-40" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="text-[11px] leading-snug text-white/30">{hint}</p>}
    </div>
  );
}

/** Etiquetas de audio que entiende Eleven v4 (dirigen la entonación; no cuentan para el tiempo). Pueden variar según el modelo. */
const AUDIO_TAGS = ["[curious]", "[excited]", "[serious]", "[whispering]", "[sighs]", "[laughing]", "[sarcastic]"];
const stripTags = (t: string) => t.replace(/\[[^\]\n]{1,40}\]/g, "").replace(/[ \t]{2,}/g, " ").trim();

const STABILITY_LEVELS: Array<{ v: number; label: string }> = [{ v: 0, label: "Creativa" }, { v: 0.5, label: "Natural" }, { v: 1, label: "Estable" }];

/**
 * Controles de ElevenLabs. Se adaptan al modelo: Eleven v4 solo admite estabilidad y similitud (sin estilo
 * ni velocidad) y se dirige con etiquetas de audio; Multilingual v2 y Flash añaden estilo, velocidad y
 * speaker boost. El volumen no existe en ElevenLabs: lo aplica Hive al mezclar la voz con el clip.
 */
function VoiceControls({ settings, onChange, voiceId, status, disabled, hideMode }: {
  settings: VoiceSettings; onChange: (v: VoiceSettings) => void; voiceId: string | null; status: StudioStatus; disabled: boolean; hideMode?: boolean;
}) {
  const [text, setText] = useState("Hola, esta es mi voz en el reel.");
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const model = status.voice_models.find((m) => m.id === settings.model_id);
  const expressive = model?.expressive ?? false;
  // «sync» y «narration» generan la voz con texto a voz (modelo, estabilidad, etiquetas); «convert» cambia la voz de Gemini.
  const usesTts = settings.mode !== "convert";
  const narration = settings.mode === "narration";
  const set = (patch: Partial<VoiceSettings>) => onChange({ ...settings, ...patch });
  const pct = (v: number) => `${Math.round(v * 100)} %`;

  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);

  const preview = async () => {
    if (!voiceId || !text.trim()) return;
    setBusy(true); setError(null);
    try {
      const url = await videoApi.previewVoice(voiceId, text.trim(), settings);
      setAudio((old) => { if (old) URL.revokeObjectURL(old); return url; });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <details className="hive-info-card group !p-3">
      <summary className="hive-label--field flex cursor-pointer list-none items-center gap-1.5 select-none">
        <Settings2 className="h-3.5 w-3.5" />Controles de ElevenLabs
        <span className="ml-auto text-[10px] font-normal normal-case text-white/30">{settings.mode === "sync" ? `Tu voz ajustada a los labios · ${model?.label.split(" · ")[0] ?? settings.model_id}` : settings.mode === "convert" ? "Cambio de voz" : `Narración · ${model?.label.split(" · ")[0] ?? settings.model_id}`}</span>
      </summary>
      <div className="mt-3 space-y-3.5">
        <div className={`space-y-1.5 ${hideMode ? "hidden" : ""}`}>
          <span className="hive-label--field">Cómo se pone la voz</span>
          <div className="grid gap-2">
            {([
              ["sync", "Tu voz ajustada a los labios (recomendada)", "Gemini habla la línea moviendo los labios y la voz de ElevenLabs de tu personaje se genera con texto a voz (v4, con etiquetas de audio) y se ajusta palabra por palabra para caer donde se mueven los labios. Suena a tu voz."],
              ["convert", "Cambio de voz", "Gemini habla y ElevenLabs transforma esa voz en la de tu personaje conservando el ritmo. Mantiene más rasgos de la voz de Gemini."],
              ["narration", "Narración sobre el clip", "ElevenLabs narra con el modelo elegido; el personaje no mueve los labios. Conserva el sonido ambiente del clip."],
            ] as const).map(([m, t, d]) => (
              <button key={m} type="button" disabled={disabled} onClick={() => set({ mode: m })}
                className={`rounded-xl border p-2.5 text-left transition-colors ${settings.mode === m ? "border-blue-500/40 bg-blue-500/10" : "border-white/10 hover:bg-white/5"}`}>
                <span className="block text-sm font-semibold text-white">{t}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-white/45">{d}</span>
              </button>
            ))}
          </div>
        </div>

        {usesTts && <label className="block space-y-1.5">
          <span className="hive-label--field">Modelo</span>
          <select className={`${inputCls} w-full rounded-md px-3 !h-9 text-sm text-white [color-scheme:dark]`} value={settings.model_id} disabled={disabled}
            onChange={(e) => set({ model_id: e.target.value })}>
            {status.voice_models.map((m) => <option key={m.id} className={OPTION_CLS} value={m.id}>{m.label}</option>)}
          </select>
        </label>}

        {expressive && usesTts ? (
          <div className="space-y-1.5">
            <span className="hive-label--field">Estabilidad</span>
            <div className="flex gap-2">
              {STABILITY_LEVELS.map((l) => (
                <button key={l.v} type="button" disabled={disabled}
                  className={`${ghostBtn} flex-1 justify-center ${settings.stability === l.v ? "!border-blue-500/40 !bg-blue-500/15 !text-blue-200" : ""}`}
                  onClick={() => set({ stability: l.v })}>{l.label}</button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-white/30">Creativa varía más y responde mejor a las etiquetas de audio; Estable se mantiene más fiel a la voz.</p>
          </div>
        ) : (
          <Slider label="Estabilidad" value={settings.stability} min={0} max={1} step={0.05} format={pct} disabled={disabled}
            hint="Más baja = más expresiva y cambiante; más alta = más uniforme." onChange={(v) => set({ stability: v })} />
        )}
        <Slider label="Similitud con la voz" value={settings.similarity} min={0} max={1} step={0.05} format={pct} disabled={disabled}
          hint="Qué tanto se pega a la voz original. Muy alta puede arrastrar ruido de la muestra." onChange={(v) => set({ similarity: v })} />

        {!usesTts ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[11px] leading-relaxed text-white/45">
            La voz de Gemini se convierte a la del personaje conservando el ritmo y la entonación, y se quita la música de fondo. Estilo, velocidad y etiquetas de audio no aplican en este modo.
          </p>
        ) : expressive ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[11px] leading-relaxed text-white/45">
            Eleven v4 no admite estilo ni velocidad. Dirige la entonación con etiquetas de audio en el diálogo, como <span className="font-mono text-blue-300">[whispering]</span> o <span className="font-mono text-blue-300">[laughing]</span>.
            Para ajustar estilo y velocidad, cambia a Multilingual v2.
          </p>
        ) : (
          <>
            <Slider label="Estilo" value={settings.style} min={0} max={1} step={0.05} format={pct} disabled={disabled}
              hint="Exagera el carácter de la voz. Más de 0 gasta más y puede ser menos estable." onChange={(v) => set({ style: v })} />
            <Slider label="Velocidad" value={settings.speed} min={0.7} max={1.2} step={0.05} format={(v) => `${v.toFixed(2)}x`} disabled={disabled} onChange={(v) => set({ speed: v })} />
            <label className="flex items-center gap-2 text-[11px] text-white/60">
              <input type="checkbox" className="accent-blue-500" checked={settings.speaker_boost} disabled={disabled} onChange={(e) => set({ speaker_boost: e.target.checked })} />
              Speaker boost: refuerza el parecido con la voz original.
            </label>
          </>
        )}

        <div className="space-y-3 border-t border-white/10 pt-3">
          <Slider label="Volumen de la voz" value={settings.volume} min={0.5} max={2} step={0.05} format={pct} disabled={disabled}
            hint="Lo aplica Hive al mezclar con el clip (ElevenLabs no tiene volumen). Más de 100 % usa un limitador para no distorsionar." onChange={(v) => set({ volume: v })} />
          {narration && <Slider label="Sonido ambiente del clip" value={settings.ambient_volume} min={0} max={1} step={0.05} format={pct} disabled={disabled}
            hint="Qué tanto se oye el audio original del clip por debajo de la voz. 0 % deja solo la voz." onChange={(v) => set({ ambient_volume: v })} />}
        </div>

        <div className="space-y-1.5 border-t border-white/10 pt-3">
          <span className="hive-label--field">Efecto de voz</span>
          <select className={`${inputCls} w-full rounded-md px-3 !h-9 text-sm text-white [color-scheme:dark]`} value={settings.fx ?? "studio"} disabled={disabled}
            onChange={(e) => set({ fx: e.target.value as VoiceSettings["fx"] })}>
            {VOICE_FX.map((f) => <option key={f.id} className={OPTION_CLS} value={f.id}>{f.label}</option>)}
          </select>
          <p className="text-[11px] leading-snug text-white/40">{VOICE_FX.find((f) => f.id === (settings.fx ?? "studio"))?.hint} Se aplica al armar el reel: cambiarlo es gratis y no regenera nada. Puedes darle otro efecto a cada escena. Pruébalo abajo.</p>
        </div>

        <div className="space-y-2 border-t border-white/10 pt-3">
          <span className="hive-label--field">Probar voz</span>
          <Input className={`${inputCls} !h-9`} value={text} maxLength={status.voice_preview_max_chars} disabled={disabled} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ghostBtn} disabled={disabled || busy || !voiceId || !text.trim()} onClick={preview}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Probar con estos ajustes
            </button>
            {!voiceId && <span className="text-[11px] text-white/35">Elige una voz primero.</span>}
          </div>
          {audio && <audio controls src={audio} className="h-8 w-full" />}
          {error && <p className="text-[11px] text-red-300">{error}</p>}
          <p className="text-[11px] leading-snug text-white/30">La prueba gasta unos {text.length} caracteres de tu plan de ElevenLabs. {!usesTts ? "Usa texto a voz solo para que oigas el timbre: en el reel la voz sale del cambio de voz de Gemini. " : settings.mode === "sync" ? "En el reel esta misma voz se ajusta en el tiempo a los labios de la escena. " : ""}El volumen se aplica en la mezcla final, no en esta prueba.</p>
        </div>
      </div>
    </details>
  );
}

function VoicePicker({ enabled, voiceId, voiceName, disabled, onPick, status, settings, onSettings, hideMode }: {
  hideMode?: boolean; enabled: boolean; voiceId: string | null; voiceName: string | null; disabled: boolean; onPick: (id: string | null, name: string | null) => void;
  status: StudioStatus; settings: VoiceSettings; onSettings: (v: VoiceSettings) => void;
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    videoApi.voices()
      .then((r) => { if (alive) setVoices(r.voices); })
      .catch((e: Error) => { if (alive) { setVoices([]); setError(e.message); } });
    return () => { alive = false; };
  }, [enabled]);

  if (!enabled) {
    return (
      <p className="text-[11px] leading-relaxed text-white/35">
        <Mic className="mr-1 inline h-3 w-3" />Para darle voz propia o clonada, <Link to="/providers" className="text-blue-300 underline">conecta ElevenLabs en Providers</Link>.
        Sin voz, Gemini dice la línea con su voz nativa (no es la misma en cada escena).
      </p>
    );
  }
  const current = voices?.find((v) => v.voice_id === voiceId);

  const clone = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !cloneName.trim() || !consent) return;
    setBusy(true);
    try {
      const v = await videoApi.cloneVoice(cloneName.trim(), file);
      setVoices((vs) => [v, ...(vs ?? [])]);
      onPick(v.voice_id, v.name);
      setCloning(false); setCloneName(""); setConsent(false);
    } catch (e) {
      void swal.fire({ title: "No se pudo clonar la voz", text: (e as Error).message, icon: "error" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <span className="hive-label--field flex items-center gap-1.5"><Mic className="h-3 w-3" />Voz (ElevenLabs)</span>
      <select className={`${inputCls} w-full rounded-md px-3 !h-9 text-sm text-white [color-scheme:dark]`} value={voiceId ?? ""} disabled={disabled || voices === null}
        onChange={(e) => { const v = voices?.find((x) => x.voice_id === e.target.value); onPick(v?.voice_id ?? null, v?.name ?? null); }}>
        <option className={OPTION_CLS} value="">{voices === null ? "Cargando voces…" : error ? "No se pudieron cargar las voces de ElevenLabs" : "Sin voz asignada (la dice Gemini)"}</option>
        {voiceId && !current && <option className={OPTION_CLS} value={voiceId}>{voiceName ?? voiceId}</option>}
        {(voices ?? []).map((v) => <option className={OPTION_CLS} key={v.voice_id} value={v.voice_id}>{v.name}{v.category === "cloned" ? " · clonada" : v.category === "premade" ? "" : ` · ${v.category}`}</option>)}
      </select>
      {error && (
        <div className="space-y-1.5 rounded-lg border border-red-500/25 bg-red-500/5 p-2">
          <p className="text-[11px] text-red-300">{error}</p>
          <Link to="/providers" className={`${ghostBtn} !border-red-500/30 !text-red-200`}>Actualizar la clave de ElevenLabs en Providers</Link>
        </div>
      )}
      {current?.preview_url && <audio controls src={current.preview_url} className="h-8 w-full" />}
      <VoiceControls settings={settings} onChange={onSettings} voiceId={voiceId} status={status} disabled={disabled} hideMode={hideMode} />
      {!cloning ? (
        <button type="button" className={ghostBtn} disabled={disabled} onClick={() => setCloning(true)}><Upload className="h-3 w-3" />Clonar una voz desde una muestra</button>
      ) : (
        <div className="hive-info-card space-y-2">
          <Input className={inputCls} placeholder="Nombre de la voz" value={cloneName} onChange={(e) => setCloneName(e.target.value)} maxLength={80} />
          <input ref={fileRef} type="file" accept="audio/*" className="block w-full text-xs text-white/50 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-white" />
          <p className="text-[11px] text-white/35">Una muestra limpia de 1 a 3 minutos, sin música. La clonación requiere un plan de ElevenLabs que la incluya.</p>
          <label className="flex items-start gap-2 text-[11px] text-white/60">
            <input type="checkbox" className="mt-0.5 accent-blue-500" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Es mi voz, o tengo permiso de su dueño para clonarla.
          </label>
          <div className="flex gap-2">
            <button type="button" className={primaryBtn + " !px-4 !py-1.5 !text-xs"} disabled={busy || !consent || !cloneName.trim()} onClick={clone}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}Clonar
            </button>
            <button type="button" className={ghostBtn} onClick={() => setCloning(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── En vivo: lo que la producción va haciendo y construyendo ─────────────────

const clock = (t: number) => new Date(t).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * Cuenta cada paso de la producción mientras ocurre (principio de narración de Hive) y muestra lo que se va
 * construyendo: la imagen de cada escena, el clip en cuanto está listo, y lo que viene después.
 */
function LiveProduction({ project }: { project: Project }) {
  const active = project.producing;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const events = [...project.activity].reverse().slice(0, 14);
  const elapsed = project.phase ? Math.max(0, Math.round((now - project.phase.since) / 1000)) : 0;
  const stepTotal = project.scenes.length;
  const done = project.scenes.filter((s) => s.status === "done").length;

  if (!active && project.activity.length === 0) return null;
  // Columna de ancho fijo: los iconos y los puntos alinean la hora y el texto en todas las filas.
  const icon = (e: (typeof events)[number], first: boolean) => (
    <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {e.kind === "error" ? <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        : e.kind === "warn" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        : e.kind === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        : active && first ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-300" />
        : <span className="h-1.5 w-1.5 rounded-full bg-white/25" />}
    </span>
  );

  const body = (
    <div className="space-y-4">
      {active && project.phase && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{project.phase.label}</p>
            <p className="mt-0.5 text-[11px] text-white/45">
              Hace {elapsed} s · {done} de {stepTotal} escenas listas. Puedes salir de esta pestaña: la producción sigue.
            </p>
          </div>
        </div>
      )}

      {stepTotal > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {project.scenes.map((s, i) => (
            <div key={s.id} className="space-y-1.5 rounded-xl border border-white/10 bg-black/20 p-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="hive-label">Escena {i + 1}</span>
                <span className={s.status === "done" ? "text-emerald-300" : s.status === "generating" ? "text-blue-300" : s.status === "failed" ? "text-red-300" : "text-white/30"}>
                  {s.status === "done" ? "Lista" : s.status === "generating" ? "En curso" : s.status === "failed" ? "Falló" : "En espera"}
                </span>
              </div>
              <div className="aspect-[9/16] w-full overflow-hidden rounded-lg border border-white/10 bg-black/30">
                {s.artifact_id
                  ? <AuthVideo src={artifactUrl(s.artifact_id)} className="h-full w-full object-cover" />
                  : s.look_artifact_id
                    ? <AuthImage src={artifactUrl(s.look_artifact_id)} alt={`Imagen de la escena ${i + 1}`} className={`h-full w-full object-cover ${s.status === "generating" ? "opacity-70" : ""}`} />
                    : <div className={`flex h-full items-center justify-center ${s.status === "generating" ? "animate-pulse bg-blue-500/5" : ""}`}><Film className="h-6 w-6 text-white/15" /></div>}
              </div>
              <p className="line-clamp-2 text-[11px] leading-snug text-white/40">{s.dialogue ? `“${s.dialogue.replace(/\[[^\]\n]{1,40}\]/g, "").trim()}”` : s.prompt}</p>
            </div>
          ))}
        </div>
      )}

      <ol className="space-y-1.5">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-2 text-xs leading-snug">
            {icon(e, i === 0)}
            <span className="w-16 shrink-0 font-mono text-[10px] text-white/30">{clock(e.at)}</span>
            <span className={e.kind === "error" ? "text-red-200" : e.kind === "warn" ? "text-amber-200" : i === 0 && active ? "text-white" : "text-white/55"}>{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );

  return active ? (
    <div className="space-y-3 rounded-2xl border border-blue-500/20 bg-blue-500/[0.03] p-4">
      <div className="hive-label flex items-center gap-2 !text-blue-300"><span className="hive-status-dot--active" />En vivo · producción en curso</div>
      {body}
    </div>
  ) : (
    <details className="hive-info-card !p-3">
      <summary className="hive-label--field cursor-pointer select-none">Bitácora de la última producción ({project.activity.length} pasos)</summary>
      <div className="mt-3">{body}</div>
    </details>
  );
}

// ─── Acabado: subtítulos, transiciones y gráficos ────────────────────────────

const PRESETS: Array<{ id: SubtitlePreset; label: string }> = [
  { id: "classic", label: "Clásico" }, { id: "karaoke", label: "Karaoke" }, { id: "box", label: "Caja" }, { id: "pop", label: "Pop" }, { id: "minimal", label: "Minimal" },
];
const TRANSITION_LABELS: Record<TransitionType, string> = {
  none: "Sin efecto (corte directo)", fade: "Fundido", fadeblack: "Fundido a negro", fadewhite: "Fundido a blanco", dissolve: "Disolver",
  wipeleft: "Cortina ←", wiperight: "Cortina →", slideleft: "Deslizar ←", slideright: "Deslizar →", circleopen: "Círculo que se abre", circleclose: "Círculo que se cierra",
  zoomin: "Zoom", pixelize: "Pixelar", radial: "Radial", smoothleft: "Suave ←",
};
const GRAPHIC_LABELS: Record<GraphicKind, string> = { none: "Sin gráfico", title: "Título arriba", lower_third: "Tercio inferior (nombre y cargo)", stat: "Dato destacado", cta: "Llamada a la acción" };
const FONT_CSS = { montserrat: "Montserrat, system-ui, sans-serif", sans: "system-ui, sans-serif", serif: "Georgia, serif" } as const;

/** Maqueta del reel con el estilo elegido (aproximación en CSS de lo que graba ffmpeg). */
function StylePreview({ style, subtitles }: { style: ReelStyle; subtitles: boolean }) {
  const st = style.subtitles;
  const px = { s: 11, m: 14, l: 19 }[st.size] * (st.preset === "pop" ? 1.12 : st.preset === "minimal" ? 0.85 : 1);
  const up = (t: string) => (st.uppercase || st.preset === "pop" ? t.toUpperCase() : t);
  const words = ["¿La", "IA", "te", "va", "a", "dejar", "sin", "trabajo?"].slice(0, 5);
  const outline = "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 5px rgba(0,0,0,.6)";
  const pos = { bottom: "bottom-[17%]", middle: "top-1/2 -translate-y-1/2", top: "top-[12%]" }[st.position];
  const g = style.graphics;
  return (
    <div className="relative mx-auto aspect-[9/16] w-44 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-slate-600 via-slate-700 to-slate-900">
      {g.enabled && g.progress_bar && <div className="absolute left-0 top-0 h-[3px] w-3/5" style={{ background: g.accent }} />}
      {g.enabled && <div className="absolute left-1/2 top-[8%] -translate-x-1/2 whitespace-nowrap px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: g.accent, fontFamily: FONT_CSS.montserrat }}>El gancho del reel</div>}
      {g.enabled && <div className="absolute bottom-[34%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: g.accent, fontFamily: FONT_CSS.montserrat }}>Comenta ➜</div>}
      {subtitles && (
        <div className={`absolute left-[7%] right-[7%] text-center leading-tight ${pos}`}>
          <span style={{
            fontFamily: FONT_CSS[st.font], fontSize: px, fontWeight: st.preset === "minimal" ? 400 : 800, color: st.preset === "pop" ? st.highlight : st.color,
            textShadow: st.preset === "box" ? "none" : st.preset === "minimal" ? "0 1px 3px rgba(0,0,0,.8)" : outline,
            background: st.preset === "box" ? "rgba(0,0,0,.65)" : "transparent", padding: st.preset === "box" ? "2px 6px" : 0, boxDecorationBreak: "clone",
          }}>
            {words.map((w, i) => (
              <span key={i} style={st.preset === "karaoke" && i === 1 ? { color: st.highlight } : undefined}>{up(w)}{i < words.length - 1 ? " " : ""}</span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

function ColorField({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-white/60">
      <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-7 w-9 cursor-pointer rounded border border-white/15 bg-transparent p-0.5 disabled:opacity-40" />
      <span>{label}</span><span className="font-mono text-white/30">{value}</span>
    </label>
  );
}

/**
 * Cómo se ve el reel por encima de los clips: estilo de los subtítulos, efecto entre escenas y gráficos animados.
 * Se aplica al unir los clips, así que cambiarlo no cuesta nada ni vuelve a generar video.
 */
function FinishSection({ style, setStyle, identity, setIdentity, subtitles, onToggleSubtitles, locked, busy, hasMusic }: {
  identity: Identity; setIdentity: (i: Identity) => void;
  style: ReelStyle; setStyle: (s: ReelStyle) => void; subtitles: boolean; onToggleSubtitles: (on: boolean) => void; locked: boolean; busy: boolean; hasMusic: boolean;
}) {
  const st = style.subtitles;
  const setSub = (patch: Partial<ReelStyle["subtitles"]>) => setStyle({ ...style, subtitles: { ...st, ...patch } });
  const seg = (active: boolean) => `${ghostBtn} ${active ? "!border-blue-500/40 !bg-blue-500/15 !text-blue-200" : ""}`;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_190px]">
      <div className="space-y-5">
        <div className="space-y-3">
          <span className="text-sm font-semibold text-white">Identidad visual</span>
          <p className="text-[11px] text-white/30">La paleta y las tipografías de las tarjetas de gráficos, los gráficos y las imágenes de apoyo. Un solo acento y un fondo único hacen que el reel se vea hecho por una sola mano. Cambiarla redibuja las tarjetas (gratis).</p>
          <div className="flex flex-wrap gap-2">
            {IDENTITY_PRESETS.map((p) => (
              <button key={p.preset} type="button" disabled={locked} title={p.mood}
                className={`${seg(identity.preset === p.preset)} !gap-2`} onClick={() => setIdentity({ ...p })}>
                <span className="flex h-4 w-7 overflow-hidden rounded-sm border border-white/20"><span className="h-full w-1/2" style={{ background: p.bg }} /><span className="h-full w-1/2" style={{ background: p.accent }} /></span>{p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <ColorField label="Fondo" value={identity.bg} disabled={locked} onChange={(v) => setIdentity({ ...identity, preset: "custom", bg: v })} />
            <ColorField label="Texto" value={identity.fg} disabled={locked} onChange={(v) => setIdentity({ ...identity, preset: "custom", fg: v })} />
            <ColorField label="Acento" value={identity.accent} disabled={locked} onChange={(v) => setIdentity({ ...identity, preset: "custom", accent: v })} />
            <select className={`${inputCls} rounded-md px-2 !h-8 text-xs text-white [color-scheme:dark]`} value={identity.heading_font} disabled={locked}
              onChange={(e) => setIdentity({ ...identity, preset: "custom", heading_font: e.target.value as Identity["heading_font"] })}>
              <option className={OPTION_CLS} value="montserrat">Títulos: Montserrat</option><option className={OPTION_CLS} value="sans">Títulos: Sans</option><option className={OPTION_CLS} value="serif">Títulos: Serif</option>
            </select>
          </div>
        </div>
        <div className="space-y-3 border-t border-white/10 pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-white">
            <input type="checkbox" className="accent-blue-500" checked={subtitles} disabled={locked || busy} onChange={(e) => onToggleSubtitles(e.target.checked)} />
            Subtítulos
          </label>
          <div className={`space-y-3 ${subtitles ? "" : "pointer-events-none opacity-40"}`}>
            <div className="space-y-1.5">
              <span className="hive-label--field">Estilo</span>
              <div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.id} type="button" disabled={locked} className={seg(st.preset === p.id)} onClick={() => setSub({ preset: p.id })}>{p.label}</button>)}</div>
              <p className="text-[11px] text-white/30">
                {st.preset === "karaoke" ? "La palabra que se dice se resalta con el color de resalte." : st.preset === "box" ? "Texto sobre una caja oscura: se lee sobre cualquier fondo." : st.preset === "pop" ? "Mayúsculas grandes con el color de resalte y una entrada con rebote." : st.preset === "minimal" ? "Pequeño y discreto." : "Blanco con borde negro: el más legible."}
              </p>
            </div>
            <div className="grid gap-3">
              <div className="space-y-1.5"><span className="hive-label--field">Posición</span>
                <div className="flex flex-wrap gap-2">{(["top", "middle", "bottom"] as const).map((v) => <button key={v} type="button" disabled={locked} className={seg(st.position === v)} onClick={() => setSub({ position: v })}>{{ top: "Arriba", middle: "Centro", bottom: "Abajo" }[v]}</button>)}</div></div>
              <div className="space-y-1.5"><span className="hive-label--field">Tamaño</span>
                <div className="flex flex-wrap gap-2">{(["s", "m", "l"] as const).map((v) => <button key={v} type="button" disabled={locked} className={seg(st.size === v)} onClick={() => setSub({ size: v })}>{{ s: "Pequeño", m: "Mediano", l: "Grande" }[v]}</button>)}</div></div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <ColorField label="Texto" value={st.color} disabled={locked} onChange={(v) => setSub({ color: v })} />
              <ColorField label="Resalte" value={st.highlight} disabled={locked} onChange={(v) => setSub({ highlight: v })} />
              <label className="flex items-center gap-2 text-[11px] text-white/60"><input type="checkbox" className="accent-blue-500" checked={st.uppercase} disabled={locked} onChange={(e) => setSub({ uppercase: e.target.checked })} />MAYÚSCULAS</label>
              <label className="flex items-center gap-2 text-[11px] text-white/60">Tipografía
                <select className={`${inputCls} rounded-md px-2 !h-8 text-xs text-white [color-scheme:dark]`} value={st.font} disabled={locked} onChange={(e) => setSub({ font: e.target.value as typeof st.font })}>
                  <option className={OPTION_CLS} value="montserrat">Montserrat</option><option className={OPTION_CLS} value="sans">Sans</option><option className={OPTION_CLS} value="serif">Serif</option>
                </select></label>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-white/10 pt-4">
          <span className="hive-label--field">Efecto entre escenas</span>
          <div className="flex flex-wrap items-center gap-3">
            <select className={`${inputCls} rounded-md px-3 !h-9 text-sm text-white [color-scheme:dark]`} value={style.transition.type} disabled={locked}
              onChange={(e) => setStyle({ ...style, transition: { ...style.transition, type: e.target.value as TransitionType } })}>
              {(Object.keys(TRANSITION_LABELS) as TransitionType[]).map((t) => <option key={t} className={OPTION_CLS} value={t}>{TRANSITION_LABELS[t]}</option>)}
            </select>
            {style.transition.type !== "none" && (
              <label className="flex items-center gap-2 text-[11px] text-white/60">Duración
                <input type="range" className="w-32 accent-blue-500" min={0.2} max={1} step={0.1} value={style.transition.duration} disabled={locked}
                  onChange={(e) => setStyle({ ...style, transition: { ...style.transition, duration: Number(e.target.value) } })} />
                <span className="font-mono text-blue-300">{style.transition.duration.toFixed(1)} s</span></label>
            )}
          </div>
          <p className="text-[11px] text-white/30">Las escenas se solapan durante ese tiempo, así que el reel dura un poco menos que la suma de las escenas.</p>
        </div>

        <div className="space-y-2 border-t border-white/10 pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-white">
            <input type="checkbox" className="accent-blue-500" checked={style.music.enabled} disabled={locked} onChange={(e) => setStyle({ ...style, music: { ...style.music, enabled: e.target.checked } })} />
            Música de fondo suave
          </label>
          <div className={`space-y-2 ${style.music.enabled ? "" : "pointer-events-none opacity-40"}`}>
            <p className="text-[11px] text-white/30">Gemini (Lyria) compone un instrumental según el tema del reel; queda bajito y se agacha solo cuando alguien habla. Cuesta unos US$0,08 por reel{hasMusic ? " (ya está compuesta: no se vuelve a cobrar)" : ""}.</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-[11px] text-white/60">Volumen
                <input type="range" min={0.04} max={0.4} step={0.02} value={style.music.volume} disabled={locked} className="accent-blue-500"
                  onChange={(e) => setStyle({ ...style, music: { ...style.music, volume: Number(e.target.value) } })} />
                <span className="w-9 text-white/40">{Math.round(style.music.volume * 100)} %</span>
              </label>
              <input className="min-w-[220px] flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/30" maxLength={200} disabled={locked}
                placeholder="Estilo (opcional): piano cálido, electrónica suave, cuerdas esperanzadoras…" value={style.music.mood}
                onChange={(e) => setStyle({ ...style, music: { ...style.music, mood: e.target.value } })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-white">
            <input type="checkbox" className="accent-blue-500" checked={style.trim.enabled} disabled={locked} onChange={(e) => setStyle({ ...style, trim: { ...style.trim, enabled: e.target.checked } })} />
            Recortar silencios
          </label>
          <p className="text-[11px] text-white/30">Gemini empieza a hablar con retraso y deja aire al final de cada clip. Al unir las escenas se corta cada una a su tramo hablado, con un pequeño margen. Es gratis y no toca los clips guardados.</p>
          <label className="flex items-center gap-2 text-sm font-semibold text-white">
            <input type="checkbox" className="accent-blue-500" checked={style.graphics.enabled} disabled={locked} onChange={(e) => setStyle({ ...style, graphics: { ...style.graphics, enabled: e.target.checked } })} />
            Gráficos animados
          </label>
          <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${style.graphics.enabled ? "" : "pointer-events-none opacity-40"}`}>
            <ColorField label="Color de acento" value={style.graphics.accent} disabled={locked} onChange={(v) => setStyle({ ...style, graphics: { ...style.graphics, accent: v } })} />
            <label className="flex items-center gap-2 text-[11px] text-white/60"><input type="checkbox" className="accent-blue-500" checked={style.graphics.progress_bar} disabled={locked}
              onChange={(e) => setStyle({ ...style, graphics: { ...style.graphics, progress_bar: e.target.checked } })} />Barra de progreso arriba</label>
          </div>
          <p className="text-[11px] text-white/30">El Director de video decide qué gráfico lleva cada escena (título, tercio inferior, dato destacado, llamada a la acción); puedes cambiarlos en cada escena.</p>
        </div>
      </div>
      <div className="space-y-2"><span className="hive-label--field block text-center">Vista previa</span><StylePreview style={style} subtitles={subtitles} /></div>
    </div>
  );
}

// ─── Editor del proyecto ─────────────────────────────────────────────────────

function ProjectEditor({ project, status, avatars, onChange, onDeleted, onAvatarsChange }: {
  project: Project; status: StudioStatus; avatars: Avatar[]; onChange: (p: Project) => void; onDeleted: () => void; onAvatarsChange: () => void;
}) {
  const [script, setScript] = useState(project.script);
  const [brief, setBrief] = useState(project.brief);
  const [title, setTitle] = useState(project.title);
  const [style, setStyle] = useState<ReelStyle>(project.style ?? DEFAULT_REEL_STYLE);
  // Título e idea ya se definieron al crear el reel: se muestran como resumen y solo se editan si el usuario lo pide.
  const [editingBasics, setEditingBasics] = useState(() => !project.brief.trim());
  const [characters, setCharacters] = useState<DraftCharacter[]>(() => toDraft(project).characters);
  const [scenes, setScenes] = useState<DraftScene[]>(() => toDraft(project).scenes);
  const [narrator, setNarrator] = useState<DraftNarrator>(() => narratorDraft(project));
  const [identity, setIdentity] = useState<Identity>(project.identity ?? IDENTITY_PRESETS[0]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const locked = project.producing;
  // Al empezar la producción se baja solo al panel en vivo, para que se vea lo que se va construyendo.
  const liveRef = useRef<HTMLDivElement>(null);
  const wasLocked = useRef(project.producing);
  useEffect(() => {
    if (locked && !wasLocked.current) liveRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    wasLocked.current = locked;
  }, [locked]);

  // Lo que prepara el agente en el chat llega por sondeo: se adopta mientras no haya cambios locales sin guardar.
  useEffect(() => {
    if (dirty) return;
    const d = toDraft(project);
    setScript(project.script); setBrief(project.brief); setTitle(project.title); setStyle(project.style ?? DEFAULT_REEL_STYLE); setCharacters(d.characters); setScenes(d.scenes); setNarrator(narratorDraft(project)); setIdentity(project.identity ?? IDENTITY_PRESETS[0]);
  }, [project.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = () => setDirty(true);
  const price = status.price_per_second_usd[project.resolution];
  const localSeconds = scenes.reduce((s, x) => s + (Number(x.seconds) || 0), 0);
  const cost = project.cost;
  const pendingSeconds = dirty ? localSeconds : cost.pending_seconds;
  const total = dirty ? localSeconds * price : cost.total_usd;
  const done = project.scenes.filter((s) => s.status === "done").length;
  const progress = project.scenes.length ? Math.round((done / project.scenes.length) * 100) : 0;

  const save = useCallback(async (forceKey?: string): Promise<Project> => {
    // La tarjeta de bienvenida intacta no se guarda, salvo que el usuario la esté usando (subir rostro, avatar).
    const toSave = characters.filter((c) => !c.pristine || c.key === forceKey);
    // 1) personajes (para tener sus ids), 2) escenas con esos ids.
    let saved = await videoApi.update(project.id, {
      title: title.trim() || project.title, brief, script, style, identity,
      narrator: narrator.voiceId ? { voice_id: narrator.voiceId, voice_name: narrator.voiceName, voice_settings: narrator.settings } : null,
      characters: toSave.map((c) => ({ id: c.id, name: c.name, description: c.description, voice_id: c.voiceId, voice_name: c.voiceName, voice_settings: c.voiceSettings })),
    });
    const idByKey = new Map<string, string>();
    toSave.forEach((c, i) => idByKey.set(c.key, saved.characters[i]?.id ?? c.key));
    saved = await videoApi.update(project.id, {
      scenes: scenes.map((s) => ({
        id: s.id, seconds: Number(s.seconds), prompt: s.prompt, wardrobe: s.wardrobe, setting: s.setting, dialogue: s.dialogue, graphic: s.graphic, fx: s.fx, source: s.source, card: s.source === "card" ? s.card : null,
        character_ids: s.characterKeys.map((k) => idByKey.get(k) ?? k),
      })),
    });
    const d = toDraft(saved);
    setCharacters(d.characters); setScenes(d.scenes); setDirty(false);
    onChange(saved);
    return saved;
  }, [project.id, title, brief, script, style, identity, characters, scenes, narrator, onChange]);

  /** Efecto de voz que heredaría una escena: el de su personaje o, sin personaje, el del narrador. */
  const inheritedFx = (s: DraftScene): string => {
    const c = characters.find((x) => s.characterKeys.includes(x.key));
    return c ? (c.voiceSettings.fx ?? "none") : s.characterKeys.length === 0 ? (narrator.voiceId ? narrator.settings.fx : "none") : "none";
  };
  const suggestionFor = (s: DraftScene) => (s.id ? project.fx_suggestions?.[project.scenes.findIndex((x) => x.id === s.id)] ?? null : null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) {
      // apiClient ya muestra sus errores; los de subida de archivos se avisan aquí.
      const msg = (e as Error).message;
      if (msg && !msg.startsWith("API Error")) void swal.fire({ title: "No se pudo completar", text: msg, icon: "error" });
    } finally { setBusy(null); }
  };

  /** Índice del personaje en el proyecto guardado (los borradores nuevos aún no tienen id). */
  const savedCharacterId = async (key: string): Promise<{ saved: Project; id: string } | null> => {
    const saved = dirty || !characters.find((c) => c.key === key)?.id ? await save(key) : project;
    const list = characters.filter((c) => !c.pristine || c.key === key);
    const id = saved.characters[list.findIndex((x) => x.key === key)]?.id;
    return id ? { saved, id } : null;
  };

  /** Cambia un personaje del borrador y lo marca como usado. */
  const patchCharacter = (key: string, patch: Partial<DraftCharacter>) => {
    setCharacters((cs) => cs.map((x) => (x.key === key ? { ...x, ...patch, pristine: false } : x)));
    touch();
  };

  const generateImage = (key: string) => run(`img-${key}`, async () => {
    const found = await savedCharacterId(key);
    if (found) onChange(await videoApi.characterImage(project.id, found.id));
  });

  const uploadFace = (key: string, file: File) => run(`face-${key}`, async () => {
    const found = await savedCharacterId(key);
    if (found) { onChange(await videoApi.uploadFace(project.id, found.id, file)); onAvatarsChange(); }
  });

  /** Pone un avatar guardado en este personaje: rostro y voz, sin volver a subir la foto. */
  const useAvatar = (key: string, avatarId: string) => run(`avatar-${key}`, async () => {
    const found = await savedCharacterId(key);
    if (found) { onChange(await videoApi.applyAvatar(project.id, avatarId, found.id)); onAvatarsChange(); }
  });

  const removeFace = (id: string) => run(`face-${id}`, async () => { onChange(await videoApi.removeFace(project.id, id)); });

  const approveAndProduce = () => run("produce", async () => {
    const saved = dirty ? await save() : project;
    // Todos los clips ya existen y solo falta unirlos: no cuesta nada, no hay nada que aprobar.
    if (saved.cost.pending_scenes === 0) { onChange(await videoApi.produce(project.id)); return; }
    const c = saved.cost;
    const ok = await swal.fire({
      title: "Aprobar costo y producir",
      html: `Se generarán <b>${c.pending_scenes}</b> clip(s) (${c.pending_seconds} s) a ${saved.resolution}` +
        (c.looks_pending ? ` y <b>${c.looks_pending}</b> imagen(es) de escena con tu rostro de referencia` : "") + (c.music_usd ? ` y la música de fondo (Lyria)` : "") + `.<br/>` +
        `Costo estimado: <b>${usd(c.total_usd)}</b>. Se cobra a tu saldo de Gemini y no se puede deshacer.` +
        (c.dialogue_chars ? `<br/><small>Además, ElevenLabs descuenta ${c.dialogue_chars} caracteres de tu plan por la voz.</small>` : ""),
      icon: "question", showCancelButton: true, confirmButtonText: "Aprobar y producir", cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;
    await videoApi.approve(project.id);
    onChange(await videoApi.produce(project.id));
  });

  /** Agrega (o rehace) la música de fondo de un reel terminado: una sola llamada a Lyria, sin tocar los clips. */
  const addMusic = () => run("music", async () => {
    const saved = dirty ? await save() : project;
    const ok = await swal.fire({
      title: saved.music ? "Rehacer la música" : "Agregar música de fondo",
      html: `Gemini (Lyria) compondrá una música instrumental suave según el tema del reel y se mezclará bajo la voz.<br/>Costo estimado: <b>${usd(0.08)}</b>. <b>No se vuelve a generar el video.</b>`,
      icon: "question", showCancelButton: true, confirmButtonText: saved.music ? "Rehacer la música" : "Agregar la música", cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;
    onChange(await videoApi.music(project.id));
  });

  /** Rehace solo la voz con el clip original de Gemini guardado: no se vuelve a pagar el video. */
  const redub = () => run("redub", async () => {
    const saved = dirty ? await save() : project;
    const ok = await swal.fire({
      title: "Rehacer la voz",
      html: `Se rehace la voz de <b>${saved.cost.redub_available}</b> escena(s) con el clip original de Gemini.<br/><b>No se vuelve a generar el video</b> (sin costo de Gemini).` +
        (saved.cost.dialogue_chars || saved.scenes.length ? `<br/><small>ElevenLabs descuenta de nuevo los caracteres del diálogo.</small>` : ""),
      icon: "question", showCancelButton: true, confirmButtonText: "Rehacer la voz", cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;
    onChange(await videoApi.redub(project.id));
  });

  const remove = async () => {
    const ok = await swal.fire({ title: "¿Borrar proyecto?", text: "Los archivos ya generados se conservan en tu carpeta.", icon: "warning", showCancelButton: true, confirmButtonText: "Borrar" });
    if (!ok.isConfirmed) return;
    await videoApi.remove(project.id).then(onDeleted).catch(() => {});
  };

  const joinOnly = !dirty && project.scenes.length > 0 && cost.pending_scenes === 0 && !project.final_artifact_id;
  const canProduce = scenes.length > 0 && !locked && !busy && (pendingSeconds > 0 || joinOnly)
    && scenes.every((s) => s.prompt.trim() && s.seconds >= status.limits.min_clip_seconds && s.seconds <= status.limits.max_clip_seconds);
  const over = localSeconds > status.limits.max_project_seconds;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">{project.title}</h2>
          <p className="mt-1 text-sm text-white/40">
            {project.aspect_ratio} · {project.resolution} · objetivo {project.target_seconds} s ·{" "}
            <span className={localSeconds === project.target_seconds ? "text-emerald-300" : "text-blue-300"}>{localSeconds} s en escenas</span>
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && <span className="hive-tag hive-tag--tone self-center">Cambios sin guardar</span>}
          <button className={ghostBtn} onClick={() => run("save", async () => { await save(); })} disabled={!dirty || !!busy || locked}>
            {busy === "save" && <Loader2 className="h-3 w-3 animate-spin" />}Guardar cambios
          </button>
          <button className={ghostBtn} onClick={remove} disabled={locked} aria-label="Borrar proyecto"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {project.error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{project.error}</span>
        </div>
      )}

      <SectionCard step={1} title="Idea y guion"
        action={!locked && (
          <button type="button" className={ghostBtn} onClick={() => setEditingBasics((v) => !v)}>{editingBasics ? "Listo" : "Editar título e idea"}</button>
        )}>
        {editingBasics ? (
          <>
            <Field label="Título"><Input className={`${inputCls} !h-9`} value={title} maxLength={120} disabled={locked} placeholder="Título del reel" onChange={(e) => { setTitle(e.target.value); touch(); }} /></Field>
            <Field label="Idea"><Textarea className={`${inputCls} !h-auto`} value={brief} onChange={(e) => { setBrief(e.target.value); touch(); }} rows={4} placeholder="Idea del video" disabled={locked} /></Field>
            {!locked && (
              <AiImprove title={title} brief={brief} aspect={project.aspect_ratio} seconds={project.target_seconds}
                characters={characters.filter((c) => c.name.trim()).map((c) => (c.description.trim() ? `${c.name}: ${c.description}` : c.name))}
                onApply={(n) => { if (n.title !== undefined) setTitle(n.title); if (n.brief !== undefined) setBrief(n.brief); touch(); }} />
            )}
          </>
        ) : (
          <div className="hive-info-card space-y-1.5">
            <p className="text-sm font-semibold text-white">{title || "Sin título"}</p>
            <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-white/55">{brief || "Sin idea todavía."}</p>
          </div>
        )}
        {!locked && (
          <AiScript mode={characters.every((c) => c.pristine) ? "voiceover" : "avatar"} title={title} brief={brief} aspect={project.aspect_ratio} seconds={project.target_seconds} disabled={!!busy}
            hasContent={!!script.trim() || scenes.length > 0}
            people={characters.filter((c) => c.id).map((c) => ({ id: c.id!, name: c.name, description: c.description, voice_expressive: status.voice_models.find((m) => m.id === c.voiceSettings.model_id)?.expressive === true && !!c.voiceId }))}
            ensureSaved={async () => {
              // Los personajes nuevos aún no tienen id: se guarda primero para poder usarlos en las escenas.
              const needsSave = dirty || characters.some((c) => !c.pristine && !c.id);
              const saved = needsSave ? await save() : project;
              return saved.characters.map((c) => ({
                id: c.id, name: c.name, description: c.description,
                voice_expressive: status.voice_models.find((m) => m.id === c.voice_settings?.model_id)?.expressive === true && !!c.voice_id,
              }));
            }}
            onApply={async (p, what) => {
              setScript(p.script);
              if (what === "all") {
                if (project.scenes.some((x) => x.status === "done")) {
                  const ok = await swal.fire({
                    title: "Reemplazar las escenas",
                    text: "Ya hay clips generados. Las escenas nuevas se producirán de nuevo y tendrán costo.",
                    icon: "warning", showCancelButton: true, confirmButtonText: "Reemplazar", cancelButtonText: "Cancelar",
                  });
                  if (!ok.isConfirmed) { touch(); return; }
                }
                setScenes(p.scenes.map((s) => ({
                  key: newKey(), seconds: s.seconds, prompt: s.prompt, characterKeys: s.character_ids,
                  wardrobe: s.wardrobe, setting: s.setting, dialogue: s.dialogue, graphic: s.graphic ?? NO_GRAPHIC, fx: null,
                  source: s.source ?? "clip", card: s.card ?? null,
                })));
              }
              touch();
            }} />
        )}
        <Field label="Guion">
          <Textarea className={`${inputCls} !h-auto`} value={script} onChange={(e) => { setScript(e.target.value); touch(); }} rows={7} disabled={locked}
            placeholder="Narración, diálogos y acciones. Pulsa «Escribir guion y escenas con IA» y lo redacta a partir de tu idea, o escríbelo tú." />
        </Field>
      </SectionCard>

      <SectionCard step={2} title="Personajes" hint="Sube una foto de tu rostro como referencia: la identidad no cambia nunca. El Director de video decide el vestuario y la escenografía de cada escena."
        action={
          <button className={ghostBtn} disabled={locked || characters.length >= status.limits.max_characters}
            onClick={() => { setCharacters((cs) => [...cs, { key: newKey(), name: "", description: "", voiceId: null, voiceName: null, voiceSettings: DEFAULT_VOICE_SETTINGS }]); touch(); }}>
            <Plus className="h-3 w-3" />Personaje
          </button>
        }>
        {!status.voice_enabled && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-white/60">
            <span className="flex items-center gap-2"><Mic className="h-3.5 w-3.5 text-blue-300" />ElevenLabs no está conectado: sin él no puedes elegir ni clonar la voz del personaje.</span>
            <Link to="/providers" className={`${ghostBtn} !border-blue-500/30 !text-blue-200`}>Conectar ElevenLabs en Providers</Link>
          </div>
        )}
        <div className="grid gap-4">
          {characters.map((c) => {
            const saved = project.characters.find((x) => x.id === c.id);
            const faceKey = `face-${c.key}`;
            const consent = !!consents[c.key];
            return (
              <div key={c.key} className="hive-info-card flex gap-3">
                <div className="flex w-24 shrink-0 flex-col gap-2">
                  <div className="h-32 w-24 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                    {saved?.face_artifact_id
                      ? <AuthImage src={artifactUrl(saved.face_artifact_id)} alt={`Rostro de ${c.name}`} className="h-full w-full object-cover" />
                      : saved?.image_artifact_id
                        ? <AuthImage src={artifactUrl(saved.image_artifact_id)} alt={c.name} className="h-full w-full object-cover" />
                        : <div className="flex h-full items-center justify-center"><UserRound className="h-8 w-8 text-white/15" /></div>}
                  </div>
                  <span className={saved?.face_path ? "hive-tag hive-tag--provider justify-center" : "hive-tag hive-tag--disabled justify-center"}>
                    {saved?.face_path ? "Rostro propio" : saved?.image_path ? "Generado" : "Sin imagen"}
                  </span>
                  {saved?.face_artifact_id && avatars.some((a) => a.face_artifact_id === saved.face_artifact_id) && (
                    <span className="text-center text-[10px] leading-tight text-emerald-300/80">Guardado en Mis avatares</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <Input className={`${inputCls} !h-9`} value={c.name} placeholder="Nombre" disabled={locked} maxLength={60}
                    onChange={(e) => patchCharacter(c.key, { name: e.target.value })} />
                  <Textarea className={`${inputCls} !h-auto`} value={c.description} rows={3} disabled={locked} placeholder="Quién es, edad, estilo general… (el vestuario de cada escena lo decide el Director)"
                    onChange={(e) => patchCharacter(c.key, { description: e.target.value })} />

                  {avatars.some((a) => a.available) && !saved?.face_path && (
                    <label className="block space-y-1.5">
                      <span className="hive-label--field">Usar un avatar guardado</span>
                      <select className={`${inputCls} w-full rounded-md px-3 !h-9 text-sm text-white [color-scheme:dark]`} value="" disabled={locked || !!busy}
                        onChange={(e) => { if (e.target.value) void useAvatar(c.key, e.target.value); }}>
                        <option className={OPTION_CLS} value="">Elegir de Mis avatares…</option>
                        {avatars.filter((a) => a.available).map((a) => <option key={a.id} className={OPTION_CLS} value={a.id}>{a.name}{a.voice_name ? ` · ${a.voice_name}` : ""}</option>)}
                      </select>
                      <span className="block text-[11px] text-white/30">No hace falta volver a subir la foto. O sube un rostro nuevo aquí abajo.</span>
                    </label>
                  )}
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 text-[11px] text-white/55">
                      <input type="checkbox" className="mt-0.5 accent-blue-500" checked={consent} disabled={locked}
                        onChange={(e) => setConsents((m) => ({ ...m, [c.key]: e.target.checked }))} />
                      El rostro es mío, o tengo permiso de la persona para usarlo.
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <label className={`${ghostBtn} cursor-pointer ${!consent || locked || !!busy || !c.name.trim() ? "pointer-events-none opacity-40" : ""}`}>
                        {busy === faceKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                        {saved?.face_path ? "Cambiar rostro" : "Subir rostro"}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadFace(c.key, f); }} />
                      </label>
                      {saved?.face_path && <button className={ghostBtn} disabled={locked || !!busy} onClick={() => saved && removeFace(saved.id)}>Quitar rostro</button>}
                      <button className={ghostBtn} disabled={locked || !!busy || !c.name.trim() || !c.description.trim()} onClick={() => generateImage(c.key)}>
                        {busy === `img-${c.key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {saved?.image_artifact_id ? "Regenerar avatar" : saved?.face_path ? "Avatar desde mi rostro" : "Generar avatar"}
                      </button>
                      <button className={ghostBtn} disabled={locked} aria-label="Quitar personaje"
                        onClick={() => { setCharacters((cs) => cs.filter((x) => x.key !== c.key)); setScenes((ss) => ss.map((s) => ({ ...s, characterKeys: s.characterKeys.filter((k) => k !== c.key) }))); touch(); }}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    {!consent && <span className="text-[11px] text-blue-300/80">Marca la casilla de arriba para activar «Subir rostro».</span>}
                    <span className="block text-[11px] text-white/30">Cada imagen ≈ {usd(status.image_cost_usd)}. JPEG, PNG o WebP de hasta 10 MB.</span>
                  </div>

                  <VoicePicker enabled={status.voice_enabled} voiceId={c.voiceId} voiceName={c.voiceName} disabled={locked} status={status}
                    settings={c.voiceSettings} onSettings={(v) => patchCharacter(c.key, { voiceSettings: v })}
                    onPick={(id, name) => patchCharacter(c.key, { voiceId: id, voiceName: name })} />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard step={3} title="Escenas" hint={`Cada escena es un clip de ${status.limits.min_clip_seconds} a ${status.limits.max_clip_seconds} s. El vestuario y la escenografía los propone el Director de video; puedes ajustarlos.`}
        action={
          <div className="flex flex-wrap gap-2">
          <button className={ghostBtn} disabled={locked || !scenes.some((s) => s.dialogue.trim())} title="Pone en cada escena con voz el efecto que le va según lo que dice"
            onClick={() => { setScenes((ss) => ss.map((x) => { const sug = suggestionFor(x); return sug && x.dialogue.trim() ? { ...x, fx: sug.id } : x; })); touch(); }}>
            <Sparkles className="h-3 w-3 text-blue-300" />Efectos de voz sugeridos
          </button>
          <button className={ghostBtn} disabled={locked || scenes.length >= status.limits.max_scenes}
            onClick={() => { setScenes((ss) => [...ss, { key: newKey(), seconds: 5, prompt: "", characterKeys: [], wardrobe: "", setting: "", dialogue: "", graphic: NO_GRAPHIC, fx: null, source: "clip", card: null }]); touch(); }}>
            <Plus className="h-3 w-3" />Escena
          </button>
          </div>
        }>
        {characters.every((c) => c.pristine) && (
          <div className="hive-info-card space-y-3">
            <div>
              <span className="hive-label--field flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" />Voz en off <span className="font-normal normal-case text-white/30">(escenas sin personaje)</span></span>
              <p className="mt-1 text-xs leading-relaxed text-white/40">Las escenas sin personaje no tienen a nadie hablando: su diálogo lo dice este narrador sobre las imágenes.</p>
            </div>
            <VoicePicker hideMode enabled={status.voice_enabled} voiceId={narrator.voiceId} voiceName={narrator.voiceName} disabled={locked} status={status}
              settings={narrator.settings} onSettings={(v) => { setNarrator((n) => ({ ...n, settings: { ...v, mode: "narration" } })); touch(); }}
              onPick={(id, name) => { setNarrator((n) => ({ ...n, voiceId: id, voiceName: name })); touch(); }} />
          </div>
        )}
        {scenes.length === 0 && <p className="text-sm text-white/35">Añade escenas a mano o pídele al Director de video que las prepare.</p>}
        {over && <p className="text-sm text-red-300">Las escenas suman {localSeconds} s; el máximo es {status.limits.max_project_seconds} s.</p>}
        <div className="space-y-3">
          {scenes.map((s, i) => {
            const server = project.scenes.find((x) => x.id === s.id);
            const tag = SCENE_TAG[server?.status ?? "pending"];
            const maxChars = Math.floor((Number(s.seconds) || 0) * DIALOGUE_CHARS_PER_SECOND);
            // La voz de la escena: el primer personaje con voz asignada. Si su modelo es expresivo (v4), se ofrecen etiquetas de audio.
            const speaker = s.characterKeys.map((k) => characters.find((c) => c.key === k)).find((c) => !!c?.voiceId);
            const speakerExpressive = !!speaker && speaker.voiceSettings.mode !== "convert" && (status.voice_models.find((m) => m.id === speaker.voiceSettings.model_id)?.expressive ?? false);
            const spoken = stripTags(s.dialogue).length;
            return (
              <div key={s.key} className="hive-info-card">
                <div className="flex gap-3">
                  <div className="flex w-20 shrink-0 flex-col gap-2">
                    <span className="hive-label">Escena {i + 1}</span>
                    <div className="flex items-center gap-1">
                      <Input type="number" className={`${inputCls} !h-8 px-2`} min={status.limits.min_clip_seconds} max={status.limits.max_clip_seconds} value={s.seconds} disabled={locked}
                        onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, seconds: Number(e.target.value) } : x)); touch(); }} />
                      <span className="text-xs text-white/35">s</span>
                    </div>
                    <span className={`${tag.cls} justify-center`}>{tag.label}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {([["clip", "Clip de Gemini"], ["card", "Tarjeta de gráficos · gratis"], ["image", "Imagen con movimiento"]] as Array<[SceneSource, string]>).map(([src, label]) => (
                        <button key={src} type="button" disabled={locked || (!!server && server.status === "done" && server.source !== src && false)}
                          className={`${ghostBtn} !px-2.5 !py-1 !text-[11px] ${s.source === src ? "!border-blue-500/40 !bg-blue-500/15 !text-blue-200" : ""}`}
                          onClick={() => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, source: src, card: src === "card" ? (x.card ?? { ...EMPTY_CARD }) : null, characterKeys: src === "clip" ? x.characterKeys : [] } : x)); touch(); }}>{label}</button>
                      ))}
                      <span className="text-[11px] text-white/30">{s.source === "card" ? "Texto exacto con tu identidad visual, sin avatar y sin costo." : s.source === "image" ? "Una imagen de Nano Banana con zoom o paneo (≈ US$ 0,04). Sin avatar." : "Video de Gemini: movimiento real, personas, acción."}</span>
                    </div>
                    {s.source === "card" && s.card ? (
                      <CardEditor card={s.card} disabled={locked} onChange={(c) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, card: c } : x)); touch(); }} />
                    ) : (
                      <Textarea className={`${inputCls} !h-auto`} value={s.prompt} rows={2} disabled={locked}
                        placeholder={s.source === "image" ? "La imagen: sujeto, estilo, composición. El texto que deba aparecer escríbelo entre comillas y corto." : "Qué se ve y qué pasa: sujeto, acción, cámara y luz."}
                        onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, prompt: e.target.value } : x)); touch(); }} />
                    )}
                    {s.source === "clip" && <div className="grid gap-2.5 sm:grid-cols-2">
                      <Field label="Vestuario">
                        <div className="relative"><Shirt className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/25" />
                          <Input className={`${inputCls} !h-9 pl-9`} value={s.wardrobe} disabled={locked} placeholder="Lo decide el Director de video"
                            onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, wardrobe: e.target.value } : x)); touch(); }} /></div>
                      </Field>
                      <Field label="Escenografía">
                        <div className="relative"><Mountain className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/25" />
                          <Input className={`${inputCls} !h-9 pl-9`} value={s.setting} disabled={locked} placeholder="Lugar, luz y ambiente"
                            onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, setting: e.target.value } : x)); touch(); }} /></div>
                      </Field>
                    </div>}
                    <Field label={`${s.source === "clip" ? "Diálogo" : "Voz en off"} (${spoken}/${maxChars})`}>
                      <Textarea className={`${inputCls} !h-auto ${spoken > maxChars ? "!border-red-500/50" : ""}`} value={s.dialogue} rows={2} disabled={locked}
                        placeholder={s.source === "clip" ? "Lo que dice el personaje (opcional). Si tiene voz de ElevenLabs se narra con ella." : "Lo que cuenta el narrador sobre esta escena (opcional). Se narra con la voz en off."}
                        onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, dialogue: e.target.value } : x)); touch(); }} />
                    </Field>
                    {speakerExpressive && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-white/35">Etiquetas de audio (Eleven v4):</span>
                        {AUDIO_TAGS.map((tag) => (
                          <button key={tag} type="button" disabled={locked} className={`${ghostBtn} !px-2 !py-0.5 !text-[11px] font-mono`}
                            onClick={() => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, dialogue: `${x.dialogue}${x.dialogue && !x.dialogue.endsWith(" ") ? " " : ""}${tag} ` } : x)); touch(); }}>{tag}</button>
                        ))}
                      </div>
                    )}
                    {s.dialogue.trim() && (() => {
                      const sug = suggestionFor(s);
                      const current = s.fx ?? inheritedFx(s);
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 text-[11px] text-white/55">Efecto de voz
                            <select className={`${inputCls} rounded-md px-2 !h-8 text-xs text-white [color-scheme:dark]`} value={s.fx ?? ""} disabled={locked}
                              onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, fx: e.target.value || null } : x)); touch(); }}>
                              <option className={OPTION_CLS} value="">Como el {s.characterKeys.length ? "personaje" : "narrador"} ({fxLabel(inheritedFx(s))})</option>
                              {VOICE_FX.map((f) => <option key={f.id} className={OPTION_CLS} value={f.id}>{f.label}</option>)}
                            </select>
                          </label>
                          {sug && sug.id !== current && (
                            <button type="button" disabled={locked} className={`${ghostBtn} !px-2 !py-0.5 !text-[11px]`} title={sug.reason}
                              onClick={() => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, fx: sug.id } : x)); touch(); }}>
                              <Sparkles className="h-3 w-3 text-blue-300" />Sugerido: {fxLabel(sug.id)} · {sug.reason}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    <div className="grid gap-2 sm:grid-cols-[190px_1fr_1fr]">
                      <label className="block space-y-1.5"><span className="hive-label--field">Gráfico</span>
                        <select className={`${inputCls} w-full rounded-md px-2 !h-9 text-xs text-white [color-scheme:dark]`} value={s.graphic.kind} disabled={locked}
                          onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, graphic: { ...x.graphic, kind: e.target.value as GraphicKind } } : x)); touch(); }}>
                          {(Object.keys(GRAPHIC_LABELS) as GraphicKind[]).map((k) => <option key={k} className={OPTION_CLS} value={k}>{GRAPHIC_LABELS[k]}</option>)}
                        </select></label>
                      {s.graphic.kind !== "none" && (
                        <>
                          <label className="block space-y-1.5"><span className="hive-label--field">{{ title: "Título", lower_third: "Nombre", stat: "Cifra", cta: "Llamada" }[s.graphic.kind]}</span>
                            <Input className={`${inputCls} !h-9`} value={s.graphic.text} maxLength={60} disabled={locked}
                              placeholder={{ title: "El gancho en pocas palabras", lower_third: "Ana García", stat: "73 %", cta: "Comenta tu caso" }[s.graphic.kind]}
                              onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, graphic: { ...x.graphic, text: e.target.value } } : x)); touch(); }} /></label>
                          {(s.graphic.kind === "lower_third" || s.graphic.kind === "stat") && (
                            <label className="block space-y-1.5"><span className="hive-label--field">{s.graphic.kind === "stat" ? "Qué significa" : "Cargo o rol"}</span>
                              <Input className={`${inputCls} !h-9`} value={s.graphic.sub} maxLength={60} disabled={locked}
                                onChange={(e) => { setScenes((ss) => ss.map((x) => x.key === s.key ? { ...x, graphic: { ...x.graphic, sub: e.target.value } } : x)); touch(); }} /></label>
                          )}
                        </>
                      )}
                    </div>
                    {characters.length > 0 && (
                      <div className="flex flex-wrap gap-3 text-xs text-white/50">
                        {characters.filter((c) => c.name.trim()).map((c) => (
                          <label key={c.key} className="flex items-center gap-1.5">
                            <input type="checkbox" className="accent-blue-500" checked={s.characterKeys.includes(c.key)} disabled={locked}
                              onChange={(e) => {
                                setScenes((ss) => ss.map((x) => x.key !== s.key ? x : {
                                  ...x, characterKeys: e.target.checked ? [...x.characterKeys, c.key].slice(0, 2) : x.characterKeys.filter((k) => k !== c.key),
                                }));
                                touch();
                              }} />
                            {c.name}
                          </label>
                        ))}
                      </div>
                    )}
                    {server?.error && <p className="text-xs text-red-300">{server.error}</p>}
                  </div>
                  <div className="flex w-24 shrink-0 flex-col gap-2">
                    {server?.look_artifact_id && !dirty && (
                      <div title="Imagen de la escena: tu rostro con el vestuario y la escenografía elegidos">
                        <AuthImage src={artifactUrl(server.look_artifact_id)} alt={`Imagen de la escena ${i + 1}`} className="aspect-[9/16] w-full rounded-md border border-white/10 object-cover" />
                      </div>
                    )}
                    {server?.artifact_id && !dirty && <AuthVideo src={artifactUrl(server.artifact_id)} className="w-full rounded-md border border-white/10" />}
                  </div>
                  <button className={`${ghostBtn} self-start`} disabled={locked} aria-label="Quitar escena"
                    onClick={() => { setScenes((ss) => ss.filter((x) => x.key !== s.key)); touch(); }}><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard step={4} title="Acabado: subtítulos, efectos y gráficos" hint="Se aplica al unir los clips: cambiarlo no cuesta nada ni vuelve a generar video.">
        <FinishSection identity={identity} setIdentity={(i) => { setIdentity(i); setStyle({ ...style, graphics: { ...style.graphics, accent: i.accent } }); touch(); }} style={style} setStyle={(v) => { setStyle(v); touch(); }} subtitles={project.subtitles} locked={locked} busy={!!busy} hasMusic={!!project.music}
          onToggleSubtitles={(on) => { void run("subs", async () => { onChange(await videoApi.update(project.id, { subtitles: on })); }); }} />
      </SectionCard>

      <SectionCard step={5} title="Costo y producción">
        <div ref={liveRef}><LiveProduction project={project} /></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="hive-stat"><div className="hive-stat__label">Por producir</div><div className="hive-stat__value">{pendingSeconds} s</div></div>
          <div className="hive-stat"><div className="hive-stat__label">Costo estimado</div><div className="hive-stat__value !text-blue-300">{usd(total)}</div></div>
          <div className="hive-stat"><div className="hive-stat__label">Gastado</div><div className="hive-stat__value">{usd(project.spent_usd)}</div></div>
          <div className="hive-stat"><div className="hive-stat__label">Voz ElevenLabs</div><div className="hive-stat__value">{dirty ? scenes.reduce((n, x) => n + x.dialogue.length, 0) : cost.dialogue_chars} car.</div></div>
        </div>
        {!dirty && (cost.looks_pending > 0 || cost.images_usd > 0) && (
          <p className="text-xs text-white/40">Incluye {cost.looks_pending} imagen(es) de escena ({usd(cost.images_usd)}): tu rostro con el vestuario y la escenografía de cada escena.</p>
        )}
        {(locked || project.scenes.length > 0) && (
          <div className="space-y-1.5">
            <Progress value={progress} className="h-2 bg-white/10 [&>div]:bg-blue-500" />
            <div className="text-xs text-white/40">{done} de {project.scenes.length} clips listos{locked ? " · produciendo, puede tardar uno o dos minutos por clip" : ""}</div>
          </div>
        )}
        {project.final_artifact_id && !dirty && cost.pending_scenes === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-emerald-300">Todos los clips están listos y el reel está terminado. Si cambias una escena, solo se vuelve a generar esa.</p>
            {style.music.enabled && !locked && (
              <div className="flex flex-wrap items-center gap-3">
                <button className={primaryBtn} onClick={addMusic} disabled={busy === "music"}>
                  {busy === "music" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {project.music ? "Rehacer la música" : "Agregar música de fondo"}
                </button>
                <span className="text-[11px] text-white/30">{project.music ? "Usa el estilo y volumen de «Acabado». " : "Este reel aún no tiene música. "}Cuesta ≈ US$0,08; los clips no se regeneran.</span>
              </div>
            )}
            {cost.redub_available > 0 && !locked && (
              <div className="flex flex-wrap items-center gap-3">
                <button className={primaryBtn} onClick={redub} disabled={busy === "redub"}>
                  {busy === "redub" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Rehacer la voz{cost.redub_stale > 0 ? ` (${cost.redub_stale} desactualizada${cost.redub_stale === 1 ? "" : "s"})` : ""}
                </button>
                <span className="text-[11px] text-white/30">Usa el clip original guardado: sin costo de video. {cost.redub_unavailable > 0 ? `${cost.redub_unavailable} escena(s) antiguas no se pueden rehacer sin volver a generarlas.` : ""}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button className={primaryBtn} onClick={approveAndProduce} disabled={!canProduce || over}>
              {busy === "produce" || locked ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {locked ? "Produciendo…" : joinOnly ? "Unir clips en el reel (sin costo)" : "Aprobar costo y producir"}
            </button>
            <span className="text-[11px] text-white/30">Modelo {status.video_model}. Los precios son aproximados; manda la factura de Google.</span>
          </div>
        )}
      </SectionCard>

      {project.final_artifact_id && (
        <SectionCard step={6} title="Reel terminado">
          {(() => {
            // Avisos de la última producción (p. ej. «no se pudo cambiar la voz»): se muestran aquí para que no pasen desapercibidos.
            const acts = project.activity;
            const lastStart = acts.map((a) => a.text).lastIndexOf(acts.slice().reverse().find((a) => a.text.startsWith("Empiezo a producir"))?.text ?? "\u0000");
            const warns = acts.slice(Math.max(0, lastStart)).filter((a) => a.kind === "warn").slice(-5);
            if (warns.length === 0) return null;
            return (
              <div className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-200"><AlertTriangle className="h-3.5 w-3.5" />Avisos de la producción</div>
                <ul className="space-y-1 text-xs leading-snug text-amber-100/80">{warns.map((w, i) => <li key={i}>{w.text}</li>)}</ul>
              </div>
            );
          })()}
          <div className="flex flex-wrap items-start gap-5">
            <div className="w-56"><AuthVideo src={artifactUrl(project.final_artifact_id)} className="w-full rounded-xl border border-white/10" /></div>
            <div className="min-w-0 flex-1 space-y-3 text-sm text-white/50">
              <p className="flex items-start gap-2"><FolderOpen className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-all">{project.final_path}</span></p>
              <button className={ghostBtn} onClick={async () => {
                const token = localStorage.getItem("hive-auth-token");
                const res = await fetch(artifactUrl(project.final_artifact_id!), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                const url = URL.createObjectURL(await res.blob());
                const a = document.createElement("a");
                a.href = url; a.download = `${project.title}.mp4`; a.click();
                URL.revokeObjectURL(url);
              }}><Download className="h-3.5 w-3.5" />Descargar</button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function VideoStudioPanel() {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, list, av] = await Promise.all([videoApi.status(), videoApi.list(), videoApi.avatars().catch(() => [] as Avatar[])]);
      setStatus(s); setProjects(list); setAvatars(av); setLoadError(false);
    } catch { setLoadError(true); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  // Sondeo: el Director de video prepara proyectos desde el chat y la producción avanza en segundo plano.
  const anyProducing = projects.some((p) => p.producing);
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, anyProducing ? 2000 : 8000);
    return () => clearInterval(t);
  }, [refresh, anyProducing]);

  const current = projects.find((p) => p.id === selected) ?? null;
  const upsert = useCallback((p: Project) => setProjects((ps) => ps.some((x) => x.id === p.id) ? ps.map((x) => x.id === p.id ? p : x) : [p, ...ps]), []);

  if (loadError && !status) return <div className="p-8 text-sm text-red-300">No se pudo cargar el estudio. Revisa que el gateway esté activo.</div>;
  if (!status) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-white/30" /></div>;

  return (
    <div className="flex h-full min-h-0 gap-4 overflow-hidden">
      <aside className="hive-card flex w-64 shrink-0 flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          <div className="hive-icon-wrap hive-icon-wrap--primary"><Clapperboard className="h-4 w-4" /></div>
          <div>
            <div className="hive-page-header__label">Gemini Omni</div>
            <h1 className="text-sm font-black uppercase tracking-tight text-white">Estudio de video</h1>
          </div>
        </div>
        <div className="p-3">
          <button className={`${primaryBtn} w-full justify-center !px-4`} onClick={() => setSelected("new")} disabled={!status.enabled}><Plus className="h-4 w-4" />Nuevo reel</button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {projects.map((p) => (
            <button key={p.id} onClick={() => setSelected(p.id)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${selected === p.id ? "border-blue-500/40 bg-blue-500/10" : "border-transparent hover:bg-white/5"}`}>
              <div className="flex items-center gap-2"><Film className="h-3.5 w-3.5 shrink-0 text-white/30" /><span className="truncate text-sm text-white/85">{p.title}</span></div>
              <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-[11px] text-white/35">
                {p.producing ? <><Loader2 className="h-3 w-3 shrink-0 animate-spin" /><span className="truncate">{p.phase?.label.replace(/^Escena (\d+) de (\d+) · /, "Esc. $1/$2 · ") ?? "produciendo"}</span></> : p.status === "done" ? <><CheckCircle2 className="h-3 w-3 text-emerald-400" />listo</> : p.status === "failed" ? "falló" : `${p.cost.total_seconds}/${p.target_seconds} s`}
              </div>
            </button>
          ))}
          {projects.length === 0 && <p className="px-3 py-4 text-xs text-white/30">Aún no hay reels.</p>}
        </div>
        <div className="space-y-1.5 border-t border-white/10 p-3 text-[11px] text-white/35">
          <div className="flex items-center gap-1.5"><span className={status.enabled ? "hive-status-dot--active" : "hive-status-dot--disabled"} />{status.enabled ? "Gemini conectado · Director de video activo" : "Gemini sin conectar"}</div>
          <div className="flex items-center gap-1.5"><span className={status.voice_enabled ? "hive-status-dot--active" : "hive-status-dot--disabled"} />{status.voice_enabled ? "ElevenLabs con clave guardada" : "ElevenLabs sin conectar"}</div>
          <div className="break-all text-white/25">Archivos en {status.folder}/imagenes y /videos</div>
        </div>
      </aside>
      <div data-testid="video-scroll" className="min-w-0 flex-1 overflow-y-auto">
        {!status.enabled ? <NotEnabled />
          : selected === "new" ? <NewProjectForm status={status} avatars={avatars} onAvatarsChange={() => void refresh()} onCreated={(p) => { upsert(p); setSelected(p.id); }} />
          : current ? <ProjectEditor key={current.id} project={current} status={status} avatars={avatars} onAvatarsChange={() => void refresh()} onChange={upsert} onDeleted={() => { setProjects((ps) => ps.filter((x) => x.id !== current.id)); setSelected(null); }} />
          : (
            <div className="hive-card mx-auto mt-24 max-w-md">
              <div className="hive-card-body space-y-4 p-8 text-center">
                <div className="hive-icon-wrap hive-icon-wrap--primary mx-auto"><Clapperboard className="h-5 w-5" /></div>
                <h2 className="text-lg font-bold text-white">Crea un reel con Gemini</h2>
                <p className="text-sm leading-relaxed text-white/50">Elige duración y formato, sube tu rostro de referencia y deja que el Director de video decida vestuario y escenografía. Produce los clips con Gemini Omni y ponles voz con ElevenLabs. Aquí revisas todo y apruebas el costo.</p>
                <button className={`${primaryBtn} mx-auto`} onClick={() => setSelected("new")}><Plus className="h-4 w-4" />Nuevo reel</button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
