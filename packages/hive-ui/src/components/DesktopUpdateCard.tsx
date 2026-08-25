/**
 * Panel de actualizaciones en Ajustes.
 *
 * El aviso automático (DesktopUpdater) solo aparece cuando hay algo nuevo, así
 * que sin esto no había ningún lugar donde preguntar "¿estoy al día?" — que es
 * exactamente lo que un usuario busca cuando algo va raro. Comparte estado con
 * el aviso, así que el botón refleja una descarga ya en curso en vez de
 * empezar otra.
 *
 * Fuera de la app de escritorio explica dónde se actualiza cada instalación, en
 * lugar de ofrecer un botón que no haría nada.
 */

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle, CheckCircle2, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useDesktopUpdateStore, isDesktopApp } from "@/stores/useDesktopUpdateStore";

const RELEASES_URL = "https://github.com/johpaz/hive/releases/latest";

type VersionInfo = { current: string; installationType?: "docker" | "binary" | "npm" | "bun" };

export function DesktopUpdateCard() {
  const { phase, update, percent, error, check, install } = useDesktopUpdateStore();
  const { data: version } = useQuery<VersionInfo>({
    queryKey: ["version-check"],
    queryFn: () => apiClient<VersionInfo>("/api/version"),
    retry: 1,
  });

  const desktop = isDesktopApp();
  const busy = phase === "checking" || phase === "downloading" || phase === "installing" || phase === "restarting";

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium">Versión instalada</h3>
          <p className="text-sm text-muted-foreground">
            Hive {version?.current ?? "—"}
            {version?.installationType ? ` · ${version.installationType}` : ""}
          </p>
        </div>
        {phase === "up-to-date" && (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Al día
          </Badge>
        )}
        {update && (
          <Badge className="gap-1">
            <ArrowUpCircle className="h-3.5 w-3.5" /> {update.version} disponible
          </Badge>
        )}
      </div>

      {!desktop && (
        <p className="text-sm text-muted-foreground">
          Esta instalación no se actualiza desde acá. Con npm o bun:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            bun install -g @johpaz/hive-agents@latest
          </code>
          . Con Docker:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">docker compose pull</code>.
        </p>
      )}

      {desktop && (
        <>
          <p className="text-sm text-muted-foreground">
            La app revisa si hay versión nueva al abrirse y cada 6 horas. Cuando la instalás, se
            descarga, se verifica su firma y Hive se reinicia solo. Tus datos y agentes no se tocan.
          </p>

          {phase === "downloading" && (
            <div className="space-y-2">
              <Progress value={percent} />
              <p className="text-xs text-muted-foreground">
                {percent > 0 ? `Descargando… ${percent}%` : "Preparando la descarga…"}
              </p>
            </div>
          )}
          {phase === "installing" && <p className="text-sm">Instalando… no cierres la aplicación.</p>}
          {phase === "restarting" && <p className="text-sm">Listo. Reiniciando Hive…</p>}

          {phase === "unsupported" && (
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                La actualización automática de Linux se publica como .deb, y este sistema no puede
                instalarlo. Descargá el .rpm desde{" "}
                <a className="underline" href={RELEASES_URL} target="_blank" rel="noreferrer">
                  la página de releases
                </a>{" "}
                e instálalo encima: conserva tus datos, agentes y claves.
              </span>
            </p>
          )}

          {phase === "error" && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {error}{" "}
                <a className="underline" href={RELEASES_URL} target="_blank" rel="noreferrer">
                  Instalar manualmente
                </a>
              </span>
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void check({ manual: true })}>
              {phase === "checking" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando…</>
              ) : (
                <><RefreshCw className="mr-2 h-4 w-4" /> Buscar actualizaciones</>
              )}
            </Button>
            {update && phase === "available" && (
              <Button onClick={() => void install()}>
                <ArrowUpCircle className="mr-2 h-4 w-4" /> Instalar {update.version}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
