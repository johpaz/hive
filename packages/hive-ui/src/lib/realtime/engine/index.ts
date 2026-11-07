/**
 * Punto único para obtener el motor de medios activo.
 *
 * Es el web salvo que la app de escritorio tenga activado el audio nativo y su
 * módulo Rust responda; en cualquier otro caso se queda el web, y el resto de
 * la aplicación no se entera de la diferencia.
 */

import { isDesktopApp } from "@/stores/useDesktopUpdateStore";
import {
  crearMotorHibrido,
  crearMotorNativo,
  nativoDisponible,
  type TauriCore,
} from "@/lib/realtime/engine/native";
import type { MediaEngine } from "@/lib/realtime/engine/types";
import { webMediaEngine } from "@/lib/realtime/engine/web";

export type {
  CapturePort,
  FrameSink,
  LipsyncSource,
  MediaEngine,
  MicPort,
  PlayerPort,
  SpectrumReader,
} from "@/lib/realtime/engine/types";

let activo: MediaEngine = webMediaEngine;

export function getMediaEngine(): MediaEngine {
  return activo;
}

/** Para pruebas y para el arranque del motor nativo. */
export function setMediaEngine(engine: MediaEngine): void {
  activo = engine;
}

const PREF_NATIVO = "hive-native-audio";

/**
 * Audio nativo: opt-in mientras el micrófono nativo no tenga cancelación de eco.
 * El motor web usa la del navegador; pasarse al nativo antes de tener la propia
 * dejaría a quien usa altavoces con la colmena contestándose a sí misma.
 */
export function loadNativeAudioPref(): boolean {
  try {
    return localStorage.getItem(PREF_NATIVO) === "1";
  } catch {
    return false;
  }
}

export function saveNativeAudioPref(activo: boolean): void {
  try {
    if (activo) localStorage.setItem(PREF_NATIVO, "1");
    else localStorage.removeItem(PREF_NATIVO);
  } catch {
    /* sin almacenamiento: la preferencia no se recuerda */
  }
}

/** El puente de Tauri, una vez comprobado que responde. */
let nucleo: TauriCore | null = null;

async function nucleoNativo(): Promise<TauriCore | null> {
  if (nucleo) return nucleo;
  if (!isDesktopApp()) return null;
  try {
    const core = (await import("@tauri-apps/api/core")) as unknown as TauriCore;
    if (await nativoDisponible(core)) {
      nucleo = core;
      return core;
    }
    console.warn("[media] el módulo nativo no responde; se usa el del navegador");
  } catch (error) {
    console.warn("[media] no se pudo iniciar el módulo nativo; se usa el del navegador", error);
  }
  return null;
}

/**
 * Elige el motor al arrancar la aplicación. Nunca lanza: si algo falla se queda
 * el web, que es el que ya funciona en todas partes.
 *
 * - Navegador: web.
 * - Escritorio: cámara nativa con audio del navegador; todo nativo si la
 *   persona activó el audio nativo.
 */
export async function iniciarMotorDeMedios(): Promise<MediaEngine> {
  const core = await nucleoNativo();
  if (!core) return activo;
  activo = loadNativeAudioPref() ? crearMotorNativo(core) : crearMotorHibrido(core);
  return activo;
}

/**
 * Cambia el audio entre navegador y nativo sin reiniciar la aplicación. Solo con
 * la llamada colgada: los micrófonos y reproductores ya creados se quedan con el
 * motor con que nacieron. Devuelve el motor que quedó activo; si piden el nativo
 * y el módulo no responde, el del navegador.
 */
export async function cambiarMotorNativo(activar: boolean): Promise<MediaEngine> {
  saveNativeAudioPref(activar);
  return iniciarMotorDeMedios();
}
