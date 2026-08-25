/**
 * Deduplicación de pedidos de la sesión de voz.
 *
 * Caso real que motivó esto (sesión del 2026-08-16): un solo "¿qué archivos
 * tenés en el espacio de trabajo?" terminó en TRES tareas idénticas delegadas a
 * especialistas. La sesión de voz reintenta con facilidad — cada hito narrado
 * vuelve a entrar como turno y el modelo, viendo un pedido sin responder,
 * delega de nuevo — así que la guarda tiene que reconocer el mismo pedido
 * aunque venga reformulado, que es justamente lo que hace la voz al llamar a la
 * función puente.
 *
 * Los pares de abajo salen textuales del historial de esa llamada.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { esDuplicado, similitud } from "../packages/core/src/gateway/realtime/bridge-tools";

/** El umbral que aplica cuando el pedido llega en caliente (≤30 s). */
const SIMILITUD_MINIMA = 0.5;
const EN_CALIENTE = 8_000;   // cadencia observada de los reintentos del modelo
const MAS_TARDE = 90_000;    // el usuario reformula, ya no es un reintento

describe("similitud entre pedidos de voz", () => {
  // Lo que llega acá NO son frases sueltas del usuario — ésas se guardan como
  // `realtime_chat` y nunca alcanzan la colmena. Son las reformulaciones que
  // escribe el propio modelo al llamar a la función puente, que es donde
  // aparecía la duplicación.
  test("reconoce el mismo pedido reformulado por el modelo", () => {
    const pares: Array<[string, string]> = [
      [
        "El usuario pide que liste los archivos del espacio de trabajo.",
        "Listá los archivos que hay en el espacio de trabajo.",
      ],
      [
        "El usuario quiere saber qué archivos hay en el espacio de trabajo de Hive.",
        "Listar los archivos disponibles en el espacio de trabajo.",
      ],
      [
        "Buscá en la web qué es el protocolo MCP y resumilo.",
        "El usuario quiere que busque en la web información sobre el protocolo MCP.",
      ],
    ];

    for (const [a, b] of pares) {
      expect(similitud(a, b)).toBeGreaterThanOrEqual(SIMILITUD_MINIMA);
    }
  });

  test("no confunde pedidos distintos", () => {
    const pares: Array<[string, string]> = [
      [
        "El usuario pide que liste los archivos del espacio de trabajo.",
        "El usuario quiere que busque en la web información sobre la marca Tu profe de IA.",
      ],
      [
        "Leé el contenido del archivo resumen_tecnico_hive_quiz.docx y resumilo.",
        "Programá un recordatorio para mañana a las nueve de la mañana.",
      ],
      [
        "Buscá el precio del dólar hoy.",
        "Escribí un informe gerencial sobre la reunión de ayer.",
      ],
    ];

    for (const [a, b] of pares) {
      expect(similitud(a, b)).toBeLessThan(SIMILITUD_MINIMA);
    }
  });

  test("corta la ráfaga de reintentos del modelo", () => {
    // La cadencia real del bug: el mismo pedido cada ~8 s (logs del 2026-08-16,
    // jobs 46/47/48/50 en menos de un minuto).
    const previa = "El usuario pide que liste los archivos del espacio de trabajo.";
    const reintento = "Listá los archivos que hay en el espacio de trabajo.";
    expect(esDuplicado(previa, reintento, EN_CALIENTE)).toBe(true);
  });

  test("un pedido distinto pasa aunque comparta palabras", () => {
    expect(
      esDuplicado("El usuario pide que liste los archivos del espacio de trabajo.",
                  "Buscá en la web el precio del dólar hoy.", EN_CALIENTE),
    ).toBe(false);
  });

  test("pasado el rato, un pedido parecido vuelve a valer", () => {
    // Falso positivo caro: bloquearlo dejaría al usuario esperando algo que la
    // colmena nunca empezó. Con el correr de los segundos gana la persona.
    expect(esDuplicado("Buscá el precio del dólar hoy.", "Buscá el precio del euro hoy.", MAS_TARDE))
      .toBe(false);
    expect(esDuplicado("Leé el archivo informe.docx", "Leé el archivo resumen.docx", MAS_TARDE))
      .toBe(false);
  });

  test("nada se deduplica después de la ventana larga", () => {
    const mismo = "El usuario pide que liste los archivos del espacio de trabajo.";
    expect(esDuplicado(mismo, mismo, 5 * 60_000)).toBe(false);
  });

  test("ignora tildes, mayúsculas y puntuación", () => {
    // La transcripción del ASR alterna la acentuación entre una frase y la siguiente.
    expect(similitud("Listá los archivos del espacio", "listá LOS ARCHIVOS del espacio!!")).toBe(1);
    expect(similitud("¿Qué versión tenés instalada?", "que version tenes instalada")).toBe(1);
  });

  test("un pedido vacío no se parece a nada", () => {
    expect(similitud("", "listar archivos")).toBe(0);
    expect(similitud("listar archivos", "")).toBe(0);
  });
});
