/**
 * Funciones puente entre la sesión de voz y el agent-loop de Hive.
 *
 * Son EXACTAMENTE tres y están congeladas: la Live API declara las tools en el
 * `setup` y no admite cambiarlas a mitad de sesión, así que el catálogo dinámico
 * de Hive (MINIMAL_TOOLS + inyección en caliente tras search_knowledge) no puede
 * vivir acá. La sesión de voz no ejecuta ninguna herramienta de la colmena: sólo
 * traduce voz → intención y encola un turno normal, que es quien coordina, delega
 * y ejecuta. Todo lo que Hive gane en el chat de texto aparece en voz sin tocar
 * este archivo.
 *
 * `consultar_a_bee` devuelve un ACUSE inmediato, nunca el resultado:
 * gemini-3.1-flash-live no soporta function calling asíncrono, así que una tool
 * que tarde bloquea la conversación entera. El resultado llega después, inyectado
 * como texto por el mismo camino que la narración.
 */

import { col, fromIndexable } from "../../storage/hive";
import type { AgentDoc, AgentRunDoc, JobDoc, NarrationEventDoc, TaskDoc } from "../../storage/collections";
import { getAgentLiveStates } from "../../canvas/emitter";
import { logger } from "../../utils/logger";
import type { LLMToolDef } from "../../agent/llm-client";
import { enqueueChatTurn } from "../webchat-turn";
import { getDurableQueue } from "../durable-queue";
import { getJob } from "../job-store";
import { sessionManager } from "../session";

const log = logger.child("realtime:bridge");

export const CONSULT_TOOL = "consultar_a_bee";
export const STATUS_TOOL = "estado_de_la_colmena";
export const CANCEL_TOOL = "cancelar_tarea";

export const BRIDGE_TOOLS: LLMToolDef[] = [
  {
    type: "function",
    function: {
      name: CONSULT_TOOL,
      description:
        "Encola la petición del usuario en la colmena de Hive, donde Bee coordina, delega en los " +
        "especialistas y usa todas las herramientas disponibles. Llámala SIEMPRE que el usuario pida " +
        "algo que requiera trabajo real: buscar información, leer o escribir archivos, generar " +
        "documentos, programar tareas, consultar APIs o cualquier cosa que no sepas de memoria. " +
        "Devuelve un acuse inmediato, NUNCA el resultado: el resultado llega después.",
      parameters: {
        type: "object",
        properties: {
          peticion: {
            type: "string",
            description:
              "La petición del usuario reformulada de forma completa y auto-contenida, con todo el " +
              "contexto necesario de lo que vinieron hablando. Quien la lee no escuchó la conversación.",
          },
        },
        required: ["peticion"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: STATUS_TOOL,
      description:
        "Devuelve lo que pasa en la colmena ahora mismo: qué hace Bee, qué especialista tiene cada " +
        "tarea y con qué herramienta trabaja, qué terminó hace poco con su resultado o error, y los " +
        "últimos pasos de esta conversación. Es instantánea: úsala siempre que el usuario pregunte " +
        "qué está pasando, quién trabaja, cómo va, qué salió o por qué tarda, en vez de suponerlo.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: CANCEL_TOOL,
      description:
        "Cancela el trabajo en curso de este usuario. Úsala sólo si el usuario pide explícitamente " +
        "parar, cancelar o dejarlo.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export interface BridgeContext {
  /** sessionId del WebChat del usuario: identifica al usuario y su socket, no la conversación. */
  sessionId: string;
  /**
   * La conversación de la llamada, la misma del chat escrito. Es el lane de la
   * cola: los turnos de voz iban al lane del sessionId mientras Bee trabajaba en
   * la conversación, así que corrían en paralelo con los del chat, y el resumen
   * de lo delegado —que vuelve al lane de la conversación— nunca llegaba a la voz.
   */
  threadId: string;
  userId: string;
  /** Inyecta texto en la sesión de voz para que Bee lo diga. */
  speak: (text: string) => void;
  /** Sigue vivo el socket de voz. Sin esto seguiríamos hablándole a nadie. */
  isAlive: () => boolean;
}

/**
 * Ejecuta una función puente. Devuelve siempre en milisegundos: cualquier espera
 * acá es silencio en la llamada.
 */
export async function executeBridgeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<Record<string, unknown>> {
  switch (name) {
    case CONSULT_TOOL:
      return consultarABee(args, ctx);
    case STATUS_TOOL:
      return estadoDeLaColmena(ctx);
    case CANCEL_TOOL:
      return cancelarTarea(ctx);
    default:
      return { ok: false, error: `Función desconocida: ${name}` };
  }
}

/**
 * Peticiones vivas por sesión. La sesión de voz reintenta con facilidad: cada
 * hito narrado vuelve a entrar como turno y el modelo, viendo un pedido "sin
 * responder", delega otra vez. Sin esta guarda, un solo "lístame los archivos"
 * terminaba en tres tareas idénticas gastando tokens en paralelo.
 */
const enCurso = new Map<string, Array<{ peticion: string; jobId: string; at: number }>>();

export function olvidarPeticiones(sessionId: string): void {
  enCurso.delete(sessionId);
}

/** Normaliza para comparar: sin tildes, sin puntuación, sin muletillas de cortesía. */
function normalizar(texto: string): Set<string> {
  const limpio = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
  const vacias = new Set([
    "el", "la", "los", "las", "un", "una", "de", "del", "que", "y", "o", "a", "en", "por",
    "para", "con", "me", "mi", "su", "es", "son", "por favor", "usuario", "quiere", "pide",
  ]);
  return new Set(limpio.split(/\s+/).filter((w) => w.length > 2 && !vacias.has(w)));
}

/** Palabras con contenido que deben coincidir para siquiera considerar un duplicado. */
const MINIMO_COMUNES = 3;

/**
 * Solapamiento (Szymkiewicz–Simpson), no Jaccard.
 *
 * Lo que se compara son dos reformulaciones que hizo el propio modelo del mismo
 * pedido, y suelen tener largos muy distintos ("lista los archivos" vs "El
 * usuario pide que liste los archivos del espacio de trabajo"). Jaccard castiga
 * esa asimetría y daba 0.3 a pedidos idénticos; el solapamiento la ignora.
 *
 * El piso de MINIMO_COMUNES palabras es lo que evita el falso positivo caro:
 * "busca el precio del dólar" y "busca el precio del euro" solapan alto pero
 * sólo comparten dos palabras, así que se tratan como pedidos distintos —
 * bloquear un pedido legítimo en silencio es peor que dejar pasar uno repetido.
 */
export function similitud(a: string, b: string): number {
  const sa = normalizar(a);
  const sb = normalizar(b);
  if (!sa.size || !sb.size) return 0;
  let comunes = 0;
  for (const w of sa) if (sb.has(w)) comunes++;
  if (comunes < MINIMO_COMUNES) return 0;
  return comunes / Math.min(sa.size, sb.size);
}

/**
 * Ventana en la que un pedido parecido es, casi seguro, el modelo reintentando.
 * Nadie cambia de tema y vuelve a pedir algo distinto pero casi idéntico en
 * medio minuto mientras espera una respuesta.
 */
const VENTANA_REINTENTO_MS = 30_000;
/** Dentro de la ventana pesa más cortar el reintento que dejar pasar un matiz. */
const UMBRAL_EN_VENTANA = 0.5;
/** Fuera de ella sólo se descarta una repetición casi literal. */
const UMBRAL_TARDIO = 0.8;
/** Más allá de esto no se compara nada: el pedido se rehace por voluntad del usuario. */
const VENTANA_DEDUPE_MS = 4 * 60_000;

/**
 * ¿La petición nueva es el mismo trabajo que una ya encolada?
 *
 * El texto solo no alcanza: "busca el precio del dólar" y "busca el precio del
 * euro" se parecen mucho y son pedidos distintos. La señal que los separa es el
 * tiempo — el modelo reintenta en segundos, la persona reformula más tarde — así
 * que el umbral se endurece con los segundos transcurridos.
 */
export function esDuplicado(previa: string, nueva: string, msDesdePrevia: number): boolean {
  if (msDesdePrevia > VENTANA_DEDUPE_MS) return false;
  const score = similitud(previa, nueva);
  return msDesdePrevia <= VENTANA_REINTENTO_MS
    ? score >= UMBRAL_EN_VENTANA
    : score >= UMBRAL_TARDIO;
}

async function consultarABee(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<Record<string, unknown>> {
  const peticion = typeof args.peticion === "string" ? args.peticion.trim() : "";
  if (!peticion) {
    return { ok: false, error: "Falta la petición: pídele al usuario que la repita." };
  }

  const activas = enCurso.get(ctx.sessionId) ?? [];
  const vivas: typeof activas = [];
  for (const previa of activas) {
    if (Date.now() - previa.at > VENTANA_DEDUPE_MS) continue;
    const job = await getJob(previa.jobId).catch(() => null);
    if (!job || job.status === "pending" || job.status === "running") vivas.push(previa);
  }

  const ahora = Date.now();
  const repetida = vivas.find((p) => esDuplicado(p.peticion, peticion, ahora - p.at));
  if (repetida) {
    enCurso.set(ctx.sessionId, vivas);
    log.info(`[${CONSULT_TOOL}] descartada por duplicada de job=${repetida.jobId}`);
    return {
      ok: true,
      estado: "ya_en_curso",
      job_id: repetida.jobId,
      nota: "Eso ya se está haciendo. No lo pidas de nuevo: dile al usuario que sigue en curso.",
    };
  }

  // El turno se pinta en el chat de texto si el usuario tiene la pestaña abierta:
  // la conversación hablada y la escrita son el mismo hilo.
  const chatSocket = sessionManager.get(ctx.sessionId)?.ws;
  const live =
    chatSocket && chatSocket.readyState === 1
      ? { sendRaw: (payload: string) => { try { chatSocket.send(payload); } catch { /* socket cerrado */ } } }
      : undefined;

  const job = await enqueueChatTurn({
    lane: ctx.threadId,
    payload: {
      source: "realtime",
      sessionId: ctx.sessionId,
      threadId: ctx.threadId,
      userId: ctx.userId,
      content: peticion,
      // Sin preferAudio: la voz la pone la sesión Live, no el TTS de cascada.
    },
    live,
  });

  log.info(`[${CONSULT_TOOL}] job=${job.id} lane=${ctx.threadId}`);
  enCurso.set(ctx.sessionId, [...vivas, { peticion, jobId: job.id, at: Date.now() }]);
  void seguirTurno(job.id, ctx);

  return {
    ok: true,
    estado: "encolado",
    job_id: job.id,
    nota: "Trabajo iniciado. Avisa en una frase corta que ya estás en eso; el resultado llega después.",
  };
}

/** Duración máxima que seguimos un turno antes de soltarlo (tareas muy largas siguen en el chat). */
const SEGUIMIENTO_MAX_MS = 15 * 60_000;
/** Gracia tras vaciarse el lane: el resumen de delegación se encola un instante después. */
const GRACIA_LANE_MS = 6_000;
/**
 * Cada cuánto recordarle al usuario que seguimos trabajando. Con la narración en
 * modo `milestones`, un turno que no delega no emite hitos: sin esto el usuario
 * escucha "ya me pongo con eso" y después silencio hasta el resultado, que es
 * exactamente la sensación de llamada cortada.
 */
const LATIDO_MS = 45_000;

/**
 * Sigue el trabajo hasta que la colmena se queda quieta y va contando lo que
 * sale. Vigila el lane entero, no el job inicial: cuando Bee delega en async,
 * ese primer turno termina sin respuesta y el resultado real llega en un turno
 * posterior ("delegation_summary") que la colmena encola sola. Seguir sólo el
 * primer job hacía que la voz anunciara "terminó sin texto" justo cuando el
 * trabajo recién empezaba.
 */
async function seguirTurno(jobId: string, ctx: BridgeContext): Promise<void> {
  const t0 = Date.now();
  const reportados = new Set<string>();
  let delay = 500;
  let vacioDesde = 0;
  let ultimoAviso = Date.now();

  while (Date.now() - t0 < SEGUIMIENTO_MAX_MS) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 3_000);
    if (!ctx.isAlive()) return;

    const jobs = await jobsDelLaneDesde(ctx.threadId, t0, jobId);
    if (!jobs.length) return;

    for (const job of jobs) {
      if (reportados.has(job.id)) continue;

      if (job.status === "completed") {
        reportados.add(job.id);
        const contenido = extraerContenido(job.result_json);
        // Sin texto = el turno delegó y sigue en marcha: callarse es correcto,
        // el resumen llegará en el siguiente job del lane.
        if (contenido) {
          ctx.speak(`[HIVE resultado] ${contenido}`);
          ultimoAviso = Date.now();
        }
      } else if (job.status === "failed" || job.status === "interrupted") {
        reportados.add(job.id);
        ctx.speak(`[HIVE error] No pude completar la tarea: ${job.error ?? "error desconocido"}`);
        ultimoAviso = Date.now();
      } else if (job.status === "cancelled") {
        reportados.add(job.id); // el usuario ya sabe que canceló
      }
    }

    const activos = jobs.some((j) => j.status === "pending" || j.status === "running");
    if (activos) {
      vacioDesde = 0;
      if (Date.now() - ultimoAviso >= LATIDO_MS) {
        ctx.speak("[HIVE] Sigo trabajando en eso.");
        ultimoAviso = Date.now();
      }
      continue;
    }
    // Nada corriendo: esperamos un poco por si la colmena encola el resumen.
    vacioDesde ||= Date.now();
    if (Date.now() - vacioDesde >= GRACIA_LANE_MS) return;
  }

  log.warn(`[${CONSULT_TOOL}] seguimiento del lane agotado tras ${SEGUIMIENTO_MAX_MS}ms`);
}

/** Jobs del lane creados por este pedido de voz (el inicial y lo que encadene). */
async function jobsDelLaneDesde(lane: string, desde: number, jobIdInicial: string): Promise<JobDoc[]> {
  try {
    const jobsCol = await col<JobDoc>("jobQueue");
    const entries = await jobsCol.findBy("lane", lane);
    const jobs = entries.map((e) => e.doc).filter((j) => j.created_at >= desde - 1_000);
    if (jobs.length) return jobs;
  } catch (error) {
    log.debug(`no pude listar el lane ${lane}: ${(error as Error).message}`);
  }
  const inicial = await getJob(jobIdInicial).catch(() => null);
  return inicial ? [inicial] : [];
}

function extraerContenido(resultJson: string | null): string {
  if (!resultJson) return "";
  try {
    const parsed = JSON.parse(resultJson);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object" && typeof (parsed as any).result === "string") {
      return (parsed as any).result;
    }
    return "";
  } catch {
    return "";
  }
}

/** Lo que BIA mira del enjambre: una ronda reciente, no toda la historia. */
const ESTADO_VENTANA_MS = 15 * 60_000;
const ESTADO_MAX_PASOS = 8;

const resumirTexto = (text: string | null | undefined, max: number): string | null => {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/**
 * La foto del enjambre para la voz. La Live API no deja darle contexto sin que
 * lo diga en voz alta (todo texto inyectado cuenta como turno del usuario), así
 * que en vez de empujarle cada paso, BIA lo consulta cuando lo necesita: qué
 * hace Bee, qué hace cada especialista con qué herramienta, qué terminó y los
 * últimos pasos de esta conversación. Antes sólo veía nombres de tareas.
 */
async function estadoDeLaColmena(ctx: BridgeContext): Promise<Record<string, unknown>> {
  try {
    const now = Date.now();
    const [tasksCol, runsCol, agentsCol, eventsCol] = await Promise.all([
      col<TaskDoc>("tasks"), col<AgentRunDoc>("agentRuns"), col<AgentDoc>("agents"), col<NarrationEventDoc>("narrationEvents"),
    ]);
    const agents = new Map((await agentsCol.scan({})).map((e) => [e.id, e.doc]));
    const nameOf = (id: string | null | undefined) => (id ? agents.get(id)?.name ?? id : "sin asignar");
    const live = new Map(getAgentLiveStates().map((s) => [s.agentId, s]));

    const coordinator = [...agents.values()].find((a) => a.role === "coordinator");
    const coordLive = coordinator ? live.get(coordinator.id) : undefined;
    const bee = coordLive && coordLive.status !== "idle"
      ? { estado: coordLive.status === "tool_call" ? "usando una herramienta" : "pensando", herramienta: coordLive.currentTool }
      : { estado: "libre" };

    const mine = async (task: TaskDoc) => {
      const run = task.run_id ? await runsCol.get(task.run_id) : null;
      return !!run && run.doc.user_id === ctx.userId;
    };
    const recent = (await tasksCol.scan({})).map((e) => e.doc)
      .filter((t) => t.status === "pending" || t.status === "in_progress" || now - t.updated_at < ESTADO_VENTANA_MS)
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 20);

    const activas: Array<Record<string, unknown>> = [];
    const terminadas: Array<Record<string, unknown>> = [];
    for (const task of recent) {
      if (!(await mine(task))) continue;
      const agentId = fromIndexable(task.agent_id);
      if (task.status === "pending" || task.status === "in_progress") {
        const state = agentId ? live.get(agentId) : undefined;
        activas.push({
          tarea: task.name,
          especialista: nameOf(agentId),
          estado: task.status === "in_progress" ? "en curso" : "en cola",
          herramienta_actual: state?.currentTool ?? null,
          progreso: task.progress,
        });
      } else if (task.status === "completed" || task.status === "failed") {
        terminadas.push({
          tarea: task.name,
          especialista: nameOf(agentId),
          resultado: task.status === "completed" ? "completada" : "falló",
          resumen: resumirTexto(task.status === "completed" ? task.result : task.error, 200),
          hace_segundos: Math.round((now - task.updated_at) / 1000),
        });
      }
    }

    const pasos = (await eventsCol.findBy("thread_id", ctx.threadId)).map((e) => e.doc)
      .filter((e) => now - e.created_at < ESTADO_VENTANA_MS)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, ESTADO_MAX_PASOS)
      .map((e) => ({
        agente: e.agent_name || nameOf(e.agent_id),
        paso: e.label,
        estado: e.status,
        detalle: resumirTexto(e.detail, 120),
        hace_segundos: Math.round((now - e.created_at) / 1000),
      }));

    return {
      ok: true,
      bee,
      tareas_activas: activas.length,
      tareas: activas,
      terminadas_recientes: terminadas.slice(0, 8),
      ultimos_pasos: pasos,
      nota: activas.length || bee.estado !== "libre"
        ? "Cuenta con tus palabras lo que está pasando; no leas la lista."
        : "No hay nada en curso ahora mismo.",
    };
  } catch (error) {
    return { ok: false, error: `No pude leer el estado: ${(error as Error).message}` };
  }
}

async function cancelarTarea(ctx: BridgeContext): Promise<Record<string, unknown>> {
  try {
    const cancelados = await getDurableQueue().cancelLane(ctx.threadId);
    return cancelados > 0
      ? { ok: true, cancelados, nota: "Trabajo cancelado. Confírmalo en una frase corta." }
      : { ok: true, cancelados: 0, nota: "No había nada en curso para cancelar." };
  } catch (error) {
    return { ok: false, error: `No pude cancelar: ${(error as Error).message}` };
  }
}
