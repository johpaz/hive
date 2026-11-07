/**
 * Motor de medios nativo: micrófono y altavoz por el módulo Rust (`hive-media`)
 * de la app de escritorio, en vez de WebAudio.
 *
 * Existe porque el motor del escritorio en Linux (WebKitGTK) no permite elegir
 * la salida, deja el contexto de audio en `interrupted` y no respeta la
 * frecuencia pedida; todo eso se resuelve del lado nativo. A cambio, el audio
 * ya no pasa por un nodo de WebAudio, así que lo que necesita ese nodo —el
 * espectro y los visemas— se obtiene de una copia del mismo PCM que se analiza
 * en un contexto mudo (`PcmAnalyser`).
 *
 * Cámara y pantalla también van por el módulo nativo (`NativeCapture`).
 */

import { SpectrumTap } from "@/lib/realtime/audio";
import type { DispositivoAudio, Salidas } from "@/lib/realtime/dispositivos";
import type {
  CapturePort,
  FrameSink,
  LipsyncSource,
  MediaEngine,
  MicPort,
  PlayerPort,
} from "@/lib/realtime/engine/types";
import { webMediaEngine } from "@/lib/realtime/engine/web";

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;
/** Mismos plazos que `RealtimePlayer`: ver los comentarios allí. */
const COLA_MS = 700;
const TOPE_MS = 4_000;

/** Primer byte de cada mensaje de vídeo. Los mismos valores que `hive_media::video`. */
const TAG_MODEL = 0;
const TAG_PREVIEW = 1;
const TAG_ENDED = 2;

/** Lo que usamos de `@tauri-apps/api/core`, inyectable para las pruebas. */
export interface TauriCore {
  invoke: <T = unknown>(cmd: string, args?: unknown) => Promise<T>;
  Channel: new <T = unknown>() => { onmessage: (message: T) => void };
}

interface FalloNativo {
  kind?: string;
  message?: string;
}

interface DispositivoNativo {
  id: string;
  nombre: string;
  porDefecto: boolean;
}

/** Los comandos devuelven `{kind, message}`; un error de Tauri puede ser texto suelto. */
function comoFallo(error: unknown): FalloNativo {
  if (error && typeof error === "object") return error as FalloNativo;
  return { kind: "other", message: String(error) };
}

function describirFallo(error: unknown, cosa: "micrófono" | "salida de audio"): string {
  const { kind, message } = comoFallo(error);
  switch (kind) {
    case "permission_denied":
      return `El sistema negó el acceso al ${cosa}. Concédelo en los ajustes de privacidad y vuelve a intentar.`;
    case "busy":
      return `Otra aplicación está usando el ${cosa}.`;
    case "no_device":
      return cosa === "micrófono"
        ? "No se encontró ningún micrófono conectado."
        : "No se encontró ninguna salida de audio.";
    default:
      return `No se pudo abrir el ${cosa}: ${message ?? "error desconocido"}`;
  }
}

/**
 * Un solo contexto de análisis para toda la aplicación.
 *
 * WebKit deja interrumpido un `AudioContext` creado fuera de un gesto del
 * usuario, y con el motor nativo el micrófono ya no pasa por `getUserMedia`
 * que lo "desbloquee". El reproductor sí crea el suyo dentro del clic que abre
 * la llamada, así que ese mismo contexto lo reutilizan todos los analizadores:
 * el del micrófono se crea después de un `await` y de otro modo nacería muerto.
 */
let contextoCompartido: AudioContext | null = null;

function contextoDeAnalisis(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!contextoCompartido || contextoCompartido.state === "closed") {
    try {
      contextoCompartido = new AudioContext();
    } catch {
      return null;
    }
  }
  if (contextoCompartido.state !== "running") void contextoCompartido.resume().catch(() => {});
  return contextoCompartido;
}

/**
 * Analiza PCM sin que suene: lo programa en un contexto de WebAudio cuya salida
 * va a un volumen cero. Da el espectro para el visualizador y el nodo donde
 * engancharle el análisis de visemas, igual que el `bus` del reproductor web.
 *
 * Pasa por `destination` con ganancia cero a propósito: un nodo sin camino al
 * destino puede que el motor ni lo procese, y el análisis se quedaría quieto.
 */
class PcmAnalyser {
  readonly spectrum = new SpectrumTap();
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private nextAt = 0;
  private sources = new Set<AudioBufferSourceNode>();

  get lipsyncSource(): LipsyncSource | null {
    return this.context && this.bus ? { context: this.context, node: this.bus } : null;
  }

  /** Crea el contexto. Llamarlo dentro del gesto del usuario, como el reproductor web. */
  ensure(): void {
    if (this.context) return;
    try {
      const context = contextoDeAnalisis();
      if (!context) return;
      this.context = context;
      this.bus = this.context.createGain();
      const mudo = this.context.createGain();
      mudo.gain.value = 0;
      this.bus.connect(mudo);
      mudo.connect(this.context.destination);
      this.spectrum.attach(this.context, this.bus);
    } catch {
      // Sin análisis la llamada funciona igual: solo se pierde el visualizador.
      this.context = null;
      this.bus = null;
    }
  }

  push(pcm: ArrayBuffer, rate: number): void {
    const context = this.context;
    const bus = this.bus;
    if (!context || !bus) return;
    const muestras = new Int16Array(pcm);
    if (!muestras.length) return;
    const buffer = context.createBuffer(1, muestras.length, rate);
    const canal = buffer.getChannelData(0);
    for (let i = 0; i < muestras.length; i++) canal[i] = muestras[i]! / 0x8000;
    const fuente = context.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(bus);
    const inicio = Math.max(context.currentTime + 0.02, this.nextAt);
    fuente.start(inicio);
    this.nextAt = inicio + buffer.duration;
    this.sources.add(fuente);
    fuente.onended = () => this.sources.delete(fuente);
  }

  clear(): void {
    for (const fuente of this.sources) {
      try {
        fuente.stop();
      } catch {
        /* ya había terminado */
      }
    }
    this.sources.clear();
    this.nextAt = 0;
  }

  close(): void {
    this.clear();
    this.spectrum.detach();
    try {
      this.bus?.disconnect();
    } catch {
      /* el contexto ya se cerró */
    }
    // El contexto es de todos: se queda abierto para el siguiente analizador.
    this.bus = null;
    this.context = null;
  }
}

/** Dos notas breves, las mismas de `RealtimePlayer.probar()`, como PCM16 a 24 kHz. */
function tonoDePrueba(): ArrayBuffer {
  const notas = [660, 990];
  const porNota = Math.round(OUTPUT_RATE * 0.17);
  const hueco = Math.round(OUTPUT_RATE * 0.01);
  const pcm = new Int16Array(notas.length * (porNota + hueco));
  notas.forEach((hz, n) => {
    for (let i = 0; i < porNota; i++) {
      // Rampa en los extremos: un tono que arranca o corta en seco chasquea.
      const envolvente = Math.min(1, i / 480, (porNota - i) / 480);
      const s = Math.sin((2 * Math.PI * hz * i) / OUTPUT_RATE) * 0.16 * envolvente;
      pcm[n * (porNota + hueco) + i] = Math.round(s * 0x7fff);
    }
  });
  return pcm.buffer;
}

class NativeMic implements MicPort {
  private readonly analyser = new PcmAnalyser();
  private abierto = false;
  /** Con qué se cierra: el módulo solo obedece al dueño vigente del micrófono. */
  private token: number | null = null;

  get spectrum() {
    return this.analyser.spectrum;
  }

  constructor(
    private readonly core: TauriCore,
    private readonly onFrame: (pcm: ArrayBuffer) => void,
    private readonly deviceId: string | null,
  ) {}

  async start(): Promise<void> {
    this.analyser.ensure();
    const frames = new this.core.Channel<ArrayBuffer | number[]>();
    frames.onmessage = (mensaje) => {
      if (!this.abierto) return;
      // Con cuerpo crudo llega un ArrayBuffer; por si algún runtime lo entrega
      // como lista de bytes, se normaliza.
      const pcm = mensaje instanceof ArrayBuffer ? mensaje : new Uint8Array(mensaje).buffer;
      this.analyser.push(pcm, INPUT_RATE);
      this.onFrame(pcm);
    };
    this.abierto = true;
    try {
      this.token = await this.core.invoke<number>("media_mic_start", { deviceId: this.deviceId, frames });
    } catch (error) {
      this.abierto = false;
      this.analyser.close();
      throw error;
    }
  }

  stop(): void {
    this.abierto = false;
    // Sin token no hubo apertura que cerrar. Con uno que ya no es el vigente,
    // el módulo ignora el cierre: otro micrófono (la llamada) tomó el relevo.
    if (this.token !== null) {
      void this.core.invoke("media_mic_stop", { token: this.token }).catch(() => {});
      this.token = null;
    }
    this.analyser.close();
  }
}

class NativePlayer implements PlayerPort {
  private readonly analyser = new PcmAnalyser();
  private salidaId: string | null = null;
  private abierto = false;
  private abriendo: Promise<void> | null = null;
  /** Reloj de pared, igual que en `RealtimePlayer`: ver `estaHablando` allí. */
  private hablaHasta = 0;
  private terminaEn = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  onIdle?: () => void;

  constructor(private readonly core: TauriCore) {}

  get spectrum() {
    return this.analyser.spectrum;
  }

  get lipsyncSource(): LipsyncSource | null {
    return this.analyser.lipsyncSource;
  }

  get isSpeaking(): boolean {
    return Date.now() < this.terminaEn;
  }

  /** Abre la salida nativa. Idempotente: varias llamadas comparten el mismo intento. */
  private abrir(): Promise<void> {
    if (this.abierto) return Promise.resolve();
    this.abriendo ??= this.core
      .invoke("media_player_start", { deviceId: this.salidaId })
      .then(() => {
        this.abierto = true;
      })
      .finally(() => {
        this.abriendo = null;
      });
    return this.abriendo;
  }

  async resume(): Promise<void> {
    // El contexto de análisis sí necesita nacer dentro del gesto del usuario.
    this.analyser.ensure();
    await this.abrir();
  }

  enqueue(pcm: ArrayBuffer): void {
    if (!this.abierto) return;
    const muestras = pcm.byteLength / 2;
    if (!muestras) return;
    // Los bytes viajan crudos: pasarlos como lista JSON los cuadruplicaría.
    void this.core.invoke("media_player_enqueue", new Uint8Array(pcm)).catch(() => {});
    this.analyser.push(pcm, OUTPUT_RATE);

    const ahora = Date.now();
    const dura = (muestras / OUTPUT_RATE) * 1000;
    this.terminaEn = Math.max(this.terminaEn, ahora) + dura;
    const falta = Math.min(TOPE_MS, Math.max(0, this.terminaEn - ahora));
    this.hablaHasta = Math.max(this.hablaHasta, ahora + falta + COLA_MS);
    this.programarIdle();
  }

  /** El motor nativo no avisa de vaciado: se deduce del reloj. */
  private programarIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.isSpeaking) this.onIdle?.();
    }, Math.max(0, this.terminaEn - Date.now()) + 30);
  }

  interrupt(): void {
    this.hablaHasta = 0;
    this.terminaEn = 0;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.analyser.clear();
    void this.core.invoke("media_player_interrupt").catch(() => {});
  }

  estaHablando(): boolean {
    return Date.now() < this.hablaHasta;
  }

  /** Cambiar de salida es reabrirla: lo que quedara en cola se descarta. */
  async usarSalida(id: string | null): Promise<void> {
    this.salidaId = id;
    if (!this.abierto && !this.abriendo) return; // se aplicará al abrir
    this.abierto = false;
    await this.abrir();
  }

  async probar(): Promise<void> {
    await this.resume();
    this.enqueue(tonoDePrueba());
  }

  stop(): void {
    this.interrupt();
    this.abierto = false;
    void this.core.invoke("media_player_stop").catch(() => {});
    this.analyser.close();
  }
}

/** Bytes → base64 sin reventar la pila: `String.fromCharCode(...grande)` la agota. */
export function bytesABase64(bytes: Uint8Array): string {
  let texto = "";
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    texto += String.fromCharCode(...bytes.subarray(i, i + trozo));
  }
  return btoa(texto);
}

type Origen = "camera" | "screen";

/**
 * Cámara o pantalla por el módulo nativo. Llegan dos clases de fotograma por el
 * mismo canal, distinguidas por el primer byte:
 * - Modelo (~1 por segundo): se manda tal cual al modelo, en base64.
 * - Vista previa (varios por segundo, pequeños): solo se pinta en el `<canvas>`
 *   que ve la persona; nunca sale de la aplicación.
 */
class NativeCapture implements CapturePort {
  private canvas: HTMLCanvasElement | null = null;
  private token: number | null = null;
  private activo = false;
  /** Descodificar la vista previa es asíncrono: si no ha terminado, se salta la siguiente. */
  private pintando = false;

  get element(): HTMLElement | null {
    return this.canvas;
  }

  constructor(
    private readonly core: TauriCore,
    private readonly origen: Origen,
    private readonly onFrame: FrameSink,
    private readonly onEnded?: () => void,
  ) {}

  async start(): Promise<void> {
    if (typeof document !== "undefined") this.canvas = document.createElement("canvas");
    const frames = new this.core.Channel<ArrayBuffer | number[]>();
    frames.onmessage = (mensaje) => this.recibir(mensaje);
    this.activo = true;
    try {
      this.token = await this.core.invoke<number>(`media_${this.origen}_start`, { frames });
    } catch (error) {
      this.activo = false;
      this.canvas = null;
      throw error;
    }
  }

  private recibir(mensaje: ArrayBuffer | number[]): void {
    if (!this.activo) return;
    const bytes = mensaje instanceof ArrayBuffer ? new Uint8Array(mensaje) : Uint8Array.from(mensaje);
    if (!bytes.length) return;
    switch (bytes[0]) {
      case TAG_MODEL:
        if (bytes.length > 1) this.onFrame(bytesABase64(bytes.subarray(1)), "image/jpeg");
        break;
      case TAG_PREVIEW:
        void this.pintar(bytes.subarray(1));
        break;
      case TAG_ENDED:
        // La persona cortó la compartición desde el sistema, fuera de nuestra
        // interfaz: sin este aviso el botón se quedaría encendido.
        this.cerrar();
        this.onEnded?.();
        break;
    }
  }

  private async pintar(jpeg: Uint8Array): Promise<void> {
    const canvas = this.canvas;
    if (!canvas || this.pintando || !jpeg.length || typeof createImageBitmap === "undefined") return;
    this.pintando = true;
    try {
      const imagen = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
      if (this.canvas === canvas) {
        canvas.width = imagen.width;
        canvas.height = imagen.height;
        canvas.getContext("2d")?.drawImage(imagen, 0, 0);
      }
      imagen.close();
    } catch {
      /* un fotograma de vista previa perdido no importa */
    } finally {
      this.pintando = false;
    }
  }

  private cerrar(): void {
    this.activo = false;
    if (this.token !== null) {
      void this.core.invoke(`media_${this.origen}_stop`, { token: this.token }).catch(() => {});
      this.token = null;
    }
    this.canvas = null;
  }

  stop(): void {
    this.cerrar();
  }
}

function describirCamara(error: unknown): string {
  const { kind, message } = comoFallo(error);
  switch (kind) {
    case "permission_denied":
      return "El sistema negó el acceso a la cámara. Concédelo en los ajustes de privacidad y vuelve a intentar.";
    case "busy":
      return "Otra aplicación está usando la cámara.";
    case "no_device":
      return "No se encontró ninguna cámara conectada.";
    default:
      return `No se pudo acceder a la cámara: ${message ?? "error desconocido"}`;
  }
}

function describirPantalla(error: unknown): string {
  const { kind, message } = comoFallo(error);
  switch (kind) {
    case "permission_denied":
      // También ocurre si la persona cierra el diálogo sin elegir nada.
      return "No se compartió ninguna pantalla.";
    case "no_device":
      return "No hay ninguna pantalla o ventana disponible para compartir.";
    default:
      return `No se pudo compartir la pantalla: ${message ?? "error desconocido"}`;
  }
}

/** Fallos del módulo nativo que no dependen de la persona: ahí vale intentar con el navegador. */
function falloDelMotor(error: unknown): boolean {
  const { kind } = comoFallo(error);
  return kind === "other" || kind === "unsupported";
}

/**
 * Captura que prueba primero el motor nativo y, si este falla por algo propio
 * (no por un permiso, una cámara ocupada o la ausencia de cámara), cae al
 * navegador. Sin esto, un fallo raro del módulo nativo dejaría sin cámara a
 * quien con el navegador sí la tendría.
 */
class CapturaConRespaldo implements CapturePort {
  private activa: CapturePort | null = null;

  constructor(
    private readonly primaria: CapturePort,
    private readonly respaldo: () => CapturePort,
  ) {}

  get element(): HTMLElement | null {
    return (this.activa ?? this.primaria).element;
  }

  async start(): Promise<void> {
    try {
      await this.primaria.start();
      this.activa = this.primaria;
    } catch (error) {
      if (!falloDelMotor(error)) throw error;
      console.warn("[media] captura nativa no disponible; se usa la del navegador", error);
      const alternativa = this.respaldo();
      await alternativa.start();
      this.activa = alternativa;
    }
  }

  stop(): void {
    this.activa?.stop();
    this.activa = null;
  }
}

/** Describe un fallo sea del módulo nativo (`{kind}`) o del navegador (`{name}`). */
function describirAmbos(
  nativo: (e: unknown) => string,
  web: (e: unknown) => string,
): (e: unknown) => string {
  return (error) =>
    error && typeof error === "object" && "kind" in error ? nativo(error) : web(error);
}

function aDispositivos(lista: DispositivoNativo[]): DispositivoAudio[] {
  return lista.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    porDefecto: d.porDefecto,
    // PipeWire pone la MAC y `bluez` en el nombre del nodo: aquí no hay duda.
    ...(d.id.includes("bluez") ? { bluetooth: true } : {}),
  }));
}

export function crearMotorNativo(core: TauriCore): MediaEngine {
  return {
    ...webMediaEngine,
    kind: "native",
    cancelaEco: true,
    createMic: (onFrame, deviceId) => new NativeMic(core, onFrame, deviceId),
    createPlayer: () => new NativePlayer(core),

    listInputs: async () => {
      try {
        return aDispositivos(await core.invoke<DispositivoNativo[]>("media_list_devices", { kind: "input" }));
      } catch {
        return [];
      }
    },

    listOutputs: async (): Promise<Salidas> => {
      try {
        const lista = aDispositivos(
          await core.invoke<DispositivoNativo[]>("media_list_devices", { kind: "output" }),
        );
        return { lista, motivo: lista.length ? null : "El sistema no reportó ninguna salida de audio." };
      } catch (error) {
        // El motivo se muestra: una lista vacía sin explicación parece "no hay altavoces".
        return { lista: [], motivo: comoFallo(error).message ?? String(error) };
      }
    },

    createCamera: (onFrame) =>
      new CapturaConRespaldo(new NativeCapture(core, "camera", onFrame), () =>
        webMediaEngine.createCamera(onFrame),
      ),
    createScreen: (onFrame, onEnded) =>
      new CapturaConRespaldo(new NativeCapture(core, "screen", onFrame, onEnded), () =>
        webMediaEngine.createScreen(onFrame, onEnded),
      ),

    describeMicError: (error) => describirFallo(error, "micrófono"),
    describeCameraError: describirAmbos(describirCamara, webMediaEngine.describeCameraError),
    describeScreenError: describirAmbos(describirPantalla, webMediaEngine.describeScreenError),
  };
}

/**
 * Audio del navegador con la **cámara nativa**.
 *
 * Es el motor por defecto en la app de escritorio. El audio sigue siendo el del
 * navegador porque el nativo aún es opt-in (su eco se está validando), pero la
 * cámara no tiene ese motivo, y la del navegador integrado a veces ni abre:
 * WebKitGTK la pide por el portal de PipeWire y se agota el tiempo, dejando
 * además el dispositivo ocupado. La pantalla se queda en el navegador hasta
 * comprobarla en uso real.
 */
export function crearMotorHibrido(core: TauriCore): MediaEngine {
  const nativo = crearMotorNativo(core);
  return {
    ...webMediaEngine,
    createCamera: nativo.createCamera,
    describeCameraError: nativo.describeCameraError,
  };
}

/**
 * ¿Responde el módulo nativo? Una llamada barata que también confirma que la
 * ACL de Tauri deja pasar los comandos desde este origen.
 */
export async function nativoDisponible(core: TauriCore): Promise<boolean> {
  try {
    await core.invoke("media_list_devices", { kind: "output" });
    return true;
  } catch {
    return false;
  }
}
