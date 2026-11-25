/**
 * office_leer_docx - Leer contenido de un archivo Word (.docx)
 *
 * @category office
 * @seedId office_leer_docx
 * @spanish leer word, abrir docx, extraer texto de word, contenido word
 */

import { resolveOfficeInput, ARTIFACT_ID_PARAM } from "./resolve-input.ts";
import { listarImagenes } from "./office-images.ts";
import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const log = logger.child("office-leer-docx");

export const officeLeerDocxTool: Tool = {
  name: "office_leer_docx",
  description:
    "Leer un archivo Word (.docx) y retornar el contenido de texto preservando párrafos y tablas. Spanish: leer word, abrir docx, extraer texto de word, contenido word",
  parameters: {
    type: "object",
    properties: {
      artifact_id: ARTIFACT_ID_PARAM,
      ruta: {
        type: "string",
        description: "Ruta absoluta o relativa al archivo .docx",
      },
      incluir_tablas: {
        type: "boolean",
        description: "Incluir contenido de tablas en la extracción (default: true)",
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>) => {
    const entrada = await resolveOfficeInput(params);
    if ("error" in entrada) return { ok: false, error: entrada.error };
    const ruta = entrada.ruta;
    const incluirTablas = (params.incluir_tablas as boolean) ?? true;

    log.debug(`Leyendo DOCX: ${ruta}`);

    try {
      const rutaAbsoluta = path.resolve(ruta);
      if (!fs.existsSync(rutaAbsoluta)) {
        return { ok: false, error: `Archivo no encontrado: ${rutaAbsoluta}` };
      }

      const mammoth = await import("mammoth");
      const buffer = fs.readFileSync(rutaAbsoluta);

      // Extraer texto plano
      const resultadoTexto = await mammoth.extractRawText({ buffer });

      // Extraer HTML para información de tablas si se requiere
      let textoTablas: string | undefined;
      if (incluirTablas) {
        const resultadoHtml = await mammoth.convertToHtml({ buffer });
        // Extraer contenido de tablas del HTML
        const tablas = resultadoHtml.value.match(/<table[\s\S]*?<\/table>/gi) ?? [];
        if (tablas.length > 0) {
          textoTablas = tablas
            .map((tabla, i) => {
              // Limpiar tags HTML y extraer texto de celdas
              const celdas = tabla.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [];
              const textoCeldas = celdas
                .map((celda) => celda.replace(/<[^>]+>/g, "").trim())
                .filter(Boolean);
              return `[Tabla ${i + 1}]\n${textoCeldas.join(" | ")}`;
            })
            .join("\n\n");
        }
      }

      const advertencias = resultadoTexto.messages
        .filter((m: any) => m.type === "warning")
        .map((m: any) => m.message);

      // Las imágenes no entran en el texto: se avisa para que el agente sepa que existen.
      let imagenes = 0;
      try {
        const JSZip = (await import("jszip")).default;
        imagenes = (await listarImagenes(await JSZip.loadAsync(buffer), "docx")).imagenes.length;
      } catch { /* sin aviso de imágenes: el texto ya se leyó */ }

      log.info(`DOCX leído: ${resultadoTexto.value.length} caracteres, ${imagenes} imágenes`);

      return {
        ok: true,
        ruta: rutaAbsoluta,
        texto: resultadoTexto.value,
        tablas: textoTablas,
        advertencias: advertencias.length > 0 ? advertencias : undefined,
        ...(imagenes ? { imagenes, aviso_imagenes: `El documento tiene ${imagenes} ${imagenes === 1 ? "imagen" : "imágenes"} que NO están en este texto (capturas, gráficos, diagramas). Si hacen falta, usa la tool office_leer_imagenes con la misma ruta.` } : {}),
      };
    } catch (error) {
      log.error(`Error leyendo DOCX: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo leer el archivo DOCX: ${(error as Error).message}`,
      };
    }
  },
};
