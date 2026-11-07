/**
 * Ajustes de pantalla y audio.
 *
 * Los mismos controles de micrófono y salida que ofrece el botón junto al
 * teléfono en HiveLive, más el tamaño de la vista. Se repiten a propósito: uno
 * se busca durante la llamada, cuando no se oye a alguien, y el otro cuando se
 * está configurando la aplicación con calma.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Cpu, Mic, Minus, Play, Plus, RotateCcw, Volume2, ZoomIn } from "lucide-react";
import { aplicarZoom, cargarZoom, zoomDisponible, ZOOM_MAX, ZOOM_MIN, ZOOM_PASO } from "@/lib/desktop-zoom";
import { type DispositivoAudio } from "@/lib/realtime/dispositivos";
import { SoloAltavozControl } from "@/components/SoloAltavozControl";
import {
  avisarDispositivos,
  marcarEntradaSoloAltavoz,
  useDispositivosAudio,
  useMicrofonoMudo,
  useNivelMicrofono,
} from "@/hooks/useAudioDevices";
import { cambiarMotorNativo, getMediaEngine, loadNativeAudioPref } from "@/lib/realtime/engine";
import { loadVoicePrefs, saveVoicePrefs, useRealtimeStore } from "@/stores/realtimeStore";
import { isDesktopApp } from "@/stores/useDesktopUpdateStore";

export function PantallaAudioCard() {
  const usarSalida = useRealtimeStore((s) => s.usarSalida);
  const usarEntrada = useRealtimeStore((s) => s.usarEntrada);
  const probarSalida = useRealtimeStore((s) => s.probarSalida);
  const enVivo = useRealtimeStore((s) => s.status !== "idle" && s.status !== "error");
  const [zoom, setZoom] = useState(() => cargarZoom());
  const { entradas, ocultas, salidas, motivoSalidas } = useDispositivosAudio();
  const [prefs, setPrefs] = useState(() => loadVoicePrefs());
  // El medidor abre el micrófono, así que sólo mientras esta pantalla está a la
  // vista: nadie quiere el micrófono encendido por haber pasado por Ajustes.
  const nivel = useNivelMicrofono(prefs.input, true, enVivo);
  const sinSenal = useMicrofonoMudo(nivel, true);
  const conZoom = zoomDisponible();
  const [nativo, setNativo] = useState(() => loadNativeAudioPref() && getMediaEngine().kind === "native");
  const [avisoNativo, setAvisoNativo] = useState<string | null>(null);

  const cambiarNativo = async (activar: boolean) => {
    setAvisoNativo(null);
    const motor = await cambiarMotorNativo(activar);
    const quedoNativo = motor.kind === "native";
    setNativo(quedoNativo);
    if (activar && !quedoNativo) {
      setAvisoNativo("El módulo de audio nativo no respondió; se sigue usando el del navegador.");
    }
    // Los ids de aparato de un motor no valen en el otro: se vuelve al
    // predeterminado en vez de dejar un selector apuntando a algo que no existe.
    saveVoicePrefs({ input: "", output: "" });
    setPrefs(loadVoicePrefs());
    avisarDispositivos();
  };

  // Los atajos de teclado cambian el zoom desde fuera de este panel.
  useEffect(() => {
    const oir = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    window.addEventListener("hive-zoom", oir);
    return () => window.removeEventListener("hive-zoom", oir);
  }, []);

  const cambiarZoom = (valor: number) => void aplicarZoom(valor).then(setZoom);

  return (
    <div className="space-y-6">
      {conZoom && (
        <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-5">
          <div className="flex items-center gap-2">
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">Tamaño de la vista</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Escala toda la aplicación. También con <kbd>Ctrl</kbd> y <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd>,
            o <kbd>Ctrl</kbd> y la rueda del ratón.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline" size="icon" aria-label="Reducir"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => cambiarZoom(zoom - ZOOM_PASO)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-16 text-center font-mono text-sm tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="outline" size="icon" aria-label="Ampliar"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => cambiarZoom(zoom + ZOOM_PASO)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => cambiarZoom(1)}>
              <RotateCcw className="h-3.5 w-3.5" /> Restablecer
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-5">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Micrófono</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Por dónde te oye la colmena en HiveLive. Se puede cambiar incluso con la
          llamada abierta.
        </p>
        <Selector
          dispositivos={entradas}
          valor={prefs.input}
          vacio="Predeterminado del sistema"
          onCambio={(input) => {
            setPrefs({ ...prefs, input });
            void usarEntrada(input);
          }}
          sinNada="No se detectó ningún micrófono."
        />
        <SoloAltavozControl
          className="space-y-1 text-xs text-muted-foreground"
          entradas={entradas}
          ocultas={ocultas}
          onOcultar={(d) => {
            marcarEntradaSoloAltavoz(d.nombre, true);
            // Si era el micrófono elegido, se vuelve al del sistema.
            if (prefs.input === d.id) {
              setPrefs({ ...prefs, input: "" });
              void usarEntrada("");
            }
          }}
          onMostrar={(d) => marcarEntradaSoloAltavoz(d.nombre, false)}
        />
        {/* La barra confirma que el aparato elegido capta algo. */}
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full origin-left rounded-full bg-primary transition-transform duration-100"
            style={{ transform: `scaleX(${Math.min(1, nivel * 1.6)})` }}
          />
        </div>
        <p
          className={sinSenal ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          role={sinSenal ? "alert" : undefined}
        >
          {sinSenal
            ? "No llega señal de este micrófono. Comprueba que esté conectado y sin silenciar, o elige otro."
            : "Habla y comprueba que la barra se mueve."}
        </p>
      </div>

      {isDesktopApp() && (
        <div className="space-y-3 rounded-lg border border-border/60 bg-card/50 p-5">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">Audio nativo (experimental)</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Captura y reproduce el audio con un módulo propio de la aplicación en lugar del
            navegador integrado: lista y cambia de dispositivo sin trucos, y quita el eco de los
            altavoces, así que se puede interrumpir a la colmena hablando encima sin usar
            auriculares. Si algo falla, desactívalo y vuelve al del navegador.
          </p>
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={nativo}
              disabled={enVivo}
              onChange={(e) => void cambiarNativo(e.target.checked)}
            />
            Usar el audio nativo
          </label>
          {enVivo && (
            <p className="text-xs text-muted-foreground">Cuelga la llamada para cambiarlo.</p>
          )}
          {avisoNativo && <p className="text-xs text-destructive" role="alert">{avisoNativo}</p>}
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-5">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Salida de la voz en vivo</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Por dónde se oye a la colmena en HiveLive. La lista la reporta el sistema
          operativo y se actualiza al conectar o desconectar un aparato.
        </p>
        <Selector
          dispositivos={salidas}
          valor={prefs.output}
          vacio="Predeterminada del sistema"
          onCambio={(output) => {
            setPrefs({ ...prefs, output });
            void usarSalida(output);
          }}
          sinNada={motivoSalidas ?? "Buscando salidas…"}
        />
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void probarSalida()}>
          <Play className="h-3.5 w-3.5" /> Probar sonido
        </Button>
      </div>
    </div>
  );
}

/** Lista de aparatos del sistema, con "el que decida el sistema" como opción. */
function Selector({
  dispositivos, valor, vacio, sinNada, onCambio,
}: {
  dispositivos: DispositivoAudio[];
  valor: string;
  vacio: string;
  sinNada: string;
  onCambio: (id: string) => void;
}) {
  if (dispositivos.length === 0) {
    return <p className="text-sm text-muted-foreground">{sinNada}</p>;
  }
  return (
    <select
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
    >
      <option value="">{vacio}</option>
      {dispositivos.map((d) => (
        <option key={d.id} value={d.id}>
          {d.nombre}
          {d.bluetooth ? " · Bluetooth" : ""}
          {d.porDefecto ? " (actual del sistema)" : ""}
        </option>
      ))}
    </select>
  );
}
