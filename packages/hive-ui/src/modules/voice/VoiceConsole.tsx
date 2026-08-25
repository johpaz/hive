/**
 * BIA — la voz de Hive.
 *
 * La interfaz es una capa flotante sobre la escena 3D, igual que la Oficina 3D:
 * el escenario ocupa toda la pantalla y los paneles se apoyan encima, se colapsan
 * y no roban clics. Todo lo que muestran son datos reales de la sesión — el
 * espectro sale de los analizadores de audio, los hitos los emite el agent-loop
 * y los tokens los reporta el proveedor. Si el panal se enciende, hay un
 * especialista ejecutando algo.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Loader2,
  Mic,
  PanelRightClose,
  PhoneOff,
  Settings2,
  Video,
  VideoOff,
  Crosshair,
  Monitor,
  MonitorOff,
} from "lucide-react";
import {
  useRealtimeStore,
  loadVoicePrefs,
  saveVoicePrefs,
  IDIOMAS,
  VOCES,
  AVATARES,
  loadAvatarPref,
  saveAvatarPref,
  type AvatarKind,
  type MilestoneKind,
  type VoiceMilestone,
} from "@/stores/realtimeStore";
import { useUserStore } from "@/stores/userStore";
import { VoiceStage } from "./scene/VoiceStage";
import { CameraPreview } from "./CameraPreview";
import { AudioSettings } from "./AudioSettings";
import type { SceneControlsHandle } from "./scene/SceneControls";
import type { BiaState } from "./scene/BiaPortrait";
import "./voice.css";

/**
 * Precio de gemini-3.1-flash-live por millón de tokens de audio (USD), el mismo
 * que lleva la fila del catálogo en storage/seed.ts. Se calcula en el cliente
 * porque el proveedor reporta tokens, no dinero.
 */
const USD_PER_1M_IN = 3;
const USD_PER_1M_OUT = 12;

/** Cuánto dura en pantalla un aviso de éxito o de fallo. */
const AVISO_MS = 4_000;

const MARKS: Record<MilestoneKind, { glyph: string; tone: string; title: string }> = {
  delegated: { glyph: "→", tone: "vx--working", title: "Delegado" },
  worker_started: { glyph: "▶", tone: "vx--working", title: "Especialista" },
  tool_call: { glyph: "·", tone: "vx--idle", title: "Herramienta" },
  tool_result: { glyph: "·", tone: "vx--idle", title: "Resultado" },
  verified: { glyph: "✓", tone: "vx--listening", title: "Verificado" },
  failed: { glyph: "!", tone: "vx--error", title: "Falló" },
  group_ready: { glyph: "◆", tone: "vx--speaking", title: "Listo" },
};

function useElapsed(startedAt: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return "—";
  const total = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Éxito y alerta son destellos: se muestran un momento y se apagan solos. */
function useAviso(milestones: VoiceMilestone[], error: string | null): "exito" | "alerta" | null {
  const [aviso, setAviso] = useState<"exito" | "alerta" | null>(null);
  const ultimo = milestones[milestones.length - 1];

  useEffect(() => {
    if (error) {
      setAviso("alerta");
      const id = setTimeout(() => setAviso(null), AVISO_MS);
      return () => clearTimeout(id);
    }
  }, [error]);

  useEffect(() => {
    if (!ultimo) return;
    const tipo =
      ultimo.kind === "failed"
        ? "alerta"
        : ultimo.kind === "verified" || ultimo.kind === "group_ready"
          ? "exito"
          : null;
    if (!tipo) return;
    setAviso(tipo);
    const id = setTimeout(() => setAviso(null), AVISO_MS);
    return () => clearTimeout(id);
  }, [ultimo?.id]);

  return aviso;
}

export function VoiceConsole() {
  const currentUser = useUserStore((s) => s.currentUser);
  const sessionId = currentUser?.id || "default";

  const fetchUser = useUserStore((s) => s.fetchUser);
  // El avatar de HiveLive se llama BIA y punto. Antes tomaba el nombre del
  // coordinador que hubiera en la BD, y la misma figura se presentaba con un
  // nombre distinto en cada instalación mientras la escena, la documentación y
  // su propia voz seguían diciendo BIA. El nombre del coordinador es de la
  // colmena y vive en el chat; éste es el de la voz.
  const agentName = "BIA";

  useEffect(() => {
    if (!currentUser) fetchUser();
  }, []);

  const status = useRealtimeStore((s) => s.status);
  const error = useRealtimeStore((s) => s.error);
  const model = useRealtimeStore((s) => s.model);
  const voice = useRealtimeStore((s) => s.voice);
  const startedAt = useRealtimeStore((s) => s.startedAt);
  const transcripts = useRealtimeStore((s) => s.transcripts);
  const milestones = useRealtimeStore((s) => s.milestones);
  const working = useRealtimeStore((s) => s.working);
  const usage = useRealtimeStore((s) => s.usage);
  const latencyMs = useRealtimeStore((s) => s.latencyMs);
  const cameraOn = useRealtimeStore((s) => s.cameraOn);
  const cameraError = useRealtimeStore((s) => s.cameraError);
  const screenOn = useRealtimeStore((s) => s.screenOn);
  const screenError = useRealtimeStore((s) => s.screenError);
  const prepararAudio = useRealtimeStore((s) => s.prepararAudio);
  const usarSalida = useRealtimeStore((s) => s.usarSalida);
  const usarEntrada = useRealtimeStore((s) => s.usarEntrada);
  const start = useRealtimeStore((s) => s.start);
  const stop = useRealtimeStore((s) => s.stop);
  const toggleCamera = useRealtimeStore((s) => s.toggleCamera);
  const toggleScreen = useRealtimeStore((s) => s.toggleScreen);

  const [panelAbierto, setPanelAbierto] = useState(true);
  // Mientras nadie toque la escena, la cámara deriva sola; al primer
  // arrastre pasa a control manual y aparece el botón de recentrar.
  const [vistaLibre, setVistaLibre] = useState(false);
  const controlsRef = useRef<SceneControlsHandle>(null);
  const [prefs, setPrefs] = useState(() => loadVoicePrefs());
  const [audioAbierto, setAudioAbierto] = useState(false);
  // El avatar no toca la sesión Live: cambia al vuelo, sin reconectar.
  const [avatar, setAvatar] = useState<AvatarKind>(() => loadAvatarPref());

  const live = status !== "idle" && status !== "error";
  const connecting = status === "connecting";

  /**
   * Voz e idioma se fijan al abrir la sesión Live y no se pueden cambiar en
   * caliente. Si hay llamada en curso se reabre sola: sin esto, mover el
   * selector no producía ningún efecto audible y parecía que estuviera roto.
   */
  const cambiarPref = (cambio: { voice?: string; language?: string }) => {
    const siguiente = { ...prefs, ...cambio };
    setPrefs(siguiente);
    saveVoicePrefs(cambio);
    if (live) {
      stop();
      // El contexto nuevo tiene que nacer aquí, dentro del gesto: cuando se
      // dispare el setTimeout WebKit ya no lo cuenta como activación.
      prepararAudio();
      setTimeout(() => void start(sessionId, siguiente.voice, siguiente.language), 350);
    }
  };
  const elapsed = useElapsed(startedAt);
  const aviso = useAviso(milestones, error);

  const baseState: BiaState = aviso ?? (!live ? "reposo" : working ? "procesando" : "reposo");

  const transcriptRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Autoscroll sólo si el usuario no se fue a leer hacia arriba.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcripts]);

  useEffect(() => {
    const el = timelineRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
      el.scrollTop = el.scrollHeight;
    }
  }, [milestones]);

  const cost = useMemo(
    () =>
      (usage.inputTokens / 1_000_000) * USD_PER_1M_IN +
      (usage.outputTokens / 1_000_000) * USD_PER_1M_OUT,
    [usage],
  );

  const specialists = useMemo(() => {
    const set = new Set<string>();
    for (const m of milestones) {
      if ((m.kind === "delegated" || m.kind === "worker_started") && m.agent) set.add(m.agent);
    }
    return set;
  }, [milestones]);

  const tone = working
    ? "vx--working"
    : status === "speaking"
      ? "vx--speaking"
      : status === "listening"
        ? "vx--listening"
        : status === "error"
          ? "vx--error"
          : "vx--idle";

  const stateLabel = connecting
    ? "Abriendo"
    : working
      ? "La colmena trabaja"
      : status === "speaking"
        ? `${agentName} habla`
        : status === "listening"
          ? "Escuchando"
          : status === "error"
            ? "Error"
            : "En reposo";

  const toggle = () => {
    // View Transitions: pasar de reposo a llamada es un cambio de modo y conviene
    // que se lea como tal, en vez de aparecer de golpe.
    // La View Transition ejecuta su callback en otra tarea, así que el audio se
    // prepara antes: para WebKit, dentro de la transición ya no hay gesto.
    if (!live) prepararAudio();
    const run = () => (live ? stop() : void start(sessionId));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof document.startViewTransition === "function" && !reduce) {
      document.startViewTransition(run);
    } else {
      run();
    }
  };

  return (
    <div className="vx">
      <VoiceStage
        className="vx__canvas"
        live={live}
        working={working}
        baseState={baseState}
        onTomarControl={() => setVistaLibre(true)}
        controlsRef={controlsRef}
        avatar={avatar}
      />

      {/* Capa flotante: no roba clics salvo en sus controles. */}
      <div className="vx__hud">
        <CameraPreview activa={cameraOn} fuente="camera" />
        <CameraPreview activa={screenOn} fuente="screen" />
        <header className="vx__head vx__glass">
          <div>
            <p className="vx__title">HiveLive</p>
            <h1 className="vx__subtitle">
              {agentName} — la voz de Hive, coordinando tu enjambre de agentes
            </h1>
          </div>
          <div className={`vx__state ${tone}`}>
            <span className="vx__dot" />
            {stateLabel}
          </div>
          {live && model ? (
            <span className="vx__state-detail">{shortModel(model)} · {voice ?? "—"}</span>
          ) : null}
        </header>

        {/* ── Controles de llamada ─────────────────────────────────────── */}
        <div className="vx__dock">
          <div className="vx__dock-row">
            <button
              className="vx__call"
              data-live={live}
              onClick={toggle}
              disabled={connecting}
              aria-label={live ? "Colgar" : `Hablar con ${agentName}`}
            >
              {connecting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : live ? (
                <PhoneOff className="h-6 w-6" />
              ) : (
                <Mic className="h-6 w-6" />
              )}
            </button>

            <button
              className={`vx__aux ${cameraOn ? "is-on" : ""}`}
              onClick={() => void toggleCamera()}
              disabled={!live}
              title={
                cameraOn
                  ? "Apagar la cámara"
                  : `Darle vista a ${agentName} (acorta la sesión y sube el consumo)`
              }
              aria-label={cameraOn ? "Apagar la cámara" : "Encender la cámara"}
            >
              {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>

            <button
              className={`vx__aux ${screenOn ? "is-on" : ""}`}
              onClick={() => void toggleScreen()}
              disabled={!live}
              title={
                screenOn
                  ? "Dejar de compartir la pantalla"
                  : `Mostrarle tu pantalla a ${agentName} para que la comente`
              }
              aria-label={screenOn ? "Dejar de compartir la pantalla" : "Compartir la pantalla"}
            >
              {screenOn ? <Monitor className="h-4 w-4" /> : <MonitorOff className="h-4 w-4" />}
            </button>

            <button
              className={`vx__aux ${audioAbierto ? "is-on" : ""}`}
              data-audio-toggle=""
              onClick={() => setAudioAbierto((v) => !v)}
              title="Elegir micrófono y salida de sonido"
              aria-label="Micrófono y sonido"
              aria-expanded={audioAbierto}
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>

          <AudioSettings
            abierto={audioAbierto}
            onCerrar={() => setAudioAbierto(false)}
            enVivo={live}
            entrada={prefs.input}
            salida={prefs.output}
            onEntrada={(input) => {
              setPrefs({ ...prefs, input });
              void usarEntrada(input);
            }}
            onSalida={(output) => {
              setPrefs({ ...prefs, output });
              void usarSalida(output);
            }}
          />

          <p className="vx__hint">
            {live
              ? `Interrumpe cuando quieras: ${agentName} se calla y te escucha. Lo que resuelva queda también escrito en el chat.`
              : `${agentName} coordina la colmena entera mientras hablas. Pídele lo mismo que le pedirías por escrito.`}
          </p>
          {cameraError ? <p className="vx__warn">{cameraError}</p> : null}
          {screenError ? <p className="vx__warn">{screenError}</p> : null}
          {error ? <p className="vx__warn">{error}</p> : null}
        </div>

        {/* ── Transcripción ────────────────────────────────────────────── */}
        <div className="vx__transcript vx__glass" ref={transcriptRef}>
          {transcripts.length === 0 ? (
            <p className="vx__empty">
              {live ? "Di algo para empezar." : "La transcripción aparece aquí mientras hablas."}
            </p>
          ) : (
            transcripts.map((line, i) => (
              <p key={`${line.at}-${i}`} className={`vx__line vx__line--${line.role}`}>
                <span className="vx__who">{line.role === "user" ? "Tú" : agentName}</span>
                <span className="vx__said">{line.text}</span>
              </p>
            ))
          )}
        </div>

        {vistaLibre ? (
          <button
            className="vx__recenter"
            onClick={() => {
              controlsRef.current?.recentrar();
              setVistaLibre(false);
            }}
          >
            <Crosshair className="h-3 w-3" />
            Recentrar vista
          </button>
        ) : null}

        {/* ── Panel de instrumentos, flotante y colapsable ─────────────── */}
        <aside className={`vx__rail vx__glass ${panelAbierto ? "" : "is-collapsed"}`}>
          <div className="vx__rail-head">
            <button
              className="vx__rail-toggle"
              onClick={() => setPanelAbierto((v) => !v)}
              aria-label={panelAbierto ? "Ocultar panel" : "Mostrar panel"}
              aria-expanded={panelAbierto}
            >
              {panelAbierto ? <PanelRightClose className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rotate-180" />}
            </button>
            {panelAbierto ? <span className="vx__rail-title">Telemetría</span> : null}
          </div>

          <div className="vx__rail-body">
            <div className="vx__gauges">
              <Gauge label="Sesión" value={elapsed} />
              <Gauge
                label="Latencia"
                value={latencyMs ? String(Math.round(latencyMs)) : "—"}
                unit={latencyMs ? "ms" : undefined}
              />
              <Gauge label="Tokens" value={usage.totalTokens ? compactNumber(usage.totalTokens) : "—"} />
              <Gauge label="Costo" value={cost > 0 ? `$${cost.toFixed(4)}` : "—"} />
            </div>

            <div className="vx__gauges">
              <Gauge label="Modelo" value={model ? shortModel(model) : "—"} small />
              <Gauge label="Voz activa" value={voice ?? "—"} small />
              <Gauge label="Especialistas" value={specialists.size ? String(specialists.size) : "—"} small />
              <Gauge
                label="Visión"
                value={screenOn ? "pantalla" : cameraOn ? "cámara" : "off"}
                small
              />
            </div>

            {/* Voz e idioma: se aplican al abrir la próxima llamada. */}
            <div className="vx__prefs">
              <label className="vx__pref">
                <span className="vx__pref-label">Avatar</span>
                <select
                  className="vx__select"
                  value={avatar}
                  onChange={(e) => {
                    const kind = e.target.value as AvatarKind;
                    setAvatar(kind);
                    saveAvatarPref(kind);
                  }}
                >
                  {AVATARES.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label className="vx__pref">
                <span className="vx__pref-label">Voz</span>
                <select
                  className="vx__select"
                  value={prefs.voice}
                  onChange={(e) => cambiarPref({ voice: e.target.value })}
                >
                  {VOCES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nombre} — {v.nota}
                    </option>
                  ))}
                </select>
              </label>

              <label className="vx__pref">
                <span className="vx__pref-label">Idioma y acento</span>
                <select
                  className="vx__select"
                  value={prefs.language}
                  onChange={(e) => cambiarPref({ language: e.target.value })}
                >
                  {IDIOMAS.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombre}
                    </option>
                  ))}
                </select>
              </label>
              {live ? (
                <p className="vx__pref-note">Se aplica en la próxima llamada.</p>
              ) : null}
            </div>

            <div className="vx__timeline" ref={timelineRef}>
              <p className="vx__timeline-head">Actividad de la colmena</p>
              {milestones.length === 0 ? (
                <p className="vx__empty">
                  Cuando {agentName} delegue trabajo verás aquí cada paso: qué especialista lo tomó, qué
                  herramienta usó y si quedó verificado.
                </p>
              ) : (
                milestones.map((event) => <Event key={event.id} event={event} />)
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Gauge({ label, value, unit, small }: { label: string; value: string; unit?: string; small?: boolean }) {
  return (
    <div className="vx__gauge">
      <div className="vx__gauge-label">{label}</div>
      <div className="vx__gauge-value" style={small ? { fontSize: "0.86rem", letterSpacing: 0 } : undefined}>
        {value}
        {unit ? <span className="vx__gauge-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function Event({ event }: { event: VoiceMilestone }) {
  const mark = MARKS[event.kind] ?? MARKS.tool_call;
  const time = new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="vx__event">
      <span className={`vx__event-mark ${mark.tone}`}>{mark.glyph}</span>
      <div>
        <div className="vx__event-label">{event.label}</div>
        <div className="vx__event-meta">
          {mark.title}
          {event.agent ? ` · ${event.agent}` : ""} · {time}
        </div>
      </div>
    </div>
  );
}

function compactNumber(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Los ids de modelo son largos; en un instrumento importa la familia. */
function shortModel(id: string): string {
  return id.replace(/^models\//, "").replace(/-preview$/, "").replace(/^gemini-/, "");
}
