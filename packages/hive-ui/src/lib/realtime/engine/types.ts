/**
 * Contrato del motor de medios de la voz en tiempo real.
 *
 * Todo lo que toca hardware —micrófono, altavoz, cámara, pantalla— pasa por aquí,
 * de modo que quien orquesta la llamada (`realtimeStore`) no sabe si por debajo
 * hay WebAudio y `getUserMedia` (navegador, móvil) o un módulo nativo en Rust
 * (app de escritorio). Cambiar de motor no debe cambiar ni una línea del llamador.
 *
 * Formato de cable, igual en todos los motores y fijado por la Live API:
 * PCM16 mono, 16 kHz hacia el modelo y 24 kHz de vuelta; fotogramas JPEG en base64.
 */

import type { DispositivoAudio, Salidas } from "@/lib/realtime/dispositivos";

/** Lectura de espectro ya normalizada (0–255 por bin) para el visualizador. */
export interface SpectrumReader {
  readonly bins: Uint8Array;
  /** Refresca `bins` y devuelve el nivel general (0–1). */
  sample(): number;
}

/** Dónde engancharle el análisis de visemas a la voz del modelo. */
export interface LipsyncSource {
  context: AudioContext;
  node: AudioNode;
}

/** Captura de micrófono. Entrega bloques PCM16 mono a 16 kHz. */
export interface MicPort {
  readonly spectrum: SpectrumReader;
  start(): Promise<void>;
  stop(): void;
}

/** Reproducción de la voz del modelo (PCM16 mono a 24 kHz). */
export interface PlayerPort {
  readonly spectrum: SpectrumReader;
  /** null si el motor no ofrece un nodo de WebAudio donde analizar la voz. */
  readonly lipsyncSource: LipsyncSource | null;
  /** Hay audio programado sonando ahora (para la interfaz). */
  readonly isSpeaking: boolean;
  /** Llamado cuando la cola se vacía. */
  onIdle?: () => void;
  /**
   * Prepara la salida. Hay que llamarla de forma síncrona dentro del gesto del
   * usuario: WebKit deja interrumpido un contexto de audio creado fuera de él.
   */
  resume(): Promise<void>;
  enqueue(pcm: ArrayBuffer): void;
  /** Barge-in: descarta todo lo pendiente. */
  interrupt(): void;
  stop(): void;
  /** ¿Suena su voz, o acaba de sonar? Para el modo manos libres. */
  estaHablando(): boolean;
  usarSalida(id: string | null): Promise<void>;
  /** Toca un tono corto por la salida elegida. */
  probar(): Promise<void>;
}

/** Cámara o pantalla: fotogramas sueltos a baja cadencia. */
export interface CapturePort {
  /**
   * Vista previa local; null hasta que arranca. Es un `<video>` en el motor web
   * y un `<canvas>` en el nativo: quien lo monta no debe suponer cuál de los dos.
   */
  readonly element: HTMLElement | null;
  start(): Promise<void>;
  stop(): void;
}

export type FrameSink = (base64: string, mimeType: string) => void;

export interface MediaEngine {
  readonly kind: "web" | "native";

  /**
   * El micrófono de este motor ya resta lo que suena por el altavoz. Si es así,
   * el modo manos libres no necesita callarlo mientras habla la colmena y se
   * puede interrumpir con la voz aunque salga por un altavoz abierto.
   */
  readonly cancelaEco: boolean;

  /** @param onFrame PCM16 mono a 16 kHz. @param deviceId null = el del sistema. */
  createMic(onFrame: (pcm: ArrayBuffer) => void, deviceId: string | null): MicPort;
  createPlayer(): PlayerPort;
  createCamera(onFrame: FrameSink): CapturePort;
  /** @param onEnded el usuario cortó la compartición fuera de nuestra interfaz. */
  createScreen(onFrame: FrameSink, onEnded?: () => void): CapturePort;

  listInputs(): Promise<DispositivoAudio[]>;
  listOutputs(): Promise<Salidas>;

  /** Traducen el fallo del motor a algo accionable para la persona. */
  describeMicError(error: unknown): string;
  describeCameraError(error: unknown): string;
  describeScreenError(error: unknown): string;
}
