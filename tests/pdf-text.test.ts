import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "../packages/core/node_modules/pdf-lib";
import { extraerTextoPdf, textoDePagina } from "../packages/core/src/tools/office/pdf-text";
import { officeLeerPdfTool } from "../packages/core/src/tools/office/office-leer-pdf";

async function pdf(paginas: Array<Array<{ x: number; y: number; t: string }>>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const items of paginas) {
    const page = doc.addPage([400, 400]);
    for (const it of items) page.drawText(it.t, { x: it.x, y: it.y, size: 12, font });
  }
  return doc.save();
}

describe("textoDePagina", () => {
  test("separa renglones por posición y columnas por el hueco", () => {
    const it = (str: string, x: number, y: number, width = str.length * 6) => ({ str, width, transform: [12, 0, 0, 12, x, y] });
    const t = textoDePagina([it("Producto", 10, 300), it("Precio", 200, 300), it("Café", 10, 285), it("12000", 200, 285), it("Nota final", 10, 200)]);
    expect(t.split("\n")[0]).toMatch(/Producto {2}Precio/);
    expect(t.split("\n")[1]).toMatch(/Café {2}12000/);
    expect(t).toContain("\n\nNota final"); // salto grande = párrafo nuevo
  });
});

describe("extraerTextoPdf", () => {
  test("lee texto con renglones, páginas y total", async () => {
    const bytes = await pdf([[{ x: 20, y: 350, t: "Contrato de servicio" }, { x: 20, y: 330, t: "Cliente: Ana" }], [{ x: 20, y: 350, t: "Clausula dos" }]]);
    const r = await extraerTextoPdf(bytes);
    expect(r.totalPaginas).toBe(2);
    expect(r.sinTexto).toBe(false);
    expect(r.texto).toContain("--- Página 1 ---\nContrato de servicio\nCliente: Ana");
    expect(r.texto).toContain("--- Página 2 ---\nClausula dos");
  });
  test("un PDF sin capa de texto se marca como escaneado (sin modelos)", async () => {
    const r = await extraerTextoPdf(await pdf([[], []]));
    expect(r.sinTexto).toBe(true);
    expect(r.texto).not.toContain("Contrato");
  });
  test("respeta el tope y dice por dónde seguir", async () => {
    const pag = (n: number) => [{ x: 20, y: 350, t: `Pagina numero ${n} ${"x".repeat(60)}` }];
    const r = await extraerTextoPdf(await pdf([pag(1), pag(2), pag(3)]), { maxCaracteres: 200 });
    expect(r.truncado).toBe(true);
    expect(r.paginasLeidas).toBe(2);
    expect(r.siguientePagina).toBe(3);
  });
  test("un archivo que no es PDF da un error claro", async () => {
    await expect(extraerTextoPdf(new TextEncoder().encode("hola"))).rejects.toThrow("PDF");
  });
});

describe("office_leer_pdf", () => {
  test("devuelve el texto una sola vez y respeta el rango", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    const ruta = join(dir, "a.pdf");
    writeFileSync(ruta, await pdf([[{ x: 20, y: 350, t: "Uno" }], [{ x: 20, y: 350, t: "Dos" }]]));
    const r: any = await officeLeerPdfTool.execute({ ruta, pagina_inicio: 2 });
    expect(r.ok).toBe(true);
    expect(r.texto).toContain("Dos");
    expect(r.texto).not.toContain("Uno");
    expect(r.paginas).toBeUndefined();
  });
  test("PDF escaneado: aviso en vez de texto", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    const ruta = join(dir, "b.pdf");
    writeFileSync(ruta, await pdf([[]]));
    const r: any = await officeLeerPdfTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.aviso).toContain("no hace OCR");
  });
});
