/**
 * office_escribir_docx - Generar un archivo Word (.docx)
 *
 * @category office
 * @seedId office_escribir_docx
 * @spanish crear word, generar docx, escribir documento word, exportar a docx
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";

const log = logger.child("office-escribir-docx");

interface ParrafoInput {
  texto: string;
  tipo?: "titulo1" | "titulo2" | "titulo3" | "parrafo" | "lista";
  negrita?: boolean;
  cursiva?: boolean;
}

interface TablaInput {
  filas: Array<{ celdas: string[] }>;
  encabezado?: boolean;
}

export const officeEscribirDocxTool: Tool = {
  name: "office_escribir_docx",
  description:
    "Generar un archivo Word (.docx) con párrafos, títulos y tablas. Spanish: crear word, generar docx, escribir documento word, exportar a docx",
  parameters: {
    type: "object",
    properties: {
      ruta: {
        type: "string",
        description: "Ruta donde guardar el archivo .docx generado",
      },
      titulo: {
        type: "string",
        description: "Título del documento (opcional)",
      },
      parrafos: {
        type: "array",
        description:
          "Array de párrafos a incluir. Cada párrafo tiene: texto (string), tipo ('titulo1'|'titulo2'|'titulo3'|'parrafo'|'lista'), negrita (bool), cursiva (bool)",
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
        description:
          "Array de tablas a incluir. Cada tabla tiene: filas (array de {celdas: string[]}), encabezado (bool, primera fila como encabezado)",
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
  execute: async (params: Record<string, unknown>) => {
    const ruta = params.ruta as string;
    const titulo = params.titulo as string | undefined;
    const parrafosInput = (params.parrafos as ParrafoInput[]) ?? [];
    const tablasInput = (params.tablas as TablaInput[]) ?? [];

    log.debug(`Generando DOCX: ${ruta}`);

    try {
      const {
        Document,
        Packer,
        Paragraph,
        TextRun,
        HeadingLevel,
        Table,
        TableRow,
        TableCell,
        WidthType,
        BorderStyle,
      } = await import("docx");

      const seccionChildren: any[] = [];

      // Título del documento
      if (titulo) {
        seccionChildren.push(
          new Paragraph({
            text: titulo,
            heading: HeadingLevel.TITLE,
          })
        );
      }

      // Párrafos
      for (const p of parrafosInput) {
        const run = new TextRun({
          text: p.texto,
          bold: p.negrita ?? false,
          italics: p.cursiva ?? false,
        });

        let heading: any = undefined;
        if (p.tipo === "titulo1") heading = HeadingLevel.HEADING_1;
        else if (p.tipo === "titulo2") heading = HeadingLevel.HEADING_2;
        else if (p.tipo === "titulo3") heading = HeadingLevel.HEADING_3;

        const opciones: any = { children: [run] };
        if (heading) opciones.heading = heading;
        if (p.tipo === "lista") opciones.bullet = { level: 0 };

        seccionChildren.push(new Paragraph(opciones));
      }

      // Tablas
      for (const tablaInput of tablasInput) {
        const filas = tablaInput.filas.map((fila, filaIdx) => {
          const celdas = fila.celdas.map((textoCelda) => {
            const esEncabezado = tablaInput.encabezado && filaIdx === 0;
            return new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: textoCelda,
                      bold: esEncabezado,
                    }),
                  ],
                }),
              ],
            });
          });
          return new TableRow({ children: celdas });
        });

        seccionChildren.push(
          new Table({
            rows: filas,
            width: { size: 100, type: WidthType.PERCENTAGE },
          })
        );

        // Línea en blanco después de la tabla
        seccionChildren.push(new Paragraph({ text: "" }));
      }

      const doc = new Document({
        sections: [
          {
            children: seccionChildren,
          },
        ],
      });

      const rutaAbsoluta = path.resolve(ruta);
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) {
        fs.mkdirSync(dirDestino, { recursive: true });
      }

      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(rutaAbsoluta, buffer);

      log.info(`DOCX generado: ${rutaAbsoluta} (${buffer.length} bytes)`);

      return {
        ok: true,
        ruta: rutaAbsoluta,
        bytesEscritos: buffer.length,
        parrafos: parrafosInput.length,
        tablas: tablasInput.length,
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
