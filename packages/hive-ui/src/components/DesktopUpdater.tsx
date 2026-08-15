/**
 * DesktopUpdater — el aviso de actualización de la app de escritorio.
 *
 * El plugin de Tauri estaba registrado y con permisos desde el principio, pero
 * nadie lo llamaba nunca: la app jamás consultaba si había versión nueva, así
 * que el usuario no se enteraba de nada mientras el backend le respondía que
 * "la app se actualiza sola". Esto es el disparador que faltaba.
 *
 * Fuera de la app de escritorio (navegador, Docker) no renderiza ni importa
 * nada: el store corta antes de tocar los plugins.
 */

import { useEffect } from "react";
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
import { useDesktopUpdateStore, isDesktopApp } from "@/stores/useDesktopUpdateStore";

/** Cada 6 horas: suficiente para enterarse el mismo día, sin molestar. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/johpaz/hive/releases/latest";

export function DesktopUpdater() {
  const { phase, update, percent, error, check, install, dismiss } = useDesktopUpdateStore();

  useEffect(() => {
    if (!isDesktopApp()) return;
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check]);

  const busy = phase === "downloading" || phase === "installing" || phase === "restarting";
  // El aviso automático solo interrumpe cuando hay algo que decir. Un error de
  // chequeo de fondo o un "estás al día" se los queda Ajustes.
  const visible = update !== null && (phase === "available" || busy || phase === "error");
  if (!visible) return null;

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
            <AlertDialogCancel onClick={dismiss}>
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
