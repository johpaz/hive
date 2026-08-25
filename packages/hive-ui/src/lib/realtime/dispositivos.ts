/**
 * Micrófono y altavoz: qué hay conectado y por dónde suena la colmena.
 *
 * Los dos extremos se resuelven distinto porque los motores no coinciden:
 *
 * - **Entradas**: `enumerateDevices()` las lista en los dos motores, y elegir
 *   una es pasar su `deviceId` a `getUserMedia`. Todo pasa dentro de la página.
 * - **Salidas**: Chrome —la app web, y el webview de Windows— implementa
 *   `AudioContext.setSinkId()` y las devuelve en `enumerateDevices()`.
 *   WebKitGTK —la app de escritorio en Linux— no implementa ninguna de las dos:
 *   medido sobre 2.52.5, `setSinkId` es `undefined` y `enumerateDevices()`
 *   devuelve cero dispositivos `audiooutput` incluso con permiso de micrófono
 *   concedido, aunque sí liste los de entrada. Ahí la lista y el cambio los
 *   hace el proceso nativo preguntándole al sistema.
 *
 * En todos los casos los dispositivos salen del sistema operativo: no hay
 * ninguna lista escrita a mano.
 */

import { isDesktopApp } from "@/stores/useDesktopUpdateStore";

export interface DispositivoAudio {
  id: string;
  nombre: string;
  porDefecto: boolean;
}

/** Nombre viejo, mantenido porque describe bien el caso de salida. */
export type SalidaAudio = DispositivoAudio;

type ContextoConSalida = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** ¿El motor deja elegir la salida desde la propia página? */
export function salidaPorNavegador(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}

/** Micrófonos disponibles. Funciona igual en los dos motores. */
export async function listarEntradas(): Promise<DispositivoAudio[]> {
  return enumerar("audioinput");
}

export interface Salidas {
  lista: DispositivoAudio[];
  /**
   * Por qué no hay nada que elegir, dicho por quien lo sabe. `null` cuando sí
   * hay lista.
   *
   * Antes esto era un `catch` que devolvía la lista vacía, y una lista vacía es
   * indistinguible de "este equipo no tiene altavoces": la app de escritorio
   * estuvo semanas sin salidas porque el `invoke` se rechazaba en silencio y
   * nadie tenía forma de verlo.
   */
  motivo: string | null;
}

/** Salidas que ofrece el sistema, por la vía que corresponda. */
export async function listarSalidas(): Promise<Salidas> {
  if (salidaPorNavegador()) {
    const lista = await enumerar("audiooutput");
    return {
      lista,
      motivo: lista.length
        ? null
        : "El navegador todavía no reporta salidas. Concede el permiso de micrófono y vuelve a abrir esta pantalla.",
    };
  }
  if (!isDesktopApp()) {
    return {
      lista: [],
      motivo: "Este navegador no deja elegir la salida: se usa la del sistema.",
    };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const lista = await invoke<DispositivoAudio[]>("audio_outputs");
    return { lista, motivo: lista.length ? null : "El sistema no reportó ninguna salida de audio." };
  } catch (error) {
    return { lista: [], motivo: (error as Error)?.message ?? String(error) };
  }
}

/**
 * Aparatos reales de un tipo, sin los alias del navegador.
 *
 * Chrome añade dos entradas ficticias, `default` y `communications`, que apuntan
 * a un aparato real. No se listan —la interfaz ya ofrece "predeterminado"— pero
 * el `groupId` de `default` sirve para marcar cuál es el que el sistema usa
 * ahora, que es la única forma de saberlo desde la página.
 */
async function enumerar(kind: MediaDeviceKind): Promise<DispositivoAudio[]> {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    const propios = todos.filter((d) => d.kind === kind);
    const grupoPorDefecto = propios.find((d) => d.deviceId === "default")?.groupId;
    return propios
      .filter((d) => d.deviceId !== "default" && d.deviceId !== "communications" && d.deviceId)
      .map((d, i) => ({
        id: d.deviceId,
        // Sin permiso de micrófono concedido el navegador oculta las etiquetas.
        nombre: d.label || `${kind === "audioinput" ? "Micrófono" : "Salida"} ${i + 1}`,
        porDefecto: !!grupoPorDefecto && d.groupId === grupoPorDefecto,
      }));
  } catch {
    return [];
  }
}

/**
 * Manda la voz al dispositivo elegido. Devuelve si el audio quedó encaminado.
 *
 * La respuesta importa: en la vía nativa el sistema sólo puede mover un flujo
 * que exista, y un flujo existe únicamente mientras algo suena. Elegir la
 * salida en reposo deja el puerto puesto pero no mueve nada, así que quien
 * reproduce tiene que saber que le queda pendiente e insistir cuando la colmena
 * empiece a hablar.
 *
 * En esa vía se mueve sólo el flujo de esta aplicación; la salida por defecto
 * del sistema no se toca, para no reencaminar lo que suene aparte.
 */
export async function aplicarSalida(id: string, context: AudioContext | null): Promise<boolean> {
  if (salidaPorNavegador()) {
    const ctx = context as ContextoConSalida | null;
    if (!ctx?.setSinkId) return false;
    await ctx.setSinkId(id);
    return true;
  }
  if (!isDesktopApp()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  const movidos = await invoke<number>("set_audio_output", { id });
  return movidos > 0;
}

/**
 * ¿Esa salida es un altavoz al aire —televisor, monitor, bafles— y no algo
 * pegado a la cabeza?
 *
 * Importa porque decide si hace falta el modo altavoz: con auriculares la voz
 * de la colmena no vuelve al micrófono y se puede interrumpir a media frase;
 * por un televisor sí vuelve, y sin freno se contesta a sí misma.
 *
 * Se deduce del propio identificador, que en la vía nativa es
 * `tarjeta|puerto` y el puerto trae el tipo en el nombre —`hdmi-output-0`,
 * `analog-output-speaker`, `headset-output`—. En la vía del navegador el
 * identificador es un hash opaco: ahí no se puede saber y decide la persona.
 */
export function esAltavozAbierto(id: string): boolean {
  const puerto = id.split("|")[1] ?? "";
  if (/headphone|headset|hf-output/.test(puerto)) return false;
  return /hdmi|speaker|spdif|tv|line-out/.test(puerto);
}
