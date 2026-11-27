import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "../packages/core/node_modules/jszip";
import { officeEscribirDocxTool } from "../packages/core/src/tools/office/office-escribir-docx";
import { officeEscribirPdfTool } from "../packages/core/src/tools/office/office-escribir-pdf";
import { officeEscribirPptxTool } from "../packages/core/src/tools/office/office-escribir-pptx";
import { officeEscribirXlsxTool } from "../packages/core/src/tools/office/office-escribir-xlsx";
import { officeEditarDocxTool } from "../packages/core/src/tools/office/office-editar-docx";
import { officeEditarPptxTool } from "../packages/core/src/tools/office/office-editar-pptx";
import { officeEditarXlsxTool } from "../packages/core/src/tools/office/office-editar-xlsx";
import { inspeccionarImagen } from "../packages/core/src/tools/office/office-imagen";

// PNG 2x1 válido
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVR4nGP8z8DwnwEIGBkYAB4KAgMEF1YdAAAAAElFTkSuQmCC", "base64");
let ws: string;
const cfg = () => ({ configurable: { workspace: ws } });
const zipDe = async (f: string) => JSZip.loadAsync(readFileSync(join(ws, f)));

beforeAll(() => { ws = mkdtempSync(join(tmpdir(), "office-img-")); writeFileSync(join(ws, "foto.png"), PNG); });

describe("imágenes en documentos Office", () => {
  test("lee tipo y tamaño del PNG", () => {
    expect(inspeccionarImagen(PNG)).toEqual({ tipo: "png", ancho: 2, alto: 1 });
  });

  test("docx: bloque imagen con pie", async () => {
    const r: any = await officeEscribirDocxTool.execute({ ruta: "a.docx", titulo: "T", bloques: [{ tipo: "imagen", ruta: "foto.png", ancho: 6, pie: "Figura 1" }] }, cfg());
    expect(r.ok).toBe(true); expect(r.imagenes).toBe(1);
    const z = await zipDe("a.docx");
    expect(Object.keys(z.files).some((n) => n.startsWith("word/media/"))).toBe(true);
  });

  test("pdf: dibuja la imagen", async () => {
    const r: any = await officeEscribirPdfTool.execute({ ruta: "a.pdf", bloques: [{ tipo: "parrafo", texto: "Hola" }, { tipo: "imagen", ruta: "foto.png", pie: "Pie" }] }, cfg());
    expect(r.ok).toBe(true); expect(r.imagenes).toBe(1);
    expect(readFileSync(join(ws, "a.pdf")).toString("latin1")).toContain("/Subtype /Image");
  });

  test("pptx: imagen sola y con texto", async () => {
    const r: any = await officeEscribirPptxTool.execute({ ruta: "a.pptx", diapositivas: [{ titulo: "A", imagen: { ruta: "foto.png", pie: "p" } }, { titulo: "B", puntos: ["x"], imagen: { ruta: "foto.png" } }] }, cfg());
    expect(r.ok).toBe(true); expect(r.imagenes).toBe(2);
    expect(Object.keys((await zipDe("a.pptx")).files).some((n) => n.startsWith("ppt/media/"))).toBe(true);
  });

  test("xlsx: imagen anclada", async () => {
    const r: any = await officeEscribirXlsxTool.execute({ ruta: "a.xlsx", hojas: [{ nombre: "H", datos: [{ a: 1 }], imagenes: [{ ruta: "foto.png", celda: "D2", ancho: 4 }] }] }, cfg());
    expect(r.ok).toBe(true); expect(r.imagenes).toBe(1);
    expect(Object.keys((await zipDe("a.xlsx")).files).some((n) => n.startsWith("xl/media/"))).toBe(true);
  });

  test("imagen inexistente: avisa y no rompe el resto", async () => {
    const r: any = await officeEscribirDocxTool.execute({ ruta: "b.docx", bloques: [{ tipo: "parrafo", texto: "x" }, { tipo: "imagen", ruta: "no-existe.png" }] }, cfg());
    expect(r.ok).toBe(true); expect(r.imagenes).toBe(0); expect(r.aviso).toContain("no-existe.png");
  });

  test("editar docx: añade imagen después de un párrafo", async () => {
    await officeEscribirDocxTool.execute({ ruta: "c.docx", bloques: [{ tipo: "parrafo", texto: "Intro" }, { tipo: "parrafo", texto: "Cierre" }] }, cfg());
    const r: any = await officeEditarDocxTool.execute({ ruta: join(ws, "c.docx"), anadir_imagenes: [{ ruta: "foto.png", despues_de: "Intro", pie: "Logo" }], guardar_como: "c2.docx" }, cfg());
    expect(r.ok).toBe(true); expect(r.imagenes_anadidas).toBe(1);
    const z = await zipDe("c2.docx");
    const xml = await z.file("word/document.xml")!.async("string");
    expect(xml.indexOf("Intro")).toBeLessThan(xml.indexOf("<w:drawing>"));
    expect(xml.indexOf("<w:drawing>")).toBeLessThan(xml.indexOf("Cierre"));
    expect(await z.file("[Content_Types].xml")!.async("string")).toContain('Extension="png"');
  });

  test("editar pptx y xlsx: añaden imagen", async () => {
    const p: any = await officeEditarPptxTool.execute({ ruta: join(ws, "a.pptx"), anadir_imagenes: [{ diapositiva: 2, ruta: "foto.png", ancho: 5 }], guardar_como: "a2.pptx" }, cfg());
    expect(p.ok).toBe(true); expect(p.imagenes_anadidas).toBe(1);
    const x: any = await officeEditarXlsxTool.execute({ ruta: join(ws, "a.xlsx"), anadir_imagenes: [{ hoja: "H", celda: "F5", ruta: "foto.png" }], guardar_como: "a2.xlsx" }, cfg());
    expect(x.ok).toBe(true); expect(x.imagenes_anadidas).toBe(1);
  });
});
