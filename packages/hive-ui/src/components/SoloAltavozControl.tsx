/**
 * «Este aparato es solo altavoz».
 *
 * Un parlante Bluetooth se anuncia como auricular y el sistema le inventa un
 * micrófono que no existe. Elegirlo —o que alguna aplicación lo abra— obliga al
 * aparato a pasar a modo llamada: el sonido baja a calidad de teléfono y se
 * corta a ratos. Aquí la persona dice cuáles son solo altavoz y dejan de
 * ofrecerse como micrófono.
 *
 * Se lista cada aparato Bluetooth, no solo el elegido: lo normal es que el
 * micrófono en uso sea otro y el parlante ni se haya tocado.
 */

import type { DispositivoAudio } from "@/lib/realtime/dispositivos";

interface Props {
  /** Micrófonos visibles; se muestran los que son Bluetooth. */
  entradas: DispositivoAudio[];
  /** Los ya marcados como solo altavoz. */
  ocultas: DispositivoAudio[];
  onOcultar: (d: DispositivoAudio) => void;
  onMostrar: (d: DispositivoAudio) => void;
  className?: string;
}

export function SoloAltavozControl({ entradas, ocultas, onOcultar, onMostrar, className }: Props) {
  const bluetooth = entradas.filter((d) => d.bluetooth);
  if (bluetooth.length === 0 && ocultas.length === 0) return null;

  return (
    <div className={className} data-testid="solo-altavoz">
      {bluetooth.map((d) => (
        <label key={d.id} className="flex cursor-pointer items-start gap-2 py-0.5">
          <input type="checkbox" checked={false} onChange={() => onOcultar(d)} className="mt-0.5" />
          <span>
            <strong>{d.nombre}</strong> es solo altavoz (no tiene micrófono). Un micrófono Bluetooth
            baja el sonido a calidad de llamada.
          </span>
        </label>
      ))}
      {ocultas.length > 0 && (
        <p className="py-0.5">
          Ocultos por ser solo altavoz:{" "}
          {ocultas.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              {d.nombre}{" "}
              <button type="button" className="underline" onClick={() => onMostrar(d)}>
                mostrar
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
