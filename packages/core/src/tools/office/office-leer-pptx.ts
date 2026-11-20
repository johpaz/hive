/**
 * office_leer_pptx - Leer contenido de un archivo PowerPoint (.pptx)
 *
 * Texto nativo por diapositiva (un párrafo por línea), en el orden real de la
 * presentación y con las notas del orador. Sin modelos.
 *
 * @category office
 * @seedId office_leer_pptx
 * @spanish leer powerpoint, abrir pptx, extraer texto de presentacion, contenido slides
 */

import { resolveOfficeInput, ARTIFACT_ID_PARAM } from "./resolve-input.ts";
import { listarSlides, textoDeXml, tituloDeXml, archivoDeNotas } from "./pptx-slides.ts";
import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const log = logger.child("office-leer-pptx");

const DEFAULT_MAX_CHARS = 40_000;

export const officeLeerPptxTool: Tool = {
  name: "office_leer_pptx",
  description:
    "Leer un PowerPoint (.pptx): texto de cada diapositiva en su orden real, con título y notas del orador, con tope de tamaño. Spanish: leer powerpoint, abrir pptx, extraer texto de presentacion, contenido slides",
  parameters: {
    type: "object",
    properties: {
      artifact_id: ARTIFACT_ID_PARAM,
      ruta: {
        type: "string",
        description: "Ruta absoluta o relativa al archivo .pptx",
      },
      solo_diapositiva: {
        type: "number",
        description: "Número de diapositiva específica a leer (1-indexed, default: todas)",
      },
      max_caracteres: {
        type: "number",
        description: "Tope de caracteres por llamada (default 40000). Si hay más, trae siguiente_diapositiva para continuar.",
      },
      desde_diapositiva: {
        type: "number",
        description: "Diapositiva desde la que empezar a leer (default 1), para continuar tras un corte.",
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>) => {
    const entrada = await resolveOfficeInput(params);
    if ("error" in entrada) return { ok: false, error: entrada.error };
    const soloSlide = params.solo_diapositiva ? Number(params.solo_diapositiva) : undefined;
    const desde = Math.max(1, Number(params.desde_diapositiva) || 1);
    const tope = Math.min(Math.max(Number(params.max_caracteres) || DEFAULT_MAX_CHARS, 1000), 200_000);

    log.debug(`Leyendo PPTX: ${entrada.ruta}`);

    try {
      const rutaAbsoluta = path.resolve(entrada.ruta);
      if (!fs.existsSync(rutaAbsoluta)) return { ok: false, error: `Archivo no encontrado: ${rutaAbsoluta}` };

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(fs.readFileSync(rutaAbsoluta)).catch(() => {
        throw new Error("El archivo no es un .pptx válido o está dañado.");
      });
      const slides = await listarSlides(zip);

      const diapositivas: Array<{ numero: number; titulo?: string; texto: string; notas?: string }> = [];
      let usados = 0;
      let siguiente: number | undefined;

      for (const slide of slides) {
        if (soloSlide !== undefined ? slide.numero !== soloSlide : slide.numero < desde) continue;
        const xml = await zip.file(slide.archivo)!.async("string");
        const texto = textoDeXml(xml);
        const archivoNotas = await archivoDeNotas(zip, slide);
        const notas = archivoNotas ? textoDeXml(await zip.file(archivoNotas)!.async("string")) : "";
        const item = { numero: slide.numero, titulo: tituloDeXml(xml, texto), texto, ...(notas ? { notas } : {}) };
        const tam = JSON.stringify(item).length;
        if (diapositivas.length > 0 && usados + tam > tope) { siguiente = slide.numero; break; }
        diapositivas.push(item);
        usados += tam;
      }

      log.info(`PPTX leído: ${slides.length} slides totales, ${diapositivas.length} leídas`);
      return {
        ok: true,
        ruta: rutaAbsoluta,
        totalDiapositivas: slides.length,
        diapositivas,
        ...(siguiente ? { truncado: true, siguiente_diapositiva: siguiente, aviso: `Hay más diapositivas: vuelve a llamar con desde_diapositiva=${siguiente}.` } : {}),
      };
    } catch (error) {
      log.error(`Error leyendo PPTX: ${(error as Error).message}`);
      return { ok: false, error: `No se pudo leer el PPTX: ${(error as Error).message}` };
    }
  },
};
