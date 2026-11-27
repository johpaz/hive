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
import { ajustarCm, cargarImagen } from "./office-imagen.ts";

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
      anadir_imagenes: {
        type: "array",
        description: "Imágenes a poner en diapositivas existentes: [{diapositiva (1-indexed), artifact_id | ruta, ancho (cm, default 12), x e y (cm desde la esquina superior izquierda; sin ellos se centra)}]. artifact_id es el que devolvió image_generate. PNG, JPEG o GIF.",
        items: { type: "object" },
      },
      incluir_notas: { type: "boolean", description: "Aplicar también a las notas del orador (default: false)" },
      guardar_como: { type: "string", description: "Ruta de salida (default: <nombre>_corregido.pptx junto al original)" },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const entrada = await resolveOfficeInput(params);
    if ("error" in entrada) return { ok: false, error: entrada.error };
    const reemplazos = (Array.isArray(params.reemplazos) ? params.reemplazos : []) as Reemplazo[];
    const imagenesPedidas = (Array.isArray(params.anadir_imagenes) ? params.anadir_imagenes : []) as Array<Record<string, unknown>>;
    if (reemplazos.length === 0 && imagenesPedidas.length === 0) return { ok: false, error: "Indica 'reemplazos' y/o 'anadir_imagenes'." };
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

      // ─── Imágenes en diapositivas existentes ───
      let imagenesAnadidas = 0;
      const imagenesFallidas: string[] = [];
      if (imagenesPedidas.length) {
        const tamano = /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(await zip.file("ppt/presentation.xml")!.async("string"));
        const slideW = tamano ? Number(tamano[1]) : 9144000, slideH = tamano ? Number(tamano[2]) : 5143500;
        const EMU = 360000;
        const tiposArchivo = zip.file("[Content_Types].xml");
        let tipos = tiposArchivo ? await tiposArchivo.async("string") : "";
        for (const ref of imagenesPedidas.slice(0, 20)) {
          const cargada = cargarImagen(ref, config);
          if ("error" in cargada) { imagenesFallidas.push(cargada.error); continue; }
          const img = cargada.imagen;
          const numero = Number(ref.diapositiva ?? 1);
          const slide = slides.find((x) => x.numero === numero);
          if (!slide) { imagenesFallidas.push(`${img.origen}: no existe la diapositiva ${numero}.`); continue; }
          const n = ++imagenesAnadidas;
          const ext = img.tipo === "jpg" ? "jpeg" : img.tipo;
          const archivoMedia = `hive_img_${Date.now().toString(36)}_${n}.${ext}`;
          const rId = `rIdHive${Date.now().toString(36)}${n}`;
          zip.file(`ppt/media/${archivoMedia}`, img.bytes);
          const relsRuta = slide.archivo.replace(/slides\/([^/]+)$/, "slides/_rels/$1.rels");
          const relsEntrada = zip.file(relsRuta);
          const rels = relsEntrada ? await relsEntrada.async("string") : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
          zip.file(relsRuta, rels.replace("</Relationships>", `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${archivoMedia}"/></Relationships>`));
          if (!new RegExp(`<Default[^>]*Extension="${ext}"`, "i").test(tipos)) tipos = tipos.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="image/${ext}"/>`);
          const ancho = Number(ref.ancho ?? ref.width);
          const cm = ajustarCm(img, Number.isFinite(ancho) && ancho > 0 ? ancho : 12, slideW / EMU, slideH / EMU);
          const cx = Math.round(cm.w * EMU), cy = Math.round(cm.h * EMU);
          const x = Number.isFinite(Number(ref.x)) && ref.x !== undefined ? Math.round(Number(ref.x) * EMU) : Math.round((slideW - cx) / 2);
          const y = Number.isFinite(Number(ref.y)) && ref.y !== undefined ? Math.round(Number(ref.y) * EMU) : Math.round((slideH - cy) / 2);
          const xmlSlide = await zip.file(slide.archivo)!.async("string");
          const ids = [...xmlSlide.matchAll(/<p:cNvPr[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
          const idForma = Math.max(1, ...ids) + 1;
          const alt = String(ref.alt ?? ref.pie ?? "Imagen").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
          const pic = `<p:pic><p:nvPicPr><p:cNvPr id="${idForma}" name="Imagen ${idForma}" descr="${alt}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
            `<p:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
            `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
          zip.file(slide.archivo, xmlSlide.replace("</p:spTree>", `${pic}</p:spTree>`));
        }
        if (tiposArchivo) zip.file("[Content_Types].xml", tipos);
      }

      const resumen = reemplazos.map((r, i) => ({ buscar: r.buscar, diapositiva: r.diapositiva, apariciones: conteo[i] }));
      if (reemplazos.length > 0 && conteo.every((c) => c === 0) && imagenesAnadidas === 0) {
        return { ok: false, error: "Ninguno de los textos a buscar aparece en las diapositivas indicadas.", resumen };
      }

      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      log.info(`PPTX editado → ${destino}`);
      return {
        ok: true,
        ruta: destino,
        reemplazos: resumen,
        imagenes_anadidas: imagenesAnadidas,
        ...(imagenesFallidas.length ? { aviso_imagenes: imagenesFallidas.join(" | ") } : {}),
        nota: "Solo se edita texto existente y se añaden imágenes (no se añaden ni quitan diapositivas). Envíalo con send_file.",
      };
    } catch (error) {
      return { ok: false, error: `No se pudo editar el PowerPoint: ${(error as Error).message}` };
    }
  },
};
