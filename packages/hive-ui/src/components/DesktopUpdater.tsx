/**
 * DesktopUpdater — el aviso de actualización de la app de escritorio.
 *
 * El plugin de Tauri estaba registrado y con permisos desde el principio, pero
 * nadie lo llamaba nunca: la app jamás consultaba si había versión nueva, así
 * que el usuario no se enteraba de nada mientras el backend le respondía que
 * "la app se actualiza sola". Esto es el disparador que faltaba.
 *
 * Fuera de la app de escritorio (navegador, Docker) el componente no hace nada:
 * los plugins solo se importan cuando `isTauri()` confirma que hay runtime.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { ArrowUpCircle, Loader2, AlertTriangle } from "lucide-react";

/** Cada 6 horas: suficiente para enterarse el mismo día, sin molestar. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/johpaz/hive/releases/latest";

type Phase = "idle" | "available" | "downloading" | "installing" | "restarting" | "error";

type PendingUpdate = {
  version: string;
  notes?: string;
  downloadAndInstall: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
};

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function DesktopUpdater() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string>("");
  // Un "después" vale para toda la sesión: nada de repreguntar cada 6 horas.
  const dismissed = useRef(false);

  const check = useCallback(async () => {
    if (!isDesktopApp() || dismissed.current || phase !== "idle") return;
    try {
      const { check: checkForUpdate } = await import("@tauri-apps/plugin-updater");
      const found = await checkForUpdate();
      if (!found) return;
      setUpdate(found as unknown as PendingUpdate);
      setPhase("available");
    } catch (err) {
      // Sin red o sin firma válida: es un chequeo de fondo, no se le grita al
      // usuario por algo que no pidió.
      console.warn("[updater] no se pudo consultar actualizaciones:", err);
    }
  }, [phase]);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check]);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase("downloading");
    setPercent(0);

    let total = 0;
    let received = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          // Sin content-length no hay porcentaje honesto: se deja indeterminado.
          if (total > 0) setPercent(Math.min(99, Math.round((received / total) * 100)));
        } else if (event.event === "Finished") {
          setPercent(100);
          setPhase("installing");
        }
      });

      setPhase("restarting");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [update]);

  if (phase === "idle" || !update) return null;

  const busy = phase === "downloading" || phase === "installing" || phase === "restarting";

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {phase === "error" ? (
              <><AlertTriangle className="h-5 w-5 text-destructive" /> No se pudo actualizar</>
            ) : busy ? (
              <><Loader2 className="h-5 w-5 animate-spin text-primary" /> Actualizando Hive</>
            ) : (
              <><ArrowUpCircle className="h-5 w-5 text-primary" /> Hive {update.version} está disponible</>
            )}
          </AlertDialogTitle>

          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {phase === "available" && (
                <>
                  <p>Se descarga e instala desde la app. Al terminar, Hive se reinicia solo.</p>
                  {update.notes && (
                    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                      {update.notes}
                    </pre>
                  )}
                </>
              )}

              {phase === "downloading" && (
                <>
                  <p>Descargando la versión {update.version}…</p>
                  <Progress value={percent} />
                  <p className="text-xs text-muted-foreground">
                    {percent > 0 ? `${percent}%` : "Preparando la descarga…"}
                  </p>
                </>
              )}

              {phase === "installing" && <p>Instalando… no cierres la aplicación.</p>}
              {phase === "restarting" && <p>Listo. Reiniciando Hive…</p>}

              {phase === "error" && (
                <>
                  <p>{error}</p>
                  <p className="text-xs text-muted-foreground">
                    Podés instalarla a mano desde{" "}
                    <a className="underline" href={RELEASES_URL} target="_blank" rel="noreferrer">
                      la página de releases
                    </a>
                    . Tus datos y agentes no se tocan.
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!busy && (
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                dismissed.current = true;
                setPhase("idle");
              }}
            >
              {phase === "error" ? "Cerrar" : "Recordarme después"}
            </AlertDialogCancel>
            {phase === "available" && (
              <AlertDialogAction onClick={(e) => { e.preventDefault(); void install(); }}>
                Instalar ahora
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
