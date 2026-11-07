/**
 * Memoria entre hilos: los resúmenes se indexan por hilo y se recuperan desde
 * otros hilos, nunca desde el propio. HIVE_DB_PATH=":memory:" para no dejar estado.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { saveSummary } from "../packages/core/src/agent/conversation-store";
import {
  indexThreadSummary,
  removeThreadSummary,
  searchRelatedSummaries,
  resolveEpisodes,
  episodicStrategy,
} from "../packages/core/src/agent/summary-memory";
import { getHiveDb } from "../packages/core/src/storage/hivedb";

async function resumir(threadId: string, texto: string) {
  await saveSummary(threadId, texto, 5, 10);
  await indexThreadSummary(threadId, texto);
}

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("memoria entre hilos", () => {
  test("encuentra el resumen de otro hilo y descarta el del hilo actual", async () => {
    await resumir("hilo-1", "El cliente pidió migrar la facturación electrónica a Alegra");
    await resumir("hilo-2", "Se habló de la facturación electrónica y los impuestos");

    const r = await searchRelatedSummaries("facturación electrónica", "hilo-2");

    expect(r.map((x) => x.threadId)).toEqual(["hilo-1"]);
    expect(r[0]!.summary).toContain("Alegra");
  });

  test("un resumen actualizado reemplaza al anterior del mismo hilo", async () => {
    await resumir("hilo-1", "Plan de viaje a Japón en primavera");
    await resumir("hilo-1", "Presupuesto del servidor de producción");

    expect(await searchRelatedSummaries("Japón", "otro")).toEqual([]);
    expect((await searchRelatedSummaries("servidor", "otro")).map((x) => x.threadId)).toEqual(["hilo-1"]);
  });

  test("al quitar el resumen de un hilo deja de encontrarse", async () => {
    await resumir("hilo-1", "Contrato con el proveedor de acero");
    await removeThreadSummary("hilo-1");

    expect(await searchRelatedSummaries("proveedor de acero", "otro")).toEqual([]);
  });

  test("una consulta vacía no devuelve nada", async () => {
    await resumir("hilo-1", "Algo cualquiera");
    expect(await searchRelatedSummaries("   ", "otro")).toEqual([]);
  });
});


describe("similitud episódica", () => {
  test("resuelve los episodios a su resumen, sin el hilo actual, los ya usados ni los huérfanos", async () => {
    await resumir("hilo-1", "Migración de facturación a Alegra");
    await resumir("hilo-2", "Hilo actual");
    await resumir("hilo-3", "Ya inyectado por otra vía");
    const r = await resolveEpisodes(
      [{ taskId: (x=>`summary:${x}`)("hilo-2") }, { taskId: (x=>`summary:${x}`)("hilo-3") }, { taskId: (x=>`summary:${x}`)("hilo-9") }, { taskId: (x=>`summary:${x}`)("hilo-1") }, { taskId: "otro:cosa" }],
      ["hilo-2", "hilo-3"],
    );
    expect(r.map((x) => x.threadId)).toEqual(["hilo-1"]);
    expect(r[0]!.summary).toContain("Alegra");
  });

  test("el resumen se indexa como episodio (kind=episode)", async () => {
    await resumir("hilo-1", "Migración de facturación a Alegra");
    const db = await getHiveDb();
    const hits = await db.queryHybrid({ text: "facturación", k: 3, filters: [{ field: "kind", value: "episode" }] });
    expect(hits.length).toBe(1);
  });

  test("sin embedQuery en el HiveDB instalado no se activa (una versión vieja ignoraría el filtro)", async () => {
    const db = (await getHiveDb()) as unknown as { embedQuery?: unknown };
    if (typeof db.embedQuery === "function") return; // build nuevo con embedder: otra rama
    expect(await episodicStrategy("facturación electrónica")).toBeUndefined();
  });
});
