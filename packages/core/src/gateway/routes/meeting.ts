import { voiceService, type AudioInput } from "../../voice/index";
import { logger } from "../../utils/logger";
import { col, nextId, toIndexable } from "../../storage/hive";
import type { MeetingSessionDoc, MeetingSegmentDoc, ModelDoc, ProviderDoc } from "../../storage/collections";

const log = logger.child("meeting-routes");

type CorsHelper = (r: Response, req: Request) => Response;

// POST /api/meetings — Crear sesión
export async function handleCreateMeeting(
  req: Request,
  addCorsHeaders: CorsHelper
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const title = (body.title as string) || "Reunión sin título";

    // Default STT model desde la BD (primer modelo stt activo) cuando el cliente no lo indica
    let sttModel = body.stt_model as string | undefined;
    if (!sttModel) {
      const providersCol = await col<ProviderDoc>("providers");
      const activeProviderIds = new Set(
        (await providersCol.scan({})).map(e => e.doc).filter(p => p.active).map(p => p.id)
      );
      const modelsCol = await col<ModelDoc>("models");
      const sttModelEntry = (await modelsCol.scan({}))
        .map(e => e.doc)
        .find(m => m.model_type === "stt" && m.active && activeProviderIds.has(m.provider_id));
      sttModel = sttModelEntry?.id || "whisper-large-v3-turbo";
    }

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

    log.info(`Meeting session created: ${id}`);
    return addCorsHeaders(Response.json({
      ok: true,
      session: { id, title, status: doc.status, stt_model: doc.stt_model, started_at: doc.started_at },
    }), req);
  } catch (error) {
    log.error(`handleCreateMeeting: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
      req
    );
  }
}

// GET /api/meetings — Listar sesiones
export async function handleListMeetings(
  req: Request,
  addCorsHeaders: CorsHelper
): Promise<Response> {
  try {
    const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
    const sessions = (await sessionsCol.scan({}))
      .map(e => e.doc)
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, 50);

    const segmentsCol = await col<MeetingSegmentDoc>("meetingSegments");
    const withCounts = await Promise.all(sessions.map(async (s) => {
      const segments = await segmentsCol.scan({ prefix: `${s.id}:` });
      return { ...s, segment_count: segments.length };
    }));

    return addCorsHeaders(Response.json({ ok: true, sessions: withCounts }), req);
  } catch (error) {
    log.error(`handleListMeetings: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
      req
    );
  }
}

// GET /api/meetings/:id — Detalle + segmentos
export async function handleGetMeeting(
  req: Request,
  addCorsHeaders: CorsHelper,
  sessionId: string
): Promise<Response> {
  try {
    const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
    const sessionEntry = await sessionsCol.get(sessionId);

    if (!sessionEntry) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 }),
        req
      );
    }

    const segmentsCol = await col<MeetingSegmentDoc>("meetingSegments");
    const segments = (await segmentsCol.scan({ prefix: `${sessionId}:` }))
      .map(e => e.doc)
      .sort((a, b) => a.seq - b.seq)
      .map(s => ({ seq: s.seq, speaker: s.speaker, text: s.text, created_at: s.created_at }));

    return addCorsHeaders(Response.json({ ok: true, session: sessionEntry.doc, segments }), req);
  } catch (error) {
    log.error(`handleGetMeeting: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
      req
    );
  }
}

// POST /api/meetings/:id/segments — Agregar segmento con audio base64
export async function handleAddMeetingSegment(
  req: Request,
  addCorsHeaders: CorsHelper,
  sessionId: string
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const audioBase64 = body.audio_base64 as string;
    const speaker = (body.speaker as string) || null;
    const mimeType = (body.mime_type as string) || "audio/webm";

    if (!audioBase64) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "audio_base64 es requerido" }, { status: 400 }),
        req
      );
    }

    const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
    const sessionEntry = await sessionsCol.get(sessionId);

    if (!sessionEntry) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 }),
        req
      );
    }
    const session = sessionEntry.doc;
    if (session.status !== "active") {
      return addCorsHeaders(
        Response.json(
          { ok: false, error: `La sesión está ${session.status}` },
          { status: 409 }
        ),
        req
      );
    }

    const audioInput: AudioInput = { type: "base64", data: audioBase64, mimeType };
    const transcription = await voiceService.transcribe(audioInput, session.stt_model);

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

    return addCorsHeaders(
      Response.json({ ok: true, seq, speaker, text: transcription }),
      req
    );
  } catch (error) {
    log.error(`handleAddMeetingSegment: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
      req
    );
  }
}

// POST /api/meetings/:id/stop — Detener sesión
export async function handleStopMeeting(
  req: Request,
  addCorsHeaders: CorsHelper,
  sessionId: string
): Promise<Response> {
  try {
    const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
    const sessionEntry = await sessionsCol.get(sessionId);

    if (!sessionEntry) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 }),
        req
      );
    }
    const session = sessionEntry.doc;

    const segmentsCol = await col<MeetingSegmentDoc>("meetingSegments");

    if (session.status !== "active") {
      const count = (await segmentsCol.scan({ prefix: `${sessionId}:` })).length;
      return addCorsHeaders(
        Response.json({ ok: true, session_id: sessionId, segment_count: count }),
        req
      );
    }

    await sessionsCol.put(sessionId, { ...session, status: "stopped", stopped_at: Date.now() }, { expectedVersion: sessionEntry.version });

    const count = (await segmentsCol.scan({ prefix: `${sessionId}:` })).length;

    log.info(`Meeting stopped: ${sessionId} — ${count} segments`);
    return addCorsHeaders(
      Response.json({
        ok: true,
        session_id: sessionId,
        title: session.title,
        segment_count: count,
      }),
      req
    );
  } catch (error) {
    log.error(`handleStopMeeting: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
      req
    );
  }
}
