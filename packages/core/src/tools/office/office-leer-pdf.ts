/**
 * office_leer_pdf - Leer contenido de un archivo PDF
 *
 * @category office
 * @seedId office_leer_pdf
 * @spanish leer pdf, abrir pdf, extraer texto de pdf, contenido pdf
 */

import { extraerTextoPdf } from "./pdf-text.ts";
import { resolveOfficeInput, ARTIFACT_ID_PARAM } from "./resolve-input.ts";
import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const log = logger.child("office-leer-pdf");

const DEFAULT_MAX_CHARS = 40_000;

export const officeLeerPdfTool: Tool = {
  name: "office_leer_pdf",
  description:
    "Leer el texto de un PDF (capa de texto nativa, sin OCR ni modelos), conservando renglones y columnas, por páginas y con tope de tamaño. Un PDF escaneado devuelve aviso en vez de texto. Spanish: leer pdf, abrir pdf, extraer texto de pdf, pdf a texto",
  parameters: {
    type: "object",
    properties: {
      artifact_id: ARTIFACT_ID_PARAM,
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
        description: "Última página a leer (default: hasta donde quepa en max_caracteres)",
      },
      max_caracteres: {
        type: "number",
        description: "Tope de caracteres por llamada (default 40000). Si hay más, la respuesta trae siguiente_pagina para continuar.",
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>) => {
    const entrada = await resolveOfficeInput(params);
    if ("error" in entrada) return { ok: false, error: entrada.error };
    const ruta = entrada.ruta;
    const paginaInicio = Math.max(1, Number(params.pagina_inicio) || 1);
    const paginaFin = params.pagina_fin ? Number(params.pagina_fin) : undefined;
    const maxCaracteres = Math.min(Math.max(Number(params.max_caracteres) || DEFAULT_MAX_CHARS, 1000), 200_000);

    log.debug(`Leyendo PDF: ${ruta}`);

    try {
      const rutaAbsoluta = path.resolve(ruta);
      if (!fs.existsSync(rutaAbsoluta)) {
        return { ok: false, error: `Archivo no encontrado: ${rutaAbsoluta}` };
      }
      const r = await extraerTextoPdf(new Uint8Array(fs.readFileSync(rutaAbsoluta)), {
        desde: paginaInicio, hasta: paginaFin, maxCaracteres,
      });
      log.info(`PDF leído: ${r.paginasLeidas}/${r.totalPaginas} páginas, ${r.texto.length} caracteres`);

      if (r.sinTexto) {
        return {
          ok: true,
          ruta: rutaAbsoluta,
          totalPaginas: r.totalPaginas,
          paginasLeidas: r.paginasLeidas,
          texto: "",
          aviso: "Estas páginas no tienen texto extraíble: el PDF parece escaneado (solo imágenes). Esta herramienta no hace OCR; pídele al usuario el documento en formato editable o que copie el texto.",
        };
      }
      const vacias = r.caracteresPorPagina.filter((c) => c === 0).length;
      return {
        ok: true,
        ruta: rutaAbsoluta,
        totalPaginas: r.totalPaginas,
        paginasLeidas: r.paginasLeidas,
        titulo: r.titulo,
        texto: r.texto,
        ...(r.truncado || r.siguientePagina
          ? { truncado: r.truncado, siguiente_pagina: r.siguientePagina, aviso: `Hay más contenido: vuelve a llamar con pagina_inicio=${r.siguientePagina}.` }
          : {}),
        ...(vacias ? { paginas_sin_texto: vacias } : {}),
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
