/**
 * Captura y reproducción de audio para el modo de voz en tiempo real.
 *
 * La API Live habla PCM16 mono crudo: 16 kHz hacia el modelo, 24 kHz de vuelta.
 * `MediaRecorder` no sirve — produce contenedores webm/ogg— así que la captura
 * va por AudioWorklet.
 *
 * El worklet se carga desde un Blob URL en vez de un archivo aparte: así funciona
 * igual en dev, en el build de Vite y dentro del bundle embebido en el binario,
 * sin que ninguno de los tres tenga que saber que existe un asset extra.
 */

import { aplicarSalida } from "@/lib/realtime/dispositivos";

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

/** Bloques de ~40 ms: suficientemente chicos para que el VAD reaccione rápido. */
const FRAME_SAMPLES = 640;

const WORKLET_SOURCE = `
class PCMCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options.processorOptions.targetRate;
    this.frame = options.processorOptions.frameSamples;
    this.ratio = sampleRate / this.target;
    this.acc = [];
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    // Remuestreo lineal al vuelo: el navegador no siempre concede el sampleRate
    // pedido (WebKitGTK, por ejemplo, entrega el del dispositivo).
    while (this.pos < input.length) {
      const idx = Math.floor(this.pos);
      const frac = this.pos - idx;
      const a = input[idx];
      const b = idx + 1 < input.length ? input[idx + 1] : a;
      this.acc.push(a + (b - a) * frac);
      this.pos += this.ratio;

      if (this.acc.length >= this.frame) {
        const pcm = new Int16Array(this.acc.length);
        for (let i = 0; i < this.acc.length; i++) {
          const s = Math.max(-1, Math.min(1, this.acc[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.acc = [];
      }
    }
    this.pos -= input.length;
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
`;

/**
 * Cuánto sigue considerándose "la colmena está hablando" después del último
 * bloque encolado.
 *
 * No es un margen de seguridad al tuntún. Un televisor por HDMI retrasa el
 * audio entre 40 y 200 ms para cuadrarlo con la imagen, y la sala añade cola de
 * reverberación: el sonido sigue saliendo por los altavoces cuando el último
 * bloque ya terminó. Sin esta cola, el micrófono vuelve a escuchar justo a
 * tiempo de recoger el final de su propia frase.
 */
const COLA_MS = 700;

/**
 * Tope de lo que se puede programar por delante.
 *
 * El plazo se calcula con la distancia hasta el final de lo encolado, y esa
 * distancia la mide el reloj del contexto de audio. Si el contexto se detiene
 * —en WebKit pasa: cae a `interrupted`— ese reloj deja de avanzar y la
 * distancia crecería sin freno, dejando el micrófono mudo para siempre. Con
 * tope, la compuerta nunca puede quedarse cerrada más de TOPE + COLA.
 */
const TOPE_MS = 4_000;

/** Bins de espectro que se publican al visualizador. */
export const SPECTRUM_BINS = 128;

/**
 * Lectura de espectro compartida por micrófono y reproducción. El visualizador
 * la sube tal cual como fila de una textura, así que se entrega ya normalizada
 * a 0–255 y con un suavizado temporal: sin él, el shader tiembla a 60 fps.
 */
export class SpectrumTap {
  readonly bins = new Uint8Array(SPECTRUM_BINS);
  private analyser: AnalyserNode | null = null;
  private raw: Uint8Array<ArrayBuffer> | null = null;
  private smoothedLevel = 0;

  attach(context: AudioContext, source: AudioNode): AnalyserNode {
    const analyser = context.createAnalyser();
    analyser.fftSize = SPECTRUM_BINS * 4;
    analyser.smoothingTimeConstant = 0.72;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -12;
    source.connect(analyser);
    this.analyser = analyser;
    this.raw = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    return analyser;
  }

  /** Refresca `bins` y devuelve el nivel general (0–1). */
  sample(): number {
    if (!this.analyser || !this.raw) return 0;
    this.analyser.getByteFrequencyData(this.raw);

    // La voz vive en la mitad baja del espectro: comprimirla ahí da mucho más
    // detalle visible que repartir los bins linealmente hasta Nyquist.
    const usable = Math.floor(this.raw.length * 0.62);
    let sum = 0;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const t = i / (SPECTRUM_BINS - 1);
      const src = Math.min(usable - 1, Math.round(Math.pow(t, 1.6) * (usable - 1)));
      const value = this.raw[src] ?? 0;
      this.bins[i] = value;
      sum += value;
    }

    /**
     * Ganancia medida, no elegida a ojo.
     *
     * La voz real de la Live API mide 0.12 de media y 0.31 en los picos con este
     * mismo cálculo (comprobado sobre 22 s de audio del modelo). Devolver eso en
     * crudo dejaba a quien lo consuma escalando gestos sobre un rango de 0–0.3:
     * las manos se movían dos grados y parecía que no se movieran. Con 3.2× los
     * picos llegan a 1 y el rango útil se aprovecha entero.
     */
    const level = Math.min(1, (sum / (SPECTRUM_BINS * 255)) * 3.2);
    // Ataque rápido, caída lenta: la energía sube con la sílaba y decae suave.
    this.smoothedLevel = level > this.smoothedLevel
      ? this.smoothedLevel + (level - this.smoothedLevel) * 0.55
      : this.smoothedLevel + (level - this.smoothedLevel) * 0.12;
    return this.smoothedLevel;
  }

  detach(): void {
    try {
      this.analyser?.disconnect();
    } catch {
      /* el contexto ya se cerró */
    }
    this.analyser = null;
    this.raw = null;
    this.bins.fill(0);
    this.smoothedLevel = 0;
  }
}

export class RealtimeMic {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  /** Espectro de lo que entra por el micrófono. */
  readonly spectrum = new SpectrumTap();

  /**
   * @param onFrame recibe PCM16 mono a INPUT_SAMPLE_RATE.
   * @param deviceId micrófono elegido; null deja decidir al sistema.
   */
  constructor(
    private readonly onFrame: (pcm: ArrayBuffer) => void,
    private readonly deviceId: string | null = null,
  ) {}

  async start(): Promise<void> {
    this.stream = await abrirMicrofono(this.deviceId);

    this.context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    this.node = new AudioWorkletNode(this.context, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { targetRate: INPUT_SAMPLE_RATE, frameSamples: FRAME_SAMPLES },
    });
    this.node.port.onmessage = (event) => this.onFrame(event.data as ArrayBuffer);

    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
    this.spectrum.attach(this.context, this.source);

    // Mismo motivo que en RealtimePlayer: si el contexto no está corriendo, el
    // worklet no procesa y no se envía ni un byte de voz. Sin esperar, por el
    // mismo riesgo de promesa que no resuelve.
    if (this.context.state !== "running") void this.context.resume().catch(() => {});
  }

  stop(): void {
    this.spectrum.detach();
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

export class RealtimePlayer {
  private context: AudioContext | null = null;
  /** Momento en que termina lo ya encolado: los bloques se pegan sin huecos. */
  private nextStartAt = 0;
  private playing = new Set<AudioBufferSourceNode>();
  /** Bus intermedio: todo pasa por acá para poder medir lo que suena. */
  private bus: GainNode | null = null;

  /** Espectro de la voz del modelo. */
  readonly spectrum = new SpectrumTap();

  /** Llamado cuando la cola se vacía (el modelo dejó de hablar). */
  onIdle?: () => void;

  /**
   * Hasta cuándo se da por hecho que suena su voz, en reloj de pared.
   *
   * En reloj de pared a propósito: es el único que siempre avanza. La versión
   * anterior preguntaba si quedaban nodos sonando, y esa cuenta sólo baja
   * cuando cada nodo dispara `onended`; en WebKit ese evento puede no llegar
   * —contexto interrumpido, o el flujo movido de aparato por debajo— y quien
   * usara la señal para callar el micrófono lo dejaba mudo para el resto de la
   * llamada.
   */
  private hablaHasta = 0;

  /** Salida elegida por el usuario; null = la que decida el sistema. */
  private salidaId: string | null = null;
  private salidaLista = false;
  private aplicandoSalida = false;
  private ultimoIntento = 0;

  async resume(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.bus = this.context.createGain();
      this.bus.connect(this.context.destination);
      this.spectrum.attach(this.context, this.bus);
      // WebKit (el motor de la app de escritorio en Linux) tiene un tercer
      // estado además de "running" y "suspended": "interrupted". Un contexto
      // creado fuera del gesto del usuario nace ahí, y también cae ahí si el
      // sistema le quita la sesión de audio en marcha —un auricular Bluetooth
      // que cambia de modo, otra aplicación que toma la salida—. El reloj
      // sigue avanzando, así que nada parece roto, pero no sale sonido: se oye
      // al usuario y no se oye a la colmena. Reanudar en cada cambio de estado
      // lo recupera solo.
      this.context.addEventListener("statechange", () => this.despertar());
    }
    // Medido en WebKit: resume() sobre un contexto "interrupted" devuelve una
    // promesa que no se resuelve NUNCA. Esperarla aquí colgaría el arranque de
    // la llamada entera —ni siquiera llegaría a abrirse el micrófono—, así que
    // solo se espera en el caso normal y el resto se intenta sin bloquear.
    if (this.context.state === "suspended") await this.context.resume();
    else this.despertar();
  }

  /** Intenta levantar el contexto sin hacer esperar a quien llama. */
  private despertar(): void {
    const context = this.context;
    if (!context || context.state === "running" || context.state === "closed") return;
    void context.resume().catch(() => {});
  }

  /** Cambia el dispositivo por el que sale la voz. */
  async usarSalida(id: string | null): Promise<void> {
    this.salidaId = id;
    this.salidaLista = false;
    // Elección del usuario: se atiende ya, sin esperar al hueco del reintento.
    this.ultimoIntento = 0;
    await this.encaminar();
  }

  /**
   * Aplica la salida elegida mientras quede pendiente.
   *
   * El sistema sólo puede mover un flujo que exista, y sólo existe mientras algo
   * suena: al elegir la salida en reposo el puerto queda puesto pero la voz no
   * se mueve hasta el primer bloque. Por eso se insiste, y por eso `salidaLista`
   * se marca con lo que responde el sistema y no con "no lanzó excepción".
   *
   * Con freno: esto se llama con cada bloque de voz —decenas por segundo— y
   * cada intento le pregunta al servidor de sonido por sus tarjetas.
   */
  private async encaminar(): Promise<void> {
    if (!this.salidaId || this.salidaLista || this.aplicandoSalida) return;
    const ahora = Date.now();
    if (ahora - this.ultimoIntento < 900) return;
    this.ultimoIntento = ahora;
    this.aplicandoSalida = true;
    try {
      this.salidaLista = await aplicarSalida(this.salidaId, this.context);
    } catch {
      // Todavía no hay nada que mover: se reintenta con el siguiente bloque.
    } finally {
      this.aplicandoSalida = false;
    }
  }

  enqueue(pcm: ArrayBuffer): void {
    if (!this.context || !this.bus) return;
    void this.encaminar();
    const samples = new Int16Array(pcm);
    if (!samples.length) return;

    const buffer = this.context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 0x8000;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.bus);

    const now = this.context.currentTime;
    // Un pelo de margen evita cortes cuando la red entrega los bloques justos.
    const startAt = Math.max(now + 0.02, this.nextStartAt);
    source.start(startAt);
    this.nextStartAt = startAt + buffer.duration;

    const faltaMs = Math.min(TOPE_MS, Math.max(0, (this.nextStartAt - now) * 1000));
    this.hablaHasta = Math.max(this.hablaHasta, Date.now() + faltaMs + COLA_MS);

    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      if (!this.playing.size) this.onIdle?.();
    };
  }

  /**
   * Toca un tono corto por la salida elegida, para reconocerla de oído.
   *
   * Va por el mismo bus que la voz: si suena por el aparato correcto, la voz
   * también lo hará. En la vía nativa además le da al proceso un flujo que
   * mover, que es lo que `encaminar()` necesita para que el cambio surta efecto.
   */
  async probar(): Promise<void> {
    await this.resume();
    if (!this.context || !this.bus) return;
    void this.encaminar();

    const inicio = this.context.currentTime + 0.05;
    // Dos notas breves —la segunda una quinta arriba— se distinguen de
    // cualquier sonido del sistema sin llegar a ser un pitido molesto.
    for (const [i, hz] of [660, 990].entries()) {
      const osc = this.context.createOscillator();
      const vol = this.context.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      const desde = inicio + i * 0.18;
      // Rampas en los extremos: un tono que arranca o corta en seco chasquea.
      vol.gain.setValueAtTime(0, desde);
      vol.gain.linearRampToValueAtTime(0.16, desde + 0.02);
      vol.gain.setValueAtTime(0.16, desde + 0.12);
      vol.gain.linearRampToValueAtTime(0, desde + 0.17);
      osc.connect(vol);
      vol.connect(this.bus);
      osc.start(desde);
      osc.stop(desde + 0.18);
    }
  }

  /**
   * ¿Está sonando su voz —o acaba de sonar— ahora mismo?
   *
   * Para decidir si conviene callar el micrófono en manos libres. Distinto de
   * `isSpeaking`, que mira los nodos vivos y es lo que quiere la interfaz.
   */
  estaHablando(): boolean {
    return Date.now() < this.hablaHasta;
  }

  /** Barge-in: el usuario habló encima. Todo lo pendiente se descarta. */
  interrupt(): void {
    // Reabre el micrófono en el acto: quien interrumpe quiere hablar ya.
    this.hablaHasta = 0;
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        /* ya había terminado */
      }
    }
    this.playing.clear();
    this.nextStartAt = 0;
  }

  get isSpeaking(): boolean {
    return this.playing.size > 0;
  }

  stop(): void {
    this.interrupt();
    this.hablaHasta = 0;
    this.spectrum.detach();
    try {
      this.bus?.disconnect();
    } catch {
      /* el contexto ya se cerró */
    }
    this.bus = null;
    void this.context?.close();
    this.context = null;
  }
}

/**
 * Abre el micrófono pedido, con vuelta atrás al del sistema.
 *
 * El aparato guardado puede haber desaparecido —un auricular desconectado, un
 * puerto distinto— y con `deviceId: exact` eso es un `OverconstrainedError` que
 * dejaría la llamada sin abrir. Vale mucho más empezar a hablar por el
 * micrófono que haya que no arrancar por una preferencia vieja.
 *
 * Sin cancelación de eco el micrófono se oye a sí mismo por el altavoz y el
 * modelo se interrumpe solo a mitad de frase.
 */
async function abrirMicrofono(deviceId: string | null): Promise<MediaStream> {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio: base });
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...base, deviceId: { exact: deviceId } },
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name !== "OverconstrainedError" && name !== "NotFoundError") throw error;
    return navigator.mediaDevices.getUserMedia({ audio: base });
  }
}

/** Traduce el fallo de getUserMedia a algo accionable (mismo criterio que ChatInput). */
export function describeMicError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permiso de micrófono denegado. Habilítalo para este sitio y vuelve a intentar.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró ningún micrófono conectado.";
    case "NotReadableError":
      return "Otra aplicación está usando el micrófono.";
    default:
      return `No se pudo acceder al micrófono: ${(error as Error)?.message ?? "error desconocido"}`;
  }
}
