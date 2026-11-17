/**
 * office_escribir_pdf - Generar un archivo PDF con estilos
 *
 * Mismo modelo que el SDK de Rust (`office_write_pdf`): bloques (títulos, párrafos
 * con tramos, listas, tablas, citas, código, reglas, saltos), temas (modern,
 * classic, corporate, minimal) y encabezado/pie con {page}, {pages} y {title}.
 * Las fuentes son las 14 estándar de PDF, medidas con exactitud, así que el texto
 * salta de línea donde el visor lo dibuja. Los caracteres fuera del alfabeto
 * latino occidental se sustituyen por «?» y se informan en la respuesta.
 *
 * @category office
 * @seedId office_escribir_pdf
 * @spanish crear pdf, generar pdf, escribir pdf, exportar a pdf
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  bloquesDeParametros,
  hexValido,
  resolverTemaDocumento,
  rellenarMarcadores,
  type Alineacion,
  type Bloque,
  type Celda,
  type ElementoLista,
  type Familia,
  type TemaDocumento,
  type Tramo,
} from "./office-style";

const log = logger.child("office-escribir-pdf");

type Variante = "regular" | "bold" | "italic" | "boldItalic";

interface Banda {
  left?: string;
  center?: string;
  right?: string;
  size?: number;
  color?: string;
  rule?: boolean;
}

interface Segmento {
  text: string;
  font: any;
  size: number;
  color: [number, number, number];
  underline: boolean;
  link?: string;
  width: number;
  space: boolean;
}

const rgbDe = (hex: string, rgb: any) =>
  rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );

function banda(valor: unknown): Banda | undefined {
  if (!valor || typeof valor !== "object") return undefined;
  const o = valor as Record<string, any>;
  const texto = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    left: texto(o.left ?? o.izquierda),
    center: texto(o.center ?? o.centro),
    right: texto(o.right ?? o.derecha),
    size: typeof (o.size ?? o.tamano) === "number" ? (o.size ?? o.tamano) : undefined,
    color: hexValido(o.color) ?? undefined,
    rule: o.rule ?? o.linea,
  };
}

export const officeEscribirPdfTool: Tool = {
  name: "office_escribir_pdf",
  description:
    "Generar un PDF con estilo. Da `contenido` (texto; acepta # títulos, - viñetas, 1. listas, > citas, | tablas |, ---) o `bloques`: títulos (nivel 1-3), párrafos (con `tramos` de negrita/cursiva/subrayado/color/tamaño/enlace), listas (viñetas o numeradas, un nivel anidado), tablas (encabezado repetido entre páginas, cebra, alineación y pesos de columna), citas, código, reglas, espacios y saltos de página. `tema.preset` elige modern, classic, corporate o minimal y puede sobreescribir colores y fuentes (sans, serif, mono). `encabezado`/`pie` llevan izquierda/centro/derecha con {page}, {pages} y {title}. Spanish: crear pdf, generar pdf, escribir pdf, exportar a pdf, informe, reporte",
  parameters: {
    type: "object",
    properties: {
      ruta: { type: "string", description: "Ruta donde guardar el archivo .pdf generado" },
      contenido: { type: "string", description: "Texto a escribir. Se interpreta como markdown simple (# títulos, - viñetas, 1. listas, > citas, tablas con |, ---)." },
      titulo: { type: "string", description: "Título del documento: va en los metadatos y como título al inicio" },
      autor: { type: "string", description: "Autor (metadatos)" },
      tamaño_pagina: { type: "string", enum: ["A4", "Letter"], description: "Tamaño de página (default A4)" },
      orientacion: { type: "string", enum: ["vertical", "horizontal"], description: "Orientación (default vertical)" },
      margen: { type: "number", description: "Margen en puntos (default 56)" },
      tamaño_fuente: { type: "number", description: "Tamaño del texto base en puntos (default 11)" },
      interlineado: { type: "number", description: "Interlineado, 1 a 3 (default 1.4)" },
      tema: {
        type: "object",
        description: "{preset: modern|classic|corporate|minimal, colores: {texto, titulo, acento, atenuado, encabezado_tabla_fondo, encabezado_tabla_texto, borde_tabla, cebra, codigo_fondo} (hex de 6 dígitos), fuentes: {cuerpo, titulos} (sans|serif|mono)}",
      },
      encabezado: { type: "object", description: "Banda superior en cada página: {izquierda, centro, derecha, tamano, color, linea}" },
      pie: { type: "object", description: "Banda inferior en cada página: {izquierda, centro, derecha, tamano, color, linea}. Ej: {derecha: 'Página {page} de {pages}'}" },
      bloques: {
        type: "array",
        description: "Contenido en bloques. tipo: titulo(nivel) | parrafo(texto|tramos, alineacion, tamano, negrita, cursiva, color) | lista(estilo vinetas|numerada, elementos: string|{texto, elementos}) | tabla(encabezado, cebra, columnas: pesos, alineacion: [..], filas: [[celda|{texto,negrita,color,relleno,alineacion}]]) | cita(texto, autor) | codigo(texto) | regla | espacio(alto) | salto_pagina",
        items: { type: "object" },
      },
    },
    required: ["ruta"],
  },
  execute: async (params: Record<string, unknown>) => {
    const ruta = params.ruta as string;
    log.debug(`Generando PDF: ${ruta}`);

    try {
      const { PDFDocument, StandardFonts, rgb, PageSizes, PDFName, PDFString } = await import("pdf-lib");

      const tema = resolverTemaDocumento(params.tema);
      const titulo = typeof params.titulo === "string" ? params.titulo : "";
      const bloques = bloquesDeParametros(params);
      if (!titulo && bloques.length === 0) {
        return { ok: false, error: "Falta contenido: da `contenido` o `bloques`." };
      }

      const base = (params.tamaño_fuente ?? params["tamaño_fuente"]) as number | undefined;
      const fs0 = Math.min(72, Math.max(6, typeof base === "number" ? base : 11));
      const interlineado = Math.min(3, Math.max(1, typeof params.interlineado === "number" ? params.interlineado : 1.4));
      const margen = Math.min(200, Math.max(20, typeof params.margen === "number" ? params.margen : 56));
      const tamPagina = (params.tamaño_pagina ?? params["tamaño_pagina"]) === "Letter" ? PageSizes.Letter : PageSizes.A4;
      const horizontal = params.orientacion === "horizontal";
      const [ancho, alto] = horizontal ? [tamPagina[1], tamPagina[0]] : [tamPagina[0], tamPagina[1]];

      const pdf = await PDFDocument.create();
      pdf.setCreator("Hive Agent");
      pdf.setProducer("Hive");
      pdf.setCreationDate(new Date());
      if (titulo) pdf.setTitle(titulo);
      if (typeof params.autor === "string") pdf.setAuthor(params.autor);

      // ─── Fuentes ─────────────────────────────────────────────────────────
      const nombres: Record<Familia, Record<Variante, any>> = {
        sans: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold, italic: StandardFonts.HelveticaOblique, boldItalic: StandardFonts.HelveticaBoldOblique },
        serif: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold, italic: StandardFonts.TimesRomanItalic, boldItalic: StandardFonts.TimesRomanBoldItalic },
        mono: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold, italic: StandardFonts.CourierOblique, boldItalic: StandardFonts.CourierBoldOblique },
      };
      const cacheFuentes = new Map<string, any>();
      const conjuntos = new Map<any, Set<number>>();
      const fuente = async (fam: Familia, v: Variante) => {
        const clave = `${fam}:${v}`;
        let f = cacheFuentes.get(clave);
        if (!f) {
          f = await pdf.embedFont(nombres[fam][v]);
          cacheFuentes.set(clave, f);
          conjuntos.set(f, new Set(f.getCharacterSet()));
        }
        return f;
      };
      // Precarga: el layout es síncrono.
      for (const fam of ["sans", "serif", "mono"] as Familia[]) {
        for (const v of ["regular", "bold", "italic", "boldItalic"] as Variante[]) await fuente(fam, v);
      }
      const pick = (fam: Familia, bold?: boolean, italic?: boolean) =>
        cacheFuentes.get(`${fam}:${bold && italic ? "boldItalic" : bold ? "bold" : italic ? "italic" : "regular"}`);

      let reemplazados = 0;
      const limpiar = (texto: string, f: any) => {
        const set = conjuntos.get(f)!;
        let salida = "";
        for (const ch of texto.replace(/\t/g, "    ").replace(/[\r\n]+/g, " ")) {
          const cp = ch.codePointAt(0)!;
          if (set.has(cp)) salida += ch;
          else if (cp === 0xa0 || cp === 0x202f) salida += " ";
          else if (cp === 0x2011 || cp === 0x2010) salida += "-";
          else if (cp < 32) continue;
          else { salida += "?"; reemplazados++; }
        }
        return salida;
      };

      // ─── Estado de página ────────────────────────────────────────────────
      const izq = margen;
      const anchoUtil = ancho - margen * 2;
      const tope = alto - margen;
      const fondo = margen;
      let pagina = pdf.addPage([ancho, alto]);
      let y = tope;

      const nuevaPagina = () => {
        pagina = pdf.addPage([ancho, alto]);
        y = tope;
      };
      const asegurar = (h: number) => {
        if (y - h < fondo && y < tope) nuevaPagina();
      };

      const color = (hex: string) => rgbDe(hex, rgb);

      // ─── Texto con tramos ────────────────────────────────────────────────
      const tramosASegmentos = (tramos: Tramo[], tamBase: number, colorBase: string, famBase: Familia, negBase?: boolean, itaBase?: boolean): Segmento[] => {
        const segs: Segmento[] = [];
        for (const t of tramos) {
          const fam = t.font ?? famBase;
          const f = pick(fam, t.bold ?? negBase, t.italic ?? itaBase);
          const size = t.size ?? tamBase;
          const c = hexValido(t.color) ?? colorBase;
          const rgbc = [
            parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255,
          ] as [number, number, number];
          for (const trozo of limpiar(t.text, f).split(/( +)/)) {
            if (!trozo) continue;
            segs.push({
              text: trozo, font: f, size, color: rgbc,
              underline: !!t.underline || !!t.link, link: t.link,
              width: f.widthOfTextAtSize(trozo, size), space: trozo.trim() === "",
            });
          }
        }
        return segs;
      };

      const envolver = (segs: Segmento[], anchoMax: number): Segmento[][] => {
        const lineas: Segmento[][] = [];
        let actual: Segmento[] = [];
        let w = 0;
        for (let s of segs) {
          if (s.space) {
            if (!actual.length) continue; // sin espacios al inicio de línea
            actual.push(s); w += s.width; continue;
          }
          // Palabra más ancha que la línea: se parte por caracteres.
          while (s.width > anchoMax) {
            const hueco = anchoMax - w;
            let n = s.text.length;
            while (n > 0 && s.font.widthOfTextAtSize(s.text.slice(0, n), s.size) > hueco) n--;
            if (n === 0) {
              if (actual.length) { lineas.push(quitarEspacioFinal(actual)); actual = []; w = 0; continue; }
              n = 1;
            }
            actual.push({ ...s, text: s.text.slice(0, n), width: s.font.widthOfTextAtSize(s.text.slice(0, n), s.size) });
            lineas.push(quitarEspacioFinal(actual)); actual = []; w = 0;
            const resto = s.text.slice(n);
            s = { ...s, text: resto, width: s.font.widthOfTextAtSize(resto, s.size) };
          }
          if (w + s.width > anchoMax && actual.length) {
            lineas.push(quitarEspacioFinal(actual)); actual = []; w = 0;
          }
          actual.push(s); w += s.width;
        }
        if (actual.length) lineas.push(quitarEspacioFinal(actual));
        return lineas.length ? lineas : [[]];
      };
      const quitarEspacioFinal = (l: Segmento[]) => {
        while (l.length && l[l.length - 1]!.space) l.pop();
        return l;
      };
      /** Distancia de la base de la línea al fondo de su caja (centrado óptico + descendente). */
      const lineaBase = (altura: number, tam: number) => (altura - tam) / 2 + tam * 0.2;
      const anchoLinea = (l: Segmento[]) => l.reduce((a, s) => a + s.width, 0);

      const dibujarLinea = (l: Segmento[], x: number, anchoCaja: number, baseY: number, alin: Alineacion, esUltima: boolean) => {
        let total = anchoLinea(l);
        let inicio = x;
        let extra = 0;
        if (alin === "center") inicio = x + (anchoCaja - total) / 2;
        else if (alin === "right") inicio = x + anchoCaja - total;
        else if (alin === "justify" && !esUltima) {
          const espacios = l.filter((s) => s.space).length;
          if (espacios) extra = (anchoCaja - total) / espacios;
        }
        let cx = inicio;
        for (const s of l) {
          const w = s.width + (s.space ? extra : 0);
          if (!s.space) {
            pagina.drawText(s.text, { x: cx, y: baseY, size: s.size, font: s.font, color: rgb(...s.color) });
          }
          if (s.underline && !s.space) {
            pagina.drawLine({ start: { x: cx, y: baseY - s.size * 0.12 }, end: { x: cx + w, y: baseY - s.size * 0.12 }, thickness: Math.max(0.5, s.size / 18), color: rgb(...s.color) });
          }
          if (s.link && !s.space) {
            const ref = pdf.context.register(pdf.context.obj({
              Type: "Annot", Subtype: "Link", Rect: [cx, baseY - s.size * 0.2, cx + w, baseY + s.size * 0.85], Border: [0, 0, 0],
              A: { Type: "Action", S: "URI", URI: PDFString.of(s.link) },
            }));
            const annots = pagina.node.Annots();
            if (annots) annots.push(ref);
            else pagina.node.set(PDFName.of("Annots"), pdf.context.obj([ref]));
          }
          cx += w;
        }
      };

      /** Dibuja un texto con salto de página entre líneas. Devuelve la altura usada. */
      const parrafo = (segs: Segmento[], x: number, anchoCaja: number, alin: Alineacion) => {
        const lineas = envolver(segs, anchoCaja);
        const tam = Math.max(...segs.map((s) => s.size), fs0);
        const alturaLinea = tam * interlineado;
        lineas.forEach((l, i) => {
          asegurar(alturaLinea);
          y -= alturaLinea;
          dibujarLinea(l, x, anchoCaja, y + lineaBase(alturaLinea, tam), alin, i === lineas.length - 1);
        });
      };

      const tramosDe = (b: { text: string; runs?: Tramo[] }): Tramo[] =>
        b.runs && b.runs.length ? b.runs : [{ text: b.text }];

      // ─── Bloques ─────────────────────────────────────────────────────────
      const escalaTitulo = { 1: 1.9, 2: 1.45, 3: 1.2 } as const;

      const dibujarTitulo = (texto: string, nivel: 1 | 2 | 3, alin: Alineacion = "left", colorTitulo?: string) => {
        const size = fs0 * escalaTitulo[nivel];
        const segs = tramosASegmentos([{ text: texto, bold: true }], size, colorTitulo ?? tema.titulo, tema.fuenteTitulos);
        const lineas = envolver(segs, anchoUtil);
        const h = lineas.length * size * 1.25;
        asegurar(h + size * 1.4); // un título no se queda solo al final de la página
        y -= size * (nivel === 1 ? 0.5 : 0.8);
        lineas.forEach((l) => {
          y -= size * 1.25;
          dibujarLinea(l, izq, anchoUtil, y + size * 0.25, alin, true);
        });
        if (nivel === 1) {
          y -= 4;
          pagina.drawLine({ start: { x: izq, y }, end: { x: izq + anchoUtil, y }, thickness: 1.2, color: color(tema.acento) });
          y -= fs0 * 0.5;
        } else {
          y -= fs0 * 0.25;
        }
      };

      const dibujarLista = (items: ElementoLista[], estilo: "bullet" | "numbered", nivel: number) => {
        const sangria = 16 + nivel * 18;
        items.forEach((it, i) => {
          const marca = estilo === "numbered" ? `${i + 1}.` : nivel === 0 ? "•" : "-";
          const f = pick(tema.fuenteCuerpo)!;
          const segs = tramosASegmentos([{ text: it.text }], fs0, tema.texto, tema.fuenteCuerpo);
          const lineas = envolver(segs, anchoUtil - sangria - 4);
          const alturaLinea = fs0 * interlineado;
          lineas.forEach((l, k) => {
            asegurar(alturaLinea);
            y -= alturaLinea;
            if (k === 0) {
              pagina.drawText(limpiar(marca, f), { x: izq + sangria - 12 - (estilo === "numbered" ? 4 : 0), y: y + lineaBase(alturaLinea, fs0), size: fs0, font: nivel === 0 && estilo === "bullet" ? pick(tema.fuenteCuerpo, true)! : f, color: color(tema.acento) });
            }
            dibujarLinea(l, izq + sangria, anchoUtil - sangria - 4, y + lineaBase(alturaLinea, fs0), "left", true);
          });
          if (it.items?.length && nivel < 1) dibujarLista(it.items, "bullet", nivel + 1);
        });
      };

      const dibujarTabla = (b: Extract<Bloque, { type: "table" }>) => {
        const nCols = Math.max(1, ...b.rows.map((r) => r.length));
        const pesos = Array.from({ length: nCols }, (_, i) => b.columns?.[i] ?? 1);
        const suma = pesos.reduce((a, c) => a + c, 0);
        const anchos = pesos.map((p) => (p / suma) * anchoUtil);
        const pad = 5;
        const tamCelda = Math.max(6, fs0 - 1);

        const alturaFila = (fila: Celda[], esEnc: boolean) => {
          let max = 1;
          fila.forEach((c, i) => {
            const segs = tramosASegmentos([{ text: c.text, bold: esEnc || c.bold }], tamCelda, tema.texto, tema.fuenteCuerpo);
            max = Math.max(max, envolver(segs, anchos[i]! - pad * 2).length);
          });
          return max * tamCelda * 1.3 + pad * 2;
        };

        const dibujarFila = (fila: Celda[], esEnc: boolean, indice: number) => {
          const h = alturaFila(fila, esEnc);
          const fondoFila = esEnc ? tema.encabezadoTablaFondo : b.zebra && indice % 2 === 1 ? tema.cebra : null;
          let cx = izq;
          for (let i = 0; i < nCols; i++) {
            const c = fila[i] ?? { text: "" };
            const relleno = c.fill ?? fondoFila;
            if (relleno) pagina.drawRectangle({ x: cx, y: y - h, width: anchos[i]!, height: h, color: color(relleno) });
            pagina.drawRectangle({ x: cx, y: y - h, width: anchos[i]!, height: h, borderColor: color(tema.bordeTabla), borderWidth: 0.5 });
            const segs = tramosASegmentos(
              [{ text: c.text, bold: esEnc || c.bold }], tamCelda,
              hexValido(c.color) ?? (esEnc ? tema.encabezadoTablaTexto : tema.texto), tema.fuenteCuerpo,
            );
            const alin = c.align ?? b.align?.[i] ?? "left";
            const lineas = envolver(segs, anchos[i]! - pad * 2);
            lineas.forEach((l, k) => {
              dibujarLinea(l, cx + pad, anchos[i]! - pad * 2, y - pad - tamCelda * 1.3 * (k + 1) + tamCelda * 0.38, alin, true);
            });
            cx += anchos[i]!;
          }
          y -= h;
        };

        const encabezado = b.header && b.rows.length > 1 ? b.rows[0]! : null;
        const cuerpo = encabezado ? b.rows.slice(1) : b.rows;
        y -= fs0 * 0.3;
        if (encabezado) {
          asegurar(alturaFila(encabezado, true) + alturaFila(cuerpo[0] ?? [], false));
          dibujarFila(encabezado, true, 0);
        }
        cuerpo.forEach((fila, i) => {
          const h = alturaFila(fila, false);
          if (y - h < fondo && y < tope) {
            nuevaPagina();
            if (encabezado) dibujarFila(encabezado, true, 0); // encabezado repetido
          }
          dibujarFila(fila, false, i);
        });
        y -= fs0 * 0.8;
      };

      // Título del documento (si lo hay), con una línea de acento.
      if (titulo) {
        const size = fs0 * 2.3;
        const lineas = envolver(tramosASegmentos([{ text: titulo, bold: true }], size, tema.titulo, tema.fuenteTitulos), anchoUtil);
        lineas.forEach((l) => {
          y -= size * 1.2;
          dibujarLinea(l, izq, anchoUtil, y + size * 0.25, "left", true);
        });
        y -= 6;
        pagina.drawRectangle({ x: izq, y: y - 3, width: Math.min(80, anchoUtil), height: 3, color: color(tema.acento) });
        y -= fs0 * 1.6;
      }

      for (const b of bloques) {
        switch (b.type) {
          case "heading":
            dibujarTitulo(b.text, b.level, b.align, b.color);
            break;
          case "paragraph": {
            const size = b.size ?? fs0;
            const segs = tramosASegmentos(tramosDe(b), size, b.color ?? tema.texto, tema.fuenteCuerpo, b.bold, b.italic);
            parrafo(segs, izq + (b.indent ?? 0), anchoUtil - (b.indent ?? 0), b.align ?? "left");
            y -= b.spaceAfter ?? fs0 * 0.6;
            break;
          }
          case "list":
            dibujarLista(b.items, b.style, 0);
            y -= fs0 * 0.6;
            break;
          case "table":
            dibujarTabla(b);
            break;
          case "quote": {
            const segs = tramosASegmentos([{ text: b.text, italic: true }], fs0, tema.atenuado, tema.fuenteCuerpo);
            const lineas = envolver(segs, anchoUtil - 22);
            const alturaLinea = fs0 * interlineado;
            const bloqueH = lineas.length * alturaLinea + (b.author ? alturaLinea : 0);
            asegurar(Math.min(bloqueH, alto - margen * 2));
            const arriba = y;
            lineas.forEach((l) => {
              asegurar(alturaLinea);
              y -= alturaLinea;
              dibujarLinea(l, izq + 16, anchoUtil - 22, y + lineaBase(alturaLinea, fs0), "left", true);
            });
            if (b.author) {
              asegurar(alturaLinea);
              y -= alturaLinea;
              dibujarLinea(envolver(tramosASegmentos([{ text: `— ${b.author}` }], fs0 - 1, tema.atenuado, tema.fuenteCuerpo), anchoUtil - 22)[0]!, izq + 16, anchoUtil - 22, y + lineaBase(alturaLinea, fs0), "right", true);
            }
            if (arriba >= y) pagina.drawRectangle({ x: izq + 2, y: y, width: 3, height: Math.max(0, arriba - y), color: color(tema.acento) });
            y -= fs0 * 0.7;
            break;
          }
          case "code": {
            const tam = Math.max(6, fs0 - 1.5);
            const mono = pick("mono")!;
            const lineasCrudas = b.text.replace(/\r\n?/g, "\n").split("\n");
            const alturaLinea = tam * 1.35;
            const cajaAncho = anchoUtil;
            const maxCaracteres = Math.max(1, Math.floor((cajaAncho - 12) / mono.widthOfTextAtSize("M", tam)));
            const lineas: string[] = [];
            for (const l of lineasCrudas) {
              const limpia = limpiar(l, mono);
              if (limpia.length === 0) lineas.push("");
              for (let i = 0; i < limpia.length; i += maxCaracteres) lineas.push(limpia.slice(i, i + maxCaracteres));
            }
            y -= 4;
            let i = 0;
            while (i < lineas.length) {
              asegurar(alturaLinea + 12);
              const disponibles = Math.max(1, Math.floor((y - fondo - 12) / alturaLinea));
              const trozo = lineas.slice(i, i + disponibles);
              const h = trozo.length * alturaLinea + 10;
              pagina.drawRectangle({ x: izq, y: y - h, width: cajaAncho, height: h, color: color(tema.codigoFondo) });
              pagina.drawRectangle({ x: izq, y: y - h, width: 2.5, height: h, color: color(tema.acento) });
              let cy = y - 5;
              for (const l of trozo) {
                cy -= alturaLinea;
                pagina.drawText(l, { x: izq + 8, y: cy + tam * 0.3, size: tam, font: mono, color: color(tema.texto) });
              }
              y -= h;
              i += trozo.length;
              if (i < lineas.length) nuevaPagina();
            }
            y -= fs0 * 0.8;
            break;
          }
          case "rule":
            asegurar(fs0);
            y -= fs0 * 0.6;
            pagina.drawLine({ start: { x: izq, y }, end: { x: izq + anchoUtil, y }, thickness: 0.75, color: color(tema.bordeTabla) });
            y -= fs0 * 0.6;
            break;
          case "spacer":
            y -= Math.min(400, Math.max(0, b.height));
            if (y < fondo) nuevaPagina();
            break;
          case "page_break":
            nuevaPagina();
            break;
        }
      }

      // ─── Encabezado y pie en todas las páginas ───────────────────────────
      const enc = banda(params.encabezado ?? params.header);
      const pie = banda(params.pie ?? params.footer);
      const paginas = pdf.getPages();
      const fBanda = pick(tema.fuenteCuerpo)!;
      const dibujarBanda = (b: Banda, pg: any, n: number, esPie: boolean) => {
        const size = Math.min(24, Math.max(5, b.size ?? 8));
        const c = color(b.color ?? tema.atenuado);
        const yTexto = esPie ? margen * 0.5 - size * 0.3 : alto - margen * 0.5 - size * 0.3;
        const partes: Array<[string | undefined, "l" | "c" | "r"]> = [[b.left, "l"], [b.center, "c"], [b.right, "r"]];
        for (const [t, pos] of partes) {
          if (!t) continue;
          const texto = limpiar(rellenarMarcadores(t, n, paginas.length, titulo), fBanda);
          const w = fBanda.widthOfTextAtSize(texto, size);
          const x = pos === "l" ? izq : pos === "c" ? izq + (anchoUtil - w) / 2 : izq + anchoUtil - w;
          pg.drawText(texto, { x, y: yTexto, size, font: fBanda, color: c });
        }
        if (b.rule) {
          const yr = esPie ? yTexto + size + 4 : yTexto - 5;
          pg.drawLine({ start: { x: izq, y: yr }, end: { x: izq + anchoUtil, y: yr }, thickness: 0.5, color: color(tema.bordeTabla) });
        }
      };
      paginas.forEach((pg, i) => {
        if (enc) dibujarBanda(enc, pg, i + 1, false);
        if (pie) dibujarBanda(pie, pg, i + 1, true);
      });

      const rutaAbsoluta = path.resolve(ruta);
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) fs.mkdirSync(dirDestino, { recursive: true });

      const pdfBytes = await pdf.save();
      fs.writeFileSync(rutaAbsoluta, pdfBytes);

      log.info(`PDF generado: ${rutaAbsoluta} (${pdf.getPageCount()} páginas)`);

      return {
        ok: true,
        ruta: rutaAbsoluta,
        paginas: pdf.getPageCount(),
        bytesEscritos: pdfBytes.length,
        ...(reemplazados > 0
          ? { caracteresReemplazados: reemplazados, aviso: "Algunos caracteres fuera del alfabeto latino occidental se sustituyeron por «?»." }
          : {}),
      };
    } catch (error) {
      log.error(`Error generando PDF: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo generar el PDF: ${(error as Error).message}`,
      };
    }
  },
};
