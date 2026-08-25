/**
 * RealtimeVoiceSession — puente entre el socket del navegador y la sesión Live
 * del proveedor.
 *
 * Flujo: PCM16 16 kHz del micrófono → proveedor → PCM 24 kHz de vuelta al
 * navegador. Cuando el modelo llama a una función puente, el trabajo real se
 * encola en el agent-loop de siempre; la narración de ese trabajo vuelve acá
 * como texto inyectado (speak) y el modelo la cuenta con su propia voz.
 */

import type { ServerWebSocket } from "bun";
import { addMessage } from "../../agent/conversation-store";
import {
  getRealtimeProvider,
  type RealtimeSession,
  type RealtimeToolCall,
} from "../../agent/realtime-providers";
import { logger } from "../../utils/logger";
import { executeBridgeTool, olvidarPeticiones, BRIDGE_TOOLS, CONSULT_TOOL } from "./bridge-tools";
import type { NarrationFrame, ServerFrame } from "./protocol";

const log = logger.child("realtime:session");

/** Silencio total (ni el usuario ni el modelo dicen nada) que cierra la sesión. */
const IDLE_TIMEOUT_MS = 3 * 60_000;
/** Reintentos de reconexión antes de rendirse. */
const MAX_RECONNECTS = 3;
/**
 * Ventana para juntar hitos antes de hablarlos. El agent-loop emite ráfagas
 * (delegated + worker_started + tool_result en el mismo par de cientos de ms):
 * inyectarlos de a uno hace que cada texto corte la frase anterior y el usuario
 * escuche tartamudeo en vez de narración.
 */
const NARRATION_COALESCE_MS = 1_500;
/** Lo mismo para resultados y errores, que sí corren prisa. */
const URGENT_COALESCE_MS = 250;
/** Cuánto esperamos a que termine de hablar antes de forzar la inyección. */
const GENERATING_MAX_MS = 20_000;
/** Hitos que se acumulan mientras habla; sólo interesan los últimos. */
const MAX_QUEUED_NARRATION = 4;

export interface VoiceSessionOptions {
  ws: ServerWebSocket<unknown>;
  /** sessionId del WebChat: lane de la cola y, a la vez, hilo de conversación. */
  sessionId: string;
  userId: string;
  threadId: string;
  providerId: string;
  model: string;
  apiKey: string;
  voice?: string;
  /** BCP-47 con acento regional (es-CO, es-MX…). */
  language?: string;
  /** La voz sale por un altavoz abierto y el micrófono la recoge. */
  speakerMode?: boolean;
  systemInstruction: string;
}

export class RealtimeVoiceSession {
  private session: RealtimeSession | null = null;
  private resumptionHandle: string | undefined;
  private closed = false;
  private reconnects = 0;
  private lastActivityAt = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  /** Transcripciones del turno en curso, para persistir la charla que no delegó. */
  private userTurnText = "";
  private modelTurnText = "";
  private delegatedThisTurn = false;

  /** Cola de textos a inyectar (narración, resultados) con su temporizador. */
  private speechQueue: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** El modelo está hablando: inyectar ahora lo cortaría a media frase. */
  private generatingSince = 0;

  /** Qué está viendo ahora mismo, para anunciarlo sólo cuando cambia. */
  private fuenteVisual: "camera" | "screen" | null = null;

  /** Consumo de la sesión y el acumulado de tramos anteriores (reconexiones). */
  private usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private usageBase = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  /** Nº de conexión: los callbacks de generaciones viejas se descartan. */
  private generation = 0;
  /** Evita que goAway y onClose disparen dos reconexiones a la vez. */
  private reconnecting = false;

  constructor(private readonly opts: VoiceSessionOptions) {}

  get sessionId(): string {
    return this.opts.sessionId;
  }

  get isAlive(): boolean {
    return !this.closed && this.opts.ws.readyState === 1;
  }

  async start(): Promise<void> {
    await this.connect();
    this.idleTimer = setInterval(() => {
      if (Date.now() - this.lastActivityAt > IDLE_TIMEOUT_MS) {
        log.info(`sesión ${this.opts.sessionId} cerrada por inactividad`);
        this.send({ type: "closed", reason: "inactividad" });
        this.close();
      }
    }, 15_000);
  }

  private async connect(): Promise<void> {
    const provider = getRealtimeProvider(this.opts.providerId);

    // Número de conexión. Gemini avisa con `goAway` y cierra el socket casi en
    // el mismo milisegundo; si las dos señales llegan a crear sesiones, la que
    // pierde la carrera queda huérfana pero con sus callbacks intactos, y sigue
    // ejecutando herramientas contra la colmena. Comparando la generación al
    // entrar, una sesión ya reemplazada deja de tener efecto.
    const gen = ++this.generation;
    const vigente = () => gen === this.generation && !this.closed;

    const session = await provider.connect({
      model: this.opts.model,
      apiKey: this.opts.apiKey,
      systemInstruction: this.opts.systemInstruction,
      tools: BRIDGE_TOOLS,
      voice: this.opts.voice,
      language: this.opts.language,
      silenceDurationMs: 600,
      // En manos libres se le sube el listón para darse por interrumpido: el
      // eco de un televisor al fondo de la sala no debe contar como alguien
      // hablándole encima.
      startOfSpeechSensitivity: this.opts.speakerMode ? "START_SENSITIVITY_LOW" : undefined,
      resumptionHandle: this.resumptionHandle,
      callbacks: {
        onAudio: (pcm) => {
          if (!vigente()) return;
          this.lastActivityAt = Date.now();
          if (!this.generatingSince) this.generatingSince = Date.now();
          this.sendBinary(pcm);
        },
        onInputTranscript: (text) => {
          if (!vigente()) return;
          this.lastActivityAt = Date.now();
          this.userTurnText += text;
          this.send({ type: "transcript", role: "user", text });
        },
        onOutputTranscript: (text) => {
          if (!vigente()) return;
          this.lastActivityAt = Date.now();
          this.modelTurnText += text;
          this.send({ type: "transcript", role: "assistant", text });
        },
        onInterrupted: () => {
          if (!vigente()) return;
          this.generatingSince = 0;
          this.send({ type: "interrupted" });
        },
        onTurnComplete: () => {
          if (!vigente()) return;
          this.generatingSince = 0;
          void this.persistTurn();
          this.send({ type: "turn_complete" });
          // Lo que se acumuló mientras hablaba puede salir ya.
          if (this.speechQueue.length) this.scheduleFlush(URGENT_COALESCE_MS);
        },
        onToolCall: (calls) => {
          // La comprobación más importante de todas: una sesión reemplazada que
          // pida ejecutar una herramienta duplicaría trabajo real en la colmena.
          if (!vigente()) {
            log.warn(`toolCall descartada: llegó de una sesión ya reemplazada (gen ${gen})`);
            return;
          }
          void this.runToolCalls(calls);
        },
        onUsage: (usage) => {
          if (!vigente()) return;
          // El proveedor reporta el acumulado de la sesión, no el delta; una
          // reconexión reinicia su contador, así que se suma por tramo.
          this.usage = {
            inputTokens: this.usageBase.inputTokens + usage.inputTokens,
            outputTokens: this.usageBase.outputTokens + usage.outputTokens,
            totalTokens: this.usageBase.totalTokens + usage.totalTokens,
          };
          this.send({ type: "usage", ...this.usage });
        },
        onResumptionHandle: (handle) => {
          if (!vigente()) return;
          this.resumptionHandle = handle;
        },
        onGoAway: (timeLeftMs) => {
          if (!vigente()) return;
          log.info(`goAway en ${timeLeftMs}ms — reconectando con handle`);
          void this.reconnect();
        },
        onError: (error) => {
          if (!vigente()) return;
          log.warn(`error del proveedor: ${error.message}`);
          this.send({ type: "error", error: error.message });
        },
        onClose: (reason) => {
          if (!vigente()) return;
          // Cierre no solicitado: la sesión sigue viva del lado del navegador,
          // así que se retoma con el handle en vez de dejar al usuario mudo.
          log.info(`sesión upstream cerrada (${reason || "sin motivo"}) — reconectando`);
          void this.reconnect();
        },
      },
    });

    // Si mientras se abría esta conexión llegó otra generación (o se cerró la
    // sesión), la recién creada sobra: se cierra en el acto en vez de quedar
    // hablando con Gemini sin que nadie la escuche.
    if (gen !== this.generation || this.closed) {
      try {
        session.close();
      } catch {
        /* nunca llegó a abrirse del todo */
      }
      return;
    }

    this.session = session;
    this.send({ type: "ready", model: this.opts.model, voice: this.opts.voice ?? null });
  }

  private async reconnect(): Promise<void> {
    if (this.closed) return;
    // goAway y el cierre del socket llegan juntos: sin esta guarda cada uno
    // abría su propia sesión y quedaban dos vivas contra el mismo hilo.
    if (this.reconnecting) return;
    if (this.reconnects >= MAX_RECONNECTS) {
      this.send({ type: "error", error: "No pude reconectar con el modelo de voz." });
      this.close();
      return;
    }
    this.reconnecting = true;
    this.reconnects++;
    // El contador del proveedor arranca de cero en la conexión nueva.
    this.usageBase = { ...this.usage };
    try {
      this.session?.close();
    } catch {
      /* ya estaba cerrada */
    }
    this.session = null;
    try {
      await this.connect();
      this.reconnects = 0;
    } catch (error) {
      log.warn(`reconexión ${this.reconnects} falló: ${(error as Error).message}`);
      // El reintento se agenda con la guarda ya liberada, si no quedaría mudo.
      setTimeout(() => void this.reconnect(), 1_000 * this.reconnects);
    } finally {
      this.reconnecting = false;
    }
  }

  // ── Entrada desde el navegador ─────────────────────────────────────────────

  handleAudio(pcm: ArrayBufferLike): void {
    if (!this.session || this.closed) return;
    this.session.sendAudio(pcm);
  }

  /**
   * Fotograma de imagen del usuario: cámara o pantalla compartida.
   *
   * Cuenta como actividad para el temporizador de inactividad: alguien que
   * comparte pantalla en silencio sigue esperando ayuda, y cerrarle la sesión
   * a los tres minutos sería absurdo.
   */
  handleVideoFrame(base64: string, mimeType: string, source: "camera" | "screen" = "camera"): void {
    if (!this.session || this.closed || !base64) return;
    this.lastActivityAt = Date.now();
    if (this.fuenteVisual !== source) {
      this.fuenteVisual = source;
      // Un aviso al entrar, no en cada fotograma: el modelo necesita saber qué
      // empieza a ver, pero repetirlo 60 veces por minuto ahogaría la charla.
      this.speak(
        source === "screen"
          ? "[HIVE] La persona empezó a compartir su pantalla. Ya la ves."
          : "[HIVE] La persona encendió su cámara. Ya la ves.",
      );
    }
    this.session.sendVideoFrame(base64, mimeType);
  }

  /** Deja de ver: la próxima fuente vuelve a anunciarse. */
  olvidarFuenteVisual(): void {
    this.fuenteVisual = null;
  }

  /** Texto tipeado por el usuario: va directo, es él quien decide interrumpir. */
  handleText(text: string): void {
    if (!this.session || this.closed) return;
    this.lastActivityAt = Date.now();
    this.session.sendText(text);
  }

  /**
   * Inyecta un hito de la colmena para que el modelo lo cuente hablando. No se
   * envía en el acto: se junta con los que vengan detrás y espera a que el
   * modelo termine la frase en curso.
   */
  speak(text: string): void {
    this.enqueueSpeech(text, NARRATION_COALESCE_MS);
  }

  /** Resultados y errores: mismo camino, pero sin esperar a más hitos. */
  speakUrgent(text: string): void {
    this.enqueueSpeech(text, URGENT_COALESCE_MS);
  }

  /**
   * Manda el hito a la UI. Va aparte de `speak()` porque el panel muestra TODO
   * lo que hace la colmena, mientras que la voz sólo cuenta los hitos: leer en
   * voz alta cada paso sería insoportable, pero verlos escritos es justamente
   * lo que hace que la espera se entienda.
   */
  sendNarration(frame: Omit<NarrationFrame, "type">): void {
    this.send({ type: "narration", ...frame });
  }

  private enqueueSpeech(text: string, delay: number): void {
    if (!this.session || this.closed || !text.trim()) return;
    this.lastActivityAt = Date.now();
    this.speechQueue.push(text);
    if (this.speechQueue.length > MAX_QUEUED_NARRATION) {
      this.speechQueue.splice(0, this.speechQueue.length - MAX_QUEUED_NARRATION);
    }
    this.scheduleFlush(delay);
  }

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushSpeech(), delay);
  }

  private flushSpeech(): void {
    this.flushTimer = null;
    if (!this.speechQueue.length || !this.session || this.closed) return;

    // Sigue hablando: reintentamos en breve en vez de cortarlo. El tope evita
    // que un turnComplete perdido deje la narración muda para siempre.
    if (this.generatingSince && Date.now() - this.generatingSince < GENERATING_MAX_MS) {
      this.scheduleFlush(400);
      return;
    }

    const text = this.speechQueue.join("\n");
    this.speechQueue = [];
    this.session.sendText(text);
  }

  // ── Funciones puente ───────────────────────────────────────────────────────

  private async runToolCalls(calls: RealtimeToolCall[]): Promise<void> {
    for (const call of calls) {
      if (call.name === CONSULT_TOOL) this.delegatedThisTurn = true;
      let result: Record<string, unknown>;
      try {
        result = await executeBridgeTool(call.name, call.args, {
          sessionId: this.opts.sessionId,
          userId: this.opts.userId,
          speak: (text) => this.speakUrgent(text),
          isAlive: () => this.isAlive,
        });
      } catch (error) {
        result = { ok: false, error: (error as Error).message };
      }
      this.send({ type: "tool", name: call.name, ok: result.ok !== false });
      this.session?.sendToolResult(call.id, call.name, result);
    }
  }

  // ── Persistencia ───────────────────────────────────────────────────────────

  /**
   * Guarda en el hilo la charla hablada que NO pasó por la colmena. Cuando se
   * delegó, el chat_turn ya persistió la petición y la respuesta: escribirlas
   * otra vez acá duplicaría el historial.
   */
  private async persistTurn(): Promise<void> {
    const user = this.userTurnText.trim();
    const model = this.modelTurnText.trim();
    this.userTurnText = "";
    this.modelTurnText = "";
    const delegated = this.delegatedThisTurn;
    this.delegatedThisTurn = false;

    if (delegated || (!user && !model)) return;

    try {
      // `realtime_chat` (no `realtime`): esto ya se respondió hablando. Marcarlo
      // como turno normal hacía que el coordinador lo leyera como pedido nuevo y
      // delegara una tarea por cada frase suelta de la llamada.
      if (user) await addMessage(this.opts.threadId, "user", user, { channel: "webchat", source: "realtime_chat" });
      if (model) await addMessage(this.opts.threadId, "assistant", model, { channel: "webchat", source: "realtime_chat" });
    } catch (error) {
      log.warn(`no pude persistir el turno hablado: ${(error as Error).message}`);
    }
  }

  // ── Salida hacia el navegador ──────────────────────────────────────────────

  private send(frame: ServerFrame): void {
    if (this.opts.ws.readyState !== 1) return;
    try {
      this.opts.ws.send(JSON.stringify(frame));
    } catch {
      /* el navegador se fue */
    }
  }

  private sendBinary(pcm: Buffer): void {
    if (this.opts.ws.readyState !== 1) return;
    try {
      this.opts.ws.send(pcm);
    } catch {
      /* el navegador se fue */
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.speechQueue = [];
    olvidarPeticiones(this.opts.sessionId);
    try {
      this.session?.close();
    } catch {
      /* ya estaba cerrada */
    }
    this.session = null;
  }
}
