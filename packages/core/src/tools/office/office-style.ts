/**
 * Estilos y bloques compartidos por las herramientas office_escribir_*.
 *
 * Espeja el SDK de Rust (hiveSDK-Rust/crates/hive-core/src/tools/office): mismos
 * temas, mismos colores y la misma forma de describir el contenido en bloques.
 * Los parámetros antiguos (`parrafos`, `tablas`, `contenido`) se siguen aceptando
 * y se convierten a bloques, así que las tareas y agentes existentes no se rompen.
 */

export type Familia = "sans" | "serif" | "mono";

export interface TemaDocumento {
  fuenteCuerpo: Familia;
  fuenteTitulos: Familia;
  texto: string;
  titulo: string;
  acento: string;
  atenuado: string;
  encabezadoTablaFondo: string;
  encabezadoTablaTexto: string;
  bordeTabla: string;
  cebra: string;
  codigoFondo: string;
}

const HEX = /^[0-9A-Fa-f]{6}$/;

/** Mismas paletas que `pdf_write.rs::theme_from`. */
const TEMAS_DOCUMENTO: Record<string, TemaDocumento> = {
  modern: {
    fuenteCuerpo: "sans", fuenteTitulos: "sans",
    texto: "1E293B", titulo: "0F172A", acento: "2563EB", atenuado: "64748B",
    encabezadoTablaFondo: "0F172A", encabezadoTablaTexto: "FFFFFF",
    bordeTabla: "CBD5E1", cebra: "F1F5F9", codigoFondo: "F1F5F9",
  },
  classic: {
    fuenteCuerpo: "serif", fuenteTitulos: "serif",
    texto: "111111", titulo: "000000", acento: "7F1D1D", atenuado: "555555",
    encabezadoTablaFondo: "E5E5E5", encabezadoTablaTexto: "000000",
    bordeTabla: "999999", cebra: "F5F5F5", codigoFondo: "F3F3F3",
  },
  corporate: {
    fuenteCuerpo: "sans", fuenteTitulos: "serif",
    texto: "374151", titulo: "1E3A5F", acento: "B8923A", atenuado: "6B7280",
    encabezadoTablaFondo: "1E3A5F", encabezadoTablaTexto: "FFFFFF",
    bordeTabla: "D1D5DB", cebra: "F3F4F6", codigoFondo: "F3F4F6",
  },
  minimal: {
    fuenteCuerpo: "sans", fuenteTitulos: "sans",
    texto: "222222", titulo: "000000", acento: "444444", atenuado: "777777",
    encabezadoTablaFondo: "FFFFFF", encabezadoTablaTexto: "000000",
    bordeTabla: "DDDDDD", cebra: "FAFAFA", codigoFondo: "F5F5F5",
  },
};

const CLAVES_COLOR: Record<string, keyof TemaDocumento> = {
  text: "texto", texto: "texto",
  heading: "titulo", titulo: "titulo",
  accent: "acento", acento: "acento",
  muted: "atenuado", atenuado: "atenuado",
  table_header_background: "encabezadoTablaFondo", encabezado_tabla_fondo: "encabezadoTablaFondo",
  table_header_text: "encabezadoTablaTexto", encabezado_tabla_texto: "encabezadoTablaTexto",
  table_border: "bordeTabla", borde_tabla: "bordeTabla",
  zebra: "cebra", cebra: "cebra",
  code_background: "codigoFondo", codigo_fondo: "codigoFondo",
};

export function hexValido(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/^#/, "");
  return HEX.test(limpio) ? limpio.toUpperCase() : null;
}

function familia(valor: unknown, defecto: Familia): Familia {
  return valor === "sans" || valor === "serif" || valor === "mono" ? valor : defecto;
}

/** Tema de documento (PDF/Word): preset + colores y fuentes que el llamador sobreescriba. */
export function resolverTemaDocumento(entrada: unknown): TemaDocumento {
  const t = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, any>;
  const nombre = String(t.preset ?? "modern");
  const base = TEMAS_DOCUMENTO[nombre];
  if (!base) {
    throw new Error(
      `Tema desconocido «${nombre}». Usa: ${Object.keys(TEMAS_DOCUMENTO).join(", ")}.`,
    );
  }
  const tema: TemaDocumento = { ...base };
  const colores = (t.colors ?? t.colores ?? {}) as Record<string, unknown>;
  for (const [clave, valor] of Object.entries(colores)) {
    const destino = CLAVES_COLOR[clave];
    const hex = hexValido(valor);
    if (destino && hex) (tema as any)[destino] = hex;
  }
  const fuentes = (t.fonts ?? t.fuentes ?? {}) as Record<string, unknown>;
  tema.fuenteCuerpo = familia(fuentes.body ?? fuentes.cuerpo, tema.fuenteCuerpo);
  tema.fuenteTitulos = familia(fuentes.heading ?? fuentes.titulos, tema.fuenteTitulos);
  return tema;
}

// ─── Paletas de presentación (pptx.rs::preset) ───────────────────────────────

export interface PaletaPresentacion {
  fondo: string;
  titulo: string;
  texto: string;
  acento: string;
  acento2: string;
  portadaFondo: string;
  portadaTexto: string;
  fuenteTitulo: string;
  fuenteCuerpo: string;
}

const PALETAS: Record<string, PaletaPresentacion> = {
  modern: { fondo: "F8FAFC", titulo: "0F172A", texto: "334155", acento: "2563EB", acento2: "F59E0B", portadaFondo: "0F172A", portadaTexto: "FFFFFF", fuenteTitulo: "Calibri", fuenteCuerpo: "Calibri" },
  light: { fondo: "FFFFFF", titulo: "1F2937", texto: "4B5563", acento: "0284C7", acento2: "94A3B8", portadaFondo: "0284C7", portadaTexto: "FFFFFF", fuenteTitulo: "Calibri", fuenteCuerpo: "Calibri" },
  dark: { fondo: "111827", titulo: "F9FAFB", texto: "D1D5DB", acento: "22D3EE", acento2: "A78BFA", portadaFondo: "030712", portadaTexto: "F9FAFB", fuenteTitulo: "Calibri", fuenteCuerpo: "Calibri" },
  corporate: { fondo: "FFFFFF", titulo: "1E3A5F", texto: "374151", acento: "1E3A5F", acento2: "B8923A", portadaFondo: "1E3A5F", portadaTexto: "FFFFFF", fuenteTitulo: "Georgia", fuenteCuerpo: "Calibri" },
  warm: { fondo: "FFFBF5", titulo: "7C2D12", texto: "44403C", acento: "EA580C", acento2: "FACC15", portadaFondo: "7C2D12", portadaTexto: "FFF7ED", fuenteTitulo: "Georgia", fuenteCuerpo: "Calibri" },
};

const CLAVES_PALETA: Record<string, keyof PaletaPresentacion> = {
  background: "fondo", fondo: "fondo",
  title: "titulo", titulo: "titulo",
  text: "texto", texto: "texto",
  accent: "acento", acento: "acento",
  accent2: "acento2", acento2: "acento2",
  cover_background: "portadaFondo", portada_fondo: "portadaFondo",
  cover_text: "portadaTexto", portada_texto: "portadaTexto",
};

export function resolverPaleta(entrada: unknown): PaletaPresentacion {
  const t = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, any>;
  const nombre = String(t.preset ?? "modern");
  const base = PALETAS[nombre];
  if (!base) {
    throw new Error(`Tema desconocido «${nombre}». Usa: ${Object.keys(PALETAS).join(", ")}.`);
  }
  const paleta = { ...base };
  const colores = (t.colors ?? t.colores ?? {}) as Record<string, unknown>;
  for (const [clave, valor] of Object.entries(colores)) {
    const destino = CLAVES_PALETA[clave];
    const hex = hexValido(valor);
    if (destino && hex) (paleta as any)[destino] = hex;
  }
  const fuentes = (t.fonts ?? t.fuentes ?? {}) as Record<string, unknown>;
  const nombreFuente = (v: unknown) =>
    typeof v === "string" && /^[A-Za-z0-9 .-]{1,64}$/.test(v) ? v : null;
  paleta.fuenteTitulo = nombreFuente(fuentes.title ?? fuentes.titulo) ?? paleta.fuenteTitulo;
  paleta.fuenteCuerpo = nombreFuente(fuentes.body ?? fuentes.cuerpo) ?? paleta.fuenteCuerpo;
  return paleta;
}

// ─── Bloques de contenido ────────────────────────────────────────────────────

export type Alineacion = "left" | "center" | "right" | "justify";

export interface Tramo {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  size?: number;
  font?: Familia;
  link?: string;
}

export interface ElementoLista {
  text: string;
  items?: ElementoLista[];
}

export interface Celda {
  text: string;
  bold?: boolean;
  color?: string;
  fill?: string;
  align?: Alineacion;
}

export type Bloque =
  | { type: "heading"; level: 1 | 2 | 3; text: string; runs?: Tramo[]; align?: Alineacion; color?: string }
  | { type: "paragraph"; text: string; runs?: Tramo[]; align?: Alineacion; size?: number; bold?: boolean; italic?: boolean; color?: string; indent?: number; spaceAfter?: number }
  | { type: "list"; style: "bullet" | "numbered"; items: ElementoLista[] }
  | { type: "table"; header: boolean; zebra: boolean; columns?: number[]; align?: Alineacion[]; rows: Celda[][] }
  | { type: "quote"; text: string; author?: string }
  | { type: "code"; text: string }
  | { type: "rule" }
  | { type: "spacer"; height: number }
  | { type: "page_break" };

const TIPOS: Record<string, string> = {
  heading: "heading", encabezado: "heading", titulo: "heading", title: "heading",
  title1: "heading", title2: "heading", title3: "heading",
  titulo1: "heading", titulo2: "heading", titulo3: "heading",
  paragraph: "paragraph", parrafo: "paragraph",
  list: "list", lista: "list",
  table: "table", tabla: "table",
  quote: "quote", cita: "quote",
  code: "code", codigo: "code",
  rule: "rule", regla: "rule", linea: "rule",
  spacer: "spacer", espacio: "spacer",
  page_break: "page_break", salto_pagina: "page_break",
};

const ALINEACIONES = new Set(["left", "center", "right", "justify"]);
const ALINEACION_ES: Record<string, Alineacion> = {
  izquierda: "left", centro: "center", centrado: "center", derecha: "right", justificado: "justify",
};

function alineacion(valor: unknown): Alineacion | undefined {
  if (typeof valor !== "string") return undefined;
  if (ALINEACIONES.has(valor)) return valor as Alineacion;
  return ALINEACION_ES[valor];
}

const g = (o: Record<string, any>, ...claves: string[]) => {
  for (const c of claves) if (o[c] !== undefined && o[c] !== null) return o[c];
  return undefined;
};

function tramos(valor: unknown): Tramo[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const salida: Tramo[] = [];
  for (const r of valor) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, any>;
    const text = String(g(o, "text", "texto") ?? "");
    if (!text) continue;
    const link = g(o, "link", "enlace");
    salida.push({
      text,
      bold: g(o, "bold", "negrita") === true,
      italic: g(o, "italic", "cursiva") === true,
      underline: g(o, "underline", "subrayado") === true,
      color: hexValido(g(o, "color")) ?? undefined,
      size: typeof g(o, "size", "tamano", "tamaño") === "number" ? g(o, "size", "tamano", "tamaño") : undefined,
      font: familia(g(o, "font", "fuente"), "sans") === g(o, "font", "fuente") ? g(o, "font", "fuente") : undefined,
      link: typeof link === "string" && /^(https?:|mailto:)/i.test(link) ? link : undefined,
    });
  }
  return salida.length ? salida : undefined;
}

function elementos(valor: unknown): ElementoLista[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((e) => {
    if (typeof e === "string") return { text: e };
    const o = (e ?? {}) as Record<string, any>;
    return {
      text: String(g(o, "text", "texto") ?? ""),
      items: elementos(g(o, "items", "elementos")),
    };
  });
}

function celda(valor: unknown): Celda {
  if (valor === null || valor === undefined) return { text: "" };
  if (typeof valor !== "object") return { text: String(valor) };
  const o = valor as Record<string, any>;
  return {
    text: String(g(o, "text", "texto") ?? ""),
    bold: g(o, "bold", "negrita") === true || undefined,
    color: hexValido(g(o, "color")) ?? undefined,
    fill: hexValido(g(o, "fill", "relleno")) ?? undefined,
    align: alineacion(g(o, "align", "alineacion")),
  };
}

function filas(valor: unknown): Celda[][] {
  if (!Array.isArray(valor)) return [];
  return valor.map((f) => {
    // `{celdas: [...]}` (formato antiguo de Word) o un array de celdas directo.
    const lista = Array.isArray(f) ? f : (f as any)?.celdas ?? (f as any)?.cells ?? [];
    return (lista as unknown[]).map(celda);
  });
}

function normalizarBloque(crudo: unknown): Bloque | null {
  if (!crudo || typeof crudo !== "object") return null;
  const o = crudo as Record<string, any>;
  const tipoCrudo = String(g(o, "type", "tipo") ?? "paragraph").toLowerCase();
  const tipo = TIPOS[tipoCrudo];
  if (!tipo) return null;

  const texto = String(g(o, "text", "texto") ?? "");
  switch (tipo) {
    case "heading": {
      const dePrefijo = /(\d)$/.exec(tipoCrudo)?.[1];
      const nivel = Number(g(o, "level", "nivel") ?? dePrefijo ?? 1);
      return {
        type: "heading",
        level: (nivel >= 3 ? 3 : nivel <= 1 ? 1 : 2) as 1 | 2 | 3,
        text: texto,
        runs: tramos(g(o, "runs", "tramos")),
        align: alineacion(g(o, "align", "alineacion")),
        color: hexValido(g(o, "color")) ?? undefined,
      };
    }
    case "paragraph": {
      const tam = g(o, "size", "tamano", "tamaño");
      return {
        type: "paragraph",
        text: texto,
        runs: tramos(g(o, "runs", "tramos")),
        align: alineacion(g(o, "align", "alineacion")),
        size: typeof tam === "number" ? tam : undefined,
        bold: g(o, "bold", "negrita") === true || undefined,
        italic: g(o, "italic", "cursiva") === true || undefined,
        color: hexValido(g(o, "color")) ?? undefined,
        indent: typeof g(o, "indent", "sangria") === "number" ? g(o, "indent", "sangria") : undefined,
        spaceAfter: typeof g(o, "space_after", "espacio_despues") === "number" ? g(o, "space_after", "espacio_despues") : undefined,
      };
    }
    case "list": {
      const estilo = String(g(o, "style", "estilo") ?? "bullet").toLowerCase();
      return {
        type: "list",
        style: estilo === "numbered" || estilo === "numerada" ? "numbered" : "bullet",
        items: elementos(g(o, "items", "elementos")),
      };
    }
    case "table": {
      const alin = g(o, "align", "alineacion");
      return {
        type: "table",
        header: g(o, "header", "encabezado") !== false,
        zebra: g(o, "zebra", "cebra") !== false,
        columns: Array.isArray(g(o, "columns", "columnas"))
          ? (g(o, "columns", "columnas") as unknown[]).map(Number).filter((n) => n > 0)
          : undefined,
        align: Array.isArray(alin) ? alin.map((a) => alineacion(a) ?? "left") : undefined,
        rows: filas(g(o, "rows", "filas")),
      };
    }
    case "quote":
      return { type: "quote", text: texto, author: g(o, "author", "autor") };
    case "code":
      return { type: "code", text: texto };
    case "rule":
      return { type: "rule" };
    case "spacer":
      return { type: "spacer", height: Number(g(o, "height", "alto") ?? 12) };
    case "page_break":
      return { type: "page_break" };
  }
  return null;
}

/**
 * Texto plano → bloques. Reconoce `#`/`##`/`###`, viñetas (`-`, `*`, `•`),
 * listas numeradas (`1.`), citas (`>`), reglas (`---`) y tablas con `|`; las
 * líneas seguidas forman un párrafo y la línea en blanco los separa.
 */
export function textoABloques(texto: string): Bloque[] {
  const bloques: Bloque[] = [];
  let parrafo: string[] = [];
  let lista: { style: "bullet" | "numbered"; items: ElementoLista[] } | null = null;
  let tabla: string[][] | null = null;

  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push({ type: "paragraph", text: parrafo.join(" ") });
    parrafo = [];
  };
  const cerrarLista = () => {
    if (lista) bloques.push({ type: "list", style: lista.style, items: lista.items });
    lista = null;
  };
  const cerrarTabla = () => {
    if (tabla && tabla.length) {
      bloques.push({ type: "table", header: true, zebra: true, rows: tabla.map((f) => f.map((t) => ({ text: t }))) });
    }
    tabla = null;
  };
  const cerrarTodo = () => { cerrarParrafo(); cerrarLista(); cerrarTabla(); };

  for (const bruta of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const linea = bruta.trimEnd();
    const t = linea.trim();
    if (!t) { cerrarTodo(); continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) { cerrarTodo(); bloques.push({ type: "heading", level: h[1]!.length as 1 | 2 | 3, text: h[2]! }); continue; }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) { cerrarTodo(); bloques.push({ type: "rule" }); continue; }
    if (t.startsWith(">")) { cerrarTodo(); bloques.push({ type: "quote", text: t.replace(/^>\s?/, "") }); continue; }

    if (t.startsWith("|") && t.endsWith("|")) {
      cerrarParrafo(); cerrarLista();
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // separador markdown
      (tabla ??= []).push(t.slice(1, -1).split("|").map((c) => c.trim()));
      continue;
    }
    const b = /^[-*•]\s+(.*)$/.exec(t);
    const n = /^\d+[.)]\s+(.*)$/.exec(t);
    if (b || n) {
      cerrarParrafo(); cerrarTabla();
      const estilo = b ? "bullet" : "numbered";
      if (lista && lista.style !== estilo) cerrarLista();
      (lista ??= { style: estilo, items: [] }).items.push({ text: (b ?? n)![1]! });
      continue;
    }
    cerrarLista(); cerrarTabla();
    parrafo.push(t);
  }
  cerrarTodo();
  return bloques;
}

/**
 * Bloques de una llamada: `bloques`/`blocks` si vienen; si no, se arman a partir
 * de los parámetros antiguos (`parrafos` y `tablas`, y `contenido` en PDF).
 */
export function bloquesDeParametros(params: Record<string, unknown>): Bloque[] {
  const explicitos = (params.bloques ?? params.blocks) as unknown;
  if (Array.isArray(explicitos)) {
    return explicitos.map(normalizarBloque).filter((b): b is Bloque => b !== null);
  }
  const salida: Bloque[] = [];
  if (typeof params.contenido === "string") salida.push(...textoABloques(params.contenido));
  if (Array.isArray(params.parrafos)) {
    // Elementos `lista` consecutivos se agrupan en una sola lista.
    for (const p of params.parrafos) {
      const o = (p ?? {}) as Record<string, any>;
      const ultimo = salida[salida.length - 1];
      if (String(o.tipo ?? o.type ?? "").toLowerCase() === "list" || String(o.tipo ?? o.type ?? "").toLowerCase() === "lista") {
        const item: ElementoLista = { text: String(o.texto ?? o.text ?? "") };
        if (ultimo?.type === "list" && ultimo.style === "bullet") ultimo.items.push(item);
        else salida.push({ type: "list", style: "bullet", items: [item] });
        continue;
      }
      const b = normalizarBloque(p);
      if (b) salida.push(b);
    }
  }
  if (Array.isArray(params.tablas)) {
    for (const t of params.tablas) {
      const b = normalizarBloque({ type: "table", ...(t as object) });
      if (b) salida.push(b);
    }
  }
  return salida;
}

/** Sustituye {page}, {pages} y {title} en el texto de encabezados y pies. */
export function rellenarMarcadores(texto: string, pagina: number, paginas: number, titulo: string): string {
  return texto
    .replace(/\{page\}|\{pagina\}/g, String(pagina))
    .replace(/\{pages\}|\{paginas\}/g, String(paginas))
    .replace(/\{title\}|\{titulo\}/g, titulo);
}
