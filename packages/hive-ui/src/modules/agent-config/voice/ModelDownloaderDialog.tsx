import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Check, RefreshCw, Loader2 } from "lucide-react";
import { useLocalTTS } from "@/stores/useGlobalConfigStore";
import type { TTSModel } from "@/stores/useGlobalConfigStore";

interface ModelDownloaderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ModelDownloaderDialog({ open, onOpenChange }: ModelDownloaderDialogProps) {
  const { 
    availableTTSModels, 
    fetchAvailableTTSModels, 
    downloadTTSModel, 
    isDownloadingModel,
    downloadLogs,
    fetchDownloadLogs 
  } = useLocalTTS();
  
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadModels();
    }
  }, [open]);

  const loadModels = async () => {
    setIsLoading(true);
    await fetchAvailableTTSModels();
    setIsLoading(false);
  };

  const handleDownload = async (modelId: string) => {
    await downloadTTSModel(modelId);
  };

  const getQualityColor = (quality: TTSModel["quality"]) => {
    switch (quality) {
      case "high":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "medium":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "low":
        return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            📦 Gestionar Modelos TTS
          </DialogTitle>
          <DialogDescription>
            Descarga modelos de voz adicionales para Piper TTS. Cada modelo incluye el archivo de voz (.onnx) y su configuración (.json).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto mt-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {availableTTSModels.filter(m => m.installed).length} / {availableTTSModels.length} instalados
              </Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={loadModels}
              disabled={isLoading || isDownloadingModel}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>

          {isLoading && !availableTTSModels.length ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : availableTTSModels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay modelos disponibles
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Idioma</TableHead>
                  <TableHead>Calidad</TableHead>
                  <TableHead>Tamaño</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {availableTTSModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">{model.name}</TableCell>
                    <TableCell>{model.language}</TableCell>
                    <TableCell>
                      <Badge className={getQualityColor(model.quality)}>
                        {model.quality}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{model.size}</TableCell>
                    <TableCell>
                      {model.installed ? (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
                          <Check className="h-3 w-3" />
                          Instalado
                        </Badge>
                      ) : isDownloadingModel && downloadLogs.some(log => log.includes(model.name)) ? (
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Descargando
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-zinc-700/50 text-zinc-400">
                          No instalado
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {model.installed ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled
                          className="gap-2 opacity-50"
                        >
                          <Check className="h-4 w-4" />
                          Instalado
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleDownload(model.id)}
                          disabled={isDownloadingModel}
                          className="gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Descargar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Download logs */}
          {downloadLogs.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium mb-2">Progreso de descarga:</div>
              <div className="bg-black/40 rounded-md border border-zinc-700/50 p-3 h-32 overflow-y-auto font-mono text-xs text-zinc-300">
                {downloadLogs.map((log, i) => (
                  <div
                    key={i}
                    className={log.startsWith("[error]") ? "text-red-400" : log.startsWith("✓") ? "text-green-400" : ""}
                  >
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
