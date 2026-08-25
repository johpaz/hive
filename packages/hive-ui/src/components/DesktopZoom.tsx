/**
 * Atajos de teclado del zoom y restauración del nivel guardado.
 *
 * Va montado una sola vez en la raíz: los atajos tienen que funcionar en
 * cualquier pantalla, no solo en Ajustes.
 */

import { useEffect } from "react";
import { aplicarZoom, cargarZoom, zoomDisponible, ZOOM_PASO } from "@/lib/desktop-zoom";

export function DesktopZoom() {
  useEffect(() => {
    if (!zoomDisponible()) return;
    void aplicarZoom(cargarZoom());

    const teclado = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // "+" llega como "=" sin mayúsculas y como "+" con ellas, según el teclado.
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        void aplicarZoom(cargarZoom() + ZOOM_PASO).then(avisar);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        void aplicarZoom(cargarZoom() - ZOOM_PASO).then(avisar);
      } else if (e.key === "0") {
        e.preventDefault();
        void aplicarZoom(1).then(avisar);
      }
    };

    const rueda = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      void aplicarZoom(cargarZoom() + (e.deltaY < 0 ? ZOOM_PASO : -ZOOM_PASO)).then(avisar);
    };

    window.addEventListener("keydown", teclado);
    window.addEventListener("wheel", rueda, { passive: false });
    return () => {
      window.removeEventListener("keydown", teclado);
      window.removeEventListener("wheel", rueda);
    };
  }, []);

  return null;
}

/** Avisa al resto de la interfaz para que un control abierto refleje el cambio. */
function avisar(valor: number): void {
  window.dispatchEvent(new CustomEvent("hive-zoom", { detail: valor }));
}
