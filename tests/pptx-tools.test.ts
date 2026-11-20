process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "../packages/core/node_modules/jszip";
import PptxGenJS from "../packages/core/node_modules/pptxgenjs";
import { officeLeerPptxTool } from "../packages/core/src/tools/office/office-leer-pptx";
import { officeEditarPptxTool } from "../packages/core/src/tools/office/office-editar-pptx";
import { reemplazarEnParrafo } from "../packages/core/src/tools/office/office-editar-docx";

async function crearPptx(dir: string, nombre = "demo.pptx"): Promise<string> {
  const p = new PptxGenJS();
  const s1 = p.addSlide();
  s1.addText("Plan 2027", { x: 1, y: 1, w: 6, h: 1, fontSize: 32, bold: true });
  s1.addText("Ventas crecen 20%", { x: 1, y: 2.5, w: 6, h: 1 });
  s1.addNotes("Mencionar el contrato con Acme");
  const s2 = p.addSlide();
  s2.addText("Riesgos", { x: 1, y: 1, w: 6, h: 1 });
  s2.addText("Ventas dependen de un cliente", { x: 1, y: 2.5, w: 6, h: 1 });
  const ruta = join(dir, nombre);
  writeFileSync(ruta, Buffer.from(await p.write({ outputType: "nodebuffer" }) as ArrayBuffer));
  return ruta;
}

describe("office_leer_pptx", () => {
  test("lee texto por diapositiva con notas y sin duplicar el contenido", async () => {
    const ruta = await crearPptx(mkdtempSync(join(tmpdir(), "pptx-")));
    const r: any = await officeLeerPptxTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.totalDiapositivas).toBe(2);
    expect(r.diapositivas[0].texto).toContain("Plan 2027");
    expect(r.diapositivas[0].texto).toContain("Ventas crecen 20%");
    expect(r.diapositivas[0].notas).toContain("contrato con Acme");
    expect(r.diapositivas[0].fragmentos).toBeUndefined();
  });

  test("respeta el orden real de la presentación, no el del archivo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pptx-"));
    const ruta = await crearPptx(dir);
    const zip = await JSZip.loadAsync(readFileSync(ruta));
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    const ids = [...pres.matchAll(/<p:sldId [^>]*\/>/g)].map((m) => m[0]);
    expect(ids.length).toBe(2);
    zip.file("ppt/presentation.xml", pres.replace(ids[0] + ids[1], ids[1] + ids[0]));
    const invertida = join(dir, "invertida.pptx");
    writeFileSync(invertida, await zip.generateAsync({ type: "nodebuffer" }));
    const r: any = await officeLeerPptxTool.execute({ ruta: invertida });
    expect(r.diapositivas[0].texto).toContain("Riesgos");
    expect(r.diapositivas[1].texto).toContain("Plan 2027");
  });

  test("respeta el tope y dice por dónde seguir", async () => {
    const ruta = await crearPptx(mkdtempSync(join(tmpdir(), "pptx-")));
    const r: any = await officeLeerPptxTool.execute({ ruta, max_caracteres: 1000, solo_diapositiva: 2 });
    expect(r.diapositivas.length).toBe(1);
    expect(r.diapositivas[0].numero).toBe(2);
  });

  test("un archivo que no es pptx da un error claro", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pptx-"));
    const ruta = join(dir, "malo.pptx");
    writeFileSync(ruta, "no soy un zip");
    const r: any = await officeLeerPptxTool.execute({ ruta });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("pptx");
  });
});

describe("office_editar_pptx", () => {
  test("edita una copia, solo la diapositiva pedida, y no toca el original", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pptx-"));
    const ruta = await crearPptx(dir);
    const antes = readFileSync(ruta);
    const r: any = await officeEditarPptxTool.execute({ ruta, reemplazos: [{ buscar: "Ventas", reemplazar: "Ingresos", diapositiva: 1 }] });
    expect(r.ok).toBe(true);
    expect(r.ruta.endsWith("demo_corregido.pptx")).toBe(true);
    expect(readFileSync(ruta).equals(antes)).toBe(true);
    const leido: any = await officeLeerPptxTool.execute({ ruta: r.ruta });
    expect(leido.diapositivas[0].texto).toContain("Ingresos crecen 20%");
    expect(leido.diapositivas[1].texto).toContain("Ventas dependen"); // la 2 queda igual
  });

  test("sin 'diapositiva' cambia todas, y las notas solo si se pide", async () => {
    const ruta = await crearPptx(mkdtempSync(join(tmpdir(), "pptx-")));
    const sin: any = await officeEditarPptxTool.execute({ ruta, reemplazos: [{ buscar: "Acme", reemplazar: "Beta" }] });
    expect(sin.ok).toBe(false); // "Acme" solo está en las notas
    const con: any = await officeEditarPptxTool.execute({ ruta, reemplazos: [{ buscar: "Acme", reemplazar: "Beta" }], incluir_notas: true });
    expect(con.ok).toBe(true);
    const leido: any = await officeLeerPptxTool.execute({ ruta: con.ruta });
    expect(leido.diapositivas[0].notas).toContain("Beta");
  });

  test("avisa si el texto no existe y respeta el workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pptx-"));
    const ruta = await crearPptx(dir);
    const nada: any = await officeEditarPptxTool.execute({ ruta, reemplazos: [{ buscar: "zzz", reemplazar: "y" }] });
    expect(nada.ok).toBe(false);
    const fuera: any = await officeEditarPptxTool.execute({ ruta, reemplazos: [{ buscar: "Plan", reemplazar: "Meta" }], guardar_como: "/tmp/fuera.pptx" }, { configurable: { workspace: dir } });
    expect(fuera.ok).toBe(false);
    expect(fuera.error).toContain("outside workspace");
  });
});

describe("reemplazo con etiqueta de PowerPoint", () => {
  test("une fragmentos de <a:t> y conserva el formato del primero", () => {
    const p = '<a:p><a:r><a:rPr b="1"/><a:t>Ventas cre</a:t></a:r><a:r><a:t>cen mucho</a:t></a:r></a:p>';
    const r = reemplazarEnParrafo(p, "Ventas crecen", "Ingresos suben", "a:t");
    expect(r.cuenta).toBe(1);
    expect(r.xml).toContain('b="1"');
    expect(r.xml).toContain("Ingresos suben");
    expect(r.xml).not.toContain("xml:space"); // <a:t> no lo admite
  });
});
