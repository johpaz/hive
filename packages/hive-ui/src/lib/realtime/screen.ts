/**
 * Compartir pantalla con la voz de Hive.
 *
 * Hermano de `camera.ts` y con el mismo trato: fotogramas sueltos a baja
 * cadencia, no vídeo continuo. La Live API admite un fotograma por segundo como
 * mucho, y cada imagen cuesta cientos de tokens frente a los 25 por segundo del
 * audio.
 *
 * Dos diferencias respecto a la cámara, y las dos importan:
 *
 * - **Se captura al doble de ancho.** A 640 px el texto de una interfaz es
 *   ilegible, y entonces el modelo no puede ayudar con lo que hay en pantalla,
 *   que es justo para lo que sirve compartirla.
 * - **Se escucha `onended`.** La compartición se corta desde el chip del propio
 *   navegador, fuera de nuestra interfaz; sin este aviso la aplicación seguiría
 *   creyendo que ve algo.
 */

/** Fotogramas por segundo enviados al modelo. */
const FPS = 1;
/** Ancho al que se reescala. El doble que la cámara: aquí hay que leer texto. */
const ANCHO_MAX = 1280;
/** Compresión JPEG. Más alta que en la cámara para no emborronar la tipografía. */
const CALIDAD = 0.72;

export class RealtimeScreen {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param onFrame recibe el JPEG en base64, sin el prefijo data:.
   * @param onEnded se llama si el usuario corta la compartición desde el navegador.
   */
  constructor(
    private readonly onFrame: (base64: string, mimeType: string) => void,
    private readonly onEnded?: () => void,
  ) {}

  /** El `<video>` para la vista previa local. */
  get element(): HTMLVideoElement | null {
    return this.video;
  }

  async start(): Promise<void> {
    // Sin audio: mezclarlo con el micrófono ensuciaría la detección de voz de
    // la conversación.
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 1, max: 5 } },
      audio: false,
    });

    const [track] = this.stream.getVideoTracks();
    if (track) {
      track.addEventListener("ended", () => {
        this.stop();
        this.onEnded?.();
      });
    }

    const video = document.createElement("video");
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.video = video;

    this.canvas = document.createElement("canvas");
    this.timer = setInterval(() => this.capture(), 1000 / FPS);
  }

  private capture(): void {
    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas || !video.videoWidth) return;

    const escala = Math.min(1, ANCHO_MAX / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * escala);
    canvas.height = Math.round(video.videoHeight * escala);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", CALIDAD);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (base64) this.onFrame(base64, "image/jpeg");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.stream = null;
    this.canvas = null;
  }
}

/** Traduce el fallo de getDisplayMedia a algo accionable. */
export function describeScreenError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
      // También ocurre si la persona cierra el diálogo sin elegir ventana.
      return "No se compartió ninguna pantalla.";
    case "NotFoundError":
      return "No hay ninguna pantalla o ventana disponible para compartir.";
    case "NotReadableError":
      return "El sistema no dejó capturar la pantalla. En Linux puede faltar el portal de escritorio.";
    default:
      return `No se pudo compartir la pantalla: ${(error as Error)?.message ?? "error desconocido"}`;
  }
}
