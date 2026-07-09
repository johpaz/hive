/**
 * Meeting Tools - 4 tools para transcripción de reuniones
 *
 * @category meeting
 *
 * - meeting_start       — Inicia una sesión de transcripción
 * - meeting_add_segment — Transcribe un chunk de audio y lo agrega a la sesión
 * - meeting_stop        — Detiene la sesión de transcripción
 * - meeting_report      — Obtiene el transcript completo para que el agente genere el reporte
 */

import type { Tool } from "../types.ts";
import { col, nextId, toIndexable } from "../../storage/hive.ts";
import type { MeetingSessionDoc, MeetingSegmentDoc } from "../../storage/collections.ts";
import { voiceService, type AudioInput } from "../../voice/index.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("meeting");

// ─── meeting_start ───────────────────────────────────────────────────────────

export const meetingStartTool: Tool = {
  name: "meeting_start",
  description:
    "Inicia una sesión de transcripción de reunión en tiempo real. | Start a real-time meeting transcription session.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Título de la reunión (default: 'Reunión sin título')",
      },
      stt_model: {
        type: "string",
        description:
          "Modelo STT a usar: 'whisper-large-v3-turbo' (default), 'whisper-large-v3', 'whisper-1'",
      },
    },
    required: [],
  },
  execute: async (params) => {
    const title = (params.title as string) || "Reunión sin título";
    const sttModel =
      (params.stt_model as string) || "whisper-large-v3-turbo";

    try {
      const id = crypto.randomUUID().replace(/-/g, "");
      const now = Date.now();
      const doc: MeetingSessionDoc = {
        id,
        user_id: toIndexable(null),
        title,
        status: "active",
        stt_model: sttModel,
        started_at: now,
        stopped_at: null,
        report_path: null,
        metadata: null,
      };

      const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
      await sessionsCol.put(id, doc, { expectedVersion: 0 });

      log.info(`Meeting session started: ${id} — "${title}"`);

      return {
        ok: true,
        session_id: id,
        title: doc.title,
        status: doc.status,
        stt_model: doc.stt_model,
        message: `✅ Sesión de reunión iniciada. ID: ${id}\nTítulo: "${title}"\nModelo STT: ${sttModel}`,
      };
    } catch (error) {
      log.error(`meeting_start error: ${(error as Error).message}`);
      return { ok: false, error: `Error al iniciar la sesión: ${(error as Error).message}` };
    }
  },
};

// ─── meeting_add_segment ─────────────────────────────────────────────────────

export const meetingAddSegmentTool: Tool = {
  name: "meeting_add_segment",
  description:
    "Transcribe un chunk de audio y lo agrega a la sesión de reunión activa. | Transcribe an audio chunk and add it to the active meeting session.",
  parameters: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "ID de la sesión de reunión activa",
      },
      audio_base64: {
        type: "string",
        description: "Audio codificado en base64 (webm, ogg, mp3)",
      },
      speaker: {
        type: "string",
        description: "Etiqueta del hablante (opcional, ej: 'Ana', 'Speaker 1')",
      },
      mime_type: {
        type: "string",
        description: "Tipo MIME del audio (default: 'audio/webm')",
      },
    },
    required: ["session_id", "audio_base64"],
  },
  execute: async (params) => {
    const sessionId = params.session_id as string;
    const audioBase64 = params.audio_base64 as string;
    const speaker = (params.speaker as string) || null;
    const mimeType = (params.mime_type as string) || "audio/webm";

    try {
      const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
      const sessionEntry = await sessionsCol.get(sessionId);

      if (!sessionEntry) {
        return { ok: false, error: `Sesión ${sessionId} no encontrada.` };
      }
      const session = sessionEntry.doc;
      if (session.status !== "active") {
        return {
          ok: false,
          error: `La sesión está ${session.status}. Solo se pueden agregar segmentos a sesiones activas.`,
        };
      }

      const audioInput: AudioInput = {
        type: "base64",
        data: audioBase64,
        mimeType,
      };

      let transcription: string;
      try {
        transcription = await voiceService.transcribe(audioInput, session.stt_model);
      } catch (transcribeError) {
        return {
          ok: false,
          error: `Error de transcripción: ${(transcribeError as Error).message}`,
        };
      }

      const paddedSeq = await nextId(`meetingSegments:${sessionId}`);
      const seq = parseInt(paddedSeq, 10) - 1; // preserve the original 0-based sequence

      const segmentsCol = await col<MeetingSegmentDoc>("meetingSegments");
      await segmentsCol.put(`${sessionId}:${paddedSeq}`, {
        id: `${sessionId}:${paddedSeq}`,
        session_id: sessionId,
        seq,
        speaker,
        text: transcription,
        duration_ms: null,
        created_at: Date.now(),
      }, { expectedVersion: 0 });

      log.info(`Segment ${seq} added to session ${sessionId}: "${transcription.substring(0, 60)}..."`);

      return {
        ok: true,
        seq,
        speaker: speaker || null,
        text: transcription,
        message: speaker ? `[${speaker}]: ${transcription}` : transcription,
      };
    } catch (error) {
      log.error(`meeting_add_segment error: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Error al agregar segmento: ${(error as Error).message}`,
      };
    }
  },
};

// ─── meeting_stop ────────────────────────────────────────────────────────────

export const meetingStopTool: Tool = {
  name: "meeting_stop",
  description:
    "Detiene una sesión de transcripción de reunión. | Stop an active meeting transcription session.",
  parameters: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "ID de la sesión de reunión a detener",
      },
    },
    required: ["session_id"],
  },
  execute: async (params) => {
    const sessionId = params.session_id as string;

    try {
      const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
      const sessionEntry = await sessionsCol.get(sessionId);

      if (!sessionEntry) {
        return { ok: false, error: `Sesión ${sessionId} no encontrada.` };
      }
      const session = sessionEntry.doc;
      if (session.status === "stopped" || session.status === "report_ready") {
        return {
          ok: true,
          session_id: sessionId,
          message: `La sesión ya estaba detenida (status: ${session.status}).`,
        };
      }

      await sessionsCol.put(sessionId, { ...session, status: "stopped", stopped_at: Date.now() }, { expectedVersion: sessionEntry.version });

      const segmentsCol = await col<MeetingSegmentDoc>("meetingSegments");
      const count = (await segmentsCol.scan({ prefix: `${sessionId}:` })).length;

      log.info(`Meeting session stopped: ${sessionId} — ${count} segments`);

      return {
        ok: true,
        session_id: sessionId,
        title: session.title,
        segment_count: count,
        message: `⏹️ Sesión "${session.title}" detenida.\n${count} segmentos transcritos.\n\nPuedes pedir el reporte con: "Genera el reporte de la reunión ${sessionId}"`,
      };
    } catch (error) {
      log.error(`meeting_stop error: ${(error as Error).message}`);
      return { ok: false, error: `Error al detener la sesión: ${(error as Error).message}` };
    }
  },
};

// ─── meeting_report ──────────────────────────────────────────────────────────

export const meetingReportTool: Tool = {
  name: "meeting_report",
  description:
    "Obtiene el transcript completo de una sesión de reunión para que el agente genere el informe gerencial. | Get the full transcript of a meeting session so the agent can generate the managerial report.",
  parameters: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "ID de la sesión de reunión",
      },
    },
    required: ["session_id"],
  },
  execute: async (params) => {
    const sessionId = params.session_id as string;

    try {
      const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
      const sessionEntry = await sessionsCol.get(sessionId);

      if (!sessionEntry) {
        return { ok: false, error: `Sesión ${sessionId} no encontrada.` };
      }
      const session = sessionEntry.doc;

      const segmentsCol = await col<MeetingSegmentDoc>("meetingSegments");
      const segments = (await segmentsCol.scan({ prefix: `${sessionId}:` }))
        .map(e => e.doc)
        .sort((a, b) => a.seq - b.seq);

      if (segments.length === 0) {
        return {
          ok: false,
          error: "La sesión no tiene segmentos transcritos. No se puede generar el reporte.",
        };
      }

      const transcript = segments
        .map((s) => (s.speaker ? `[${s.speaker}]: ${s.text}` : s.text))
        .join("\n");

      const durationSec = Math.floor(((session.stopped_at ?? Date.now()) - session.started_at) / 1000);
      const durationMin = Math.floor(durationSec / 60);
      const durationSecRem = durationSec % 60;

      return {
        ok: true,
        session_id: session.id,
        title: session.title,
        status: session.status,
        duration: `${durationMin}m ${durationSecRem}s`,
        segment_count: segments.length,
        transcript,
        instructions: `Con el transcript anterior, genera un INFORME GERENCIAL en español con estas secciones:

## Informe de Reunión: ${session.title}

### 1. Resumen Ejecutivo
(3-5 oraciones que capturen la esencia de la reunión)

### 2. Participantes Detectados
(Lista de nombres o roles mencionados en el transcript)

### 3. Decisiones Tomadas
(Lista numerada de cada decisión concreta)

### 4. Action Items
| Qué | Quién | Cuándo |
|-----|-------|--------|
(Tabla con todas las tareas asignadas)

### 5. Próximos Pasos
(Lista de acciones inmediatas)

### 6. Temas de Seguimiento
(Puntos que quedaron pendientes o requieren más discusión)

Luego llama a office_escribir_docx para guardar el reporte como documento Word.`,
      };
    } catch (error) {
      log.error(`meeting_report error: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Error al obtener el reporte: ${(error as Error).message}`,
      };
    }
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export function createTools(): Tool[] {
  return [
    meetingStartTool,
    meetingAddSegmentTool,
    meetingStopTool,
    meetingReportTool,
  ];
}
