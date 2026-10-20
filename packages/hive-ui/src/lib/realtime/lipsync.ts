/**
 * Visemas a partir del audio de la voz del modelo.
 *
 * Gemini Live entrega PCM sin visemas ni marcas de tiempo, así que la boca se
 * deduce del propio audio con HeadAudio: un AudioWorklet que clasifica cada
 * trama (MFCC contra prototipos) y devuelve 15 visemas Oculus en [0, 1]. Corre en
 * el navegador, sin servidor, y el worklet y el modelo van empaquetados: la app
 * de escritorio tiene que funcionar sin internet.
 *
 * El análisis añade unos 50 ms: la boca llega un pelo después del sonido, que
 * se tolera mucho mejor que una boca que se adelanta a la voz.
 */

import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import workletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import modelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";

/** El worklet se registra una sola vez por contexto. */
const registrados = new WeakSet<AudioContext>();

export class VisemeTracker {
  /** Último valor de cada visema (`viseme_aa`…), 0–1. */
  readonly values: Record<string, number> = {};
  private node: HeadAudio | null = null;
  private source: AudioNode | null = null;
  private context: AudioContext | null = null;
  private intentando: AudioContext | null = null;
  /** Cuándo falló el último intento: se reintenta con calma, no en cada fotograma. */
  private falloEn = 0;

  /** Hay un clasificador vivo sobre este contexto. */
  get activo(): boolean {
    return this.node !== null;
  }

  /** ¿Ya está (o se está) conectando a este contexto? */
  atiende(context: AudioContext): boolean {
    return this.context === context || this.intentando === context;
  }

  async attach(context: AudioContext, source: AudioNode): Promise<void> {
    if (this.atiende(context) || Date.now() - this.falloEn < 5_000) return;
    this.detach();
    this.intentando = context;
    try {
      if (!registrados.has(context)) {
        await context.audioWorklet.addModule(workletUrl);
        registrados.add(context);
      }
      const node = new HeadAudio(context, {
        processorOptions: {},
        // silMode 0: sin calibración manual de silencio; deciden los
        // prototipos entrenados. La voz del modelo es limpia, sin ruido de fondo.
        parameterData: { vadMode: 1, vadGateActiveDb: -40, vadGateInactiveDb: -60, silMode: 0 },
      });
      await node.loadModel(modelUrl);
      // Mientras esperaba, el contexto pudo cambiar (la llamada se reinició).
      if (this.intentando !== context) {
        node.disconnect();
        return;
      }
      node.onvalue = (key: string, value: number) => {
        this.values[key] = value;
      };
      source.connect(node);
      this.node = node;
      this.source = source;
      this.context = context;
    } catch (err) {
      // Sin worklet (o sin audio) la boca sigue a la amplitud: no es fatal.
      this.falloEn = Date.now();
      console.warn("[lipsync] HeadAudio no disponible:", err);
    } finally {
      if (this.intentando === context) this.intentando = null;
    }
  }

  /** Avanza el suavizado de visemas; llamar una vez por fotograma. */
  update(dtMs: number): void {
    this.node?.update(dtMs);
  }

  detach(): void {
    try {
      if (this.node) this.source?.disconnect(this.node);
    } catch {
      /* el contexto ya se cerró */
    }
    try {
      this.node?.disconnect();
    } catch {
      /* idem */
    }
    this.node = null;
    this.source = null;
    this.context = null;
    this.intentando = null;
    for (const k of Object.keys(this.values)) this.values[k] = 0;
  }
}
