/**
 * thread-id — identidad de las conversaciones.
 *
 * Cubre las dos reglas de formato de las que depende el aislamiento entre hilos:
 * el separador "/" (para no chocar con el hilo legacy, cuyo id es el userId pelado)
 * y el colapso de ":" (para que ningún prefijo de scan sea prefijo de otro).
 */

import { describe, test, expect } from "bun:test";
import {
  makeThreadId,
  parseThreadId,
  isStructuredThreadId,
  newWebConversationId,
  sanitizeSegment,
} from "../packages/core/src/agent/thread-id";

describe("makeThreadId / parseThreadId", () => {
  test("round-trips un hilo normal", () => {
    const id = makeThreadId("user-1", "telegram", "558812345");
    expect(id).toBe("user-1/telegram/558812345");
    expect(parseThreadId(id)).toEqual({
      userId: "user-1",
      channel: "telegram",
      peerId: "558812345",
    });
  });

  test("conserva el jid de un grupo de WhatsApp", () => {
    const id = makeThreadId("user-1", "whatsapp", "573001112233-1620000000@g.us");
    expect(parseThreadId(id)?.peerId).toBe("573001112233-1620000000@g.us");
  });

  test('colapsa ":" para que un peerId no sea prefijo de otro', () => {
    // Telegram arma el peerId de grupo como `${chat.id}:${from.id}`. Sin colapsar
    // los dos puntos, el prefijo de scan del DM ("user-1/telegram/12345:") sería
    // prefijo del id de los mensajes del grupo, y el DM leería la conversación
    // del grupo como si fuera suya.
    const dm = makeThreadId("user-1", "telegram", "12345");
    const grupo = makeThreadId("user-1", "telegram", "12345:678");

    expect(grupo).toBe("user-1/telegram/12345_678");
    expect(`${grupo}:000000000000001`.startsWith(`${dm}:`)).toBe(false);
  });

  test('sanea "/" para no romper el parseo', () => {
    const id = makeThreadId("user-1", "slack", "team/canal");
    expect(parseThreadId(id)?.peerId).toBe("team_canal");
  });

  test("sanitizeSegment deja el resto intacto", () => {
    expect(sanitizeSegment("abc-123@g.us")).toBe("abc-123@g.us");
    expect(sanitizeSegment("a/b:c")).toBe("a_b_c");
  });

  test("un segmento vacío no produce un id degenerado", () => {
    expect(makeThreadId("user-1", "webchat", "")).toBe("user-1/webchat/default");
  });
});

describe("hilos sin formato", () => {
  test("el hilo legacy (userId pelado) no parsea", () => {
    expect(parseThreadId("user-1")).toBeNull();
    expect(isStructuredThreadId("user-1")).toBe(false);
  });

  test("el hilo aislado de un worker no parsea", () => {
    expect(parseThreadId("task-42-investigador")).toBeNull();
  });

  test("un id con partes de más no parsea", () => {
    expect(parseThreadId("a/b/c/d")).toBeNull();
  });

  test("el prefijo del hilo legacy no alcanza a los hilos nuevos", () => {
    // La razón de usar "/" y no ":": `conversations` se lee por prefijo, y el hilo
    // legacy escanea "user-1:". Con ":" de separador se habría tragado el
    // historial de todas las conversaciones nuevas del mismo usuario.
    const nuevo = makeThreadId("user-1", "webchat", "conv-abc");
    expect(`${nuevo}:000000000000001`.startsWith("user-1:")).toBe(false);
  });
});

describe("newWebConversationId", () => {
  test("genera ids distintos y sin caracteres reservados", () => {
    const a = newWebConversationId();
    const b = newWebConversationId();
    expect(a).not.toBe(b);
    expect(a.startsWith("conv-")).toBe(true);
    expect(sanitizeSegment(a)).toBe(a);
  });
});
