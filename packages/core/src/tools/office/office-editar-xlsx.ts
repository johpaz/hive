/**
 * office_editar_xlsx - Modificar celdas de un Excel existente conservando su formato
 *
 * A diferencia de office_escribir_xlsx (crea desde cero), esta abre el archivo,
 * cambia solo las celdas indicadas y lo guarda: estilos, anchos, formatos y
 * fórmulas de las demás celdas quedan como estaban. Nunca pisa el original:
 * guarda una copia (por defecto «<nombre>_corregido.xlsx»).
 *
 * @category office
 * @seedId office_editar_xlsx
 * @spanish editar excel, corregir excel, modificar celdas, mejorar hoja de cálculo
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveOfficeInput, ARTIFACT_ID_PARAM } from "./resolve-input.ts";
import { resolveInWorkspace, getWorkspace } from "../filesystem/workspace-guard.ts";

const log = logger.child("office-editar-xlsx");

interface Cambio {
  hoja: string;
  celda: string;
  valor?: string | number | boolean | null;
  formula?: string;
}

export const officeEditarXlsxTool: Tool = {
  name: "office_editar_xlsx",
  description:
    "Editar un Excel (.xlsx) existente cambiando solo las celdas indicadas, conservando el formato del resto. Guarda una copia (no pisa el original) y devuelve su ruta para enviarla con send_file. Spanish: editar excel, corregir excel, modificar celdas, mejorar hoja de cálculo",
  parameters: {
    type: "object",
    properties: {
      ruta: { type: "string", description: "Ruta del .xlsx a editar" },
      artifact_id: ARTIFACT_ID_PARAM,
      cambios: {
        type: "array",
        description: "Celdas a modificar. Usa 'valor' para texto/número o 'formula' (sin el signo =) para una fórmula.",
        items: {
          type: "object",
          properties: {
            hoja: { type: "string", description: "Nombre de la hoja" },
            celda: { type: "string", description: "Referencia, p. ej. B7" },
            valor: { type: "string", description: "Nuevo valor (texto o número; vacío para limpiar la celda)" },
            formula: { type: "string", description: "Fórmula sin '=', p. ej. SUM(B2:B6)" },
          },
          required: ["hoja", "celda"],
        },
      },
      guardar_como: { type: "string", description: "Ruta de salida (default: <nombre>_corregido.xlsx junto al original)" },
    },
    required: ["cambios"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const entrada = await resolveOfficeInput(params);
    if ("error" in entrada) return { ok: false, error: entrada.error };
    const cambios = Array.isArray(params.cambios) ? (params.cambios as Cambio[]) : [];
    if (cambios.length === 0) return { ok: false, error: "Indica al menos un cambio en 'cambios'." };
    if (cambios.length > 2000) return { ok: false, error: "Demasiados cambios en una llamada (máximo 2000)." };

    try {
      const workspace = getWorkspace(config);
      const origen = path.resolve(entrada.ruta);
      if (!fs.existsSync(origen)) return { ok: false, error: `Archivo no encontrado: ${origen}` };
      if (!/\.xlsx$/i.test(origen)) return { ok: false, error: "Solo se pueden editar archivos .xlsx." };

      // El origen puede ser un adjunto del usuario (fuera del workspace) y eso es lícito;
      // el destino sí debe quedar dentro del workspace si el agente tiene uno.
      const base = path.basename(origen).replace(/\.xlsx$/i, "");
      const pedido = typeof params.guardar_como === "string" && params.guardar_como.trim()
        ? params.guardar_como.trim()
        : null;
      const destino = path.resolve(
        pedido
          ? resolveInWorkspace(pedido, workspace)
          : workspace
            ? resolveInWorkspace(`${base}_corregido.xlsx`, workspace)
            : path.join(path.dirname(origen), `${base}_corregido.xlsx`),
      );
      if (destino === origen) return { ok: false, error: "El destino no puede ser el archivo original." };

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(origen);

      const aplicados: string[] = [];
      const omitidos: string[] = [];
      for (const c of cambios) {
        const hoja = wb.getWorksheet(c.hoja);
        if (!hoja) { omitidos.push(`${c.hoja}!${c.celda} (no existe la hoja)`); continue; }
        if (!/^[A-Za-z]{1,3}[0-9]{1,7}$/.test(c.celda ?? "")) { omitidos.push(`${c.hoja}!${c.celda} (referencia inválida)`); continue; }
        const celda = hoja.getCell(c.celda.toUpperCase());
        if (typeof c.formula === "string" && c.formula.trim()) {
          celda.value = { formula: c.formula.trim().replace(/^=/, "") } as any;
        } else if ("valor" in c) {
          celda.value = c.valor as any;
        } else {
          omitidos.push(`${c.hoja}!${c.celda} (falta 'valor' o 'formula')`);
          continue;
        }
        aplicados.push(`${c.hoja}!${c.celda.toUpperCase()}`);
      }
      if (aplicados.length === 0) return { ok: false, error: `No se aplicó ningún cambio. ${omitidos.join("; ")}` };

      fs.mkdirSync(path.dirname(destino), { recursive: true });
      await wb.xlsx.writeFile(destino);
      log.info(`XLSX editado: ${aplicados.length} celdas → ${destino}`);
      return {
        ok: true,
        ruta: destino,
        celdas_modificadas: aplicados.length,
        ...(omitidos.length ? { omitidos } : {}),
        nota: "Las fórmulas se recalculan al abrir el archivo en Excel. Envíalo con send_file.",
      };
    } catch (error) {
      return { ok: false, error: `No se pudo editar el Excel: ${(error as Error).message}` };
    }
  },
};
