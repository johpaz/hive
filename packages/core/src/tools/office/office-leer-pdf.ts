/**
 * office_leer_pdf - Leer contenido de un archivo PDF
 *
 * @category office
 * @seedId office_leer_pdf
 * @spanish leer pdf, abrir pdf, extraer texto de pdf, contenido pdf
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const log = logger.child("office-leer-pdf");

export const officeLeerPdfTool: Tool = {
  name: "office_leer_pdf",
  description:
    "Leer contenido de un archivo PDF y retornar texto plano con metadata. Spanish: leer pdf, abrir pdf, extraer texto de pdf, pdf a texto",
  parameters: {
    type: "object",
    properties: {
      ruta: {
        type: "string",
        description: "Ruta absoluta o relativa al archivo PDF",
      },
      pagina_inicio: {
        type: "number",
        description: "Página desde la que empezar (1-indexed, default: 1)",
      },
      pagina_fin: {
        type: "number",
        description: "Última página a leer (default: todas las páginas)",
      },
    },
    required: ["ruta"],
  },
  execute: async (params: Record<string, unknown>) => {
    const ruta = params.ruta as string;
    const paginaInicio = Math.max(1, (params.pagina_inicio as number) ?? 1);
    const paginaFin = params.pagina_fin as number | undefined;

    log.debug(`Leyendo PDF: ${ruta}`);

    try {
      const rutaAbsoluta = path.resolve(ruta);
      if (!fs.existsSync(rutaAbsoluta)) {
        return { ok: false, error: `Archivo no encontrado: ${rutaAbsoluta}` };
      }

      const buffer = fs.readFileSync(rutaAbsoluta);
      const uint8Array = new Uint8Array(buffer);

      // Importar pdfjs-dist (compatible con Bun, sin worker)
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as any).catch(
        () => import("pdfjs-dist" as any)
      );

      // Desactivar worker para entorno Node/Bun
      const lib = pdfjsLib.default ?? pdfjsLib;
      if (lib.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc = "";
      }

      const doc = await lib.getDocument({ data: uint8Array, disableWorker: true }).promise;
      const totalPaginas = doc.numPages;

      // Metadata
      let titulo: string | undefined;
      try {
        const meta = await doc.getMetadata();
        titulo = (meta?.info as any)?.Title ?? undefined;
      } catch {
        // metadata opcional
      }

      const inicio = paginaInicio;
      const fin = paginaFin ? Math.min(paginaFin, totalPaginas) : totalPaginas;

      const textosPorPagina: Array<{ pagina: number; texto: string }> = [];

      for (let i = inicio; i <= fin; i++) {
        const pagina = await doc.getPage(i);
        const contenido = await pagina.getTextContent();
        const texto = (contenido.items as any[])
          .map((item: any) => item.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        textosPorPagina.push({ pagina: i, texto });
      }

      const textoCompleto = textosPorPagina.map((p) => p.texto).join("\n\n");

      log.info(`PDF leído: ${totalPaginas} páginas, ${textoCompleto.length} caracteres`);

      return {
        ok: true,
        ruta: rutaAbsoluta,
        totalPaginas,
        paginasLeidas: fin - inicio + 1,
        titulo,
        texto: textoCompleto,
        paginas: textosPorPagina,
      };
    } catch (error) {
      log.error(`Error leyendo PDF: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo leer el PDF: ${(error as Error).message}`,
      };
    }
  },
};
