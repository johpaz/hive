import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTaskFiles, supersedeFiles, withTaskFiles, writtenPathFromResult } from "../packages/core/src/agent/written-files";

describe("archivos escritos por una tarea", () => {
  test("extrae la ruta solo de escritores con éxito", () => {
    expect(writtenPathFromResult("office_escribir_docx", "ok: true\nruta: /w/informe.docx\nbytesEscritos: 10")).toBe("/w/informe.docx");
    expect(writtenPathFromResult("office_editar_xlsx", '{"ok":true,"ruta":"/w/a_corregido.xlsx"}')).toBe("/w/a_corregido.xlsx");
    expect(writtenPathFromResult("office_escribir_docx", "ok: false\nerror: x\nruta: /w/x.docx")).toBeNull();
    expect(writtenPathFromResult("office_leer_pdf", "ok: true\nruta: /w/x.pdf")).toBeNull();
    expect(writtenPathFromResult("office_escribir_pdf", "ok: true\nruta: relativa.pdf")).toBeNull();
  });

  test("el metadata conserva otras claves y no duplica", () => {
    const m = withTaskFiles(JSON.stringify({ otra: 1 }), ["/a", "/a", "/b"]);
    expect(JSON.parse(m).otra).toBe(1);
    expect(readTaskFiles(m)).toEqual(["/a", "/b"]);
    expect(readTaskFiles(null)).toEqual([]);
    expect(readTaskFiles("no json")).toEqual([]);
  });

  test("supersedeFiles aparta el rechazado, respeta el sobrescrito y no actúa sin reemplazo", () => {
    const d = mkdtempSync(join(tmpdir(), "sup-"));
    const v1 = join(d, "informe.docx"), v2 = join(d, "informe_v2.docx");
    writeFileSync(v1, "viejo"); writeFileSync(v2, "nuevo");

    expect(supersedeFiles([v1], [])).toEqual([]);          // sin reemplazo: no se toca nada
    expect(existsSync(v1)).toBe(true);
    expect(supersedeFiles([v1], [v1])).toEqual([]);        // sobrescrito en el mismo sitio
    expect(existsSync(v1)).toBe(true);

    expect(supersedeFiles([v1], [v2])).toEqual([v1]);      // nombre nuevo: el viejo se aparta
    expect(existsSync(v1)).toBe(false);
    expect(existsSync(v2)).toBe(true);
    expect(readdirSync(join(d, ".rechazados")).length).toBe(1);
  });

  test("purga lo apartado hace más de 7 días", () => {
    const d = mkdtempSync(join(tmpdir(), "sup-"));
    const a = join(d, "a.docx"), b = join(d, "b.docx"), nuevo = join(d, "c.docx");
    writeFileSync(a, "1"); writeFileSync(b, "2"); writeFileSync(nuevo, "3");
    const hace10dias = Date.now() - 10 * 24 * 3600 * 1000;
    supersedeFiles([a], [nuevo], hace10dias);
    expect(readdirSync(join(d, ".rechazados")).length).toBe(1);
    supersedeFiles([b], [nuevo]);                           // ahora: purga el de hace 10 días
    const quedan = readdirSync(join(d, ".rechazados"));
    expect(quedan.length).toBe(1);
    expect(quedan[0]).toContain("b.docx");
  });
});

import { rejectedFilesToSupersede } from "../packages/core/src/agent/written-files";
describe("re-delegación tras un fallo", () => {
  const meta = (o: string, files: string[] = []) => JSON.stringify({ origin_thread: o, files });
  const now = Date.now();
  const cur = { id: "9", agent_id: "w", metadata: meta("t1") };
  test("solo failed/blocked del mismo worker y conversación, dentro de la ventana", () => {
    const prior = [
      { id: "1", agent_id: "w", status: "blocked", metadata: meta("t1", ["/a.docx"]), updated_at: now },
      { id: "2", agent_id: "w", status: "completed", metadata: meta("t1", ["/ok.docx"]), updated_at: now },
      { id: "3", agent_id: "w", status: "failed", metadata: meta("otra", ["/b.docx"]), updated_at: now },
      { id: "4", agent_id: "x", status: "failed", metadata: meta("t1", ["/c.docx"]), updated_at: now },
      { id: "5", agent_id: "w", status: "failed", metadata: meta("t1", ["/viejo.docx"]), updated_at: now - 7 * 3600 * 1000 },
      { id: "6", agent_id: "w", status: "failed", metadata: meta("t1", []), updated_at: now },
    ];
    expect(rejectedFilesToSupersede(cur, prior, now)).toEqual([{ taskId: "1", files: ["/a.docx"] }]);
  });
  test("sin conversación de origen no actúa", () => {
    expect(rejectedFilesToSupersede({ ...cur, metadata: null }, [{ id: "1", agent_id: "w", status: "failed", metadata: meta("t1", ["/a"]), updated_at: now }], now)).toEqual([]);
  });
});
