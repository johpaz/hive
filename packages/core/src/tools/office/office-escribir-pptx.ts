/**
 * office_escribir_pptx - Generar un archivo PowerPoint (.pptx)
 *
 * @category office
 * @seedId office_escribir_pptx
 * @spanish crear powerpoint, generar pptx, escribir presentacion, exportar a pptx
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";

const log = logger.child("office-escribir-pptx");

interface DiapositivaInput {
  titulo?: string;
  contenido?: string;
  puntos?: string[];
  notas?: string;
}

export const officeEscribirPptxTool: Tool = {
  name: "office_escribir_pptx",
  description:
    "Generar un archivo PowerPoint (.pptx) desde un array de diapositivas con título y contenido. Spanish: crear powerpoint, generar pptx, escribir presentacion, exportar a pptx",
  parameters: {
    type: "object",
    properties: {
      ruta: {
        type: "string",
        description: "Ruta donde guardar el archivo .pptx generado",
      },
      titulo_presentacion: {
        type: "string",
        description: "Título de la presentación (aparece en la primera diapositiva)",
      },
      diapositivas: {
        type: "array",
        description:
          "Array de diapositivas. Cada una tiene: titulo (string), contenido (string, texto libre), puntos (string[], lista de viñetas), notas (string, notas del presentador)",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            contenido: { type: "string" },
            puntos: { type: "array", items: { type: "string" } },
            notas: { type: "string" },
          },
        },
      },
    },
    required: ["ruta", "diapositivas"],
  },
  execute: async (params: Record<string, unknown>) => {
    const ruta = params.ruta as string;
    const tituloPresentacion = params.titulo_presentacion as string | undefined;
    const diapositivasInput = params.diapositivas as DiapositivaInput[];

    log.debug(`Generando PPTX: ${ruta}`);

    try {
      const pptxgen = (await import("pptxgenjs")).default;
      const pres = new pptxgen();

      // Configuración básica
      pres.layout = "LAYOUT_16x9";

      // Diapositiva de título (si se proporciona título de presentación)
      if (tituloPresentacion) {
        const slidePortada = pres.addSlide();
        slidePortada.addText(tituloPresentacion, {
          x: "10%",
          y: "35%",
          w: "80%",
          h: "30%",
          fontSize: 36,
          bold: true,
          align: "center",
          color: "363636",
        });
      }

      // Diapositivas de contenido
      for (const diapoInput of diapositivasInput) {
        const slide = pres.addSlide();

        // Título de la diapositiva
        if (diapoInput.titulo) {
          slide.addText(diapoInput.titulo, {
            x: "5%",
            y: "5%",
            w: "90%",
            h: "15%",
            fontSize: 24,
            bold: true,
            color: "363636",
            valign: "middle",
          });
        }

        const yContenido = diapoInput.titulo ? "22%" : "10%";
        const hContenido = diapoInput.titulo ? "70%" : "82%";

        // Puntos de viñeta (tienen prioridad sobre contenido libre)
        if (diapoInput.puntos && diapoInput.puntos.length > 0) {
          const textoPuntos = diapoInput.puntos.map((punto) => ({
            text: punto,
            options: {
              bullet: true,
              fontSize: 18,
              color: "595959",
              breakLine: true,
            } as any,
          }));

          slide.addText(textoPuntos, {
            x: "5%",
            y: yContenido,
            w: "90%",
            h: hContenido,
            valign: "top",
          });
        } else if (diapoInput.contenido) {
          // Texto libre
          slide.addText(diapoInput.contenido, {
            x: "5%",
            y: yContenido,
            w: "90%",
            h: hContenido,
            fontSize: 16,
            color: "595959",
            valign: "top",
            wrap: true,
          });
        }

        // Notas del presentador
        if (diapoInput.notas) {
          slide.addNotes(diapoInput.notas);
        }
      }

      const rutaAbsoluta = path.resolve(ruta);
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) {
        fs.mkdirSync(dirDestino, { recursive: true });
      }

      // Escribir el archivo
      await pres.writeFile({ fileName: rutaAbsoluta });

      const stats = fs.statSync(rutaAbsoluta);

      log.info(
        `PPTX generado: ${rutaAbsoluta} (${diapositivasInput.length} diapositivas)`
      );

      return {
        ok: true,
        ruta: rutaAbsoluta,
        totalDiapositivas:
          diapositivasInput.length + (tituloPresentacion ? 1 : 0),
        bytesEscritos: stats.size,
      };
    } catch (error) {
      log.error(`Error generando PPTX: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo generar el archivo PowerPoint: ${(error as Error).message}`,
      };
    }
  },
};
