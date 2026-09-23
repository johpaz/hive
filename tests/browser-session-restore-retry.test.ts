/**
 * La restauración de la sesión se comprueba y se reintenta.
 *
 * Chrome recién abierto puede aceptar `Network.setCookies` sin error y no dejar
 * nada puesto: el target todavía no está listo. Antes el backend daba la sesión
 * por restaurada igual y el agente navegaba deslogueado sin que nada fallara —
 * así se caía `browser-session-persistence.test.ts` en CI, de forma
 * intermitente y sin dejar rastro del motivo.
 *
 * Aquí la vista es de mentira, así que el fallo se provoca a voluntad: el test
 * es determinístico y no necesita navegador.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import {
  contarRestauradas,
  restaurarCookiesEnVista,
} from "../packages/core/src/tools/web/webview-backend.ts";
import type { StoredCookie } from "../packages/core/src/tools/web/browser-session.ts";

const COOKIE: StoredCookie = { name: "sid", value: "secreto", domain: "localhost", path: "/" };

/**
 * Vista falsa con el contrato mínimo de la restauración.
 *
 * `fallosDeSetCookies` es cuántas veces `setCookies` se comporta como el Chrome
 * a medio arrancar: responde bien y no guarda nada.
 */
class VistaFalsa {
  cookies: Array<Record<string, unknown>> = [];
  intentosDeSetCookies = 0;
  navegaciones: string[] = [];

  constructor(private readonly fallosDeSetCookies: number) {}

  async navigate(url: string): Promise<void> {
    this.navegaciones.push(url);
  }

  async cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (method === "Network.setCookies") {
      this.intentosDeSetCookies++;
      if (this.intentosDeSetCookies > this.fallosDeSetCookies) {
        this.cookies = (params?.cookies as Array<Record<string, unknown>>) ?? [];
      }
      return {};
    }
    if (method === "Network.getAllCookies") return { cookies: this.cookies };
    return {};
  }
}

/** La cola real del backend; aquí sólo ejecuta la operación sobre la vista. */
const colaDe = (vista: VistaFalsa) =>
  <T,>(operacion: (v: VistaFalsa) => Promise<T>): Promise<T> => operacion(vista);

describe("restauración de cookies en la vista", () => {
  test("reintenta cuando el navegador aceptó las cookies pero no las conservó", async () => {
    const vista = new VistaFalsa(1); // el primer intento se traga la cookie

    const resultado = await restaurarCookiesEnVista([COOKIE], colaDe(vista));

    expect(resultado.restaurada).toBe(true);
    expect(resultado.intentos).toBe(2);
    expect(vista.cookies).toHaveLength(1);
  });

  test("no reintenta cuando la primera vez quedó puesta", async () => {
    const vista = new VistaFalsa(0);

    const resultado = await restaurarCookiesEnVista([COOKIE], colaDe(vista));

    expect(resultado).toMatchObject({ restaurada: true, puestas: 1, intentos: 1 });
    expect(vista.intentosDeSetCookies).toBe(1);
  });

  test("se rinde y lo dice cuando la vista nunca conserva nada", async () => {
    const vista = new VistaFalsa(Number.MAX_SAFE_INTEGER);

    const resultado = await restaurarCookiesEnVista([COOKIE], colaDe(vista));

    expect(resultado.restaurada).toBe(false);
    expect(resultado.intentos).toBeGreaterThan(1);
  });

  test("un error de CDP no rompe la navegación: se reporta como no restaurada", async () => {
    const resultado = await restaurarCookiesEnVista([COOKIE], async () => {
      throw new Error("CDP session not ready");
    });

    expect(resultado.restaurada).toBe(false);
  });

  test("siempre navega a about:blank antes de poner las cookies", async () => {
    const vista = new VistaFalsa(0);

    await restaurarCookiesEnVista([COOKIE], colaDe(vista));

    expect(vista.navegaciones).toEqual(["about:blank"]);
  });
});

describe("contarRestauradas", () => {
  test("no cuenta una cookie del mismo nombre con otro valor", () => {
    const vieja = { name: "sid", value: "de-otra-corrida", domain: "localhost" };
    expect(contarRestauradas([vieja], [COOKIE])).toBe(0);
  });

  test("cuenta la que coincide en nombre, dominio y valor", () => {
    const puesta = { name: "sid", value: "secreto", domain: "localhost" };
    expect(contarRestauradas([puesta], [COOKIE])).toBe(1);
  });

  test("una respuesta sin cookies no cuenta ninguna", () => {
    expect(contarRestauradas(undefined, [COOKIE])).toBe(0);
  });
});
