/**
 * Office Tools - 8 tools para manejo de archivos Office
 *
 * @category office
 *
 * Herramientas:
 * - office_leer_pdf     — Leer PDF y extraer texto + metadata
 * - office_escribir_pdf — Generar PDF desde texto
 * - office_leer_docx    — Leer Word (.docx) y extraer texto
 * - office_escribir_docx — Generar Word (.docx) con párrafos y tablas
 * - office_leer_xlsx    — Leer Excel (.xlsx) como JSON
 * - office_escribir_xlsx — Generar Excel (.xlsx) desde JSON
 * - office_leer_pptx    — Leer PowerPoint (.pptx) y extraer texto por slide
 * - office_escribir_pptx — Generar PowerPoint (.pptx) desde array de slides
 */

import type { Tool } from "../types.ts";
import { officeLeerPdfTool } from "./office-leer-pdf.ts";
import { officeEscribirPdfTool } from "./office-escribir-pdf.ts";
import { officeLeerDocxTool } from "./office-leer-docx.ts";
import { officeEscribirDocxTool } from "./office-escribir-docx.ts";
import { officeLeerXlsxTool } from "./office-leer-xlsx.ts";
import { officeEscribirXlsxTool } from "./office-escribir-xlsx.ts";
import { officeLeerPptxTool } from "./office-leer-pptx.ts";
import { officeEscribirPptxTool } from "./office-escribir-pptx.ts";

export function createTools(): Tool[] {
  return [
    officeLeerPdfTool,
    officeEscribirPdfTool,
    officeLeerDocxTool,
    officeEscribirDocxTool,
    officeLeerXlsxTool,
    officeEscribirXlsxTool,
    officeLeerPptxTool,
    officeEscribirPptxTool,
  ];
}

export * from "./office-leer-pdf.ts";
export * from "./office-escribir-pdf.ts";
export * from "./office-leer-docx.ts";
export * from "./office-escribir-docx.ts";
export * from "./office-leer-xlsx.ts";
export * from "./office-escribir-xlsx.ts";
export * from "./office-leer-pptx.ts";
export * from "./office-escribir-pptx.ts";
