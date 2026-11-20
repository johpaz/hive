/**
 * office_escribir_docx - Generar un archivo Word (.docx) con estilos
 *
 * Comparte tema y bloques con el PDF (modern, classic, corporate, minimal): los
 * títulos, la fuente, los colores, las tablas (encabezado con fondo, cebra,
 * bordes) y las listas salen como estilos reales de Word, no como texto suelto.
 * Admite encabezado y pie con {page}, {pages} y {title}. Los parámetros antiguos
 * (`parrafos`, `tablas`) siguen funcionando.
 *
 * @category office
 * @seedId office_escribir_docx
 * @spanish crear word, generar docx, escribir documento word, exportar a docx
 */

import { resolveInWorkspace, getWorkspace } from "../filesystem/workspace-guard.ts";
import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  bloquesDeParametros,
  hexValido,
  resolverTemaDocumento,
  type Bloque,
  type ElementoLista,
  type Familia,
  type Tramo,
} from "./office-style";

const log = logger.child("office-escribir-docx");

const FUENTE_WORD: Record<Familia, string> = { sans: "Calibri", serif: "Cambria", mono: "Consolas" };

export const officeEscribirDocxTool: Tool = {
  name: "office_escribir_docx",
  description:
    "Generar un archivo Word (.docx) con estilo: títulos, párrafos (con `tramos` de negrita/cursiva/subrayado/color/enlace), listas (viñetas o numeradas), tablas con encabezado en color y cebra, citas, código, reglas y saltos de página. `tema.preset` elige modern, classic, corporate o minimal. `encabezado`/`pie` ({texto, alineacion}) se repiten en cada página y aceptan {page}, {pages} y {title}. Spanish: crear word, generar docx, escribir documento word, exportar a docx, informe, carta, propuesta",
  parameters: {
    type: "object",
    properties: {
      ruta: { type: "string", description: "Ruta donde guardar el archivo .docx generado" },
      titulo: { type: "string", description: "Título del documento (opcional)" },
      autor: { type: "string", description: "Autor (metadatos)" },
      tamaño_pagina: { type: "string", enum: ["A4", "Letter"], description: "Tamaño de página (default A4)" },
      tema: {
        type: "object",
        description: "{preset: modern|classic|corporate|minimal, colores: {texto, titulo, acento, atenuado, encabezado_tabla_fondo, encabezado_tabla_texto, borde_tabla, cebra, codigo_fondo} (hex de 6 dígitos), fuentes: {cuerpo, titulos} (sans|serif|mono)}",
      },
      encabezado: { type: "object", description: "Encabezado de página: {texto, alineacion: left|center|right}" },
      pie: { type: "object", description: "Pie de página: {texto, alineacion}. Ej: {texto: 'Página {page} de {pages}', alineacion: 'center'}" },
      bloques: {
        type: "array",
        description: "Contenido ordenado en bloques. tipo: titulo(nivel 1-3) | parrafo(texto|tramos, alineacion, negrita, cursiva, color) | lista(estilo vinetas|numerada, elementos) | tabla(encabezado, cebra, columnas: pesos, alineacion: [..], filas: [[celda]]) | cita(texto, autor) | codigo(texto) | regla | espacio(alto) | salto_pagina",
        items: { type: "object" },
      },
      parrafos: {
        type: "array",
        description:
          "Formato simple (alternativa a `bloques`): párrafos con texto, tipo ('titulo1'|'titulo2'|'titulo3'|'parrafo'|'lista'), negrita, cursiva",
        items: {
          type: "object",
          properties: {
            texto: { type: "string" },
            tipo: { type: "string" },
            negrita: { type: "boolean" },
            cursiva: { type: "boolean" },
          },
        },
      },
      tablas: {
        type: "array",
        description: "Formato simple: tablas con filas ({celdas: string[]}) y encabezado (bool, primera fila como encabezado). Van después de los párrafos; para mezclar el orden usa `bloques`.",
        items: {
          type: "object",
          properties: {
            filas: { type: "array", items: { type: "object" } },
            encabezado: { type: "boolean" },
          },
        },
      },
    },
    required: ["ruta"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const ruta = params.ruta as string;
    const titulo = typeof params.titulo === "string" ? params.titulo : "";

    log.debug(`Generando DOCX: ${ruta}`);

    try {
      const d = await import("docx");
      const {
        Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
        BorderStyle, ShadingType, AlignmentType, LevelFormat, PageBreak, Header, Footer,
        PageNumber, ExternalHyperlink, TableLayoutType,
      } = d;

      const tema = resolverTemaDocumento(params.tema);
      const bloques = bloquesDeParametros(params);
      if (!titulo && bloques.length === 0) {
        return { ok: false, error: "Falta contenido: da `bloques`, `parrafos` o `tablas`." };
      }

      const fCuerpo = FUENTE_WORD[tema.fuenteCuerpo];
      const fTitulos = FUENTE_WORD[tema.fuenteTitulos];
      const letter = (params.tamaño_pagina ?? params["tamaño_pagina"]) === "Letter";
      const pagAncho = letter ? 12240 : 11906;
      const pagAlto = letter ? 15840 : 16838;
      const margen = 1134; // 2 cm
      const anchoUtil = pagAncho - margen * 2;

      const alin = (a?: string) =>
        a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : a === "justify" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;

      // ─── Runs ──────────────────────────────────────────────────────────
      const hacerRun = (t: Tramo, base?: { bold?: boolean; italic?: boolean; color?: string; size?: number }) => {
        const run = new TextRun({
          text: t.text,
          bold: t.bold ?? base?.bold,
          italics: t.italic ?? base?.italic,
          underline: t.underline ? {} : undefined,
          color: hexValido(t.color) ?? base?.color,
          size: t.size ? Math.round(t.size * 2) : base?.size,
          font: t.font ? FUENTE_WORD[t.font] : undefined,
        });
        if (t.link) {
          return new ExternalHyperlink({
            link: t.link,
            children: [new TextRun({ text: t.text, bold: t.bold, italics: t.italic, color: tema.acento, underline: {}, size: t.size ? Math.round(t.size * 2) : base?.size })],
          });
        }
        return run;
      };
      const runsDe = (b: { text: string; runs?: Tramo[] }, base?: Parameters<typeof hacerRun>[1]) =>
        (b.runs && b.runs.length ? b.runs : [{ text: b.text }]).map((t) => hacerRun(t, base));

      // ─── Numeración ────────────────────────────────────────────────────
      const numeraciones: any[] = [
        {
          reference: "viñetas",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } }, run: { color: tema.acento } } },
            { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } }, run: { color: tema.acento } } },
          ],
        },
      ];
      let contadorListas = 0;
      const nuevaNumerada = () => {
        const reference = `numerada-${++contadorListas}`;
        numeraciones.push({
          reference,
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } }, run: { color: tema.acento } } },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 360 } }, run: { color: tema.acento } } },
          ],
        });
        return reference;
      };

      // ─── Bloques → hijos de la sección ─────────────────────────────────
      const hijos: any[] = [];

      const itemsLista = (items: ElementoLista[], estilo: "bullet" | "numbered", nivel: number, ref: string) => {
        for (const it of items) {
          hijos.push(new Paragraph({
            children: [new TextRun({ text: it.text })],
            numbering: { reference: nivel === 0 || estilo === "numbered" ? ref : "viñetas", level: nivel },
            spacing: { after: 60 },
          }));
          if (it.items?.length && nivel < 1) itemsLista(it.items, estilo, nivel + 1, estilo === "numbered" ? ref : "viñetas");
        }
      };

      const borde = (color: string, size = 4) => ({ style: BorderStyle.SINGLE, size, color, space: 0 });

      const tabla = (b: Extract<Bloque, { type: "table" }>) => {
        const nCols = Math.max(1, ...b.rows.map((r) => r.length));
        const pesos = Array.from({ length: nCols }, (_, i) => b.columns?.[i] ?? 1);
        const suma = pesos.reduce((a, c) => a + c, 0);
        const anchos = pesos.map((p) => Math.floor((p / suma) * anchoUtil));
        const conEnc = b.header && b.rows.length > 1;
        const lado = borde(tema.bordeTabla);
        const filas = b.rows.map((fila, i) => {
          const esEnc = conEnc && i === 0;
          const indiceCuerpo = conEnc ? i - 1 : i;
          return new TableRow({
            tableHeader: esEnc,
            cantSplit: true,
            children: Array.from({ length: nCols }, (_, c) => {
              const celda = fila[c] ?? { text: "" };
              const relleno = celda.fill ?? (esEnc ? tema.encabezadoTablaFondo : b.zebra && indiceCuerpo % 2 === 1 ? tema.cebra : undefined);
              return new TableCell({
                width: { size: anchos[c]!, type: WidthType.DXA },
                margins: { top: 70, bottom: 70, left: 110, right: 110 },
                shading: relleno ? { type: ShadingType.CLEAR, fill: relleno, color: "auto" } : undefined,
                children: [new Paragraph({
                  alignment: alin(celda.align ?? b.align?.[c]),
                  children: [new TextRun({
                    text: celda.text,
                    bold: esEnc || celda.bold,
                    color: hexValido(celda.color) ?? (esEnc ? tema.encabezadoTablaTexto : tema.texto),
                    size: 20,
                  })],
                })],
              });
            }),
          });
        });
        hijos.push(new Table({
          rows: filas,
          width: { size: anchoUtil, type: WidthType.DXA },
          columnWidths: anchos,
          layout: TableLayoutType.FIXED,
          borders: { top: lado, bottom: lado, left: lado, right: lado, insideHorizontal: lado, insideVertical: lado },
        }));
        hijos.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      };

      if (titulo) {
        hijos.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: titulo })] }));
      }

      for (const b of bloques) {
        switch (b.type) {
          case "heading":
            hijos.push(new Paragraph({
              heading: b.level === 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
              alignment: alin(b.align),
              children: runsDe(b, b.color ? { color: hexValido(b.color) ?? undefined } : undefined),
            }));
            break;
          case "paragraph":
            hijos.push(new Paragraph({
              alignment: alin(b.align),
              indent: b.indent ? { left: Math.round(b.indent * 20) } : undefined,
              spacing: { after: b.spaceAfter !== undefined ? Math.round(b.spaceAfter * 20) : 140, line: 300 },
              children: runsDe(b, { bold: b.bold, italic: b.italic, color: hexValido(b.color) ?? undefined, size: b.size ? Math.round(b.size * 2) : undefined }),
            }));
            break;
          case "list":
            itemsLista(b.items, b.style, 0, b.style === "numbered" ? nuevaNumerada() : "viñetas");
            hijos.push(new Paragraph({ text: "", spacing: { after: 60 } }));
            break;
          case "table":
            tabla(b);
            break;
          case "quote":
            hijos.push(new Paragraph({
              indent: { left: 360 },
              spacing: { before: 120, after: b.author ? 40 : 160 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: tema.acento, space: 10 } },
              children: [new TextRun({ text: b.text, italics: true, color: tema.atenuado })],
            }));
            if (b.author) {
              hijos.push(new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 160 },
                children: [new TextRun({ text: `— ${b.author}`, color: tema.atenuado, size: 20 })],
              }));
            }
            break;
          case "code":
            for (const linea of b.text.replace(/\r\n?/g, "\n").split("\n")) {
              hijos.push(new Paragraph({
                shading: { type: ShadingType.CLEAR, fill: tema.codigoFondo, color: "auto" },
                border: { left: { style: BorderStyle.SINGLE, size: 18, color: tema.acento, space: 6 } },
                spacing: { after: 0, line: 260 },
                indent: { left: 120 },
                children: [new TextRun({ text: linea || " ", font: FUENTE_WORD.mono, size: 19, color: tema.texto })],
              }));
            }
            hijos.push(new Paragraph({ text: "", spacing: { after: 120 } }));
            break;
          case "rule":
            hijos.push(new Paragraph({
              spacing: { before: 120, after: 120 },
              border: { bottom: borde(tema.bordeTabla, 6) },
              children: [],
            }));
            break;
          case "spacer":
            hijos.push(new Paragraph({ text: "", spacing: { after: Math.round(Math.min(400, Math.max(0, b.height)) * 20) } }));
            break;
          case "page_break":
            hijos.push(new Paragraph({ children: [new PageBreak()] }));
            break;
        }
      }
      if (hijos.length === 0) hijos.push(new Paragraph({ text: "" }));

      // ─── Encabezado y pie ──────────────────────────────────────────────
      const zona = (valor: unknown) => {
        if (!valor || typeof valor !== "object") return undefined;
        const o = valor as Record<string, any>;
        const texto = String(o.texto ?? o.text ?? "");
        if (!texto) return undefined;
        // Convierte los marcadores en campos reales de Word, para que el número
        // de página sea el de cada página y no un valor fijo.
        const partes = texto.split(/(\{page\}|\{pagina\}|\{pages\}|\{paginas\}|\{title\}|\{titulo\})/);
        const children = partes.filter(Boolean).map((p) => {
          const opts = { size: 18, color: tema.atenuado, font: fCuerpo };
          if (p === "{page}" || p === "{pagina}") return new TextRun({ ...opts, children: [PageNumber.CURRENT] });
          if (p === "{pages}" || p === "{paginas}") return new TextRun({ ...opts, children: [PageNumber.TOTAL_PAGES] });
          if (p === "{title}" || p === "{titulo}") return new TextRun({ ...opts, text: titulo });
          return new TextRun({ ...opts, text: p });
        });
        return new Paragraph({ style: "HiveBanda", alignment: alin(o.alineacion ?? o.align), children });
      };
      const enc = zona(params.encabezado ?? params.header);
      const pie = zona(params.pie ?? params.footer);

      // ─── Documento con estilos reales ──────────────────────────────────
      const estiloTitulo = (id: string, name: string, size: number, antes: number, despues: number, conLinea = false) => ({
        id, name, basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: fTitulos, size, bold: true, color: tema.titulo },
        paragraph: {
          spacing: { before: antes, after: despues },
          keepNext: true,
          ...(conLinea ? { border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: tema.acento, space: 4 } } } : {}),
        },
      });

      const doc = new Document({
        creator: typeof params.autor === "string" ? params.autor : "Hive Agent",
        title: titulo || undefined,
        styles: {
          default: { document: { run: { font: fCuerpo, size: 22, color: tema.texto }, paragraph: { spacing: { line: 300 } } } },
          paragraphStyles: [
            estiloTitulo("Title", "Title", 52, 0, 240),
            estiloTitulo("Heading1", "Heading 1", 36, 360, 160, true),
            estiloTitulo("Heading2", "Heading 2", 28, 280, 100),
            estiloTitulo("Heading3", "Heading 3", 24, 220, 80),
            // Encabezado y pie: el estilo de párrafo alcanza también a los campos (número de página).
            { id: "HiveBanda", name: "Hive Banda", basedOn: "Normal", run: { font: fCuerpo, size: 18, color: tema.atenuado } },
          ],
        },
        numbering: { config: numeraciones },
        sections: [{
          properties: { page: { size: { width: pagAncho, height: pagAlto }, margin: { top: margen, bottom: margen, left: margen, right: margen } } },
          headers: enc ? { default: new Header({ children: [enc] }) } : undefined,
          footers: pie ? { default: new Footer({ children: [pie] }) } : undefined,
          children: hijos,
        }],
      });

      const rutaAbsoluta = path.resolve(resolveInWorkspace(ruta, getWorkspace(config)));
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) fs.mkdirSync(dirDestino, { recursive: true });

      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(rutaAbsoluta, buffer);

      log.info(`DOCX generado: ${rutaAbsoluta} (${buffer.length} bytes)`);

      return {
        ok: true,
        ruta: rutaAbsoluta,
        bytesEscritos: buffer.length,
        bloques: bloques.length,
        parrafos: bloques.filter((b) => b.type === "paragraph" || b.type === "heading").length,
        tablas: bloques.filter((b) => b.type === "table").length,
      };
    } catch (error) {
      log.error(`Error generando DOCX: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo generar el archivo DOCX: ${(error as Error).message}`,
      };
    }
  },
};
