/**
 * Cámara de la sesión de voz: le da vista a BIA.
 *
 * Envía fotogramas sueltos, no vídeo continuo, y a propósito: con vídeo la Live
 * API recorta la sesión de 15 minutos a unos 2, y cada imagen cuesta cientos de
 * tokens frente a los 25 por segundo que cuesta el audio. Un fotograma por
 * segundo alcanza para que entienda qué le estás mostrando.
 */

/** Fotogramas por segundo enviados al modelo. */
const FPS = 1;
/** Ancho al que se reescala antes de codificar; de sobra para reconocer una escena. */
const ANCHO_MAX = 640;
/** Compresión JPEG: por encima de esto sólo crece el costo en tokens. */
const CALIDAD = 0.6;

export class RealtimeCamera {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** @param onFrame recibe el JPEG en base64, sin el prefijo data:. */
  constructor(private readonly onFrame: (base64: string, mimeType: string) => void) {}

  /** El `<video>` para la vista previa local, una vez arrancada la cámara. */
  get element(): HTMLVideoElement | null {
    return this.video;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    });

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

/** Traduce el fallo de getUserMedia de vídeo a algo accionable. */
export function describeCameraError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permiso de cámara denegado. Habilitalo para este sitio y volvé a intentar.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró ninguna cámara conectada.";
    case "NotReadableError":
      return "Otra aplicación está usando la cámara.";
    default:
      return `No se pudo acceder a la cámara: ${(error as Error)?.message ?? "error desconocido"}`;
  }
}
