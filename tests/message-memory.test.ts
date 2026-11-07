/**
 * Historial recuperable: los mensajes de un hilo se indexan y se buscan por
 * significado solo dentro de ese hilo. HIVE_DB_PATH=":memory:" para no dejar estado.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { addMessage, getHistory, getMessagesByIds } from "../packages/core/src/agent/conversation-store";
import {
  indexThreadMessages,
  removeThreadMessages,
  searchThreadMessages,
} from "../packages/core/src/agent/message-memory";

async function conversar(threadId: string, textos: string[]) {
  for (const [i, t] of textos.entries()) {
    await addMessage(threadId, i % 2 === 0 ? "user" : "assistant", t, { channel: "webchat" });
  }
  const rows = await getHistory(threadId);
  await indexThreadMessages(threadId, rows);
  return rows;
}

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("historial recuperable", () => {
  test("encuentra un dato exacto de un mensaje antiguo", async () => {
    await conversar("u/web/a", [
      "El token de staging es STG-4471-ZETA, guárdalo",
      "Listo, anotado",
      "Ahora hablemos del menú del almuerzo",
      "Claro, ¿qué te gustaría comer?",
    ]);

    const hits = await searchThreadMessages("u/web/a", "token de staging");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.message.content).toContain("STG-4471-ZETA");
  });

  test("no cruza hilos", async () => {
    await conversar("u/web/a", ["La clave del proveedor de acero es ACE-99"]);
    await conversar("u/web/b", ["Receta de arroz con coco"]);

    expect(await searchThreadMessages("u/web/b", "proveedor de acero")).toEqual([]);
    expect((await searchThreadMessages("u/web/a", "proveedor de acero")).length).toBe(1);
  });

  test("reindexar es idempotente", async () => {
    const rows = await conversar("u/web/a", ["Presupuesto del servidor de producción"]);
    await indexThreadMessages("u/web/a", rows);

    expect((await searchThreadMessages("u/web/a", "servidor")).length).toBe(1);
  });

  test("al quitar el hilo deja de encontrarse, sin tocar otros hilos", async () => {
    await conversar("u/web/a", ["Contrato confidencial con el proveedor"]);
    await conversar("u/web/b", ["Contrato de alquiler del local"]);
    await removeThreadMessages("u/web/a");

    expect(await searchThreadMessages("u/web/a", "contrato")).toEqual([]);
    expect((await searchThreadMessages("u/web/b", "contrato")).length).toBe(1);
  });

  test("no indexa mensajes vacíos y una consulta vacía no devuelve nada", async () => {
    await conversar("u/web/a", ["   ", "texto con contenido"]);

    expect(await searchThreadMessages("u/web/a", "   ")).toEqual([]);
    expect((await searchThreadMessages("u/web/a", "contenido")).length).toBe(1);
  });
});

describe("getMessagesByIds", () => {
  test("devuelve en orden cronológico y omite ids inexistentes", async () => {
    const rows = await conversar("u/web/a", ["uno", "dos", "tres"]);
    const ids = rows.map((r) => r.id);

    const got = await getMessagesByIds("u/web/a", [ids[2]!, 999999, ids[0]!]);

    expect(got.map((m) => m.content)).toEqual(["uno", "tres"]);
  });

  test("no lee mensajes de otro hilo", async () => {
    const rows = await conversar("u/web/a", ["secreto"]);
    expect(await getMessagesByIds("u/web/b", [rows[0]!.id])).toEqual([]);
  });
});

describe("indexado al guardar (sin compactar)", () => {
  /** El indexado va en segundo plano: se espera a que el mensaje aparezca, con tope. */
  async function esperarHit(threadId: string, consulta: string, ms = 3000) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      const hits = await searchThreadMessages(threadId, consulta);
      if (hits.length > 0) return hits;
      await new Promise((r) => setTimeout(r, 25));
    }
    return [];
  }

  test("un mensaje guardado con addMessage ya es recuperable, sin indexThreadMessages", async () => {
    await addMessage("u/web/idx", "user", "La cuenta de facturación termina en 8842-QX", { channel: "webchat" });

    const hits = await esperarHit("u/web/idx", "cuenta de facturación");

    expect(hits.length).toBe(1);
    expect(hits[0]!.message.content).toContain("8842-QX");
  });

  test("los mensajes muy cortos no se indexan", async () => {
    await addMessage("u/web/corto", "user", "ok", { channel: "webchat" });
    await addMessage("u/web/corto", "user", "El almacén central abre a las seis de la mañana", { channel: "webchat" });

    expect((await esperarHit("u/web/corto", "almacén central")).length).toBe(1);
    expect(await searchThreadMessages("u/web/corto", "ok")).toEqual([]);
  });
});
