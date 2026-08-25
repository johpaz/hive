/**
 * computer_use_task — Hive opera su propio navegador mirando la pantalla.
 *
 * @category web
 * @seedId computer_use_task
 * @spanish usar el navegador, hacer clic, operar una página, rellenar un formulario
 *
 * A diferencia del resto de `browser_*`, que actúan por selector CSS, aquí el
 * modelo ve una captura y decide dónde pulsar. Sirve para páginas donde no hay
 * selector estable: canvas, lienzos, interfaces generadas, PDFs incrustados.
 *
 * El bucle es el estándar de Computer Use: captura → el modelo devuelve una
 * acción con coordenadas → se ejecuta → nueva captura, hasta terminar.
 *
 * Dos decisiones que conviene conocer:
 *
 * 1. **Las acciones van por CDP (`Input.dispatchMouseEvent`) cuando el motor lo
 *    expone, que es siempre que haya un Chromium.** Es entrada real del
 *    navegador: un canvas, un PDF incrustado o un mapa no reciben un MouseEvent
 *    sintético, y son justo las páginas para las que existe esta tool. Donde no
 *    hay CDP —el WebKit de macOS— se cae a `evaluate()`, que alcanza para HTML.
 *
 * 2. **Actúa sobre el navegador de Hive, nunca sobre la pantalla del usuario.**
 *    Si se equivoca, rompe su propia pestaña. En Wayland, además, ninguna
 *    aplicación puede mover el ratón de otras ventanas.
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";
import { loadProviderApiKey } from "../../storage/crypto.ts";

const log = logger.child("computer-use");

/** Resolución recomendada por Google para este modelo. */
const VIEWPORT = { width: 1440, height: 900 };
/** Tope de acciones por tarea: un bucle mal cerrado no puede girar sin fin. */
const MAX_PASOS = 15;
/** El modelo devuelve coordenadas en 0–999; hay que escalarlas al viewport. */
const ESCALA_MODELO = 1000;

/**
 * Ancho al que se reduce cada captura antes de mandarla al modelo.
 *
 * Medido sobre una página real: el viewport de 1440x900 al 70% pesa 72 KB y le
 * cuesta ~1032 tokens a Gemini (cuatro tiles de 768). A 1024 de ancho son ~516,
 * y el modelo sigue leyendo botones y texto sin problema. Reescalar cuesta
 * ~11 ms con `Bun.Image`, contra los ~50 ms que ya cuesta la captura.
 *
 * Lo que se optimiza son píxeles, no bytes: el costo va por tiles de 768, así
 * que en una página casi vacía el JPEG recodificado puede pesar algo más y aun
 * así costar la mitad.
 */
const ANCHO_CAPTURA = Number(process.env.HIVE_COMPUTER_USE_IMAGE_WIDTH) || 1024;

/** Calidad JPEG de la captura que ve el modelo. */
const CALIDAD_CAPTURA = 70;

/**
 * Cuántas capturas se conservan en el historial.
 *
 * Cada paso agregaba una imagen y el historial se reenvía **entero** en cada
 * llamada: una tarea de 15 pasos mandaba 120 imágenes en total (~124k tokens
 * sólo de píxeles). El modelo decide mirando la pantalla actual; la anterior
 * ayuda a ver si su última acción hizo algo, y de ahí para atrás no aporta.
 */
const CAPTURAS_EN_HISTORIAL = 2;

const MODELO = process.env.HIVE_COMPUTER_USE_MODEL || "gemini-3.7-flash";

export interface Vista {
  url: string;
  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(script: string): Promise<T>;
  screenshot(options?: Record<string, unknown>): Promise<string>;
  type(text: string): Promise<void>;
  press(key: string, options?: { modifiers?: string[] }): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  /** Puente CDP. Lo tienen los dos backends con Chrome; el WebKit de macOS no. */
  cdp?<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

/**
 * Reduce la captura antes de que salga hacia el modelo.
 *
 * `Bun.Image` (1.4+) hace el reescalado en proceso, sin dependencias nativas ni
 * un binario aparte. Si no está —Bun más viejo— se manda la original: peor
 * factura, mismo comportamiento.
 */
export async function reducirCaptura(base64: string): Promise<string> {
  const Imagen = (globalThis as { Bun?: { Image?: unknown } }).Bun?.Image as
    | (new (datos: Uint8Array) => {
        metadata(): Promise<{ width: number; height: number }>;
        resize(ancho: number): { jpeg(o: { quality: number }): { toBuffer(): Promise<Buffer> } };
      })
    | undefined;
  if (typeof Imagen !== "function") return base64;

  try {
    const bytes = Buffer.from(base64, "base64");
    const imagen = new Imagen(bytes);
    const { width } = await imagen.metadata();
    // Nunca agrandar: una captura chica ya es barata y estirarla sólo empeora
    // lo que el modelo ve.
    if (width <= ANCHO_CAPTURA) return base64;

    const reducida = await imagen.resize(ANCHO_CAPTURA).jpeg({ quality: CALIDAD_CAPTURA }).toBuffer();
    return reducida.toString("base64");
  } catch (error) {
    log.info(`no se pudo reducir la captura, se manda entera: ${(error as Error).message}`);
    return base64;
  }
}

/**
 * Saca del historial las capturas viejas, dejando las últimas
 * `CAPTURAS_EN_HISTORIAL`. Se reemplazan por una línea de texto para que el
 * modelo sepa que ahí hubo una pantalla y no crea que el paso no ocurrió.
 */
export function podarCapturas(historial: any[]): void {
  const conImagen: number[] = [];
  for (let i = 0; i < historial.length; i++) {
    if (historial[i]?.parts?.some((parte: any) => parte?.inlineData)) conImagen.push(i);
  }

  for (const indice of conImagen.slice(0, -CAPTURAS_EN_HISTORIAL)) {
    const entrada = historial[indice];
    entrada.parts = entrada.parts
      .filter((parte: any) => !parte?.inlineData)
      .concat([{ text: "(captura de este paso omitida para no cargar el contexto)" }]);
  }
}

/** Escala una coordenada del espacio del modelo (0–999) al viewport real. */
function aPixeles(valor: unknown, tamano: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n / ESCALA_MODELO) * tamano);
}

/** Qué hay en el punto — sólo para contarle al modelo dónde cayó el clic. */
function guionDescribir(x: number, y: number): string {
  return `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    if (!el) return "sin-elemento";
    return (el.tagName || "?") + " " + ((el.innerText || el.value || "").trim().slice(0, 60));
  })()`;
}

/**
 * Clic sintético, para cuando no hay CDP.
 *
 * Se despacha la secuencia completa (mousedown, mouseup, click) sobre el
 * elemento que hay en el punto: llamar sólo a `.click()` se salta los handlers
 * que muchas interfaces cuelgan de mousedown, y el clic parece no hacer nada.
 */
function guionClic(x: number, y: number, boton: number, veces: number): string {
  return `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    if (!el) return "sin-elemento";
    const opts = { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, button: ${boton} };
    for (let i = 0; i < ${veces}; i++) {
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }
    if (typeof el.focus === "function") el.focus();
    return (el.tagName || "?") + " " + ((el.innerText || el.value || "").trim().slice(0, 60));
  })()`;
}

/**
 * Vistas que ya demostraron no tener CDP utilizable.
 *
 * Tener el método no alcanza: el motor WebKit lo expone y lanza. Se prueba una
 * vez, y si falla esta vista queda marcada para el resto de la tarea en vez de
 * pagar un error por cada acción.
 */
const sinCdp = new WeakSet<object>();

function tieneCdp(vista: Vista): boolean {
  return typeof vista.cdp === "function" && !sinCdp.has(vista as unknown as object);
}

/**
 * Clic por coordenadas.
 *
 * Con CDP se despacha entrada real del navegador (`Input.dispatchMouseEvent`),
 * que es lo único que atienden un canvas, un PDF incrustado o un mapa: ahí no
 * hay elemento que reciba un MouseEvent sintético, y ese es justo el caso para
 * el que existe esta tool. Donde no hay CDP —un mac sin ningún Chromium, que
 * cae a WebKit— se usan los eventos sintéticos, que sirven para HTML normal.
 */
export async function clicEnPunto(
  vista: Vista,
  x: number,
  y: number,
  boton: number,
  veces: number,
): Promise<string> {
  if (tieneCdp(vista)) {
    const nombre = boton === 2 ? "right" : boton === 1 ? "middle" : "left";
    const mascara = boton === 2 ? 2 : boton === 1 ? 4 : 1;

    try {
      const donde = String(await vista.evaluate(guionDescribir(x, y)));

      // El mouseMoved previo importa: sin él, los menús y tooltips que
      // reaccionan al hover nunca llegan a abrirse antes de que baje el botón.
      await vista.cdp!("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
      for (let i = 1; i <= veces; i++) {
        await vista.cdp!("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: nombre, buttons: mascara, clickCount: i });
        await vista.cdp!("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: nombre, buttons: 0, clickCount: i });
      }
      return donde;
    } catch (error) {
      sinCdp.add(vista as unknown as object);
      log.info(`sin entrada por CDP, se usan eventos sintéticos: ${(error as Error).message}`);
    }
  }

  return String(await vista.evaluate(guionClic(x, y, boton, veces)));
}

export async function hoverEnPunto(vista: Vista, x: number, y: number): Promise<string> {
  if (tieneCdp(vista)) {
    try {
      await vista.cdp!("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
      return String(await vista.evaluate(guionDescribir(x, y)));
    } catch (error) {
      sinCdp.add(vista as unknown as object);
      log.info(`sin hover por CDP, se usan eventos sintéticos: ${(error as Error).message}`);
    }
  }

  return String(
    await vista.evaluate(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return "sin-elemento";
      const opts = { bubbles: true, clientX: ${x}, clientY: ${y} };
      el.dispatchEvent(new MouseEvent("mouseover", opts));
      el.dispatchEvent(new MouseEvent("mousemove", opts));
      return el.tagName || "?";
    })()`),
  );
}

/**
 * Ejecuta una acción del modelo.
 *
 * El nombre se compara por palabra clave y no contra una lista cerrada: los
 * nombres de las funciones predefinidas cambian entre versiones del modelo
 * (`click` vs `click_at`, `press_key` vs `key_combination`), y una tabla exacta
 * se rompería en la siguiente.
 */
async function ejecutarAccion(
  vista: Vista,
  nombre: string,
  args: Record<string, unknown>,
  viewport: { width: number; height: number },
): Promise<string> {
  const n = nombre.toLowerCase();
  const x = aPixeles(args.x, viewport.width);
  const y = aPixeles(args.y, viewport.height);

  if (n.includes("navigate") || n.includes("go_to") || n === "search") {
    const destino = String(args.url ?? args.query ?? "");
    if (!destino) return "sin destino";
    const url = destino.startsWith("http")
      ? destino
      : `https://www.google.com/search?q=${encodeURIComponent(destino)}`;
    await vista.navigate(url);
    await Bun.sleep(900);
    return `navegado a ${url}`;
  }

  if (n.includes("back")) {
    await vista.back();
    await Bun.sleep(600);
    return "atrás";
  }

  if (n.includes("forward")) {
    await vista.forward();
    await Bun.sleep(600);
    return "adelante";
  }

  if (n.includes("wait")) {
    await Bun.sleep(Math.min(5000, Number(args.seconds ?? 2) * 1000 || 2000));
    return "esperado";
  }

  if (n.includes("scroll")) {
    const direccion = String(args.direction ?? "down").toLowerCase();
    const magnitud = Number(args.amount ?? args.dy ?? 400) || 400;
    const dy = direccion.includes("up") ? -magnitud : magnitud;
    const dx = direccion.includes("left") ? -magnitud : direccion.includes("right") ? magnitud : 0;
    await vista.scroll(dx, dy || 0);
    await Bun.sleep(350);
    return `scroll ${direccion}`;
  }

  if (n.includes("hover") || n === "move" || n.includes("mouse_move")) {
    return await hoverEnPunto(vista, x, y);
  }

  if (n.includes("type") || n.includes("write")) {
    const texto = String(args.text ?? args.value ?? "");
    // Si trae coordenadas, primero hay que poner el foco donde toca.
    if (args.x !== undefined) await clicEnPunto(vista, x, y, 0, 1);
    await vista.type(texto);
    if (args.press_enter === true || args.submit === true) await vista.press("Enter");
    return `escrito: ${texto.slice(0, 40)}`;
  }

  if (n.includes("key") || n.includes("press") || n.includes("hotkey")) {
    const combinacion = String(args.keys ?? args.key ?? args.combination ?? "");
    const partes = combinacion.split(/[+\s]+/).filter(Boolean);
    const tecla = partes.pop() ?? "";
    if (!tecla) return "sin tecla";
    await vista.press(tecla, partes.length ? { modifiers: partes } : undefined);
    return `tecla ${combinacion}`;
  }

  if (n.includes("drag")) {
    const x2 = aPixeles(args.destination_x ?? args.to_x ?? args.x2, viewport.width);
    const y2 = aPixeles(args.destination_y ?? args.to_y ?? args.y2, viewport.height);
    if (tieneCdp(vista)) {
      try {
        // Un arrastre real necesita movimientos intermedios: las interfaces que
        // siguen el puntero (sliders, lienzos, reordenables) ignoran un salto.
        await vista.cdp!("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
        await vista.cdp!("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
        for (let paso = 1; paso <= 5; paso++) {
          await vista.cdp!("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: Math.round(x + ((x2 - x) * paso) / 5),
            y: Math.round(y + ((y2 - y) * paso) / 5),
            button: "left",
            buttons: 1,
          });
        }
        await vista.cdp!("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1 });
        return `arrastrado de (${x},${y}) a (${x2},${y2})`;
      } catch (error) {
        sinCdp.add(vista as unknown as object);
        log.info(`sin arrastre por CDP, se usan eventos sintéticos: ${(error as Error).message}`);
      }
    }

    return String(
      await vista.evaluate(`(() => {
        const a = document.elementFromPoint(${x}, ${y});
        const b = document.elementFromPoint(${x2}, ${y2});
        if (!a || !b) return "sin-elemento";
        a.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: ${x}, clientY: ${y} }));
        b.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: ${x2}, clientY: ${y2} }));
        b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: ${x2}, clientY: ${y2} }));
        return "arrastrado";
      })()`),
    );
  }

  if (n.includes("screenshot")) return "captura tomada";

  if (n.includes("click")) {
    const boton = n.includes("right") ? 2 : n.includes("middle") ? 1 : 0;
    const veces = n.includes("triple") ? 3 : n.includes("double") ? 2 : 1;
    const resultado = await clicEnPunto(vista, x, y, boton, veces);
    await Bun.sleep(450);
    return `clic en (${x},${y}) → ${resultado}`;
  }

  return `acción no soportada: ${nombre}`;
}

/** ¿El modelo pide confirmación humana para esta acción? */
function pideConfirmacion(args: Record<string, unknown>): boolean {
  const decision = String(args.safety_decision ?? (args.safety as any)?.decision ?? "").toLowerCase();
  return decision.includes("confirm");
}

export const computerUseTaskTool: Tool = {
  name: "computer_use_task",
  description:
    "Opera el navegador de Hive mirando la pantalla: hace clic, escribe y navega guiado por lo que ve. " +
    "Úsalo cuando la página no tenga selectores estables o cuando browser_click/browser_type no basten. " +
    "Actúa sobre el navegador de Hive, NUNCA sobre la pantalla del usuario. " +
    "Spanish: usar el navegador, hacer clic, operar una página, rellenar un formulario",
  timeoutMs: 240_000,
  parameters: {
    type: "object",
    properties: {
      objetivo: {
        type: "string",
        description:
          "Qué hay que lograr, en una frase concreta y verificable. Ej: 'buscar el precio del dólar en el Banco de la República y leer la cifra'.",
      },
      url: { type: "string", description: "Página desde la que empezar (opcional)." },
      max_pasos: { type: "number", description: `Tope de acciones (default ${MAX_PASOS}).` },
      confirmado: {
        type: "boolean",
        description:
          "Ponlo en true SOLO si el usuario ya aprobó explícitamente una acción que quedó pendiente de confirmación.",
      },
    },
    required: ["objetivo"],
  },
  execute: async (params: Record<string, unknown>, _config?: any) => {
    const objetivo = String(params.objetivo ?? "").trim();
    if (!objetivo) return { ok: false, error: "Falta el objetivo." };

    const maxPasos = Math.max(1, Math.min(30, Number(params.max_pasos) || MAX_PASOS));
    const confirmado = params.confirmado === true;

    const apiKey = (await loadProviderApiKey("gemini")) || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Falta la API key de Gemini (Ajustes → Proveedores)." };
    }

    const servicio = getBrowserService();
    if (!servicio?.isAvailable()) {
      return { ok: false, error: "El navegador de Hive no está disponible." };
    }
    const vista = (await servicio.getView()) as unknown as Vista | null;
    if (!vista) return { ok: false, error: "No se pudo abrir el navegador de Hive." };

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    // El resize es un intento, no un requisito: algunos motores del WebView no
    // implementan `Emulation.setDeviceMetricsOverride` y lanzan. Lo que importa
    // es medir después el viewport de verdad, porque es contra ese tamaño
    // —no contra el que pedimos— que hay que escalar las coordenadas del modelo.
    try {
      await vista.resize(VIEWPORT.width, VIEWPORT.height);
    } catch (error) {
      log.info(`el motor no permite fijar el viewport: ${(error as Error).message}`);
    }

    if (params.url) {
      await vista.navigate(String(params.url));
      await Bun.sleep(900);
    }

    const medido = await vista
      .evaluate<{ w: number; h: number }>("({ w: window.innerWidth, h: window.innerHeight })")
      .catch(() => null);
    const viewport = {
      width: Number(medido?.w) || VIEWPORT.width,
      height: Number(medido?.h) || VIEWPORT.height,
    };
    log.info(`viewport real: ${viewport.width}x${viewport.height}`);

    const capturar = async (): Promise<string> =>
      reducirCaptura(
        await vista.screenshot({ encoding: "base64", format: "jpeg", quality: CALIDAD_CAPTURA }),
      );

    const historial: any[] = [
      {
        role: "user",
        parts: [
          { text: `Objetivo: ${objetivo}\nURL actual: ${vista.url}` },
          { inlineData: { mimeType: "image/jpeg", data: await capturar() } },
        ],
      },
    ];

    const acciones: string[] = [];

    for (let paso = 0; paso < maxPasos; paso++) {
      const respuesta = await ai.models.generateContent({
        model: MODELO,
        contents: historial,
        config: {
          tools: [{ computerUse: { environment: "ENVIRONMENT_BROWSER" } }],
        } as any,
      });

      const partes = respuesta.candidates?.[0]?.content?.parts ?? [];
      const llamada = partes.find((p: any) => p.functionCall)?.functionCall;
      const texto = partes
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join(" ")
        .trim();

      if (!llamada) {
        log.info(`objetivo cumplido en ${paso} acciones`);
        return { ok: true, completado: true, pasos: paso, acciones, resultado: texto || "Hecho.", url: vista.url };
      }

      const args = (llamada.args ?? {}) as Record<string, unknown>;

      // La confirmación no se resuelve aquí: el runtime de tools no puede
      // preguntarle a nadie. Se devuelve el control al coordinador, que sí
      // habla con el usuario, y la tarea se reanuda con `confirmado: true`.
      if (pideConfirmacion(args) && !confirmado) {
        log.info(`pausada por seguridad: ${llamada.name}`);
        return {
          ok: true,
          completado: false,
          pendiente_confirmacion: true,
          accion: llamada.name,
          intencion: String(args.intent ?? texto ?? ""),
          acciones,
          url: vista.url,
          nota:
            "Esta acción necesita el visto bueno del usuario. Pregúntale con tus palabras y, si acepta, " +
            "vuelve a llamar a computer_use_task con el mismo objetivo y confirmado: true.",
        };
      }

      const resultado = await ejecutarAccion(vista, String(llamada.name), args, viewport);
      acciones.push(`${llamada.name}: ${resultado}`);
      log.info(`paso ${paso + 1}/${maxPasos} — ${llamada.name} → ${resultado}`);

      // Se devuelve el contenido del modelo TAL CUAL vino, sin reconstruirlo.
      // Gemini 3.x firma cada functionCall con un `thoughtSignature` y rechaza
      // el turno siguiente si falta: reconstruir la parte a mano cortaba el
      // bucle en la segunda acción con un 400.
      historial.push(respuesta.candidates?.[0]?.content ?? { role: "model", parts: [{ functionCall: llamada }] });
      historial.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: llamada.name,
              response: { output: resultado, url: vista.url },
            },
          },
          { inlineData: { mimeType: "image/jpeg", data: await capturar() } },
        ],
      });

      podarCapturas(historial);
    }

    return {
      ok: true,
      completado: false,
      pasos: maxPasos,
      acciones,
      url: vista.url,
      nota: `Se alcanzó el tope de ${maxPasos} acciones sin terminar. Revisa el objetivo o divídelo en partes.`,
    };
  },
};
