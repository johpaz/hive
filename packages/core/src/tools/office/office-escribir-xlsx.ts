/**
 * office_escribir_xlsx - Generar un archivo Excel (.xlsx)
 *
 * @category office
 * @seedId office_escribir_xlsx
 * @spanish crear excel, generar xlsx, escribir excel, exportar a xlsx
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";

const log = logger.child("office-escribir-xlsx");

interface HojaInput {
  nombre: string;
  datos: Record<string, any>[] | any[][];
  encabezados?: string[];
}

export const officeEscribirXlsxTool: Tool = {
  name: "office_escribir_xlsx",
  description:
    "Generar un archivo Excel (.xlsx) desde un objeto JSON con hojas, filas y columnas. Spanish: crear excel, generar xlsx, escribir excel, exportar a xlsx",
  parameters: {
    type: "object",
    properties: {
      ruta: {
        type: "string",
        description: "Ruta donde guardar el archivo .xlsx generado",
      },
      hojas: {
        type: "array",
        description:
          "Array de hojas a crear. Cada hoja tiene: nombre (string), datos (array de objetos o array de arrays), encabezados (string[], opcional para forzar orden de columnas)",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            datos: { type: "array" },
            encabezados: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    required: ["ruta", "hojas"],
  },
  execute: async (params: Record<string, unknown>) => {
    const ruta = params.ruta as string;
    const hojasInput = params.hojas as HojaInput[];

    log.debug(`Generando XLSX: ${ruta}`);

    try {
      const XLSX = await import("xlsx");

      const workbook = XLSX.utils.book_new();

      for (const hojaInput of hojasInput) {
        let worksheet: any;

        if (
          hojasInput.length > 0 &&
          Array.isArray(hojaInput.datos) &&
          hojaInput.datos.length > 0 &&
          Array.isArray(hojaInput.datos[0])
        ) {
          // Si los datos son array de arrays
          worksheet = XLSX.utils.aoa_to_sheet(hojaInput.datos as any[][]);
        } else {
          // Si los datos son array de objetos
          worksheet = XLSX.utils.json_to_sheet(
            hojaInput.datos as Record<string, any>[],
            hojaInput.encabezados ? { header: hojaInput.encabezados } : undefined
          );
        }

        XLSX.utils.book_append_sheet(workbook, worksheet, hojaInput.nombre);
      }

      const rutaAbsoluta = path.resolve(ruta);
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) {
        fs.mkdirSync(dirDestino, { recursive: true });
      }

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      fs.writeFileSync(rutaAbsoluta, buffer);

      const totalFilas = hojasInput.reduce(
        (acc, h) => acc + h.datos.length,
        0
      );

      log.info(
        `XLSX generado: ${rutaAbsoluta} (${hojasInput.length} hojas, ${totalFilas} filas)`
      );

      return {
        ok: true,
        ruta: rutaAbsoluta,
        hojas: hojasInput.map((h) => h.nombre),
        totalHojas: hojasInput.length,
        totalFilas,
        bytesEscritos: buffer.length,
      };
    } catch (error) {
      log.error(`Error generando XLSX: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo generar el archivo Excel: ${(error as Error).message}`,
      };
    }
  },
};
