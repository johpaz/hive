import { getDb } from "../../storage/sqlite";
import { voiceService, type AudioInput } from "../../voice/index";
import { logger } from "../../utils/logger";

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
    const sttModel = (body.stt_model as string) || "whisper-large-v3-turbo";

    const db = getDb();
    const result = db
      .query(
        `INSERT INTO meeting_sessions (title, stt_model)
         VALUES (?, ?)
         RETURNING id, title, status, stt_model, started_at`
      )
      .get(title, sttModel) as {
      id: string;
      title: string;
      status: string;
      stt_model: string;
      started_at: number;
    };

    log.info(`Meeting session created: ${result.id}`);
    return addCorsHeaders(Response.json({ ok: true, session: result }), req);
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
    const db = getDb();
    const sessions = db
      .query(
        `SELECT ms.*, COUNT(seg.id) as segment_count
         FROM meeting_sessions ms
         LEFT JOIN meeting_segments seg ON seg.session_id = ms.id
         GROUP BY ms.id
         ORDER BY ms.started_at DESC
         LIMIT 50`
      )
      .all() as Record<string, unknown>[];

    return addCorsHeaders(Response.json({ ok: true, sessions }), req);
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
    const db = getDb();
    const session = db
      .query(`SELECT * FROM meeting_sessions WHERE id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!session) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 }),
        req
      );
    }

    const segments = db
      .query(
        `SELECT seq, speaker, text, created_at FROM meeting_segments
         WHERE session_id = ? ORDER BY seq ASC`
      )
      .all(sessionId) as Record<string, unknown>[];

    return addCorsHeaders(Response.json({ ok: true, session, segments }), req);
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

    const db = getDb();
    const session = db
      .query(`SELECT id, stt_model, status FROM meeting_sessions WHERE id = ?`)
      .get(sessionId) as { id: string; stt_model: string; status: string } | undefined;

    if (!session) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 }),
        req
      );
    }
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

    const seqResult = db
      .query(
        `SELECT COALESCE(MAX(seq) + 1, 0) as next_seq FROM meeting_segments WHERE session_id = ?`
      )
      .get(sessionId) as { next_seq: number };

    const seq = seqResult.next_seq;
    db.query(
      `INSERT INTO meeting_segments (session_id, seq, speaker, text) VALUES (?, ?, ?, ?)`
    ).run(sessionId, seq, speaker, transcription);

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
    const db = getDb();
    const session = db
      .query(`SELECT id, title, status FROM meeting_sessions WHERE id = ?`)
      .get(sessionId) as { id: string; title: string; status: string } | undefined;

    if (!session) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 }),
        req
      );
    }

    if (session.status !== "active") {
      const count = (
        db
          .query(`SELECT COUNT(*) as c FROM meeting_segments WHERE session_id = ?`)
          .get(sessionId) as { c: number }
      ).c;
      return addCorsHeaders(
        Response.json({ ok: true, session_id: sessionId, segment_count: count }),
        req
      );
    }

    db.query(
      `UPDATE meeting_sessions SET status = 'stopped', stopped_at = unixepoch() WHERE id = ?`
    ).run(sessionId);

    const countResult = db
      .query(`SELECT COUNT(*) as count FROM meeting_segments WHERE session_id = ?`)
      .get(sessionId) as { count: number };

    log.info(`Meeting stopped: ${sessionId} — ${countResult.count} segments`);
    return addCorsHeaders(
      Response.json({
        ok: true,
        session_id: sessionId,
        title: session.title,
        segment_count: countResult.count,
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
