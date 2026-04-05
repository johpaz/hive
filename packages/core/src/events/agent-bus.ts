/**
 * Agent Bus - Sistema de mensajería pub/sub para comunicación entre workers
 * 
 * Permite que los workers se comuniquen entre sí sin pasar por el coordinador.
 * Útil para:
 * - Notificar completado de tareas con dependencias
 * - Solicitar ayuda entre workers
 * - Compartir resultados intermedios
 * - Coordinar ejecución en paralelo
 */

import { EventEmitter } from "events";
import { logger } from "../utils/logger";
import { getDb } from "../storage/sqlite";

const log = logger.child("agent-bus");

// ─── Tipos de eventos ────────────────────────────────────────────────────────

export interface AgentBusEventMap {
  "worker:task_started": {
    workerId: string;
    workerName: string;
    taskId: number;
    taskName: string;
    projectId: string;
    timestamp: number;
  };
  "worker:task_completed": {
    workerId: string;
    workerName: string;
    taskId: number;
    taskName: string;
    projectId: string;
    result: string;
    timestamp: number;
  };
  "worker:task_failed": {
    workerId: string;
    workerName: string;
    taskId: number;
    taskName: string;
    projectId: string;
    error: string;
    timestamp: number;
  };
  "worker:help_request": {
    fromWorkerId: string;
    fromWorkerName: string;
    taskId: number;
    request: string;
    requiredSkill?: string;
    timestamp: number;
  };
  "worker:help_response": {
    toWorkerId: string;
    fromWorkerId: string;
    fromWorkerName: string;
    taskId: number;
    response: string;
    timestamp: number;
  };
  "worker:blocked": {
    workerId: string;
    workerName: string;
    taskId: number;
    blockedBy: string;
    reason: string;
    timestamp: number;
  };
  "worker:unblocked": {
    workerId: string;
    workerName: string;
    taskId: number;
    unblockedBy: string;
    timestamp: number;
  };
  "project:started": {
    projectId: string;
    projectName: string;
    coordinatorId: string;
    timestamp: number;
  };
  "project:completed": {
    projectId: string;
    projectName: string;
    coordinatorId: string;
    summary: string;
    timestamp: number;
  };
  "message:custom": {
    fromWorkerId: string;
    fromWorkerName: string;
    toWorkerId?: string;
    topic: string;
    content: string;
    timestamp: number;
  };
}

export type AgentBusEventKey = keyof AgentBusEventMap;

export interface AgentBusEventHandler<K extends AgentBusEventKey> {
  (data: AgentBusEventMap[K]): void | Promise<void>;
}

// ─── Message Store - Persistencia de mensajes en BD ─────────────────────────

export interface AgentBusMessage {
  id: number;
  event_type: string;
  from_worker_id: string | null;
  to_worker_id: string | null;
  topic: string | null;
  content: string;
  metadata: string | null;
  created_at: number;
  read: number;
}

/**
 * Guarda un mensaje en la base de datos para persistencia
 */
function persistMessage(event: AgentBusEventKey, data: any, metadata?: Record<string, unknown>): void {
  const db = getDb();
  
  // Extraer IDs de worker según el tipo de evento
  let fromWorkerId: string | null = null;
  let toWorkerId: string | null = null;
  let topic: string | null = null;
  let content: string;

  switch (event) {
    case "worker:task_started":
    case "worker:task_completed":
    case "worker:task_failed":
      fromWorkerId = (data as any).workerId || null;
      topic = event;
      content = JSON.stringify(data);
      break;
    case "worker:help_request":
      fromWorkerId = (data as any).fromWorkerId || null;
      topic = "help_request";
      content = (data as any).request || "";
      break;
    case "worker:help_response":
      fromWorkerId = (data as any).fromWorkerId || null;
      toWorkerId = (data as any).toWorkerId || null;
      topic = "help_response";
      content = (data as any).response || "";
      break;
    case "worker:blocked":
    case "worker:unblocked":
      fromWorkerId = (data as any).workerId || null;
      topic = event;
      content = JSON.stringify(data);
      break;
    case "message:custom":
      fromWorkerId = (data as any).fromWorkerId || null;
      toWorkerId = (data as any).toWorkerId || null;
      topic = (data as any).topic || null;
      content = (data as any).content || "";
      break;
    default:
      fromWorkerId = (data as any).workerId || (data as any).fromWorkerId || null;
      topic = event;
      content = JSON.stringify(data);
  }

  try {
    db.query(`
      INSERT OR IGNORE INTO agent_bus_messages
        (event_type, from_worker_id, to_worker_id, topic, content, metadata, created_at, read)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch(), 0)
    `).run(
      event,
      fromWorkerId,
      toWorkerId,
      topic,
      content,
      metadata ? JSON.stringify(metadata) : null
    );
  } catch (err) {
    log.warn(`Failed to persist message (non-critical): ${(err as Error).message}`);
  }
}

/**
 * Obtiene mensajes no leídos para un worker específico
 */
export function getUnreadMessagesForWorker(workerId: string, limit: number = 50): AgentBusMessage[] {
  const db = getDb();
  
  try {
    const messages = db.query<any, [string, number]>(`
      SELECT * FROM agent_bus_messages 
      WHERE (to_worker_id = ? OR to_worker_id IS NULL) AND read = 0
      ORDER BY created_at ASC
      LIMIT ?
    `).all(workerId, limit);

    // Marcar como leídos
    if (messages.length > 0) {
      const ids = messages.map((m: AgentBusMessage) => m.id).join(",");
      db.query(`UPDATE agent_bus_messages SET read = 1 WHERE id IN (${ids})`).run();
    }

    return messages;
  } catch (err) {
    log.error(`Failed to get unread messages: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Obtiene el historial de mensajes de un proyecto
 */
export function getProjectMessageHistory(projectId: string, limit: number = 100): AgentBusMessage[] {
  const db = getDb();
  
  try {
    // Primero obtenemos los task_ids del proyecto
    const tasks = db.query<any, [string]>(
      "SELECT id FROM tasks WHERE project_id = ?"
    ).all(projectId);

    if (tasks.length === 0) return [];

    // Obtenemos los agent_ids de las tareas
    const agentIds = tasks
      .map((t: any) => t.agent_id)
      .filter((id: string | null) => id !== null);

    if (agentIds.length === 0) return [];

    // Obtenemos mensajes relacionados a estos agents
    const placeholders = agentIds.map(() => "?").join(",");
    const messages = db.query<any, any[]>(`
      SELECT * FROM agent_bus_messages 
      WHERE from_worker_id IN (${placeholders})
      ORDER BY created_at DESC
      LIMIT ?
    `).all([...agentIds, limit]);

    return messages;
  } catch (err) {
    log.error(`Failed to get project message history: ${(err as Error).message}`);
    return [];
  }
}

// ─── Agent Bus Implementation ────────────────────────────────────────────────

class AgentBusImpl {
  private emitter = new EventEmitter();
  private logPrefix = "[agent-bus]";

  /**
   * Publica un evento en el bus
   */
  publish<K extends AgentBusEventKey>(event: K, data: AgentBusEventMap[K], metadata?: Record<string, unknown>): void {
    const enrichedData = {
      ...data,
      _eventId: crypto.randomUUID(),
      _timestamp: Date.now(),
      _event: event,
    } as AgentBusEventMap[K] & { _eventId: string; _timestamp: number; _event: string };

    // Emitir evento en memoria
    this.emitter.emit(event, enrichedData);

    // Persistir en BD
    persistMessage(event, enrichedData, metadata);

    log.info(`${this.logPrefix} published: ${event}`, { 
      event, 
      fromWorkerId: (data as any).workerId || (data as any).fromWorkerId,
      toWorkerId: (data as any).toWorkerId 
    });
  }

  /**
   * Se suscribe a un tipo de evento
   */
  subscribe<K extends AgentBusEventKey>(
    event: K, 
    handler: AgentBusEventHandler<K>
  ): () => void {
    this.emitter.on(event, handler);
    log.debug(`${this.logPrefix} subscribed to: ${event}`);
    
    return () => this.unsubscribe(event, handler);
  }

  /**
   * Se suscribe una vez a un evento
   */
  subscribeOnce<K extends AgentBusEventKey>(
    event: K, 
    handler: AgentBusEventHandler<K>
  ): void {
    this.emitter.once(event, handler);
  }

  /**
   * Cancela suscripción
   */
  unsubscribe<K extends AgentBusEventKey>(
    event: K, 
    handler: AgentBusEventHandler<K>
  ): void {
    this.emitter.off(event, handler);
  }

  /**
   * Elimina todos los listeners
   */
  removeAllListeners<K extends AgentBusEventKey>(event?: K): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Obtiene cantidad de listeners para un evento
   */
  listenerCount<K extends AgentBusEventKey>(event: K): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Publica un mensaje personalizado de worker a worker
   */
  sendMessage(
    fromWorkerId: string,
    fromWorkerName: string,
    content: string,
    options?: { toWorkerId?: string; topic?: string }
  ): void {
    this.publish("message:custom", {
      fromWorkerId,
      fromWorkerName,
      toWorkerId: options?.toWorkerId,
      topic: options?.topic || "general",
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Notifica que una tarea comenzó
   */
  notifyTaskStarted(
    workerId: string,
    workerName: string,
    taskId: number,
    taskName: string,
    projectId: string
  ): void {
    this.publish("worker:task_started", {
      workerId,
      workerName,
      taskId,
      taskName,
      projectId,
      timestamp: Date.now(),
    });
  }

  /**
   * Notifica que una tarea completó
   */
  notifyTaskCompleted(
    workerId: string,
    workerName: string,
    taskId: number,
    taskName: string,
    projectId: string,
    result: string
  ): void {
    this.publish("worker:task_completed", {
      workerId,
      workerName,
      taskId,
      taskName,
      projectId,
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Notifica que una tarea falló
   */
  notifyTaskFailed(
    workerId: string,
    workerName: string,
    taskId: number,
    taskName: string,
    projectId: string,
    error: string
  ): void {
    this.publish("worker:task_failed", {
      workerId,
      workerName,
      taskId,
      taskName,
      projectId,
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * Solicita ayuda a otros workers
   */
  requestHelp(
    fromWorkerId: string,
    fromWorkerName: string,
    taskId: number,
    request: string,
    requiredSkill?: string
  ): void {
    this.publish("worker:help_request", {
      fromWorkerId,
      fromWorkerName,
      taskId,
      request,
      requiredSkill,
      timestamp: Date.now(),
    });
  }

  /**
   * Responde a una solicitud de ayuda
   */
  respondToHelp(
    toWorkerId: string,
    fromWorkerId: string,
    fromWorkerName: string,
    taskId: number,
    response: string
  ): void {
    this.publish("worker:help_response", {
      toWorkerId,
      fromWorkerId,
      fromWorkerName,
      taskId,
      response,
      timestamp: Date.now(),
    });
  }
}

// Singleton
export const agentBus = new AgentBusImpl();

export type AgentBus = typeof agentBus;
