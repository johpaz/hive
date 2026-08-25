/**
 * Lo que `computer_use_task` le manda al modelo, medido en píxeles.
 *
 * El bucle vive de capturas: una por paso, y el historial se reenvía entero en
 * cada llamada. Sin control, una tarea de 15 pasos manda 120 imágenes. Dos
 * cosas lo evitan y las dos se prueban acá: reducir cada captura con
 * `Bun.Image` (1.4+) y conservar sólo las últimas del historial.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { reducirCaptura, podarCapturas } from "../packages/core/src/tools/web/computer-use.ts";

const TIENE_IMAGE = typeof (globalThis as { Bun?: { Image?: unknown } }).Bun?.Image === "function";
const { isWebViewSupported } = await import("../packages/core/src/tools/web/browser-backend.ts");
const { WebViewBackend } = await import("../packages/core/src/tools/web/webview-backend.ts");

// Las imágenes de prueba salen del navegador de verdad: construir un JPEG a
// mano no prueba nada sobre lo que la tool manda al modelo.
const VIVO = TIENE_IMAGE && isWebViewSupported();

async function capturaReal(): Promise<{ base64: string; ancho: number }> {
  const backend = new WebViewBackend({ persistSession: false });
  try {
    await backend.navigate(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        "<h1>Panel</h1><button>Aceptar</button><input placeholder='correo'>",
      )}`,
    );
    const base64 = await backend.screenshot({ format: "jpeg", quality: 70 });
    const { width } = await new (Bun as unknown as { Image: any }).Image(
      Buffer.from(base64, "base64"),
    ).metadata();
    return { base64, ancho: width };
  } finally {
    backend.close();
  }
}

describe.skipIf(!VIVO)("reducirCaptura", () => {
  test("la captura llega al modelo con el ancho tope", async () => {
    const { base64, ancho } = await capturaReal();
    // El viewport por defecto (1280) es más ancho que el tope: hay que reducir.
    expect(ancho).toBeGreaterThan(1024);

    const reducida = await reducirCaptura(base64);
    const meta = await new (Bun as unknown as { Image: any }).Image(
      Buffer.from(reducida, "base64"),
    ).metadata();

    // Lo que se mide es el ancho, no los bytes: el modelo cobra por tiles de
    // 768 px, así que 1024 vale la mitad que 1280 aunque en una página casi
    // vacía el JPEG recodificado llegue a pesar algo más.
    expect(meta.width).toBe(1024);
  }, 60_000);

  test("una captura que ya está en el tope no se toca — estirarla sólo empeora lo que se ve", async () => {
    const { base64 } = await capturaReal();
    const unaVez = await reducirCaptura(base64);
    const dosVeces = await reducirCaptura(unaVez);

    expect(dosVeces).toBe(unaVez);
  }, 60_000);

  test("si la imagen no se puede procesar, se manda la original en vez de fallar", async () => {
    const basura = Buffer.from("esto no es una imagen").toString("base64");
    expect(await reducirCaptura(basura)).toBe(basura);
  });
});

describe("podarCapturas", () => {
  /** Un historial como el que arma el bucle: turno del modelo + turno con captura. */
  function historialDe(pasos: number): any[] {
    const historial: any[] = [];
    for (let i = 0; i < pasos; i++) {
      historial.push({ role: "model", parts: [{ functionCall: { name: "click_at" } }] });
      historial.push({
        role: "user",
        parts: [
          { functionResponse: { name: "click_at", response: { output: `paso ${i}` } } },
          { inlineData: { mimeType: "image/jpeg", data: `imagen-${i}` } },
        ],
      });
    }
    return historial;
  }

  const imagenesDe = (historial: any[]) =>
    historial.flatMap((e) => (e.parts ?? []).filter((p: any) => p.inlineData).map((p: any) => p.inlineData.data));

  test("deja sólo las dos últimas capturas", () => {
    const historial = historialDe(6);
    podarCapturas(historial);

    expect(imagenesDe(historial)).toEqual(["imagen-4", "imagen-5"]);
  });

  test("las capturas que se van dejan constancia de que existieron", () => {
    const historial = historialDe(4);
    podarCapturas(historial);

    const primerTurno = historial[1];
    expect(primerTurno.parts.some((p: any) => p.inlineData)).toBe(false);
    // El functionResponse se conserva: el modelo tiene que saber qué pasó.
    expect(primerTurno.parts.some((p: any) => p.functionResponse)).toBe(true);
    expect(primerTurno.parts.at(-1).text).toContain("omitida");
  });

  test("con pocas capturas no toca nada", () => {
    const historial = historialDe(2);
    podarCapturas(historial);

    expect(imagenesDe(historial)).toEqual(["imagen-0", "imagen-1"]);
  });

  test("podar dos veces no duplica la nota", () => {
    const historial = historialDe(5);
    podarCapturas(historial);
    podarCapturas(historial);

    const notas = historial[1].parts.filter((p: any) => p.text?.includes("omitida"));
    expect(notas).toHaveLength(1);
  });
});
