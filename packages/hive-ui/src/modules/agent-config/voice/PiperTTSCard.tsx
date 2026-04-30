import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocalTTS } from "@/stores/useGlobalConfigStore";
import { Download, Play, Square, RefreshCw, Wifi, WifiOff, Terminal, Package } from "lucide-react";
import { apiClient } from "@/lib/api";
import { ModelDownloaderDialog } from "./ModelDownloaderDialog";

interface LogsResponse {
  logs: string[];
  ttsRoot: string;
  bunPath: string;
}

export function PiperTTSCard() {
  const { localTTS, fetchLocalTTSStatus, installLocalTTS, startLocalTTS, stopLocalTTS } = useLocalTTS();
  const [isActing, setIsActing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [ttsRoot, setTtsRoot] = useState("");
  const [showModelDialog, setShowModelDialog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLocalTTSStatus();
  }, [fetchLocalTTSStatus]);

  // Polling durante instalación
  useEffect(() => {
    if (localTTS.installing) {
      pollRef.current = setInterval(() => {
        fetchLocalTTSStatus();
        if (showLogs) fetchLogs();
      }, 3000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [localTTS.installing, showLogs, fetchLocalTTSStatus]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const fetchLogs = async () => {
    try {
      const data = await apiClient<LogsResponse>("/api/tts-local/logs");
      setLogs(data.logs);
      setTtsRoot(data.ttsRoot);
    } catch {
      // ignore
    }
  };

  const handleInstall = async () => {
    setIsActing(true);
    setShowLogs(true);
    try {
      await installLocalTTS();
      await fetchLogs();
    } finally {
      setIsActing(false);
    }
  };

  const handleStart = async () => {
    setIsActing(true);
    try {
      await startLocalTTS();
    } finally {
      setIsActing(false);
    }
  };

  const handleStop = async () => {
    setIsActing(true);
    try {
      await stopLocalTTS();
    } finally {
      setIsActing(false);
    }
  };

  const handleShowLogs = async () => {
    setShowLogs((v) => !v);
    if (!showLogs) await fetchLogs();
  };

  const { installed, running, piperExists, voiceExists, port } = localTTS;
  const isInstalling = localTTS.installing;

  return (
    <Card className={`relative overflow-hidden col-span-full ${running ? "border-blue-500/30 bg-blue-500/[0.02]" : ""}`}>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎙️</span>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Piper TTS
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal border-zinc-600 text-zinc-400">
                  Local · Offline
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                TTS sin internet — binario nativo, sin Python, sin Docker. Fallback cuando no hay providers online.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isInstalling ? (
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Instalando…
              </Badge>
            ) : installed ? (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                Instalado
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-zinc-700/50 text-zinc-400">
                No instalado
              </Badge>
            )}
            {installed && (
              running ? (
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1">
                  <Wifi className="h-3 w-3" />
                  Servidor :{port}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-zinc-700/50 text-zinc-400 gap-1">
                  <WifiOff className="h-3 w-3" />
                  Detenido
                </Badge>
              )
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Detalles de componentes antes de instalar */}
        {!installed && !isInstalling && (
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className={`flex items-center gap-1.5 ${piperExists ? "text-green-400" : ""}`}>
              <span>{piperExists ? "✓" : "○"}</span> Binario Piper (~8 MB)
            </div>
            <div className={`flex items-center gap-1.5 ${voiceExists ? "text-green-400" : ""}`}>
              <span>{voiceExists ? "✓" : "○"}</span> Voz española (~60 MB)
            </div>
          </div>
        )}

        {installed && (
          <p className="text-xs text-muted-foreground">
            Voz: <code className="text-zinc-300">{localTTS.voices?.[0] || "N/A"}</code> · Puerto:{" "}
            <code className="text-zinc-300">{port}</code> · Configurable con{" "}
            <code className="text-zinc-300">TTS_PORT</code> / <code className="text-zinc-300">TTS_VOICE</code>
          </p>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap gap-2">
          {!installed && !isInstalling && (
            <Button size="sm" onClick={handleInstall} disabled={isActing} className="gap-2">
              <Download className="h-3.5 w-3.5" />
              Instalar Piper (~68 MB)
            </Button>
          )}

          {isInstalling && (
            <Button size="sm" disabled className="gap-2 opacity-70">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Descargando…
            </Button>
          )}

          {installed && !running && (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={isActing}
              className="gap-2 bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Play className="h-3.5 w-3.5" />
              Iniciar servidor
            </Button>
          )}

          {running && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStop}
              disabled={isActing}
              className="gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              <Square className="h-3.5 w-3.5" />
              Detener servidor
            </Button>
          )}

          {installed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowModelDialog(true)}
              disabled={isActing}
              className="gap-2"
            >
              <Package className="h-3.5 w-3.5" />
              Gestionar modelos
              {localTTS.voices && localTTS.voices.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                  {localTTS.voices.length}
                </Badge>
              )}
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchLocalTTSStatus()}
            title="Actualizar estado"
            className="text-zinc-400"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleShowLogs}
            className="gap-1.5 text-zinc-400 text-xs"
          >
            <Terminal className="h-3.5 w-3.5" />
            {showLogs ? "Ocultar log" : "Ver log"}
          </Button>
        </div>

        {isInstalling && (
          <p className="text-xs text-yellow-400/80">
            Descargando binario y modelo de voz… puede tardar 1-3 min. El estado se actualiza automáticamente.
          </p>
        )}

        {/* Log panel */}
        {showLogs && (
          <div className="space-y-1">
            {ttsRoot && (
              <p className="text-[10px] text-zinc-500 font-mono">ruta: {ttsRoot}</p>
            )}
            <div
              ref={logsRef}
              className="bg-black/40 rounded-md border border-zinc-700/50 p-3 h-40 overflow-y-auto font-mono text-[11px] text-zinc-300 leading-relaxed"
            >
              {logs.length === 0 ? (
                <span className="text-zinc-600">Sin registros aún. Inicia la instalación para ver el progreso.</span>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={i}
                    className={line.startsWith("[stderr]") || line.startsWith("[error]") ? "text-red-400" : ""}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <ModelDownloaderDialog open={showModelDialog} onOpenChange={setShowModelDialog} />
      </CardContent>
    </Card>
  );
}
