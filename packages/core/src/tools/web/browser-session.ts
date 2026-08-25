/**
 * Persistencia de la sesión del navegador — cookies entre reinicios.
 *
 * `Bun.WebView` abre Chrome con un perfil efímero: `/tmp/.<hash>.bun-chrome`,
 * donde el hash cambia de un proceso a otro y no hay forma de fijarlo (probado:
 * el constructor ignora `userDataDir` y `args`). Sin esto, cada reinicio del
 * gateway perdería todos los logins que el agente haya hecho.
 *
 * La solución es guardar las cookies por CDP y volver a ponerlas al arrancar.
 * Van al almacén de secretos —keychain del sistema, o la colección cifrada— y
 * no a un JSON en claro: una cookie de sesión vale tanto como la contraseña.
 */

import { logger } from "../../utils/logger.ts";
import { loadSecret, storeSecret, deleteSecret } from "../../storage/crypto.ts";

const log = logger.child("browser-session");

const SECRET_NAME = "browser.session.cookies";

/**
 * Tope de lo que se guarda. El almacén de secretos no está pensado para
 * megabytes, y un navegador que estuvo horas de paseo junta cookies de
 * publicidad que no le sirven a nadie.
 */
const MAX_BYTES = 256 * 1024;

/** Los campos que `Network.setCookies` acepta de vuelta. */
export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

/**
 * ¿Se guarda la sesión? Default sí; `HIVE_BROWSER_PERSIST_SESSION=0` o
 * `tools.browser.persistSession: false` la apagan (kioscos, equipos
 * compartidos, o cuando se quiere que cada tarea arranque sin historia).
 */
export function sessionPersistenceEnabled(configured?: boolean): boolean {
  const env = process.env.HIVE_BROWSER_PERSIST_SESSION;
  if (env !== undefined) return env !== "0" && env.toLowerCase() !== "false";
  return configured !== false;
}

/** Deja sólo los campos reutilizables y descarta lo ya vencido. */
export function normalizeCookies(raw: unknown): StoredCookie[] {
  if (!Array.isArray(raw)) return [];
  const ahora = Date.now() / 1000;
  const out: StoredCookie[] = [];

  for (const item of raw) {
    // Lo que llega es JSON crudo: del protocolo, o de un archivo que alguien
    // editó. Un null en la lista no puede tumbar la restauración entera.
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : null;
    const value = typeof c.value === "string" ? c.value : null;
    const domain = typeof c.domain === "string" ? c.domain : null;
    if (!name || value === null || !domain) continue;

    // -1 es la marca de CDP para "cookie de sesión": esas se conservan, que son
    // justamente las del login. Las que traen fecha y ya pasó, no.
    const expires = typeof c.expires === "number" ? c.expires : undefined;
    if (expires !== undefined && expires > 0 && expires < ahora) continue;

    out.push({
      name,
      value,
      domain,
      path: typeof c.path === "string" ? c.path : undefined,
      expires: expires !== undefined && expires > 0 ? expires : undefined,
      httpOnly: c.httpOnly === true,
      secure: c.secure === true,
      sameSite: typeof c.sameSite === "string" ? c.sameSite : undefined,
    });
  }
  return out;
}

export async function loadStoredCookies(): Promise<StoredCookie[]> {
  try {
    const raw = await loadSecret(SECRET_NAME);
    if (!raw) return [];
    return normalizeCookies(JSON.parse(raw));
  } catch (err) {
    log.warn(`no se pudo leer la sesión guardada: ${(err as Error).message}`);
    return [];
  }
}

export async function storeCookies(cookies: unknown[]): Promise<number> {
  const limpias = normalizeCookies(cookies);
  if (!limpias.length) return 0;

  // Si no entra, se recorta por el final: las de sesión y las de dominio propio
  // suelen venir primero, y perder una cookie de tracking no le duele a nadie.
  let payload = JSON.stringify(limpias);
  let guardadas = limpias;
  while (payload.length > MAX_BYTES && guardadas.length > 1) {
    guardadas = guardadas.slice(0, Math.floor(guardadas.length / 2));
    payload = JSON.stringify(guardadas);
  }

  try {
    await storeSecret(SECRET_NAME, payload);
    return guardadas.length;
  } catch (err) {
    log.warn(`no se pudo guardar la sesión: ${(err as Error).message}`);
    return 0;
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    await deleteSecret(SECRET_NAME);
  } catch (err) {
    log.warn(`no se pudo borrar la sesión: ${(err as Error).message}`);
  }
}
