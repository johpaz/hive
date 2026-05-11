import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocalLLM, useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { Download, RefreshCw, Terminal, Package, Cpu, Binary, Play, Square } from "lucide-react";
import { apiClient } from "@/lib/api";

interface LogsResponse {
  logs: string[];
  llmRoot: string;
}

export function LocalLLMCard() {
  const { 
    localLLM, 
    localLLMLogs, 
    fetchLocalLLMStatus, 
    installLocalLLM, 
    startLocalLLM,
    stopLocalLLM,
    downloadLLMModel, 
    fetchLocalLLMLogs 
  } = useLocalLLM();
  
  const [isActing, setIsActing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [llmRoot, setLlmRoot] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLocalLLMStatus();
  }, [fetchLocalLLMStatus]);

  // Polling para status
  useEffect(() => {
    if (localLLM.installing || localLLM.downloadingModelId) {
      pollRef.current = setInterval(() => {
        fetchLocalLLMStatus();
      }, 3000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [localLLM.installing, localLLM.downloadingModelId, fetchLocalLLMStatus]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [localLLMLogs]);

  // SSE para logs en vivo
  useEffect(() => {
    if (!showLogs) return;
    
    // Conectar a SSE
    const eventSource = new EventSource("/api/llm-local/logs?mode=TEXT");
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.llmRoot) setLlmRoot(data.llmRoot);
        if (data.logs || data.serverLogs) {
          useGlobalConfigStore.setState((state) => {
            const combined = [...(data.logs || []), ...(data.serverLogs || [])];
            // Asegurar unicidad o simplemente anexar si el servidor ya lo maneja bien
            return { localLLMLogs: combined };
          });
        }
      } catch (err) {
        console.error("Error parsing SSE log data", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [showLogs]);


  const handleInstall = async () => {
    setIsActing(true);
    setShowLogs(true);
    try {
      await installLocalLLM();
    } finally {
      setIsActing(false);
    }
  };

  const handleDownload = async (modelId: string) => {
    setIsActing(true);
    try {
      await downloadLLMModel(modelId);
    } finally {
      setIsActing(false);
    }
  };

  const handleStartServer = async (mode: string = "TEXT") => {
    setIsActing(true);
    try {
      await startLocalLLM(mode);
    } finally {
      setIsActing(false);
    }
  };

  const handleStopServer = async (mode?: string) => {
    setIsActing(true);
    try {
      await stopLocalLLM(mode);
    } finally {
      setIsActing(false);
    }
  };

  const handleShowLogs = () => {
    setShowLogs((v) => !v);
  };

  const { installed, binaryExists, anyModelExists, installing, downloadingModelId, gpu, models } = localLLM;

  return (
    <Card className={`relative overflow-hidden col-span-full ${installed ? "border-amber-500/30 bg-amber-500/[0.02]" : ""}`}>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🤖</span>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Local LLM (llama-server)
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal border-zinc-600 text-zinc-400">
                  Local · Private
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Inferencia local sin internet usando llama-server. Soporta aceleración por GPU ({gpu.backend}).
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {localLLM.activeServers.map(srv => (
              <Badge key={srv.mode} className="bg-green-500/20 text-green-400 border-green-500/30 gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                {srv.mode} ({srv.port})
              </Badge>
            ))}
            
            {!localLLM.running && binaryExists && (
              <Badge variant="outline" className="border-zinc-700 text-zinc-500">
                Apagado
              </Badge>
            )}
            
            {installing ? (
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Configurando…
              </Badge>
            ) : binaryExists ? (
              <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                Binario Listo
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-zinc-700/50 text-zinc-400">
                No configurado
              </Badge>
            )}
            {gpu && (
              <Badge variant="outline" className="gap-1 border-zinc-700 text-zinc-400">
                <Cpu className="h-3 w-3" />
                {gpu.deviceName || gpu.backend}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Componentes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Binary className="h-4 w-4 text-amber-400" />
              Infraestructura
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs border border-zinc-800 p-2 rounded bg-zinc-900/50">
                <span className="text-zinc-400">Motor llama-server</span>
                {binaryExists ? (
                  <span className="text-green-400 font-medium">✓ Instalado</span>
                ) : (
                  <Button variant="link" size="sm" onClick={handleInstall} disabled={isActing || installing} className="h-auto p-0 text-amber-400">
                    Instalar ahora
                  </Button>
                )}
              </div>
              
              {localLLM.activeServers.length > 0 && (
                <div className="space-y-1.5 mt-2">
                   <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Servidores Activos</p>
                   {localLLM.activeServers.map(srv => (
                     <div key={srv.mode} className="flex items-center justify-between text-[11px] bg-zinc-800/30 p-1.5 rounded border border-zinc-700/50">
                       <span className="text-zinc-300 font-medium">{srv.mode}</span>
                       <div className="flex items-center gap-2">
                         <span className="text-zinc-500">Puerto {srv.port}</span>
                         <Button 
                           variant="ghost" 
                           size="icon" 
                           className="h-5 w-5 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                           onClick={() => handleStopServer(srv.mode)}
                           disabled={isActing}
                         >
                           <Square className="h-3 w-3 fill-current" />
                         </Button>
                       </div>
                     </div>
                   ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4 text-amber-400" />
              Modelos Disponibles
            </h4>
            <div className="space-y-2">
              {models.map((model) => (
                <div key={model.id} className="flex items-center justify-between text-xs border border-zinc-800 p-2 rounded bg-zinc-900/50">
                  <div className="flex flex-col">
                    <span className="text-zinc-200">{model.name}</span>
                    <span className="text-[10px] text-zinc-500">{model.size}</span>
                  </div>
                  {model.downloaded ? (
                    <span className="text-green-400 font-medium">✓ Descargado</span>
                  ) : downloadingModelId === model.id ? (
                    <span className="text-yellow-400 flex items-center gap-1">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Descargando…
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleDownload(model.id)} disabled={isActing || !!downloadingModelId} className="h-7 text-[10px] px-2 border-zinc-700">
                      Descargar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Acciones principales */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800">
          {!binaryExists && !installing && (
            <Button size="sm" onClick={handleInstall} disabled={isActing} className="gap-2 bg-amber-600 hover:bg-amber-500">
              <Download className="h-3.5 w-3.5" />
              Configurar Local LLM
            </Button>
          )}

          {binaryExists && !installing && (
            <div className="flex flex-wrap gap-2 w-full">
              <div className="flex gap-1 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800">
                {["TEXT", "IMAGE", "AUDIO"].map((m) => {
                  const isActive = localLLM.activeServers.some(s => s.mode === m);
                  return (
                    <Button 
                      key={m}
                      size="sm" 
                      variant={isActive ? "default" : "ghost"}
                      onClick={() => isActive ? handleStopServer(m) : handleStartServer(m)} 
                      disabled={isActing || (!isActive && !anyModelExists)}
                      className={`gap-1.5 text-[10px] h-7 px-2.5 ${
                        isActive 
                        ? "bg-green-600 hover:bg-green-500 text-white" 
                        : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {isActive ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                      {m}
                    </Button>
                  );
                })}
              </div>
              
              {localLLM.running && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => handleStopServer()} 
                  disabled={isActing} 
                  className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 h-9"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Apagar Todo
                </Button>
              )}
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchLocalLLMStatus()}
            title="Actualizar estado"
            className="text-zinc-400"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleShowLogs}
            className="gap-1.5 text-zinc-400 text-xs ml-auto"
          >
            <Terminal className="h-3.5 w-3.5" />
            {showLogs ? "Ocultar log" : "Ver log"}
          </Button>
        </div>

        {/* Log panel */}
        {showLogs && (
          <div className="space-y-1">
            {llmRoot && (
              <p className="text-[10px] text-zinc-500 font-mono text-right">ruta: {llmRoot}</p>
            )}
            <div
              ref={logsRef}
              className="bg-black/40 rounded-md border border-zinc-700/50 p-3 h-48 overflow-y-auto font-mono text-[11px] text-zinc-300 leading-relaxed"
            >
              {localLLMLogs.length === 0 ? (
                <span className="text-zinc-600">Sin registros aún. Inicia la configuración para ver el progreso.</span>
              ) : (
                localLLMLogs.map((line, i) => (
                  <div
                    key={i}
                    className={line.includes("[error]") ? "text-red-400" : line.includes("✓") ? "text-green-400" : ""}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
