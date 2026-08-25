/**
 * Zoom de toda la vista en la app de escritorio.
 *
 * Lo aplica el motor del webview, no CSS: así reescala también lo que la página
 * no controla (desplazamiento, superficies de canvas, tamaños del sistema) sin
 * descuadrar el diseño. En el navegador no hace falta —el propio navegador ya
 * tiene su zoom— así que ahí no se ofrece.
 */

import { isDesktopApp } from "@/stores/useDesktopUpdateStore";

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;
export const ZOOM_PASO = 0.1;
const CLAVE = "hive-desktop-zoom";

export function zoomDisponible(): boolean {
  return isDesktopApp();
}

export function cargarZoom(): number {
  if (typeof localStorage === "undefined") return 1;
  const guardado = Number(localStorage.getItem(CLAVE));
  return Number.isFinite(guardado) && guardado > 0 ? acotar(guardado) : 1;
}

export function acotar(factor: number): number {
  // Redondear evita que 1.0000000000000002 se quede pegado tras varios pasos.
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor)) * 100) / 100;
}

/** Aplica el zoom y lo recuerda para la próxima vez que se abra la app. */
export async function aplicarZoom(factor: number): Promise<number> {
  const valor = acotar(factor);
  if (typeof localStorage !== "undefined") localStorage.setItem(CLAVE, String(valor));
  if (!isDesktopApp()) return valor;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_zoom", { factor: valor });
  } catch {
    // Versión antigua de la app sin el comando: se ignora en vez de romper.
  }
  return valor;
}
