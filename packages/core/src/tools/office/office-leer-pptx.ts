/**
 * office_leer_pptx - Leer contenido de un archivo PowerPoint (.pptx)
 *
 * @category office
 * @seedId office_leer_pptx
 * @spanish leer powerpoint, abrir pptx, extraer texto de presentacion, contenido slides
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const log = logger.child("office-leer-pptx");

export const officeLeerPptxTool: Tool = {
  name: "office_leer_pptx",
  description:
    "Leer un archivo PowerPoint (.pptx) y retornar el texto de cada diapositiva como array estructurado. Spanish: leer powerpoint, abrir pptx, extraer texto de presentacion, contenido slides",
  parameters: {
    type: "object",
    properties: {
      ruta: {
        type: "string",
        description: "Ruta absoluta o relativa al archivo .pptx",
      },
      solo_diapositiva: {
        type: "number",
        description:
          "Número de diapositiva específica a leer (1-indexed, default: todas)",
      },
    },
    required: ["ruta"],
  },
  execute: async (params: Record<string, unknown>) => {
    const ruta = params.ruta as string;
    const soloSlide = params.solo_diapositiva as number | undefined;

    log.debug(`Leyendo PPTX: ${ruta}`);

    try {
      const rutaAbsoluta = path.resolve(ruta);
      if (!fs.existsSync(rutaAbsoluta)) {
        return { ok: false, error: `Archivo no encontrado: ${rutaAbsoluta}` };
      }

      const JSZip = (await import("jszip")).default;
      const buffer = fs.readFileSync(rutaAbsoluta);
      const zip = await JSZip.loadAsync(buffer);

      // Encontrar todos los archivos de slides
      const archivosSlides = Object.keys(zip.files)
        .filter((nombre) => /^ppt\/slides\/slide\d+\.xml$/i.test(nombre))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0");
          const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0");
          return numA - numB;
        });

      const diapositivas: Array<{
        numero: number;
        titulo?: string;
        texto: string;
        fragmentos: string[];
      }> = [];

      for (let i = 0; i < archivosSlides.length; i++) {
        const numeroSlide = i + 1;

        if (soloSlide !== undefined && numeroSlide !== soloSlide) {
          continue;
        }

        const archivoSlide = archivosSlides[i];
        const xmlContenido = await zip.files[archivoSlide].async("string");

        // Extraer texto de elementos <a:t> (texto en slides de OOXML)
        const fragmentos: string[] = [];
        const regexTexto = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let match;

        while ((match = regexTexto.exec(xmlContenido)) !== null) {
          const texto = match[1]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .trim();

          if (texto) {
            fragmentos.push(texto);
          }
        }

        // Intentar extraer el título (elemento <p:sp> con tipo "title")
        let titulo: string | undefined;
        const regexTitulo =
          /<p:ph[^>]*type="title"[^>]*\/>[\s\S]*?<a:t[^>]*>([\s\S]*?)<\/a:t>/;
        const matchTitulo = regexTitulo.exec(xmlContenido);
        if (matchTitulo) {
          titulo = matchTitulo[1].trim();
        } else if (fragmentos.length > 0) {
          // Primer fragmento como título tentativo
          titulo = fragmentos[0];
        }

        const texto = fragmentos.join(" ").replace(/\s+/g, " ").trim();

        diapositivas.push({
          numero: numeroSlide,
          titulo,
          texto,
          fragmentos,
        });
      }

      log.info(
        `PPTX leído: ${archivosSlides.length} slides totales, ${diapositivas.length} leídas`
      );

      return {
        ok: true,
        ruta: rutaAbsoluta,
        totalDiapositivas: archivosSlides.length,
        diapositivas,
      };
    } catch (error) {
      log.error(`Error leyendo PPTX: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo leer el archivo PowerPoint: ${(error as Error).message}`,
      };
    }
  },
};
