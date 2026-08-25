/**
 * Ajustes de audio de la llamada: por qué micrófono se te oye y por qué
 * altavoz suena la colmena.
 *
 * Vive pegado al dique de la llamada, como en cualquier videollamada: el sitio
 * donde uno lo busca cuando no se oye nada es junto al botón de colgar, no en
 * una pantalla de configuración aparte.
 */

import { useEffect, useRef } from "react";
import { Play, Volume2, X } from "lucide-react";
import { useDispositivosAudio, useNivelMicrofono } from "@/hooks/useAudioDevices";
import { useRealtimeStore } from "@/stores/realtimeStore";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  /** Hay llamada en curso: el nivel se lee del micrófono ya abierto. */
  enVivo: boolean;
  entrada: string;
  salida: string;
  onEntrada: (id: string) => void;
  onSalida: (id: string) => void;
}

export function AudioSettings({
  abierto, onCerrar, enVivo, entrada, salida, onEntrada, onSalida,
}: Props) {
  const { entradas, salidas, motivoSalidas } = useDispositivosAudio();
  const nivel = useNivelMicrofono(entrada, abierto, enVivo);
  const probarSalida = useRealtimeStore((s) => s.probarSalida);
  const modoAltavoz = useRealtimeStore((s) => s.modoAltavoz);
  const usarModoAltavoz = useRealtimeStore((s) => s.usarModoAltavoz);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const teclado = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    const fuera = (e: PointerEvent) => {
      const destino = e.target as HTMLElement | null;
      // El botón que abre el panel se ignora: si no, este cierre lo apagaría y
      // el clic siguiente lo volvería a encender, así que nunca se cerraría.
      if (destino?.closest?.("[data-audio-toggle]")) return;
      if (!caja.current?.contains(destino)) onCerrar();
    };
    window.addEventListener("keydown", teclado);
    window.addEventListener("pointerdown", fuera, true);
    return () => {
      window.removeEventListener("keydown", teclado);
      window.removeEventListener("pointerdown", fuera, true);
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="vx__audio vx__glass" ref={caja} role="dialog" aria-label="Micrófono y sonido">
      <div className="vx__audio-head">
        <span className="vx__rail-title">Micrófono y sonido</span>
        <button className="vx__audio-x" onClick={onCerrar} aria-label="Cerrar">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="vx__pref">
        <span className="vx__pref-label">Micrófono</span>
        <select className="vx__select" value={entrada} onChange={(e) => onEntrada(e.target.value)}>
          <option value="">Predeterminado del sistema</option>
          {entradas.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}{d.porDefecto ? " (actual del sistema)" : ""}
            </option>
          ))}
        </select>
      </label>

      {/* La barra es la prueba de que el micrófono elegido capta algo. */}
      <div className="vx__meter" aria-hidden="true">
        <div className="vx__meter-fill" style={{ transform: `scaleX(${Math.min(1, nivel * 1.6)})` }} />
      </div>
      <p className="vx__pref-note">
        {enVivo ? "Habla: la barra sigue tu voz." : "Habla y comprueba que la barra se mueve."}
      </p>

      <label className="vx__pref">
        <span className="vx__pref-label">Salida</span>
        {salidas.length > 0 ? (
          <select className="vx__select" value={salida} onChange={(e) => onSalida(e.target.value)}>
            <option value="">Predeterminada del sistema</option>
            {salidas.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}{d.porDefecto ? " (actual del sistema)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="vx__pref-note">{motivoSalidas ?? "Buscando salidas…"}</p>
        )}
      </label>

      <button className="vx__audio-test" onClick={() => void probarSalida()}>
        <Play className="h-3 w-3" />
        Probar sonido
      </button>

      {/* Se enciende solo al elegir un televisor o unos bafles; con auriculares
          se apaga. Aquí se puede corregir: la sala la conoce quien escucha. */}
      <label className="vx__switch">
        <input
          type="checkbox"
          checked={modoAltavoz}
          onChange={(e) => usarModoAltavoz(e.target.checked)}
        />
        <span>Modo altavoz</span>
      </label>
      <p className="vx__pref-note">
        {modoAltavoz
          ? "Mientras habla no te escucha: por un altavoz abierto oiría su propia voz y se contestaría sola. Para cortarla, pulsa el botón del micrófono; vuelve a oírte medio segundo después de callar."
          : "Puedes cortarla hablando encima. Si la oyes por un altavoz y se contesta a sí misma, enciende esto; con auriculares no hace falta."}
      </p>

      <p className="vx__pref-note">
        <Volume2 className="inline h-3 w-3 align-[-2px]" /> El micrófono se cambia al
        instante, incluso con la llamada abierta.
      </p>
    </div>
  );
}
