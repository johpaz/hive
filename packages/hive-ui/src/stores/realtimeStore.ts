/**
 * Estado del modo de voz en tiempo real.
 *
 * Es un socket aparte del de chat (`/realtime` vs `/ws`) porque transporta audio
 * binario, no mensajes. El hilo de conversación, en cambio, es el mismo: el
 * servidor encola los turnos hablados en el lane del WebChat, así que lo que se
 * habla aparece también escrito en el chat.
 */

import { create } from "zustand";
import { getWsBaseUrl } from "@/lib/gateway-url";
import { RealtimeMic, RealtimePlayer, describeMicError, type SpectrumTap } from "@/lib/realtime/audio";
import { RealtimeCamera, describeCameraError } from "@/lib/realtime/camera";
import { RealtimeScreen, describeScreenError } from "@/lib/realtime/screen";
import { esAltavozAbierto } from "@/lib/realtime/dispositivos";

export type VoiceStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

export type MilestoneKind =
  | "delegated" | "worker_started" | "tool_call" | "tool_result"
  | "verified" | "failed" | "group_ready";

export interface VoiceTranscript {
  role: "user" | "assistant";
  text: string;
  at: number;
}

/** Un hito real del agent-loop, tal como lo emite la colmena. */
export interface VoiceMilestone {
  id: string;
  kind: MilestoneKind;
  status: string;
  label: string;
  detail: string | null;
  agent: string;
  at: number;
}

export interface VoiceUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface RealtimeState {
  status: VoiceStatus;
  error: string | null;
  model: string | null;
  voice: string | null;
  /** Momento en que se abrió la sesión, para el cronómetro. */
  startedAt: number | null;
  /** Transcripción viva de la conversación hablada. */
  transcripts: VoiceTranscript[];
  /** Lo que la colmena hizo por dentro, en orden. */
  milestones: VoiceMilestone[];
  /** Última función puente ejecutada, para pintar "trabajando en la colmena". */
  lastTool: string | null;
  /** true mientras hay trabajo delegado sin resolver. */
  working: boolean;
  usage: VoiceUsage;
  /** Ms entre el fin de tu frase y la primera sílaba de Bee. */
  latencyMs: number | null;
  /** La cámara está encendida: BIA ve lo que le muestras. */
  cameraOn: boolean;
  cameraError: string | null;
  /** Compartiendo pantalla: BIA ve lo que tienes delante. */
  screenOn: boolean;
  screenError: string | null;
  /**
   * Crea y despierta el contexto de audio. Hay que llamarla de forma síncrona
   * dentro del gesto del usuario, antes de cualquier tarea diferida.
   */
  prepararAudio: () => void;
  /** Cambia el dispositivo por el que se oye la voz, en caliente. */
  usarSalida: (id: string) => Promise<void>;
  /** Cambia el micrófono, en caliente: reabre la captura sin cortar la llamada. */
  usarEntrada: (id: string) => Promise<void>;
  /** Toca un tono corto por la salida elegida, para reconocerla de oído. */
  probarSalida: () => Promise<void>;
  /**
   * Manos libres. Con la voz saliendo por un altavoz abierto, el micrófono la
   * recoge y la colmena se contesta a sí misma; en ese modo no se le envía
   * micrófono mientras habla.
   */
  modoAltavoz: boolean;
  usarModoAltavoz: (activo: boolean) => void;
  /** true mientras manos libres tiene el micrófono callado. */
  micCallado: () => boolean;
  start: (sessionId: string, voice?: string, language?: string) => Promise<void>;
  stop: () => void;
  sendText: (text: string) => void;
  interrupt: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
}

/** El `<video>` de la cámara, para la vista previa. Fuera del estado: es un nodo DOM. */
export function getCameraElement(): HTMLVideoElement | null {
  return camera?.element ?? null;
}

/** Ídem para la pantalla compartida. */
export function getScreenElement(): HTMLVideoElement | null {
  return screen?.element ?? null;
}

/** Acceso a los analizadores para el visualizador; fuera del estado de React. */
export function getSpectrumTaps(): { mic: SpectrumTap | null; player: SpectrumTap | null } {
  return { mic: mic?.spectrum ?? null, player: player?.spectrum ?? null };
}

let ws: WebSocket | null = null;
let mic: RealtimeMic | null = null;
let player: RealtimePlayer | null = null;
let camera: RealtimeCamera | null = null;
let screen: RealtimeScreen | null = null;

/** Voces de Gemini Live, con el carácter de cada una para poder elegir a oído. */
export const VOCES = [
  { id: "Kore", nombre: "Kore", nota: "Femenina, firme" },
  { id: "Aoede", nombre: "Aoede", nota: "Femenina, cálida" },
  { id: "Leda", nombre: "Leda", nota: "Femenina, juvenil" },
  { id: "Zephyr", nombre: "Zephyr", nota: "Femenina, luminosa" },
  { id: "Autonoe", nombre: "Autonoe", nota: "Femenina, serena" },
  { id: "Despina", nombre: "Despina", nota: "Femenina, suave" },
  { id: "Puck", nombre: "Puck", nota: "Masculina, animada" },
  { id: "Charon", nombre: "Charon", nota: "Masculina, grave" },
  { id: "Fenrir", nombre: "Fenrir", nota: "Masculina, enérgica" },
  { id: "Orus", nombre: "Orus", nota: "Masculina, neutra" },
] as const;

/** Idiomas con acento regional. El primero es el que se usa por defecto. */
export const IDIOMAS = [
  { id: "es-CO", nombre: "Español (Colombia)" },
  { id: "es-MX", nombre: "Español (México)" },
  { id: "es-AR", nombre: "Español (Argentina)" },
  { id: "es-ES", nombre: "Español (España)" },
  { id: "es-US", nombre: "Español (EE. UU.)" },
  { id: "en-US", nombre: "Inglés (EE. UU.)" },
  { id: "pt-BR", nombre: "Portugués (Brasil)" },
] as const;

/** Figura de BIA: el render fotográfico con relieve o la malla 3D. */
export const AVATARES = [
  { id: "foto", nombre: "Retrato (mejor acabado)" },
  { id: "modelo", nombre: "Modelo 3D (se gira con el ratón)" },
] as const;

export type AvatarKind = (typeof AVATARES)[number]["id"];

const PREF_AVATAR = "hive-voice-avatar";
const PREF_VOZ = "hive-voice-persona";
const PREF_IDIOMA = "hive-voice-language";
const PREF_SALIDA = "hive-voice-output";
const PREF_ENTRADA = "hive-voice-input";
const PREF_ALTAVOZ = "hive-voice-speaker";

/** Preferencias de la voz: viven en el navegador porque son de esta máquina. */
export interface VoicePrefs {
  voice: string;
  language: string;
  /** Salida elegida; vacío = la que diga el sistema. */
  output: string;
  /** Micrófono elegido; vacío = el que diga el sistema. */
  input: string;
  /** Manos libres: no se envía micrófono mientras la colmena habla. */
  speaker: boolean;
}

export function loadVoicePrefs(): VoicePrefs {
  if (typeof localStorage === "undefined") {
    return { voice: VOCES[0].id, language: IDIOMAS[0].id, output: "", input: "", speaker: false };
  }
  return {
    voice: localStorage.getItem(PREF_VOZ) || VOCES[0].id,
    language: localStorage.getItem(PREF_IDIOMA) || IDIOMAS[0].id,
    // Vacío significa "el que diga el sistema", que es lo razonable por defecto.
    output: localStorage.getItem(PREF_SALIDA) || "",
    input: localStorage.getItem(PREF_ENTRADA) || "",
    speaker: localStorage.getItem(PREF_ALTAVOZ) === "1",
  };
}

export function saveVoicePrefs(prefs: Partial<VoicePrefs>): void {
  if (typeof localStorage === "undefined") return;
  if (prefs.voice) localStorage.setItem(PREF_VOZ, prefs.voice);
  if (prefs.language) localStorage.setItem(PREF_IDIOMA, prefs.language);
  guardarDispositivo(PREF_SALIDA, prefs.output);
  guardarDispositivo(PREF_ENTRADA, prefs.input);
  if (prefs.speaker !== undefined) localStorage.setItem(PREF_ALTAVOZ, prefs.speaker ? "1" : "0");
}

/** Un dispositivo vacío no es "sin valor": es "el predeterminado del sistema". */
function guardarDispositivo(clave: string, valor: string | undefined): void {
  if (valor === undefined) return;
  if (valor) localStorage.setItem(clave, valor);
  else localStorage.removeItem(clave);
}

/** El avatar no toca la sesión Live: se cambia sin reconectar. */
export function loadAvatarPref(): AvatarKind {
  if (typeof localStorage === "undefined") return "modelo";
  const guardado = localStorage.getItem(PREF_AVATAR);
  return guardado === "foto" || guardado === "modelo" ? guardado : "modelo";
}

export function saveAvatarPref(kind: AvatarKind): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(PREF_AVATAR, kind);
}

function buildRealtimeUrl(
  sessionId: string,
  voice?: string,
  language?: string,
  modoAltavoz?: boolean,
): string {
  const url = new URL(`${getWsBaseUrl()}/realtime`);
  url.searchParams.set("session", sessionId);
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("hive-auth-token") : null;
  if (token) url.searchParams.set("token", token);
  if (voice) url.searchParams.set("voice", voice);
  if (language) url.searchParams.set("lang", language);
  if (modoAltavoz) url.searchParams.set("altavoz", "1");
  return url.toString();
}

const EMPTY_USAGE: VoiceUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** Marca de tiempo del fin de tu última frase, para medir cuánto tarda en contestar. */
let lastUserSpeechAt = 0;

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  status: "idle",
  error: null,
  model: null,
  voice: null,
  startedAt: null,
  transcripts: [],
  milestones: [],
  lastTool: null,
  working: false,
  usage: EMPTY_USAGE,
  latencyMs: null,
  cameraOn: false,
  cameraError: null,
  screenOn: false,
  screenError: null,
  modoAltavoz: loadVoicePrefs().speaker,

  toggleCamera: async () => {
    if (camera) {
      camera.stop();
      camera = null;
      set({ cameraOn: false, cameraError: null });
      return;
    }
    try {
      const cam = new RealtimeCamera((data, mimeType) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "video", data, mimeType }));
        }
      });
      await cam.start();
      camera = cam;
      set({ cameraOn: true, cameraError: null });
    } catch (error) {
      camera = null;
      set({ cameraOn: false, cameraError: describeCameraError(error) });
    }
  },

  toggleScreen: async () => {
    if (screen) {
      screen.stop();
      screen = null;
      set({ screenOn: false, screenError: null });
      return;
    }
    try {
      const compartida = new RealtimeScreen(
        (data, mimeType) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "video", data, mimeType, source: "screen" }));
          }
        },
        // El usuario puede cortar desde el chip del propio navegador, fuera de
        // esta interfaz: sin este aviso el botón se quedaría encendido.
        () => {
          screen = null;
          set({ screenOn: false });
        },
      );
      await compartida.start();
      screen = compartida;
      set({ screenOn: true, screenError: null });
    } catch (error) {
      screen = null;
      set({ screenOn: false, screenError: describeScreenError(error) });
    }
  },

  prepararAudio: () => {
    // WebKit exige activación reciente del usuario: si el AudioContext nace en
    // una tarea diferida —la View Transition del botón, un setTimeout— queda en
    // estado "interrupted" y la voz de la colmena no suena. Chrome no distingue
    // ese caso, por eso el fallo solo aparecía en la app de escritorio.
    if (!player) {
      player = new RealtimePlayer();
      player.onIdle = () => {
        if (get().status === "speaking") set({ status: "listening" });
      };
    }
    void player.resume();
  },

  usarModoAltavoz: (activo) => {
    saveVoicePrefs({ speaker: activo });
    set({ modoAltavoz: activo });
  },

  /** ¿Está callado el micrófono ahora mismo por manos libres? Para la interfaz. */
  micCallado: () => get().modoAltavoz && !!player?.estaHablando(),

  usarSalida: async (id) => {
    saveVoicePrefs({ output: id });
    // Elegir un televisor o unos bafles enciende el modo altavoz solo; volver a
    // auriculares lo apaga. Sigue siendo una casilla: la última palabra es de
    // quien escucha, que sabe si el aparato le queda cerca o lejos.
    if (id) get().usarModoAltavoz(esAltavozAbierto(id));
    await player?.usarSalida(id || null);
  },

  /**
   * El micrófono sí se puede cambiar sin colgar: la sesión Live sólo ve el PCM
   * que le llega, le da igual de qué aparato salga. Se reabre la captura y el
   * socket sigue como estaba.
   */
  usarEntrada: async (id) => {
    saveVoicePrefs({ input: id });
    if (!mic) return;
    mic.stop();
    const nuevo = new RealtimeMic((pcm) => {
      if (get().modoAltavoz && player?.estaHablando()) return;
      if (ws?.readyState === WebSocket.OPEN) ws.send(pcm);
    }, id || null);
    mic = nuevo;
    try {
      await nuevo.start();
    } catch (error) {
      mic = null;
      set({ status: "error", error: describeMicError(error) });
    }
  },

  probarSalida: async () => {
    // Hay que pasar por prepararAudio: el tono nace del clic y WebKit sólo
    // deja sonar un contexto creado dentro del gesto.
    get().prepararAudio();
    const prefs = loadVoicePrefs();
    if (prefs.output) void player?.usarSalida(prefs.output);
    await player?.probar();
  },

  start: async (sessionId, voice, language) => {
    if (get().status !== "idle" && get().status !== "error") return;
    set({
      status: "connecting",
      error: null,
      transcripts: [],
      milestones: [],
      lastTool: null,
      working: false,
      usage: EMPTY_USAGE,
      latencyMs: null,
      startedAt: Date.now(),
    });

    // El contexto de audio debería venir ya creado desde el gesto del usuario
    // que pulsó el botón (prepararAudio). Si no, se crea aquí y WebKit puede
    // dejarlo interrumpido; el vigilante de statechange lo rescata.
    get().prepararAudio();
    const prefs = loadVoicePrefs();
    if (prefs.output) void player?.usarSalida(prefs.output);

    try {
      await player?.resume();

      if (!window.isSecureContext) {
        throw new Error("El micrófono necesita una conexión segura (https o localhost).");
      }

      mic = new RealtimeMic((pcm) => {
        // Manos libres: mientras suena su voz, lo que entra por el micrófono
        // es ella misma rebotando en la sala. Enviarlo es pedirle que se
        // interrumpa sola. El plazo lo lleva el reproductor con reloj de pared
        // —ver `estaHablando()`—: cualquier señal basada en estado podría
        // quedarse trabada y dejar el micrófono mudo el resto de la llamada.
        if (get().modoAltavoz && player?.estaHablando()) return;
        if (ws?.readyState === WebSocket.OPEN) ws.send(pcm);
      }, prefs.input || null);
      await mic.start();
    } catch (error) {
      get().stop();
      set({ status: "error", error: describeMicError(error) });
      return;
    }

    ws = new WebSocket(
      buildRealtimeUrl(
        sessionId,
        voice ?? prefs.voice,
        language ?? prefs.language,
        get().modoAltavoz,
      ),
    );
    ws.binaryType = "arraybuffer";

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        player?.enqueue(event.data);
        if (get().status === "listening") {
          // Primera sílaba de la respuesta: cierra la medición de latencia.
          const latency = lastUserSpeechAt ? Date.now() - lastUserSpeechAt : null;
          lastUserSpeechAt = 0;
          set(latency ? { status: "speaking", latencyMs: latency } : { status: "speaking" });
        }
        return;
      }
      let frame: any;
      try {
        frame = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (frame.type) {
        case "ready":
          set({ status: "listening", model: frame.model, voice: frame.voice });
          break;
        case "transcript":
          if (frame.role === "user") lastUserSpeechAt = Date.now();
          set((state) => ({ transcripts: appendTranscript(state.transcripts, frame.role, frame.text) }));
          break;
        case "narration":
          set((state) => ({
            milestones: [
              ...state.milestones,
              {
                id: `${frame.at}-${state.milestones.length}`,
                kind: frame.kind,
                status: frame.status,
                label: frame.label,
                detail: frame.detail ?? null,
                agent: frame.agent ?? "",
                at: frame.at,
              },
            ].slice(-60),
            // group_ready es el fan-in: la colmena terminó de delegar.
            working: frame.kind !== "group_ready" && frame.kind !== "failed",
          }));
          break;
        case "usage":
          set({
            usage: {
              inputTokens: frame.inputTokens,
              outputTokens: frame.outputTokens,
              totalTokens: frame.totalTokens,
            },
          });
          break;
        case "interrupted":
          player?.interrupt();
          set({ status: "listening" });
          break;
        case "turn_complete":
          if (!player?.isSpeaking) set({ status: "listening" });
          break;
        case "tool":
          set({ lastTool: frame.name, working: frame.name === "consultar_a_bee" });
          break;
        case "error":
          set({ status: "error", error: frame.error });
          break;
        case "closed":
          get().stop();
          break;
      }
    };

    ws.onerror = () => set({ status: "error", error: "Se perdió la conexión con la voz." });
    ws.onclose = () => {
      if (get().status !== "error") get().stop();
    };
  },

  stop: () => {
    mic?.stop();
    player?.stop();
    camera?.stop();
    camera = null;
    screen?.stop();
    screen = null;
    try {
      ws?.close();
    } catch {
      /* ya estaba cerrado */
    }
    mic = null;
    player = null;
    ws = null;
    lastUserSpeechAt = 0;
    set({
      status: "idle", model: null, voice: null, lastTool: null,
      working: false, startedAt: null, cameraOn: false, cameraError: null,
      screenOn: false, screenError: null,
    });
  },

  sendText: (text) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "text", content: text }));
  },

  interrupt: () => {
    player?.interrupt();
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "interrupt" }));
  },
}));

/**
 * Las transcripciones llegan en fragmentos: se pegan al último turno del mismo
 * hablante en vez de crear una línea por sílaba.
 */
function appendTranscript(
  current: VoiceTranscript[],
  role: "user" | "assistant",
  text: string,
): VoiceTranscript[] {
  const last = current[current.length - 1];
  if (last && last.role === role) {
    const updated = [...current];
    updated[updated.length - 1] = { ...last, text: last.text + text };
    return updated;
  }
  return [...current, { role, text, at: Date.now() }].slice(-40);
}
