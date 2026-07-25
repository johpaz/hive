import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Square, FileText, Clock, ChevronDown, ChevronUp, Radio, History, MonitorSpeaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useMeetingStore, buildMeetingWsUrl, type MeetingSegment } from "@/stores/meetingStore";
import { getApiBaseUrl } from "@/lib/gateway-url";

function formatElapsed(startedAt: number): string {
  const elapsed = Math.floor((Date.now() / 1000) - startedAt);
  const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const s = (elapsed % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type CaptureMode = "microphone" | "system" | "dual" | "unsupported";

async function checkSystemAudioSupport(): Promise<boolean> {
  if (!navigator.mediaDevices?.getDisplayMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      systemAudio: "include" as const,
    } as any);
    const hasAudio = stream.getAudioTracks().length > 0;
    stream.getTracks().forEach((t) => t.stop());
    return hasAudio;
  } catch {
    return false;
  }
}

function SegmentItem({ segment }: { segment: MeetingSegment }) {
  return (
    <div className="flex gap-3 py-2 px-3 rounded-lg hover:bg-white/[0.03] transition-colors">
      {segment.speaker && (
        <span className="shrink-0 text-xs font-semibold text-amber-400 mt-0.5 leading-5">
          [{segment.speaker}]
        </span>
      )}
      <span className="text-sm text-zinc-300 leading-relaxed">{segment.text}</span>
    </div>
  );
}

function RecordingPulse() {
  return (
    <span className="relative flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
    </span>
  );
}

export function MeetingPanel() {
  const {
    sessions,
    activeSessionId,
    segments,
    isRecording,
    isConnecting,
    error,
    wsConnection,
    startSession,
    stopSession,
    fetchSessions,
    addSegmentLocal,
    setWsConnection,
    setRecording,
    setError,
    clearActiveSession,
    generateReport,
  } = useMeetingStore();

  const [title, setTitle] = useState("");
  const [elapsed, setElapsed] = useState("00:00");
  const [showSessions, setShowSessions] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("microphone");
  const [systemAudioSupported, setSystemAudioSupported] = useState<boolean | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const meetingWsRef = useRef<WebSocket | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    if (!isRecording || !activeSession) return;
    const timer = setInterval(() => setElapsed(formatElapsed(activeSession.started_at)), 1000);
    return () => clearInterval(timer);
  }, [isRecording, activeSession]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments]);

  useEffect(() => {
    fetchSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    checkSystemAudioSupport().then((supported) => {
      setSystemAudioSupported(supported);
    });
  }, []);

  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      systemStreamRef.current?.getTracks().forEach((track) => track.stop());
      void audioContextRef.current?.close();
      meetingWsRef.current?.close();
    };
  }, []);

  const handleStart = useCallback(async () => {
    if (!title.trim()) {
      setError("Ingresa el título de la reunión");
      return;
    }
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Tu navegador no puede acceder al micrófono. Asegúrate de usar HTTPS o localhost.");
      return;
    }

    const CHUNK_MS = 5000;
    const MIME = "audio/webm";
    let combinedStream: MediaStream;
    let mode: CaptureMode = "microphone";

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = micStream;

      let systemStream: MediaStream | undefined;
      if (systemAudioSupported) {
        try {
          systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
            systemAudio: "include" as const,
          } as any);
          systemStreamRef.current = systemStream;
          mode = systemStream.getAudioTracks().length > 0 ? "system" : "microphone";
        } catch {
          mode = "microphone";
        }
      }

      if (mode === "system" && systemStream) {
        const audioCtx = new AudioContext();
        audioContextRef.current = audioCtx;
        const destination = audioCtx.createMediaStreamDestination();
        destinationRef.current = destination;

        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(destination);

        const systemSource = audioCtx.createMediaStreamSource(systemStream);
        systemSource.connect(destination);

        combinedStream = new MediaStream([...destination.stream.getAudioTracks()]);
        setCaptureMode("dual");
      } else {
        combinedStream = micStream;
        setCaptureMode("microphone");
      }
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Permiso de micrófono denegado. Ve a la configuración del navegador (🔒 en la barra de URL) y permite el micrófono.");
      } else if (name === "NotFoundError") {
        setError("No se encontró ningún micrófono en este dispositivo.");
      } else {
        setError(`No se pudo acceder al micrófono: ${(e as Error).message}`);
      }
      return;
    }
    streamRef.current = combinedStream;

    const sessionId = await startSession(title.trim());
    if (!sessionId) {
      combinedStream.getTracks().forEach((t) => t.stop());
      systemStreamRef.current?.getTracks().forEach((t) => t.stop());
      return;
    }

    const ws = new WebSocket(buildMeetingWsUrl(sessionId));
    meetingWsRef.current = ws;
    setWsConnection(ws);

    const startChunk = () => {
      if (!isRecordingRef.current || ws.readyState !== WebSocket.OPEN) return;

      chunksRef.current = [];
      const recorder = new MediaRecorder(combinedStream, { mimeType: MIME });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (chunksRef.current.length === 0) {
          if (isRecordingRef.current && ws.readyState === WebSocket.OPEN) startChunk();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: MIME });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "audio_chunk", audio: base64, mime_type: MIME }));
          }
          if (isRecordingRef.current && ws.readyState === WebSocket.OPEN) startChunk();
        };
      };

      recorder.start();
      chunkTimerRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, CHUNK_MS);
    };

    ws.onopen = () => {
      isRecordingRef.current = true;
      setRecording(true);
      startChunk();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        if (msg.type === "transcript_segment") {
          addSegmentLocal({
            seq: msg.seq as number,
            speaker: (msg.speaker as string) || null,
            text: msg.text as string,
          });
        }
        if (msg.type === "meeting_stopped") {
          isRecordingRef.current = false;
          setRecording(false);
        }
        if (msg.type === "error") {
          setError(msg.error as string);
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => setError("Error en la conexión WebSocket");
    ws.onclose = () => {
      if (meetingWsRef.current === ws) meetingWsRef.current = null;
      isRecordingRef.current = false;
      setRecording(false);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      systemStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
    };
  }, [title, startSession, setWsConnection, setRecording, setError, addSegmentLocal, systemAudioSupported]);

  const handleStop = useCallback(async () => {
    isRecordingRef.current = false;
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    systemStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    await stopSession();
    meetingWsRef.current = null;
    setElapsed("00:00");
  }, [stopSession]);

  const handleGenerateReport = useCallback(async () => {
    if (!activeSessionId) return;
    setReportLoading(true);
    await generateReport(activeSessionId);
    setReportLoading(false);
  }, [activeSessionId, generateReport]);

  const reportReady = activeSession?.status === "report_ready";
  const isStopped = !isRecording && activeSessionId;
  const isIdle = !isRecording && !activeSession?.status.startsWith("stop") && !activeSessionId;

  return (
    <div className="flex h-full flex-col bg-[#111319] text-white">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-white/[0.06] bg-[#191b22]/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Radio className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white leading-tight">Transcripción de Reuniones</h1>
              <p className="text-[11px] text-zinc-500 leading-tight">Captura · Transcribe · Informa en tiempo real</p>
            </div>
          </div>
          {isRecording && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
              <RecordingPulse />
              <span className="text-xs font-semibold text-red-400 tabular-nums">{elapsed}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main layout — stacked on mobile, side-by-side on lg+ */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">

        {/* ── Left panel: controls + transcript ── */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* Session controls */}
          <div className="shrink-0 px-5 py-4 border-b border-white/[0.06] space-y-3">
            {isIdle ? (
              /* Idle: title input + start button */
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Nombre de la reunión..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                  className="flex-1 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-zinc-600 focus-visible:ring-amber-500/40 focus-visible:border-amber-500/40 rounded-xl h-10"
                  disabled={isConnecting}
                />
                <Button
                  onClick={handleStart}
                  disabled={isConnecting || !title.trim()}
                  className="shrink-0 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-semibold rounded-xl h-10 px-5 shadow-lg shadow-amber-900/30 transition-all"
                >
                  <Mic className="h-4 w-4 mr-1.5" />
                  {isConnecting ? "Iniciando..." : "Iniciar"}
                </Button>
              </div>
            ) : (
              /* Active or stopped session */
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Badge
                    variant="outline"
                    className={
                      isRecording
                        ? "border-red-500/40 text-red-400 bg-red-500/10 rounded-full px-2.5"
                        : "border-zinc-600/40 text-zinc-400 bg-white/[0.04] rounded-full px-2.5"
                    }
                  >
                    {isRecording ? "● REC" : "Detenida"}
                  </Badge>
                  {captureMode !== "microphone" && isRecording && (
                    <Badge
                      variant="outline"
                      className="border-blue-500/40 text-blue-400 bg-blue-500/10 rounded-full px-2.5"
                    >
                      {captureMode === "dual" ? (
                        <>
                          <MonitorSpeaker className="h-3 w-3 mr-1" />
                          Mic+Altavozz
                        </>
                      ) : captureMode === "system" ? (
                        <>
                          <MonitorSpeaker className="h-3 w-3 mr-1" />
                          Altavozz
                        </>
                      ) : null}
                    </Badge>
                  )}
                  <span className="text-sm font-medium text-zinc-200 truncate max-w-[180px]">
                    {activeSession?.title}
                  </span>
                  {isRecording && (
                    <span className="hidden sm:flex items-center gap-1 text-xs text-zinc-500">
                      <Clock className="h-3 w-3" />
                      {elapsed}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isRecording && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStop}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 rounded-xl h-8"
                    >
                      <Square className="h-3 w-3 mr-1.5 fill-current" />
                      Detener
                    </Button>
                  )}
                  {isStopped && (
                    <>
                      <Button
                        size="sm"
                        onClick={handleGenerateReport}
                        disabled={reportLoading || reportReady}
                        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl h-8 px-3 shadow-md shadow-amber-900/30 disabled:opacity-60"
                      >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        {reportLoading ? "Generando..." : reportReady ? "Reporte generado ✓" : "Generar Reporte"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearActiveSession}
                        className="text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] rounded-xl h-8"
                      >
                        Nueva reunión
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-red-500/[0.08] border border-red-500/20 text-xs text-red-400">
                <span className="shrink-0 mt-px">⚠</span>
                <span>{error}</span>
              </div>
            )}

            {/* Report ready banner */}
            {reportReady && activeSessionId && (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 text-xs text-emerald-400">
                <span>✓</span>
                <span>Reporte generado.</span>
                <a
                  href={`${getApiBaseUrl()}/api/meetings/${activeSessionId}/report/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-emerald-300 font-medium"
                >
                  Descargar .docx
                </a>
              </div>
            )}
          </div>

          {/* Transcript feed */}
          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
            {segments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-600">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                  <MicOff className="h-7 w-7" />
                </div>
                <p className="text-sm text-center max-w-[220px] leading-relaxed">
                  {isRecording
                    ? "Escuchando… las transcripciones aparecerán aquí"
                    : "Inicia una sesión para ver la transcripción en tiempo real"}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {segments.map((seg) => (
                  <SegmentItem key={seg.seq} segment={seg} />
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>

          {/* Segment counter footer */}
          {segments.length > 0 && (
            <div className="shrink-0 border-t border-white/[0.06] px-5 py-2 flex items-center justify-between">
              <span className="text-[11px] text-zinc-600">
                {segments.length} segmento{segments.length !== 1 ? "s" : ""} transcritos
              </span>
              {isRecording && (
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Clock className="h-3 w-3" />
                  {elapsed}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel: session history ── */}
        <div className="shrink-0 flex flex-col lg:w-64 xl:w-72 border-t lg:border-t-0 lg:border-l border-white/[0.06] bg-[#191b22]/40 max-h-60 lg:max-h-none">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="flex items-center justify-between px-4 py-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-300 border-b border-white/[0.06] transition-colors"
          >
            <span className="flex items-center gap-2">
              <History className="h-3.5 w-3.5" />
              Historial ({sessions.length})
            </span>
            {showSessions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showSessions && (
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-600">
                  <History className="h-6 w-6 opacity-40" />
                  <p className="text-xs">Sin reuniones aún</p>
                </div>
              ) : (
                <div className="py-1">
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => useMeetingStore.getState().fetchSession(s.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04] ${
                        s.id === activeSessionId ? "bg-amber-500/[0.06]" : ""
                      }`}
                    >
                      <p className="text-xs font-medium text-zinc-200 truncate leading-snug">{s.title}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 rounded-full border-0 ${
                            s.status === "active"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : s.status === "report_ready"
                              ? "bg-blue-500/15 text-blue-400"
                              : "bg-white/[0.05] text-zinc-500"
                          }`}
                        >
                          {s.status === "active" ? "activa" : s.status === "report_ready" ? "con reporte" : "detenida"}
                        </Badge>
                        {s.segment_count !== undefined && s.segment_count > 0 && (
                          <span className="text-[10px] text-zinc-600">{s.segment_count} seg</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
