/**
 * office_escribir_xlsx - Generar un archivo Excel (.xlsx) con estilos
 *
 * Mismo modelo que `office_write_xlsx` del SDK de Rust: por hoja, `columnas`
 * fija formato (fecha, moneda, porcentaje…), ancho, negrita, color, relleno,
 * alineación y ajuste de texto; `estilo_encabezado` da estilo a la primera fila,
 * `congelar_encabezado` la fija y `autofiltro` añade los botones de filtro.
 * Por defecto el encabezado sale con estilo, la fila fija y los anchos se
 * ajustan al contenido. Las celdas son siempre valores: un texto que empieza
 * por «=» nunca se evalúa como fórmula.
 *
 * @category office
 * @seedId office_escribir_xlsx
 * @spanish crear excel, generar xlsx, escribir excel, exportar a xlsx
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";
import { hexValido } from "./office-style";

const log = logger.child("office-escribir-xlsx");

interface ColumnaInput {
  columna: string | number;
  formato?: string;
  ancho?: number;
  negrita?: boolean;
  color?: string;
  relleno?: string;
  alineacion?: "left" | "center" | "right" | "izquierda" | "centro" | "derecha";
  ajustar?: boolean;
}

interface HojaInput {
  nombre: string;
  datos: Record<string, any>[] | any[][];
  encabezados?: string[];
  columnas?: ColumnaInput[];
  estilo_encabezado?: { negrita?: boolean; color?: string; relleno?: string; alineacion?: string };
  congelar_encabezado?: boolean;
  autofiltro?: boolean;
}

const FORMATOS: Record<string, string> = {
  date: "yyyy-mm-dd", fecha: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm:ss", fecha_hora: "yyyy-mm-dd hh:mm:ss",
  time: "hh:mm:ss", hora: "hh:mm:ss",
  integer: "0", entero: "0",
  decimal: "0.00",
  thousands: "#,##0", miles: "#,##0",
  percent: "0.00%", porcentaje: "0.00%",
  currency: '"$"#,##0.00', moneda: '"$"#,##0.00',
  text: "@", texto: "@",
};
const ES_FECHA = new Set(["date", "fecha", "datetime", "fecha_hora", "time", "hora"]);

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO_HORA = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Fecha ISO → Date en UTC (Excel guarda la fecha sin zona; así no se corre un día). */
function aFecha(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const t = ISO.exec(valor.trim());
  if (t) return new Date(Date.UTC(+t[1]!, +t[2]! - 1, +t[3]!, +(t[4] ?? 0), +(t[5] ?? 0), +(t[6] ?? 0)));
  const h = ISO_HORA.exec(valor.trim());
  if (h) return new Date(Date.UTC(1899, 11, 30, +h[1]!, +h[2]!, +(h[3] ?? 0)));
  return null;
}

const alineacionExcel = (a?: string): "left" | "center" | "right" | undefined =>
  a === "center" || a === "centro" ? "center" : a === "right" || a === "derecha" ? "right" : a === "left" || a === "izquierda" ? "left" : undefined;

const relleno = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${hex}` } });

/** Largo aproximado del texto que Excel mostrará, para dimensionar la columna. */
function largoVisible(v: unknown, formato?: string): number {
  if (v === null || v === undefined) return 0;
  if (v instanceof Date) return formato === "datetime" || formato === "fecha_hora" ? 19 : 12;
  if (typeof v === "number") {
    const f = formato ?? "";
    if (/^(currency|moneda)$/.test(f) || f.includes("$")) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.length + 1;
    if (/^(percent|porcentaje)$/.test(f)) return `${(v * 100).toFixed(2)}%`.length;
    if (/^(thousands|miles)$/.test(f)) return v.toLocaleString("en-US").length;
    if (f === "decimal") return v.toFixed(2).length;
    return String(v).length;
  }
  return String(v).length;
}

function letraDeColumna(n: number): string {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

export const officeEscribirXlsxTool: Tool = {
  name: "office_escribir_xlsx",
  description:
    "Generar un archivo Excel (.xlsx) con estilo desde hojas de objetos o de arrays. La primera fila es el encabezado (se estiliza, se fija y recibe autofiltro por defecto). Por hoja, `columnas` fija formato (fecha, fecha_hora, hora, entero, decimal, miles, porcentaje, moneda, texto o un código de formato de Excel; los textos ISO como 2025-03-01 en una columna de fecha se guardan como fechas reales), ancho, negrita, color, relleno, alineacion y ajustar para una columna indicada por el texto de su encabezado o su índice. Colores #RRGGBB. Las celdas son siempre valores: un texto que empieza por = nunca es fórmula. Spanish: crear excel, generar xlsx, escribir excel, exportar a xlsx, hoja de cálculo, reporte",
  parameters: {
    type: "object",
    properties: {
      ruta: { type: "string", description: "Ruta donde guardar el archivo .xlsx generado" },
      hojas: {
        type: "array",
        description:
          "Hojas a crear. Cada una: nombre, datos (array de objetos o array de arrays), encabezados (orden de columnas, opcional), columnas ([{columna, formato, ancho, negrita, color, relleno, alineacion, ajustar}]), estilo_encabezado ({negrita, color, relleno, alineacion}), congelar_encabezado (default true), autofiltro (default true)",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            datos: { type: "array", items: { type: "object" } },
            encabezados: { type: "array", items: { type: "string" } },
            columnas: { type: "array", items: { type: "object" } },
            estilo_encabezado: { type: "object" },
            congelar_encabezado: { type: "boolean" },
            autofiltro: { type: "boolean" },
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
      if (!Array.isArray(hojasInput) || hojasInput.length === 0) {
        return { ok: false, error: "`hojas` debe tener al menos una hoja." };
      }
      const ExcelJS = (await import("exceljs")).default;
      const libro = new ExcelJS.Workbook();
      libro.creator = "Hive Agent";
      libro.created = new Date();

      let totalFilas = 0;
      const usados = new Set<string>();

      for (const hojaInput of hojasInput) {
        let nombre = String(hojaInput.nombre ?? "Hoja").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Hoja";
        for (let n = 2; usados.has(nombre.toLowerCase()); n++) nombre = `${nombre.slice(0, 28)} ${n}`;
        usados.add(nombre.toLowerCase());

        const datos = Array.isArray(hojaInput.datos) ? hojaInput.datos : [];
        const hoja = libro.addWorksheet(nombre);

        // Matriz de filas: la primera es el encabezado.
        let matriz: unknown[][];
        if (datos.length > 0 && Array.isArray(datos[0])) {
          matriz = datos as unknown[][];
          if (hojaInput.encabezados?.length) matriz = [hojaInput.encabezados, ...matriz];
        } else {
          const objetos = datos as Record<string, unknown>[];
          const claves = hojaInput.encabezados?.length
            ? hojaInput.encabezados
            : [...new Set(objetos.flatMap((o) => Object.keys(o ?? {})))];
          matriz = [claves, ...objetos.map((o) => claves.map((k) => (o ?? {})[k]))];
        }
        const encabezados = (matriz[0] ?? []).map((c) => String(c ?? ""));
        const nCols = Math.max(1, ...matriz.map((f) => f.length));

        // Resolución de columnas (por texto del encabezado o por índice, desde 0).
        const reglas = new Map<number, ColumnaInput>();
        for (const c of hojaInput.columnas ?? []) {
          const idx = typeof c.columna === "number" ? c.columna : encabezados.indexOf(String(c.columna));
          if (idx >= 0 && idx < nCols) reglas.set(idx, c);
        }

        matriz.forEach((fila, i) => {
          const valores = Array.from({ length: nCols }, (_, c) => {
            const v = fila[c];
            if (v === null || v === undefined) return null;
            if (i > 0) {
              const formato = reglas.get(c)?.formato;
              if (formato && ES_FECHA.has(formato)) return aFecha(v) ?? v;
            }
            if (v instanceof Date || typeof v === "number" || typeof v === "boolean") return v;
            if (typeof v === "object") return JSON.stringify(v);
            return String(v); // texto: nunca fórmula
          });
          hoja.addRow(valores as any);
        });

        // Anchos: los de `columnas`, o ajustados al contenido (con tope).
        for (let c = 0; c < nCols; c++) {
          const regla = reglas.get(c);
          let ancho = regla?.ancho;
          if (!ancho) {
            let max = 6;
            for (const f of matriz) {
              const v = f[c];
              const largo = largoVisible(v, regla?.formato);
              if (largo > max) max = largo;
            }
            ancho = Math.min(60, Math.ceil(max * (regla?.negrita ? 1.15 : 1.05)) + 3);
          }
          hoja.getColumn(c + 1).width = ancho;
        }

        // Estilo por columna (celdas de datos).
        for (const [idx, r] of reglas) {
          const formato = r.formato ? (FORMATOS[r.formato] ?? r.formato) : undefined;
          for (let f = 2; f <= matriz.length; f++) {
            const celda = hoja.getCell(f, idx + 1);
            if (formato) celda.numFmt = formato;
            const color = hexValido(r.color);
            if (r.negrita || color) celda.font = { name: "Calibri", size: 11, bold: r.negrita, color: color ? { argb: `FF${color}` } : undefined };
            const fondo = hexValido(r.relleno);
            if (fondo) celda.fill = relleno(fondo);
            const al = alineacionExcel(r.alineacion);
            if (al || r.ajustar) celda.alignment = { horizontal: al, wrapText: r.ajustar, vertical: r.ajustar ? "top" : undefined };
          }
        }

        // Encabezado: con estilo por defecto (el usuario puede cambiarlo).
        const eh = hojaInput.estilo_encabezado ?? {};
        const ehFondo = hexValido(eh.relleno) ?? "1E293B";
        const ehColor = hexValido(eh.color) ?? "FFFFFF";
        const fila1 = hoja.getRow(1);
        fila1.height = 22;
        for (let c = 1; c <= nCols; c++) {
          const celda = fila1.getCell(c);
          celda.font = { name: "Calibri", size: 11, bold: eh.negrita !== false, color: { argb: `FF${ehColor}` } };
          celda.fill = relleno(ehFondo);
          celda.alignment = { horizontal: alineacionExcel(eh.alineacion) ?? alineacionExcel(reglas.get(c - 1)?.alineacion) ?? "left", vertical: "middle", wrapText: true };
        }
        // Bordes finos en toda la tabla, para que se lea como tabla.
        for (let f = 1; f <= matriz.length; f++) {
          for (let c = 1; c <= nCols; c++) {
            const lado = { style: "thin" as const, color: { argb: "FFCBD5E1" } };
            hoja.getCell(f, c).border = { top: lado, left: lado, bottom: lado, right: lado };
          }
        }

        if (hojaInput.congelar_encabezado !== false && matriz.length > 1) {
          hoja.views = [{ state: "frozen", ySplit: 1 }];
        }
        if (hojaInput.autofiltro !== false && matriz.length > 1) {
          hoja.autoFilter = { from: "A1", to: `${letraDeColumna(nCols)}1` };
        }

        totalFilas += Math.max(0, matriz.length - 1);
      }

      const rutaAbsoluta = path.resolve(ruta);
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) fs.mkdirSync(dirDestino, { recursive: true });

      const buffer = Buffer.from(await libro.xlsx.writeBuffer());
      fs.writeFileSync(rutaAbsoluta, buffer);

      log.info(`XLSX generado: ${rutaAbsoluta} (${hojasInput.length} hojas, ${totalFilas} filas)`);

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
