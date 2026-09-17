/**
 * Transporte del modo de voz en tiempo real.
 *
 * server.ts sólo llama a estos cuatro handlers; toda la mecánica vive acá para
 * no seguir engordando un archivo que ya pasa las 2400 líneas.
 *
 * El sessionId del socket es `realtime:<userId>`, pero el lane de la cola y el
 * hilo de conversación son los del WebChat del usuario: lo hablado y lo escrito
 * son la misma conversación.
 */

import type { ServerWebSocket } from "bun";
import { DEFAULT_GEMINI_LIVE_MODEL } from "../../agent/realtime-providers";
import { shouldDeliverToChannel, type NarrationMode } from "../../events/channel-narration";
import { loadProviderApiKey } from "../../storage/crypto";
import { col } from "../../storage/hive";
import type { AgentDoc, ModelDoc, NarrationEventDoc, UserDoc } from "../../storage/collections";
import { logger } from "../../utils/logger";
import { resolveWebThread } from "../webchat-turn";
import { getRecentMessages, getSummary, isInternalSource } from "../../agent/conversation-store";
import { buildVoicePrompt, type VoiceHistory } from "./prompt";
import { parseClientFrame } from "./protocol";
import { RealtimeVoiceSession } from "./voice-session";

const log = logger.child("realtime");

export const REALTIME_PREFIX = "realtime:";
export const DEFAULT_VOICE = "Kore";
/** Español de Colombia por defecto; el usuario lo cambia en la consola de voz. */
export const DEFAULT_LANGUAGE = "es-CO";
/** Único proveedor con adaptador realtime hoy. */
const REALTIME_PROVIDER = "gemini";
/** Sólo hitos: hablar cada paso de cada herramienta es insoportable. */
const VOICE_NARRATION_MODE: NarrationMode = "milestones";

/** Sesiones vivas, indexadas por el sessionId de WebChat (el del lane). */
const sessions = new Map<string, RealtimeVoiceSession>();

export function getVoiceSession(sessionId: string): RealtimeVoiceSession | undefined {
  return sessions.get(sessionId);
}

export function hasVoiceSessions(): boolean {
  return sessions.size > 0;
}

/**
 * Narración hablada. Se compone con el adaptador de entrega de eventos que ya
 * existe (events/narration.ts): si el turno pertenece a un usuario con la voz
 * abierta, el hito se le inyecta al modelo para que lo cuente. La entrega normal
 * al chat sigue igual — el usuario ve el proceso escrito y lo escucha a la vez.
 *
 * Se filtra con la misma política que los canales de mensajería y por el mismo
 * motivo, agravado: en el chat un tool_call es un widget plegable, pero hablado
 * es una frase que hay que escuchar entera. Con `all`, un turno que delega dos
 * workers narraría veinte pasos y taparía la respuesta.
 */
export function deliverNarrationToVoice(event: NarrationEventDoc): boolean {
  if (!sessions.size || !event.session_id) return false;
  const session = sessions.get(event.session_id);
  if (!session?.isAlive) return false;

  // El panel ve todo lo que pasa; la voz sólo cuenta los hitos.
  session.sendNarration({
    kind: event.kind,
    status: event.status,
    label: event.label,
    detail: event.detail,
    agent: event.agent_name || event.agent_id || "",
    at: event.created_at,
  });

  if (!shouldDeliverToChannel(event, VOICE_NARRATION_MODE)) return false;

  const detail = event.detail ? ` ${compactForSpeech(event.detail)}` : "";
  session.speak(`[HIVE] ${event.label}${detail}`);
  return true;
}

/** Los detalles traen stacks, rutas y JSON: hablados no aportan nada. */
function compactForSpeech(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length <= 140 ? flat : `${flat.slice(0, 139)}…`;
}

/**
 * Contexto previo para la llamada, recortado a lo que vale la pena pagar.
 *
 * El system instruction de la Live API se manda entero al conectar y no se puede
 * cambiar después, así que esto se cobra una vez por llamada: pocos turnos y
 * cortos. Se excluyen los eventos internos (fan-in de delegación), que no son
 * palabras de nadie.
 */
const VOICE_HISTORY_TURNS = 12;
const VOICE_HISTORY_CHARS = 220;
const VOICE_SUMMARY_CHARS = 800;

async function loadVoiceHistory(threadId: string): Promise<VoiceHistory | null> {
  try {
    const [mensajes, resumen] = await Promise.all([
      getRecentMessages(threadId, VOICE_HISTORY_TURNS),
      getSummary(threadId).catch(() => null),
    ]);

    const turnos = mensajes
      .filter((m) => (m.role === "user" || m.role === "assistant") && !isInternalSource(m.source))
      .map((m) => ({
        role: m.role as "user" | "assistant",
        // El chat antepone `[Timestamp: ...]` a cada mensaje del usuario: hablado
        // no aporta nada y ocupa la mitad de la línea.
        text: truncar(m.content.replace(/^\[Timestamp:[^\]]*\]\s*/, ""), VOICE_HISTORY_CHARS),
      }))
      .filter((t) => t.text.length > 0);

    if (!turnos.length && !resumen?.summary) return null;
    return { resumen: resumen?.summary?.slice(0, VOICE_SUMMARY_CHARS) ?? null, turnos };
  } catch (error) {
    // Sin contexto se habla igual: nunca impedir que la llamada abra.
    log.warn(`no pude cargar el contexto de ${threadId}: ${(error as Error).message}`);
    return null;
  }
}

function truncar(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

// ─── Handlers llamados desde server.ts ───────────────────────────────────────

export interface RealtimeUpgradeData {
  sessionId: string;
  webchatSessionId: string;
  /** Conversación de la web que continúa esta llamada. Vacío = la más reciente. */
  threadId?: string;
  voice: string;
  /** BCP-47 con acento regional (es-CO, es-MX…), elegido en la consola de voz. */
  language: string;
  /** Manos libres: la voz sale por un altavoz abierto, no por auriculares. */
  speakerMode: boolean;
  authenticatedAt: number;
}

/** Datos del `server.upgrade()`. La autenticación la hace server.ts, como en /ws. */
export function buildUpgradeData(
  userId: string,
  voice?: string | null,
  language?: string | null,
  speakerMode?: string | null,
  threadId?: string | null,
): RealtimeUpgradeData {
  return {
    sessionId: `${REALTIME_PREFIX}${userId}`,
    webchatSessionId: userId,
    threadId: threadId?.trim() || undefined,
    voice: voice?.trim() || DEFAULT_VOICE,
    language: language?.trim() || DEFAULT_LANGUAGE,
    speakerMode: speakerMode === "1",
    authenticatedAt: Date.now(),
  };
}

export async function handleRealtimeOpen(ws: ServerWebSocket<any>): Promise<void> {
  const data = ws.data as RealtimeUpgradeData;
  const webchatSessionId = data.webchatSessionId;

  try {
    const apiKey =
      (await loadProviderApiKey(REALTIME_PROVIDER)) || process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      throw new Error(
        "Falta la API key de Google Gemini. Configúrala en Ajustes → Proveedores para usar la voz en tiempo real.",
      );
    }

    // Misma conversación que el chat escrito: si la consola mandó una, se usa esa;
    // si no, la más reciente de la web. Hablar y escribir son el mismo hilo.
    const { userId, threadId } = await resolveWebThread(webchatSessionId, data.threadId);
    const [agentsCol, usersCol] = await Promise.all([col<AgentDoc>("agents"), col<UserDoc>("users")]);
    const coordinators = await agentsCol.findBy("role", "coordinator", { limit: 1 });
    const [agent, user] = await Promise.all([
      agentsCol.get(coordinators[0]?.id || "bee").catch(() => null),
      usersCol.get(userId).catch(() => null),
    ]);

    // Lo ya hablado/escrito en esta conversación. BIA lo escribía pero no lo leía:
    // cada llamada empezaba en blanco aunque el chat de texto sí recordara.
    const historial = await loadVoiceHistory(threadId);

    const session = new RealtimeVoiceSession({
      ws,
      sessionId: webchatSessionId,
      userId,
      threadId,
      providerId: REALTIME_PROVIDER,
      model: await resolveRealtimeModel(),
      apiKey,
      voice: data.voice,
      language: data.language,
      speakerMode: data.speakerMode,
      // El estilo sale del setup —el tono elegido y el idioma del usuario son
      // los mismos que usa la voz—, pero el nombre no: la voz es BIA siempre.
      systemInstruction: buildVoicePrompt({
        userName: user?.doc.name ?? null,
        // El idioma elegido en la consola manda sobre el del perfil: es la
        // elección explícita para esta llamada, y es lo único que el modelo
        // obedece (speechConfig.languageCode lo ignora en audio nativo).
        language: data.language,
        tone: agent?.doc.tone ?? null,
        userNotes: user?.doc.notes ?? null,
        historial,
      }),
    });

    // Una sesión de voz por usuario: abrir otra pestaña reemplaza la anterior en
    // vez de dejar dos micrófonos hablándole al mismo hilo.
    sessions.get(webchatSessionId)?.close();
    sessions.set(webchatSessionId, session);

    await session.start();
    log.info(`voz abierta para ${webchatSessionId}`);
  } catch (error) {
    const message = (error as Error).message;
    log.warn(`no pude abrir la voz para ${webchatSessionId}: ${message}`);
    try {
      ws.send(JSON.stringify({ type: "error", error: message }));
      ws.close();
    } catch {
      /* el navegador ya se fue */
    }
  }
}

export function handleRealtimeMessage(ws: ServerWebSocket<any>, message: string | Buffer): void {
  const data = ws.data as RealtimeUpgradeData;
  const session = sessions.get(data.webchatSessionId);
  if (!session) return;

  // Audio crudo: PCM16 16 kHz. Es la ruta caliente, va primero y sin JSON.
  if (typeof message !== "string") {
    session.handleAudio(message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength));
    return;
  }

  const frame = parseClientFrame(message);
  if (!frame) return;

  switch (frame.type) {
    case "text":
      session.handleText(frame.content);
      break;
    case "video":
      session.handleVideoFrame(frame.data, frame.mimeType ?? "image/jpeg", frame.source ?? "camera");
      break;
    case "interrupt":
      // Un turno vacío del usuario corta la generación en curso del modelo.
      session.handleText(" ");
      break;
    case "ping":
      try {
        ws.send(JSON.stringify({ type: "pong" }));
      } catch {
        /* socket cerrado */
      }
      break;
  }
}

export function handleRealtimeClose(ws: ServerWebSocket<any>): void {
  const data = ws.data as RealtimeUpgradeData;
  const session = sessions.get(data.webchatSessionId);
  if (!session) return;
  session.close();
  sessions.delete(data.webchatSessionId);
  log.info(`voz cerrada para ${data.webchatSessionId}`);
}

export function closeAllVoiceSessions(): void {
  for (const session of sessions.values()) session.close();
  sessions.clear();
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

/**
 * Modelo realtime del catálogo. El scan no garantiza orden, así que sin una
 * preferencia explícita la sesión abría con el modelo que cayera primero.
 * Prioridad: el que el usuario marcó activo → el recomendado → cualquiera.
 */
async function resolveRealtimeModel(): Promise<string> {
  try {
    const modelsCol = await col<ModelDoc>("models");
    const candidates = (await modelsCol.findBy("model_type", "realtime")).filter(
      (e) => e.doc.provider_id === REALTIME_PROVIDER && e.doc.enabled,
    );
    const pick =
      candidates.find((e) => e.doc.active) ??
      candidates.find((e) => e.doc.id === DEFAULT_GEMINI_LIVE_MODEL) ??
      candidates[0];
    if (pick) return pick.doc.id;
  } catch {
    /* BD sin sembrar todavía */
  }
  return DEFAULT_GEMINI_LIVE_MODEL;
}
