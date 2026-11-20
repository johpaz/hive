/**
 * office_editar_pptx - Modificar el texto de un PowerPoint existente conservando su diseño
 *
 * Reemplaza texto en las diapositivas (y opcionalmente en las notas) aunque
 * PowerPoint lo haya partido en varios fragmentos con formato distinto; layouts,
 * imágenes, gráficos y animaciones no se tocan. Nunca pisa el original: guarda
 * una copia («<nombre>_corregido.pptx»). No añade ni quita diapositivas.
 *
 * @category office
 * @seedId office_editar_pptx
 * @spanish editar powerpoint, corregir presentación, reemplazar texto en diapositivas, mejorar pptx
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveOfficeInput, ARTIFACT_ID_PARAM } from "./resolve-input.ts";
import { resolveInWorkspace, getWorkspace } from "../filesystem/workspace-guard.ts";
import { reemplazarEnParrafo } from "./office-editar-docx.ts";
import { listarSlides, archivoDeNotas } from "./pptx-slides.ts";

const log = logger.child("office-editar-pptx");

interface Reemplazo { buscar: string; reemplazar: string; diapositiva?: number }

export const officeEditarPptxTool: Tool = {
  name: "office_editar_pptx",
  description:
    "Editar un PowerPoint (.pptx) existente reemplazando texto en diapositivas (y notas si se pide), conservando diseño, imágenes y gráficos. Guarda una copia (no pisa el original) y devuelve su ruta para enviarla con send_file. No añade ni elimina diapositivas. Spanish: editar powerpoint, corregir presentación, reemplazar texto en diapositivas",
  parameters: {
    type: "object",
    properties: {
      ruta: { type: "string", description: "Ruta del .pptx a editar" },
      artifact_id: ARTIFACT_ID_PARAM,
      reemplazos: {
        type: "array",
        description: "Pares buscar → reemplazar. 'diapositiva' (opcional) limita el cambio a esa diapositiva; sin ella se aplica a todas. Para borrar un texto usa reemplazar vacío.",
        items: {
          type: "object",
          properties: {
            buscar: { type: "string" },
            reemplazar: { type: "string" },
            diapositiva: { type: "number", description: "Número de diapositiva (1-indexed) al que limitar el cambio" },
          },
          required: ["buscar", "reemplazar"],
        },
      },
      incluir_notas: { type: "boolean", description: "Aplicar también a las notas del orador (default: false)" },
      guardar_como: { type: "string", description: "Ruta de salida (default: <nombre>_corregido.pptx junto al original)" },
    },
    required: ["reemplazos"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const entrada = await resolveOfficeInput(params);
    if ("error" in entrada) return { ok: false, error: entrada.error };
    const reemplazos = (Array.isArray(params.reemplazos) ? params.reemplazos : []) as Reemplazo[];
    if (reemplazos.length === 0) return { ok: false, error: "Indica al menos un reemplazo en 'reemplazos'." };
    const incluirNotas = params.incluir_notas === true;

    try {
      const workspace = getWorkspace(config);
      const origen = path.resolve(entrada.ruta);
      if (!fs.existsSync(origen)) return { ok: false, error: `Archivo no encontrado: ${origen}` };
      if (!/\.pptx$/i.test(origen)) return { ok: false, error: "Solo se pueden editar archivos .pptx." };

      const base = path.basename(origen).replace(/\.pptx$/i, "");
      const pedido = typeof params.guardar_como === "string" && params.guardar_como.trim() ? params.guardar_como.trim() : null;
      const destino = path.resolve(
        pedido
          ? resolveInWorkspace(pedido, workspace)
          : workspace
            ? resolveInWorkspace(`${base}_corregido.pptx`, workspace)
            : path.join(path.dirname(origen), `${base}_corregido.pptx`),
      );
      if (destino === origen) return { ok: false, error: "El destino no puede ser el archivo original." };

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(fs.readFileSync(origen)).catch(() => {
        throw new Error("El archivo no es un .pptx válido o está dañado.");
      });
      const slides = await listarSlides(zip);
      if (slides.length === 0) return { ok: false, error: "La presentación no tiene diapositivas." };

      const conteo = reemplazos.map(() => 0);
      const aplicar = (xml: string, numero: number): string => {
        let salida = xml;
        reemplazos.forEach((r, i) => {
          if (typeof r.buscar !== "string" || !r.buscar) return;
          if (r.diapositiva !== undefined && Number(r.diapositiva) !== numero) return;
          salida = salida.replace(/<a:p[ >][\s\S]*?<\/a:p>/g, (parrafo) => {
            const res = reemplazarEnParrafo(parrafo, r.buscar, String(r.reemplazar ?? ""), "a:t");
            conteo[i] += res.cuenta;
            return res.xml;
          });
        });
        return salida;
      };

      for (const slide of slides) {
        zip.file(slide.archivo, aplicar(await zip.file(slide.archivo)!.async("string"), slide.numero));
        if (incluirNotas) {
          const notas = await archivoDeNotas(zip, slide);
          if (notas) zip.file(notas, aplicar(await zip.file(notas)!.async("string"), slide.numero));
        }
      }

      const resumen = reemplazos.map((r, i) => ({ buscar: r.buscar, diapositiva: r.diapositiva, apariciones: conteo[i] }));
      if (conteo.every((c) => c === 0)) {
        return { ok: false, error: "Ninguno de los textos a buscar aparece en las diapositivas indicadas.", resumen };
      }

      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      log.info(`PPTX editado → ${destino}`);
      return {
        ok: true,
        ruta: destino,
        reemplazos: resumen,
        nota: "Solo se edita texto existente (no se añaden ni quitan diapositivas). Envíalo con send_file.",
      };
    } catch (error) {
      return { ok: false, error: `No se pudo editar el PowerPoint: ${(error as Error).message}` };
    }
  },
};
