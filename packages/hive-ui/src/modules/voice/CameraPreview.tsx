/**
 * Vista previa de lo que BIA está viendo: cámara o pantalla compartida.
 *
 * El `<video>` lo crean RealtimeCamera/RealtimeScreen fuera de React (necesitan
 * existir antes de poder capturar fotogramas), así que aquí se adopta el nodo en
 * vez de montar otro: dos elementos sobre el mismo MediaStream duplicarían la
 * decodificación.
 *
 * La cámara va en espejo, como cualquier cámara frontal — verse invertido
 * resulta desconcertante. La pantalla NO: invertirla la haría ilegible.
 */

import { useEffect, useRef } from "react";
import { Monitor, Video } from "lucide-react";
import { getCameraElement, getScreenElement } from "@/stores/realtimeStore";

interface VistaPreviaProps {
  activa: boolean;
  fuente?: "camera" | "screen";
}

export function CameraPreview({ activa, fuente = "camera" }: VistaPreviaProps) {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = contenedor.current;
    if (!host || !activa) return;

    // El elemento puede tardar un instante en existir: la cámara se pide de
    // forma asíncrona y el permiso lo concede el usuario.
    const obtener = () => (fuente === "screen" ? getScreenElement() : getCameraElement());

    let cancelado = false;
    let reanudar: (() => void) | null = null;

    const adoptar = () => {
      if (cancelado) return;
      const video = obtener();
      if (!video) {
        requestAnimationFrame(adoptar);
        return;
      }
      video.classList.add("vx__cam-video");
      if (fuente === "screen") video.classList.add("vx__cam-video--plano");
      host.appendChild(video);

      // WebKitGTK —el motor de la app de escritorio en Linux— pausa un <video>
      // al moverlo de sitio en el árbol. Como camera.ts llama a play() antes de
      // que exista este contenedor, el elemento llegaba aquí reproduciéndose y
      // se quedaba clavado en el primer fotograma: no sólo en la vista previa,
      // también en lo que se le manda al modelo, que capturaba siempre la misma
      // imagen. Por eso el play() va DESPUÉS de adoptarlo, y se repite si el
      // motor lo vuelve a pausar (ocurre al ocultar y reabrir el panel).
      reanudar = () => {
        void video.play().catch(() => {
          /* sin permiso o pista cortada: no hay nada que reanudar */
        });
      };
      reanudar();
      video.addEventListener("pause", reanudar);
    };
    adoptar();

    return () => {
      cancelado = true;
      const video = obtener();
      if (video && reanudar) video.removeEventListener("pause", reanudar);
      if (video && video.parentElement === host) host.removeChild(video);
    };
  }, [activa, fuente]);

  if (!activa) return null;

  const Icono = fuente === "screen" ? Monitor : Video;

  return (
    <figure className={`vx__cam ${fuente === "screen" ? "vx__cam--pantalla" : ""}`}>
      <div className="vx__cam-frame" ref={contenedor} />
      <figcaption className="vx__cam-label">
        <Icono className="h-3 w-3" />
        {fuente === "screen" ? "Tu pantalla" : "Lo que ve"}
      </figcaption>
    </figure>
  );
}
