/**
 * office_escribir_pdf - Generar un archivo PDF desde texto
 *
 * @category office
 * @seedId office_escribir_pdf
 * @spanish crear pdf, generar pdf, escribir pdf, exportar a pdf
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";

const log = logger.child("office-escribir-pdf");

export const officeEscribirPdfTool: Tool = {
  name: "office_escribir_pdf",
  description:
    "Generar un archivo PDF desde texto con configuración de márgenes y tamaño de página. Spanish: crear pdf, generar pdf, escribir pdf, exportar a pdf",
  parameters: {
    type: "object",
    properties: {
      ruta: {
        type: "string",
        description: "Ruta donde guardar el archivo PDF generado",
      },
      contenido: {
        type: "string",
        description: "Texto o contenido a escribir en el PDF",
      },
      titulo: {
        type: "string",
        description: "Título del documento (opcional)",
      },
      tamaño_pagina: {
        type: "string",
        description: "Tamaño de página: 'A4' o 'Letter' (default: 'A4')",
        enum: ["A4", "Letter"],
      },
      margen: {
        type: "number",
        description: "Margen en puntos (default: 50)",
      },
      tamaño_fuente: {
        type: "number",
        description: "Tamaño de fuente en puntos (default: 12)",
      },
    },
    required: ["ruta", "contenido"],
  },
  execute: async (params: Record<string, unknown>) => {
    const ruta = params.ruta as string;
    const contenido = params.contenido as string;
    const titulo = params.titulo as string | undefined;
    const tamañoPagina = (params.tamaño_pagina as string) ?? "A4";
    const margen = (params.margen as number) ?? 50;
    const tamañoFuente = (params.tamaño_fuente as number) ?? 12;

    log.debug(`Generando PDF: ${ruta}`);

    try {
      const { PDFDocument, StandardFonts, rgb, PageSizes } = await import("pdf-lib");

      const pdfDoc = await PDFDocument.create();

      if (titulo) {
        pdfDoc.setTitle(titulo);
      }
      pdfDoc.setCreator("Hive Agent");
      pdfDoc.setCreationDate(new Date());

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pageSize = tamañoPagina === "Letter" ? PageSizes.Letter : PageSizes.A4;

      const anchoPagina = pageSize[0];
      const altoPagina = pageSize[1];
      const anchoUtil = anchoPagina - margen * 2;
      const lineHeight = tamañoFuente * 1.4;

      // Si hay título, agregarlo primero
      const lineasTodas: string[] = [];
      if (titulo) {
        lineasTodas.push(titulo);
        lineasTodas.push(""); // línea en blanco
      }

      // Dividir el contenido en líneas respetando saltos de línea
      const lineasContenido = contenido.split("\n");

      // Para cada línea, dividir en sublíneas si es demasiado larga
      for (const linea of lineasContenido) {
        if (linea.trim() === "") {
          lineasTodas.push("");
          continue;
        }

        const palabras = linea.split(" ");
        let lineaActual = "";

        for (const palabra of palabras) {
          const prueba = lineaActual ? `${lineaActual} ${palabra}` : palabra;
          const ancho = font.widthOfTextAtSize(prueba, tamañoFuente);

          if (ancho > anchoUtil && lineaActual) {
            lineasTodas.push(lineaActual);
            lineaActual = palabra;
          } else {
            lineaActual = prueba;
          }
        }

        if (lineaActual) {
          lineasTodas.push(lineaActual);
        }
      }

      // Distribuir líneas en páginas
      const lineasPorPagina = Math.floor((altoPagina - margen * 2) / lineHeight);
      let paginaActual = pdfDoc.addPage(pageSize);
      let yActual = altoPagina - margen;
      let lineasEnPagina = 0;

      for (let i = 0; i < lineasTodas.length; i++) {
        if (lineasEnPagina >= lineasPorPagina) {
          paginaActual = pdfDoc.addPage(pageSize);
          yActual = altoPagina - margen;
          lineasEnPagina = 0;
        }

        const esEncabezado = titulo && i === 0;
        const fuenteActual = esEncabezado ? tamañoFuente + 4 : tamañoFuente;

        if (lineasTodas[i] !== "") {
          paginaActual.drawText(lineasTodas[i], {
            x: margen,
            y: yActual,
            size: fuenteActual,
            font,
            color: rgb(0, 0, 0),
          });
        }

        yActual -= lineHeight;
        lineasEnPagina++;
      }

      const rutaAbsoluta = path.resolve(ruta);
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) {
        fs.mkdirSync(dirDestino, { recursive: true });
      }

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(rutaAbsoluta, pdfBytes);

      log.info(`PDF generado: ${rutaAbsoluta} (${pdfDoc.getPageCount()} páginas)`);

      return {
        ok: true,
        ruta: rutaAbsoluta,
        paginas: pdfDoc.getPageCount(),
        bytesEscritos: pdfBytes.length,
      };
    } catch (error) {
      log.error(`Error generando PDF: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo generar el PDF: ${(error as Error).message}`,
      };
    }
  },
};
