/**
 * Protocolo del socket /realtime.
 *
 * Es distinto al de /ws (slash-commands.ts) a propósito: aquel transporta
 * mensajes de chat, éste transporta audio. Los frames binarios son PCM16 mono
 * crudo en ambos sentidos — 16 kHz hacia el servidor, 24 kHz hacia el navegador —
 * y el JSON queda para control y transcripciones.
 */

export type ClientFrame =
  /** Texto escrito en vez de hablado, dentro de la misma sesión de voz. */
  | { type: "text"; content: string }
  /**
   * Fotograma de imagen (JPEG en base64), a baja cadencia.
   *
   * `source` distingue la cámara de la pantalla compartida. Van por el mismo
   * frame a propósito: para el modelo son imágenes idénticas, y duplicar el
   * tipo obligaría a duplicar también todo el camino hasta el proveedor.
   */
  | { type: "video"; data: string; mimeType?: string; source?: "camera" | "screen" }
  /** El usuario cortó al modelo desde la UI (barge-in manual). */
  | { type: "interrupt" }
  | { type: "ping" };

/** Hito de la colmena, tal como lo emite el agent-loop (events/narration.ts). */
export interface NarrationFrame {
  type: "narration";
  kind: "delegated" | "worker_started" | "tool_call" | "tool_result" | "verified" | "failed" | "group_ready";
  status: string;
  label: string;
  detail: string | null;
  /** Especialista al que pertenece el hito; vacío = el coordinador. */
  agent: string;
  at: number;
}

export type ServerFrame =
  | { type: "ready"; model: string; voice: string | null }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  /** Vaciar la cola de reproducción YA: el usuario habló encima. */
  | { type: "interrupted" }
  | { type: "turn_complete" }
  /** Una función puente se ejecutó (para pintar estado en la UI). */
  | { type: "tool"; name: string; ok: boolean }
  /** Lo que la colmena está haciendo por dentro, para la línea de tiempo. */
  | NarrationFrame
  /** Consumo acumulado de la sesión: alimenta el contador de costo en vivo. */
  | { type: "usage"; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: "error"; error: string }
  | { type: "closed"; reason: string }
  | { type: "pong" };

export function parseClientFrame(raw: string): ClientFrame | null {
  try {
    const parsed = JSON.parse(raw) as ClientFrame;
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}
