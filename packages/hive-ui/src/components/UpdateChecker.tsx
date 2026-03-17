import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  ArrowUpCircle, 
  CheckCircle2, 
  Download, 
  AlertTriangle, 
  Loader2,
  ExternalLink,
  Info
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { swal } from "@/lib/swal";

interface VersionInfo {
  current: string;
  latest?: string;
  status: "up-to-date" | "update-available" | "checking" | "error";
  error?: string;
  installationType?: "docker" | "binary" | "npm" | "bun";
}

interface UpdateResponse {
  success: boolean;
  message?: string;
  error?: string;
  output?: string;
  instructions?: string[];
}

export function UpdateChecker() {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateInstructions, setUpdateInstructions] = useState<string[]>([]);
  const queryClient = useQueryClient();

  // Consultar versión cada 5 minutos
  const { data: versionInfo, isLoading } = useQuery<VersionInfo>({
    queryKey: ["version-check"],
    queryFn: () => apiClient<VersionInfo>("/api/version"),
    refetchInterval: 300000, // 5 minutos
    retry: 2,
  });

  // Mutación para triggerar actualización
  const updateMutation = useMutation({
    mutationFn: () => apiClient<UpdateResponse>("/api/update", {
      method: "POST",
      showLoader: "Actualizando Hive...",
    }),
    onSuccess: (data) => {
      setUpdateProgress(100);
      
      if (data.success) {
        setUpdateInstructions(data.instructions || []);
        swal.fire({
          title: "¡Actualización Completada!",
          text: data.message || "Hive ha sido actualizado exitosamente.",
          icon: "success",
          confirmButtonText: "Continuar"
        });
      } else {
        // Mostrar instrucciones si hay error
        if (data.instructions) {
          setUpdateInstructions(data.instructions);
        }
        swal.fire({
          title: "Información de Actualización",
          html: `
            <div class="text-left space-y-2">
              ${data.error ? `<p class="mb-2">${data.error}</p>` : ""}
              ${data.output ? `<pre class="bg-muted p-2 rounded text-xs overflow-auto max-h-40">${data.output}</pre>` : ""}
            </div>
          `,
          icon: data.instructions ? "info" : "error",
          confirmButtonText: "Entendido"
        });
      }
      
      // Recargar información de versión después de actualizar
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["version-check"] });
      }, 2000);
    },
    onError: (error) => {
      setUpdateProgress(0);
      console.error("[UpdateChecker] Error:", error);
    },
  });

  const handleUpdateClick = () => {
    setShowUpdateDialog(true);
  };

  const confirmUpdate = () => {
    setShowUpdateDialog(false);
    setUpdateProgress(10);
    updateMutation.mutate();
    
    // Simular progreso
    const interval = setInterval(() => {
      setUpdateProgress(prev => {
        if (prev >= 90) {
          clearInterval(interval);
          return prev;
        }
        return prev + 10;
      });
    }, 500);
  };

  const getInstallationTypeLabel = (type?: string) => {
    switch (type) {
      case "docker": return "Docker";
      case "binary": return "Binario";
      case "npm": return "npm";
      case "bun": return "Bun";
      default: return "Desconocida";
    }
  };

  const getStatusBadge = () => {
    if (!versionInfo) return null;

    switch (versionInfo.status) {
      case "up-to-date":
        return (
          <Badge variant="outline" className="flex items-center gap-1 bg-green-500/10 text-green-400 border-green-500/20">
            <CheckCircle2 className="h-3 w-3" />
            Actualizado
          </Badge>
        );
      case "update-available":
        return (
          <Badge className="flex items-center gap-1 bg-blue-500 text-white border-blue-400 hover:bg-blue-600">
            <ArrowUpCircle className="h-3 w-3" />
            v{versionInfo.latest} disponible
          </Badge>
        );
      case "checking":
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Verificando...
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Error
          </Badge>
        );
    }
  };

  const isUpdateAvailable = versionInfo?.status === "update-available";

  return (
    <>
      {/* Botón/Indicator en el header */}
      <div className="flex flex-col items-end gap-1">
        <span className="hive-label mb-1">Versión</span>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          {versionInfo && (
            <span className="text-xs text-white/40 font-mono">
              v{versionInfo.current} · {getInstallationTypeLabel(versionInfo.installationType)}
            </span>
          )}
        </div>
      </div>

      {/* Botón de actualizar (solo si hay actualización disponible) */}
      {isUpdateAvailable && (
        <Button
          size="sm"
          onClick={handleUpdateClick}
          disabled={updateMutation.isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20"
        >
          {updateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Actualizando...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Actualizar a v{versionInfo.latest}
            </>
          )}
        </Button>
      )}

      {/* Dialog de confirmación */}
      <AlertDialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-blue-500" />
              Actualizar Hive
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Se ha detectado una nueva versión disponible (<strong>v{versionInfo?.latest}</strong>). 
                Tu versión actual es <strong>v{versionInfo?.current}</strong>.
              </p>
              
              <div className="bg-muted p-3 rounded-lg space-y-2">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold mb-1">Tipo de instalación: {getInstallationTypeLabel(versionInfo?.installationType)}</p>
                    {versionInfo?.installationType === "docker" && (
                      <p className="text-muted-foreground">
                        Para Docker, deberás ejecutar manualmente los comandos en tu terminal.
                      </p>
                    )}
                    {versionInfo?.installationType === "binary" && (
                      <p className="text-muted-foreground">
                        Para el binario, serás redirigido a GitHub Releases para descargar la nueva versión.
                      </p>
                    )}
                    {(versionInfo?.installationType === "npm" || versionInfo?.installationType === "bun") && (
                      <p className="text-muted-foreground">
                        La actualización se realizará automáticamente. Deberás reiniciar el gateway después.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {updateMutation.isPending && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Progreso de actualización...</span>
                    <span className="text-muted-foreground">{updateProgress}%</span>
                  </div>
                  <Progress value={updateProgress} className="h-2" />
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUpdate}
              disabled={updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Actualizando...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Confirmar actualización
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de instrucciones post-actualización */}
      {updateInstructions.length > 0 && (
        <AlertDialog open={true} onOpenChange={() => setUpdateInstructions([])}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Instrucciones de Actualización</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <p>Sigue estos pasos para completar la actualización:</p>
                <ol className="list-decimal list-inside space-y-2 bg-muted p-4 rounded-lg">
                  {updateInstructions.map((instruction, index) => (
                    <li key={index} className="text-sm">{instruction}</li>
                  ))}
                </ol>
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ExternalLink className="h-4 w-4 mt-0.5" />
                  <p>Después de completar los pasos, recarga esta página para ver la nueva versión.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>Entendido</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
