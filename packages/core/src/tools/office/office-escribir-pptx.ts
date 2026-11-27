/**
 * office_escribir_pptx - Generar un archivo PowerPoint (.pptx) con estilos
 *
 * Mismo modelo que `office_write_pptx` del SDK de Rust: portada opcional, una
 * diapositiva por entrada con título y texto libre o viñetas, notas del
 * presentador y un tema (modern, light, dark, corporate, warm) cuyos colores y
 * fuentes se pueden sobreescribir.
 *
 * @category office
 * @seedId office_escribir_pptx
 * @spanish crear powerpoint, generar pptx, escribir presentacion, exportar a pptx
 */

import { resolveInWorkspace, getWorkspace } from "../filesystem/workspace-guard.ts";
import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as path from "node:path";
import * as fs from "node:fs";
import { resolverPaleta } from "./office-style";
import { cargarImagen } from "./office-imagen.ts";

const log = logger.child("office-escribir-pptx");

interface DiapositivaInput {
  titulo?: string;
  contenido?: string;
  puntos?: string[];
  notas?: string;
  /** {artifact_id | ruta, pie}. Con texto va a la derecha; sin texto ocupa el área de contenido. */
  imagen?: Record<string, unknown> | string;
}

export const officeEscribirPptxTool: Tool = {
  name: "office_escribir_pptx",
  description:
    "Generar una presentación PowerPoint (.pptx) 16:9 con estilo: portada opcional con fondo propio, diapositivas con título, acento de color, texto libre o viñetas, número de diapositiva y notas del presentador. `tema.preset` elige modern, light, dark, corporate o warm y puede sobreescribir colores y fuentes. Spanish: crear powerpoint, generar pptx, escribir presentacion, exportar a pptx, diapositivas, slides",
  parameters: {
    type: "object",
    properties: {
      ruta: { type: "string", description: "Ruta donde guardar el archivo .pptx generado" },
      titulo_presentacion: { type: "string", description: "Título de la presentación (portada)" },
      subtitulo_presentacion: { type: "string", description: "Subtítulo de la portada (autor, fecha, empresa…)" },
      tema: {
        type: "object",
        description: "{preset: modern|light|dark|corporate|warm, colores: {fondo, titulo, texto, acento, acento2, portada_fondo, portada_texto} (hex de 6 dígitos), fuentes: {titulo, cuerpo} (nombre de tipografía)}",
      },
      diapositivas: {
        type: "array",
        description:
          "Diapositivas. Cada una: titulo (string), contenido (texto libre), puntos (string[] viñetas; tienen prioridad sobre contenido), notas (notas del presentador)",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            contenido: { type: "string" },
            puntos: { type: "array", items: { type: "string" } },
            notas: { type: "string" },
            imagen: { type: "object", description: "Imagen de la diapositiva: {artifact_id | ruta, pie}. artifact_id es el que devolvió image_generate. Con texto/puntos queda a la derecha; sola ocupa todo el espacio. PNG, JPEG o GIF." },
          },
        },
      },
    },
    required: ["ruta", "diapositivas"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const ruta = params.ruta as string;
    const tituloPresentacion = params.titulo_presentacion as string | undefined;
    const subtitulo = params.subtitulo_presentacion as string | undefined;
    const diapositivasInput = params.diapositivas as DiapositivaInput[];

    log.debug(`Generando PPTX: ${ruta}`);

    try {
      if (!Array.isArray(diapositivasInput)) {
        return { ok: false, error: "`diapositivas` debe ser un array." };
      }
      const paleta = resolverPaleta(params.tema);
      const pptxgen = (await import("pptxgenjs")).default;
      const pres = new pptxgen();
      pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
      if (tituloPresentacion) pres.title = tituloPresentacion;
      pres.author = "Hive Agent";

      const imagenesFallidas: string[] = [];
      let imagenesInsertadas = 0;
      const ANCHO = 10;
      const ALTO = 5.625;

      // ─── Portada ────────────────────────────────────────────────────────
      if (tituloPresentacion) {
        const s = pres.addSlide();
        s.background = { color: paleta.portadaFondo };
        s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: ALTO, fill: { color: paleta.acento }, line: { color: paleta.acento, width: 0 } });
        s.addText(tituloPresentacion, {
          x: 0.9, y: 1.5, w: 8.2, h: 1.7,
          fontFace: paleta.fuenteTitulo, fontSize: tituloPresentacion.length > 60 ? 32 : 42, bold: true,
          color: paleta.portadaTexto, align: "left", valign: "bottom", fit: "shrink",
        });
        s.addShape(pres.ShapeType.rect, { x: 0.9, y: 3.4, w: 1.2, h: 0.06, fill: { color: paleta.acento2 }, line: { color: paleta.acento2, width: 0 } });
        if (subtitulo) {
          s.addText(subtitulo, {
            x: 0.9, y: 3.6, w: 8.2, h: 1.0,
            fontFace: paleta.fuenteCuerpo, fontSize: 20, color: paleta.portadaTexto,
            align: "left", valign: "top", fit: "shrink",
          });
        }
      }

      // ─── Diapositivas de contenido ──────────────────────────────────────
      for (const d of diapositivasInput) {
        const s = pres.addSlide();
        s.background = { color: paleta.fondo };
        s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: ALTO, fill: { color: paleta.acento }, line: { color: paleta.acento, width: 0 } });

        if (d.titulo) {
          s.addText(d.titulo, {
            x: 0.6, y: 0.35, w: ANCHO - 1.2, h: 0.9,
            fontFace: paleta.fuenteTitulo, fontSize: d.titulo.length > 55 ? 24 : 30, bold: true,
            color: paleta.titulo, align: "left", valign: "middle", fit: "shrink",
          });
          s.addShape(pres.ShapeType.rect, { x: 0.6, y: 1.28, w: 0.9, h: 0.06, fill: { color: paleta.acento2 }, line: { color: paleta.acento2, width: 0 } });
        }

        const y = d.titulo ? 1.6 : 0.6;
        const h = ALTO - y - 0.6;

        // Con imagen y texto, el texto se queda a la izquierda y la imagen ocupa la derecha.
        let anchoTexto = ANCHO - 1.2;
        if (d.imagen) {
          const cargada = cargarImagen(d.imagen, config);
          if ("error" in cargada) {
            imagenesFallidas.push(cargada.error);
          } else {
            const img = cargada.imagen;
            const hayTexto = !!((d.puntos && d.puntos.length) || d.contenido);
            const pie = typeof d.imagen === "object" ? (d.imagen.pie ?? d.imagen.caption) as string | undefined : undefined;
            const caja = hayTexto
              ? { x: 5.5, y, w: ANCHO - 5.5 - 0.5, h: h - (pie ? 0.35 : 0) }
              : { x: 0.6, y, w: ANCHO - 1.2, h: h - (pie ? 0.35 : 0) };
            if (hayTexto) anchoTexto = 4.6;
            // Se escala a la caja conservando la proporción y se centra en ella.
            const k = Math.min(caja.w / img.ancho, caja.h / img.alto);
            const w = img.ancho * k, hh = img.alto * k;
            const ix = caja.x + (caja.w - w) / 2, iy = caja.y + (caja.h - hh) / 2;
            s.addImage({ data: `image/${img.tipo === "jpg" ? "jpeg" : img.tipo};base64,${img.bytes.toString("base64")}`, x: ix, y: iy, w, h: hh, altText: pie ?? d.titulo ?? "Imagen" });
            if (pie) {
              s.addText(pie, { x: caja.x, y: caja.y + caja.h + 0.03, w: caja.w, h: 0.3, fontFace: paleta.fuenteCuerpo, fontSize: 11, italic: true, color: paleta.texto, align: "center", fit: "shrink" });
            }
            imagenesInsertadas++;
          }
        }

        if (d.puntos && d.puntos.length > 0) {
          const largoTotal = d.puntos.reduce((a, p) => a + p.length, 0);
          const tam = d.puntos.length > 7 || largoTotal > 520 ? 15 : d.puntos.length > 5 || largoTotal > 360 ? 17 : 20;
          s.addText(
            d.puntos.map((punto) => ({
              text: punto,
              options: { bullet: { indent: 20 }, breakLine: true, paraSpaceAfter: 8 },
            })),
            {
              x: 0.6, y, w: anchoTexto, h,
              fontFace: paleta.fuenteCuerpo, fontSize: tam, color: paleta.texto,
              valign: "top", fit: "shrink",
            },
          );
        } else if (d.contenido) {
          s.addText(d.contenido, {
            x: 0.6, y, w: anchoTexto, h,
            fontFace: paleta.fuenteCuerpo, fontSize: d.contenido.length > 600 ? 15 : d.contenido.length > 350 ? 17 : 20,
            color: paleta.texto, valign: "top", paraSpaceAfter: 8, fit: "shrink",
          });
        }

        if (tituloPresentacion) {
          s.addText(tituloPresentacion, {
            x: 0.6, y: ALTO - 0.45, w: 6, h: 0.3,
            fontFace: paleta.fuenteCuerpo, fontSize: 10, color: paleta.texto, transparency: 40, align: "left",
          });
        }
        s.slideNumber = { x: ANCHO - 1.0, y: ALTO - 0.45, w: 0.6, h: 0.3, fontFace: paleta.fuenteCuerpo, fontSize: 10, color: paleta.acento, align: "right", bold: true };

        if (d.notas) s.addNotes(d.notas);
      }

      const rutaAbsoluta = path.resolve(resolveInWorkspace(ruta, getWorkspace(config)));
      const dirDestino = path.dirname(rutaAbsoluta);
      if (!fs.existsSync(dirDestino)) fs.mkdirSync(dirDestino, { recursive: true });

      await pres.writeFile({ fileName: rutaAbsoluta });
      const stats = fs.statSync(rutaAbsoluta);

      log.info(`PPTX generado: ${rutaAbsoluta} (${diapositivasInput.length} diapositivas)`);

      return {
        ok: true,
        ruta: rutaAbsoluta,
        totalDiapositivas: diapositivasInput.length + (tituloPresentacion ? 1 : 0),
        bytesEscritos: stats.size,
        imagenes: imagenesInsertadas,
        ...(imagenesFallidas.length ? { aviso: `Imágenes omitidas: ${imagenesFallidas.join(" | ")}` } : {}),
      };
    } catch (error) {
      log.error(`Error generando PPTX: ${(error as Error).message}`);
      return {
        ok: false,
        error: `No se pudo generar el archivo PowerPoint: ${(error as Error).message}`,
      };
    }
  },
};
