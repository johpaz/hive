import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "../packages/core/node_modules/jszip";
import { officeEditarDocxTool, reemplazarEnParrafo } from "../packages/core/src/tools/office/office-editar-docx";
import { officeEditarXlsxTool } from "../packages/core/src/tools/office/office-editar-xlsx";

describe("reemplazarEnParrafo", () => {
  test("reemplaza texto partido en varios fragmentos y conserva el formato del primero", () => {
    const p = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hola Mun</w:t></w:r><w:r><w:t>do cruel</w:t></w:r></w:p>';
    const r = reemplazarEnParrafo(p, "Mundo", "Colombia");
    expect(r.cuenta).toBe(1);
    expect(r.xml).toContain("<w:b/>");
    expect(r.xml).toContain("Hola Colombia");
    expect(r.xml).toContain(" cruel");
  });
  test("escapa XML y soporta varias apariciones", () => {
    const r = reemplazarEnParrafo("<w:p><w:r><w:t>a & a</w:t></w:r></w:p>".replace("&", "&amp;"), "a", "<b>");
    expect(r.cuenta).toBe(2);
    expect(r.xml).toContain("&lt;b&gt; &amp; &lt;b&gt;");
  });
  test("sin coincidencia deja el párrafo igual", () => {
    const p = "<w:p><w:r><w:t>nada</w:t></w:r></w:p>";
    expect(reemplazarEnParrafo(p, "x", "y")).toEqual({ xml: p, cuenta: 1 - 1 + 0 });
  });
});

async function docx(dir: string, texto: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  const ruta = join(dir, "carta.docx");
  writeFileSync(ruta, await zip.generateAsync({ type: "nodebuffer" }));
  return ruta;
}

describe("office_editar_docx", () => {
  test("edita una copia y no toca el original", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edit-docx-"));
    const ruta = await docx(dir, "Estimado cliente");
    const antes = readFileSync(ruta);
    const res: any = await officeEditarDocxTool.execute({ ruta, reemplazos: [{ buscar: "cliente", reemplazar: "señor Pérez" }], anadir_parrafos: ["Atentamente"] });
    expect(res.ok).toBe(true);
    expect(res.ruta.endsWith("carta_corregido.docx")).toBe(true);
    expect(readFileSync(ruta).equals(antes)).toBe(true);
    const out = await (await JSZip.loadAsync(readFileSync(res.ruta))).file("word/document.xml")!.async("string");
    expect(out).toContain("Estimado señor Pérez");
    expect(out.indexOf("Atentamente")).toBeLessThan(out.indexOf("<w:sectPr"));
  });
  test("avisa si el texto no existe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edit-docx-"));
    const ruta = await docx(dir, "Hola");
    const res: any = await officeEditarDocxTool.execute({ ruta, reemplazos: [{ buscar: "zzz", reemplazar: "y" }] });
    expect(res.ok).toBe(false);
  });
  test("respeta el workspace en el destino", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edit-docx-"));
    const ruta = await docx(dir, "Hola");
    const res: any = await officeEditarDocxTool.execute({ ruta, reemplazos: [{ buscar: "Hola", reemplazar: "Adiós" }], guardar_como: "/tmp/fuera.docx" }, { configurable: { workspace: dir } });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("outside workspace");
  });
});

describe("office_editar_xlsx", () => {
  test("cambia una celda y conserva el estilo del resto", async () => {
    const ExcelJS = (await import("../packages/core/node_modules/exceljs")).default;
    const dir = mkdtempSync(join(tmpdir(), "edit-xlsx-"));
    const ruta = join(dir, "ventas.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Ventas");
    ws.getCell("A1").value = "total";
    ws.getCell("A1").font = { bold: true };
    ws.getCell("B2").value = 10;
    await wb.xlsx.writeFile(ruta);
    const res: any = await officeEditarXlsxTool.execute({ ruta, cambios: [{ hoja: "Ventas", celda: "B2", valor: 99 }, { hoja: "Nada", celda: "A1", valor: 1 }] });
    expect(res.ok).toBe(true);
    expect(res.celdas_modificadas).toBe(1);
    expect(res.omitidos.length).toBe(1);
    const out = new ExcelJS.Workbook();
    await out.xlsx.readFile(res.ruta);
    expect(out.getWorksheet("Ventas")!.getCell("B2").value).toBe(99);
    expect(out.getWorksheet("Ventas")!.getCell("A1").font?.bold).toBe(true);
  });
});

describe("office_escribir_* respetan el workspace", () => {
  test("rechazan una ruta fuera del workspace sin lanzar excepción", async () => {
    const { officeEscribirDocxTool } = await import("../packages/core/src/tools/office/office-escribir-docx");
    const { officeEscribirXlsxTool } = await import("../packages/core/src/tools/office/office-escribir-xlsx");
    const dir = mkdtempSync(join(tmpdir(), "ws-"));
    const cfg = { configurable: { workspace: dir } };
    const d: any = await officeEscribirDocxTool.execute({ ruta: "/tmp/fuera-ws.docx", contenido: "x" } as any, cfg);
    const x: any = await officeEscribirXlsxTool.execute({ ruta: "/tmp/fuera-ws.xlsx", hojas: [{ nombre: "A", datos: [[1]] }] } as any, cfg);
    expect(d.ok).toBe(false);
    expect(d.error).toContain("outside workspace");
    expect(x.ok).toBe(false);
    expect(x.error).toContain("outside workspace");
  });
});
