import * as path from "node:path";
import { voiceService, type AudioInput } from "../../voice/index";
import { logger } from "../../utils/logger";
import { col, nextId, toIndexable } from "../../storage/hive";
import type { MeetingSessionDoc, MeetingSegmentDoc, ModelDoc, ProviderDoc } from "../../storage/collections";
import { getHiveDir } from "../../config/loader";
import { getDefaultLLM, resolveProviderConfig, callLLM } from "../../agent/llm-client";
import { officeEscribirDocxTool } from "../../tools/office/office-escribir-docx";

const log = logger.child("meeting-routes");

const REPORT_SECTIONS = [
  "Resumen Ejecutivo",
  "Participantes Detectados",
  "Decisiones Tomadas",
  "Action Items",
  "Próximos Pasos",
  "Temas de Seguimiento",
] as const;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "reporte";
}

function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").trim();
}

interface ParsedReport {
  titulo?: string;
  parrafos: Array<{ texto: string; tipo?: "titulo1" | "titulo2" | "titulo3" | "parrafo" | "lista" }>;
  tablas: Array<{ filas: Array<{ celdas: string[] }>; encabezado?: boolean }>;
}

// Parses the strict markdown contract requested from the LLM (see
// buildReportPrompt) into office_escribir_docx's paragraph/table shape.
function parseReportMarkdown(markdown: string): ParsedReport {
  const lines = markdown.split("\n");
  const result: ParsedReport = { parrafos: [], tablas: [] };
  let tableBuffer: string[][] = [];

  const flushTable = () => {
    if (tableBuffer.length === 0) return;
    result.tablas.push({
      filas: tableBuffer.map((celdas) => ({ celdas })),
      encabezado: true,
    });
    tableBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushTable();
      continue;
    }

    if (line.startsWith("|")) {
      if (/^\|[\s:-]+\|$/.test(line)) continue; // separator row
      const cells = line.split("|").map((c) => stripInlineMarkdown(c)).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      tableBuffer.push(cells);
      continue;
    }
    flushTable();

    if (line.startsWith("## ")) {
      result.titulo = stripInlineMarkdown(line.slice(3));
      continue;
    }
    if (line.startsWith("### ")) {
      result.parrafos.push({ texto: stripInlineMarkdown(line.slice(4)), tipo: "titulo2" });
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      result.parrafos.push({ texto: stripInlineMarkdown(line.slice(2)), tipo: "lista" });
      continue;
    }
    result.parrafos.push({ texto: stripInlineMarkdown(line), tipo: "parrafo" });
  }
  flushTable();
  return result;
}

function buildReportPrompt(title: string, durationLabel: string, segmentCount: number, transcript: string) {
  const system =
    "Eres un asistente que redacta informes gerenciales de reuniones en español. " +
    "Responde ÚNICAMENTE con el informe en el siguiente formato exacto, sin texto adicional antes o después:\n" +
    "- Un único encabezado `## Informe de Reunión: <título>`.\n" +
    `- Seis encabezados \`### N. <sección>\`, en este orden exacto: ${REPORT_SECTIONS.map((s, i) => `${i + 1}. ${s}`).join(", ")}.\n` +
    "- Las viñetas empiezan con `- `.\n" +
    "- La sección Action Items debe ser una única tabla markdown con encabezado `| Qué | Quién | Cuándo |` y fila separadora `|---|---|---|`.\n" +
    "- No uses negrita/cursiva ni comentarios adicionales.";

  const user =
    `Título: ${title}\nDuración: ${durationLabel}\nSegmentos: ${segmentCount}\n\n` +
    `Transcript:\n${transcript}\n\nGenera el informe siguiendo exactamente el formato solicitado.`;

  return { system, user };
}

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

// POST /api/meetings/:id/report — Generar informe gerencial (.docx) vía una única llamada LLM directa
export async function handleGenerateMeetingReport(
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

    if (session.status === "active") {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Detén la sesión antes de generar el reporte." }, { status: 409 }),
        req
      );
    }

    const segmentsCol = await col<MeetingSegmentDoc>("meetingSegments");
    const segments = (await segmentsCol.scan({ prefix: `${sessionId}:` }))
      .map((e) => e.doc)
      .sort((a, b) => a.seq - b.seq);

    if (segments.length === 0) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "La sesión no tiene segmentos transcritos." }, { status: 400 }),
        req
      );
    }

    const transcript = segments
      .map((s) => (s.speaker ? `[${s.speaker}]: ${s.text}` : s.text))
      .join("\n");

    const durationSec = Math.floor(((session.stopped_at ?? Date.now()) - session.started_at) / 1000);
    const durationMin = Math.floor(durationSec / 60);
    const durationSecRem = durationSec % 60;
    const durationLabel = `${durationMin}m ${durationSecRem}s`;

    const defaultLLM = await getDefaultLLM();
    if (!defaultLLM) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "No hay proveedor LLM activo configurado." }, { status: 500 }),
        req
      );
    }
    const providerCfg = await resolveProviderConfig(defaultLLM.provider, defaultLLM.model);

    const { system, user } = buildReportPrompt(session.title, durationLabel, segments.length, transcript);
    const response = await callLLM({
      ...providerCfg,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const reportMarkdown = response.content.trim();
    if (!reportMarkdown || response.stop_reason === "error") {
      return addCorsHeaders(
        Response.json({ ok: false, error: reportMarkdown || "El LLM no devolvió contenido." }, { status: 500 }),
        req
      );
    }

    const parsed = parseReportMarkdown(reportMarkdown);
    const reportPath = path.join(getHiveDir(), "meeting-reports", `${sessionId}.docx`);

    const result = (await officeEscribirDocxTool.execute({
      ruta: reportPath,
      titulo: parsed.titulo ?? `Informe de Reunión: ${session.title}`,
      parrafos: parsed.parrafos,
      tablas: parsed.tablas,
    })) as { ok: boolean; ruta?: string; error?: string };

    if (!result.ok || !result.ruta) {
      return addCorsHeaders(
        Response.json({ ok: false, error: result.error ?? "No se pudo generar el archivo DOCX." }, { status: 500 }),
        req
      );
    }

    await sessionsCol.put(
      sessionId,
      { ...session, status: "report_ready", report_path: result.ruta },
      { expectedVersion: sessionEntry.version }
    );

    log.info(`Meeting report generated: ${sessionId} → ${result.ruta}`);
    return addCorsHeaders(
      Response.json({ ok: true, session_id: sessionId, report_path: result.ruta, status: "report_ready" }),
      req
    );
  } catch (error) {
    log.error(`handleGenerateMeetingReport: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
      req
    );
  }
}

// GET /api/meetings/:id/report/download — Descargar el .docx generado
export async function handleDownloadMeetingReport(
  req: Request,
  addCorsHeaders: CorsHelper,
  sessionId: string
): Promise<Response> {
  try {
    const sessionsCol = await col<MeetingSessionDoc>("meetingSessions");
    const sessionEntry = await sessionsCol.get(sessionId);

    if (!sessionEntry || !sessionEntry.doc.report_path) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "Reporte no encontrado" }, { status: 404 }),
        req
      );
    }

    const file = Bun.file(sessionEntry.doc.report_path);
    if (!(await file.exists())) {
      return addCorsHeaders(
        Response.json({ ok: false, error: "El archivo del reporte ya no existe" }, { status: 404 }),
        req
      );
    }

    return addCorsHeaders(
      new Response(file, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(sessionEntry.doc.title)}.docx"`,
        },
      }),
      req
    );
  } catch (error) {
    log.error(`handleDownloadMeetingReport: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
      req
    );
  }
}
