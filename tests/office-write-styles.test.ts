process.env.HIVE_DB_PATH = ":memory:";

import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import JSZip from "../packages/core/node_modules/jszip";
import { officeEscribirPdfTool } from "../packages/core/src/tools/office/office-escribir-pdf";
import { officeEscribirDocxTool } from "../packages/core/src/tools/office/office-escribir-docx";
import { officeEscribirXlsxTool } from "../packages/core/src/tools/office/office-escribir-xlsx";
import { officeEscribirPptxTool } from "../packages/core/src/tools/office/office-escribir-pptx";
import { bloquesDeParametros, resolverTemaDocumento } from "../packages/core/src/tools/office/office-style";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hive-office-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const zip = async (file: string) => JSZip.loadAsync(fs.readFileSync(file));
const text = async (z: JSZip, name: string) => (await z.file(name)!.async("string"));

describe("estilos compartidos", () => {
  test("temas conocidos y error claro en uno desconocido", () => {
    expect(resolverTemaDocumento({ preset: "corporate" }).acento).toBe("B8923A");
    expect(resolverTemaDocumento({ colores: { acento: "#ff0000" } }).acento).toBe("FF0000");
    expect(() => resolverTemaDocumento({ preset: "nope" })).toThrow(/Tema desconocido/);
  });

  test("parámetros antiguos se convierten a bloques (listas consecutivas se agrupan)", () => {
    const b = bloquesDeParametros({
      parrafos: [{ texto: "T", tipo: "titulo2" }, { texto: "a", tipo: "lista" }, { texto: "b", tipo: "lista" }],
      tablas: [{ encabezado: true, filas: [{ celdas: ["x", "y"] }] }],
    });
    expect(b.map((x) => x.type)).toEqual(["heading", "list", "table"]);
    expect((b[0] as any).level).toBe(2);
    expect((b[1] as any).items.length).toBe(2);
  });

  test("texto plano → títulos, viñetas, tablas", () => {
    const b = bloquesDeParametros({ contenido: "# Hola\n\nparrafo\n\n- uno\n- dos\n\n| a | b |\n|---|---|\n| 1 | 2 |" });
    expect(b.map((x) => x.type)).toEqual(["heading", "paragraph", "list", "table"]);
  });
});

describe("PDF", () => {
  test("bloques, tema, encabezado y pie con {page}/{pages}; tabla larga repite encabezado", async () => {
    const file = path.join(dir, "a.pdf");
    const filas = Array.from({ length: 60 }, (_, i) => [`F${i}`, "x ".repeat(30), `${i}`]);
    const r: any = await officeEscribirPdfTool.execute({
      ruta: file, titulo: "Informe", tema: { preset: "classic" },
      pie: { centro: "Pág {page}/{pages}" },
      bloques: [{ tipo: "tabla", filas: [["Col A", "Col B", "Col C"], ...filas] }],
    });
    expect(r.ok).toBe(true);
    expect(r.paginas).toBeGreaterThan(1);
    // El texto se extrae con pdftotext (poppler); sin él solo se comprueba la estructura.
    const proc = Bun.spawnSync(["pdftotext", "-layout", file, "-"], { stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode === 0) {
      const todo = proc.stdout.toString();
      expect(todo).toContain(`Pág 1/${r.paginas}`);
      expect(todo).toContain(`Pág ${r.paginas}/${r.paginas}`);
      // el encabezado de la tabla vuelve a aparecer en cada página
      expect((todo.match(/Col A/g) ?? []).length).toBe(r.paginas);
    }
  });

  test("caracteres fuera de Latin-1 se informan, no se pierden en silencio", async () => {
    const r: any = await officeEscribirPdfTool.execute({ ruta: path.join(dir, "b.pdf"), contenido: "hola 😀 ñ" });
    expect(r.ok).toBe(true);
    expect(r.caracteresReemplazados).toBe(1);
  });

  test("tema inválido devuelve error", async () => {
    const r: any = await officeEscribirPdfTool.execute({ ruta: path.join(dir, "c.pdf"), contenido: "x", tema: { preset: "zzz" } });
    expect(r.ok).toBe(false);
  });
});

describe("Word", () => {
  test("estilos reales de título con el color del tema, encabezado y campos de página", async () => {
    const file = path.join(dir, "a.docx");
    const r: any = await officeEscribirDocxTool.execute({
      ruta: file, titulo: "Doc", tema: { preset: "corporate" },
      encabezado: { texto: "{title}" }, pie: { texto: "Página {page} de {pages}", alineacion: "center" },
      bloques: [
        { tipo: "titulo", nivel: 1, texto: "H1" },
        { tipo: "tabla", filas: [["A", "B"], ["1", "2"], ["3", "4"]] },
      ],
    });
    expect(r.ok).toBe(true);
    const z = await zip(file);
    const styles = await text(z, "word/styles.xml");
    expect(styles).toContain("1E3A5F"); // color de título del tema corporate
    expect(styles).toContain("Cambria"); // fuente serif de los títulos
    const doc = await text(z, "word/document.xml");
    expect(doc).toContain('w:fill="1E3A5F"'); // fondo del encabezado de tabla
    expect(doc).toContain('w:fill="F3F4F6"'); // cebra
    expect(Object.keys(z.files).some((n) => /word\/footer\d*\.xml/.test(n))).toBe(true);
    const footer = await text(z, Object.keys(z.files).find((n) => /word\/footer\d*\.xml/.test(n))!);
    expect(footer).toMatch(/PAGE/);
    expect(footer).toMatch(/NUMPAGES/);
  });

  test("formato antiguo (parrafos/tablas) sigue funcionando", async () => {
    const r: any = await officeEscribirDocxTool.execute({
      ruta: path.join(dir, "legacy.docx"),
      parrafos: [{ texto: "S", tipo: "titulo1" }, { texto: "p", tipo: "parrafo", negrita: true }],
      tablas: [{ encabezado: true, filas: [{ celdas: ["x", "y"] }, { celdas: ["1", "2"] }] }],
    });
    expect(r.ok).toBe(true);
    expect(r.tablas).toBe(1);
  });
});

describe("Excel", () => {
  test("encabezado con estilo, fila fija, autofiltro, formatos y fechas reales; '=' nunca es fórmula", async () => {
    const file = path.join(dir, "a.xlsx");
    const r: any = await officeEscribirXlsxTool.execute({
      ruta: file,
      hojas: [{
        nombre: "Ventas",
        datos: [{ item: "A", fecha: "2026-11-03", precio: 1234.5, nota: "=SUM(A1)" }],
        columnas: [{ columna: "fecha", formato: "fecha" }, { columna: "precio", formato: "moneda", negrita: true }],
      }],
    });
    expect(r.ok).toBe(true);
    const z = await zip(file);
    const hoja = await text(z, "xl/worksheets/sheet1.xml");
    expect(hoja).toContain('state="frozen"');
    expect(hoja).toContain("<autoFilter");
    expect(hoja).not.toContain("<f>"); // sin fórmulas
    const estilos = await text(z, "xl/styles.xml");
    expect(estilos).toContain("yyyy-mm-dd");
    expect(estilos).toContain("FF1E293B"); // relleno del encabezado
    // la fecha es un número de serie, no texto
    expect(hoja).toMatch(/<c r="B2"[^>]*><v>\d+/);
  });

  test("hoja de arrays y nombres de hoja repetidos o inválidos", async () => {
    const r: any = await officeEscribirXlsxTool.execute({
      ruta: path.join(dir, "b.xlsx"),
      hojas: [{ nombre: "Datos/1", datos: [["a", "b"], [1, 2]] }, { nombre: "Datos 1", datos: [{ x: 1 }] }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("PowerPoint", () => {
  test("el tema se aplica: fondo de portada, acento y número de diapositiva", async () => {
    const file = path.join(dir, "a.pptx");
    const r: any = await officeEscribirPptxTool.execute({
      ruta: file, titulo_presentacion: "Deck", subtitulo_presentacion: "Sub", tema: { preset: "warm" },
      diapositivas: [{ titulo: "Uno", puntos: ["a", "b"], notas: "nota" }],
    });
    expect(r.ok).toBe(true);
    expect(r.totalDiapositivas).toBe(2);
    const z = await zip(file);
    const portada = await text(z, "ppt/slides/slide1.xml");
    expect(portada).toContain("7C2D12"); // portada_fondo de warm
    const contenido = await text(z, "ppt/slides/slide2.xml");
    expect(contenido).toContain("FFFBF5"); // fondo
    expect(contenido).toContain("EA580C"); // acento
    expect(contenido).toContain("slidenum");
    expect(Object.keys(z.files).some((n) => n.startsWith("ppt/notesSlides/"))).toBe(true);
  });

  test("tema desconocido devuelve error", async () => {
    const r: any = await officeEscribirPptxTool.execute({ ruta: path.join(dir, "b.pptx"), diapositivas: [], tema: { preset: "x" } });
    expect(r.ok).toBe(false);
  });
});
