/**
 * Micrófonos que en realidad no existen.
 *
 * Un parlante Bluetooth suele anunciarse como auricular —con perfiles de manos
 * libres incluidos— y el sistema le inventa un micrófono. No hay forma de saber
 * si es verdad sin abrirlo, y abrirlo es justo lo que obliga al aparato a pasar
 * a modo llamada: el sonido baja a calidad de teléfono y se corta a ratos. Por
 * eso la decisión es de la persona: «este aparato es solo altavoz», y la app
 * deja de ofrecérselo como micrófono.
 *
 * Se recuerda por **nombre**, no por id: los ids del navegador y de los motores
 * cambian entre ejecuciones y entre motores, el nombre es lo que ve la persona.
 */

import type { DispositivoAudio } from "@/lib/realtime/dispositivos";

const CLAVE = "hive-voice-speaker-only";

export function cargarSoloAltavoz(): string[] {
  try {
    const crudo = localStorage.getItem(CLAVE);
    const lista = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

function guardar(lista: string[]): void {
  try {
    if (lista.length) localStorage.setItem(CLAVE, JSON.stringify(lista));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

export function marcarSoloAltavoz(nombre: string, activo: boolean): string[] {
  const actual = cargarSoloAltavoz().filter((n) => n !== nombre);
  const siguiente = activo ? [...actual, nombre] : actual;
  guardar(siguiente);
  return siguiente;
}

/**
 * ¿Parece un aparato Bluetooth?
 *
 * Por el motor si lo sabe (`bluetooth`), por los nombres que da el sistema
 * (Linux de escritorio) o por la etiqueta: Windows y macOS ponen «Bluetooth»,
 * «Headset» o «Hands-Free» en ella.
 */
export function parecerBluetooth(d: DispositivoAudio, nombresDelSistema: readonly string[]): boolean {
  if (d.bluetooth) return true;
  const etiqueta = d.nombre.trim().toLowerCase();
  if (/bluetooth|bluez|hands-?free|\bheadset\b/.test(etiqueta)) return true;
  // Igualdad o prefijo con espacio: un nombre corto como «TV» no debe marcar
  // «TV Studio USB» ni cualquier etiqueta que lo contenga.
  return nombresDelSistema.some((n) => {
    const base = n.trim().toLowerCase();
    return !!base && (etiqueta === base || etiqueta.startsWith(`${base} `));
  });
}

export interface EntradasPreparadas {
  /** Lo que se ofrece: primero los micrófonos de verdad, al final los Bluetooth. */
  visibles: DispositivoAudio[];
  /** Los que la persona marcó como solo altavoz. */
  ocultas: DispositivoAudio[];
}

export function prepararEntradas(
  lista: readonly DispositivoAudio[],
  nombresDelSistema: readonly string[],
  soloAltavoz: readonly string[],
): EntradasPreparadas {
  const marcadas = lista.map((d) => ({ ...d, bluetooth: parecerBluetooth(d, nombresDelSistema) }));
  const ocultas = marcadas.filter((d) => soloAltavoz.includes(d.nombre));
  const resto = marcadas.filter((d) => !soloAltavoz.includes(d.nombre));
  // Partición estable: el orden dentro de cada grupo es el que dio el sistema.
  const visibles = [...resto.filter((d) => !d.bluetooth), ...resto.filter((d) => d.bluetooth)];
  return { visibles, ocultas };
}
