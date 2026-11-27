/**
 * office_editar_docx - Modificar un Word existente conservando su formato
 *
 * Trabaja sobre el XML del documento: reemplaza texto aunque Word lo haya
 * partido en varios fragmentos con formato distinto, y deja intactos estilos,
 * tablas, imágenes, encabezados y pie. Opcionalmente añade párrafos al final.
 * Nunca pisa el original: guarda una copia («<nombre>_corregido.docx»).
 *
 * @category office
 * @seedId office_editar_docx
 * @spanish editar word, corregir word, reemplazar texto en docx, mejorar documento word
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveOfficeInput, ARTIFACT_ID_PARAM } from "./resolve-input.ts";
import { ajustarCm, cargarImagen } from "./office-imagen.ts";
import { resolveInWorkspace, getWorkspace } from "../filesystem/workspace-guard.ts";

const log = logger.child("office-editar-docx");

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Reemplaza en un párrafo (XML de <w:p>) todas las apariciones de `buscar`.
 * El texto de un párrafo vive repartido en <w:t>; se une, se localizan las
 * coincidencias y cada una se escribe en el fragmento donde empieza (así hereda
 * su formato) vaciando el resto de fragmentos que cubría.
 */
export function reemplazarEnParrafo(parrafo: string, buscar: string, reemplazar: string, etiqueta: "w:t" | "a:t" = "w:t"): { xml: string; cuenta: number } {
  const re = new RegExp(`(<${etiqueta}(?:\\s[^>]*)?>)([^<]*)(<\\/${etiqueta}>)`, "g");
  const partes: { start: number; end: number; open: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(parrafo))) {
    partes.push({ start: m.index, end: m.index + m[0].length, open: m[1], text: unescapeXml(m[2]) });
  }
  if (partes.length === 0) return { xml: parrafo, cuenta: 0 };
  const textos = partes.map((p) => p.text);
  const completo = textos.join("");
  if (!buscar || !completo.includes(buscar)) return { xml: parrafo, cuenta: 0 };

  // Offset de inicio de cada fragmento dentro del texto completo.
  const offsets: number[] = [];
  let acc = 0;
  for (const t of textos) { offsets.push(acc); acc += t.length; }

  let cuenta = 0;
  let desde = 0;
  const nuevos = [...textos];
  // Se procesa de derecha a izquierda para no invalidar offsets.
  const coincidencias: number[] = [];
  while (true) {
    const i = completo.indexOf(buscar, desde);
    if (i === -1) break;
    coincidencias.push(i);
    desde = i + buscar.length;
  }
  for (const inicio of coincidencias.reverse()) {
    const fin = inicio + buscar.length;
    let primero = true;
    for (let k = 0; k < partes.length; k++) {
      const ini = offsets[k], finK = offsets[k] + textos[k].length;
      if (finK <= inicio || ini >= fin) continue;
      const localIni = Math.max(inicio, ini) - ini;
      const localFin = Math.min(fin, finK) - ini;
      const t = nuevos[k];
      nuevos[k] = t.slice(0, localIni) + (primero ? reemplazar : "") + t.slice(localFin);
      primero = false;
    }
    cuenta++;
  }
  // Reconstruir el párrafo de derecha a izquierda con los textos nuevos.
  let xml = parrafo;
  for (let k = partes.length - 1; k >= 0; k--) {
    const p = partes[k];
    let open = p.open;
    if (etiqueta === "w:t" && nuevos[k] !== textos[k] && !/xml:space/.test(open)) open = open.replace(/>$/, ' xml:space="preserve">');
    xml = xml.slice(0, p.start) + open + escapeXml(nuevos[k]) + `</${etiqueta}>` + xml.slice(p.end);
  }
  return { xml, cuenta };
}

const EMU_POR_CM = 360000;

/** XML de un párrafo con la imagen en línea (<w:drawing>) que apunta a la relación `rId`. */
function parrafoConImagen(rId: string, n: number, w: number, h: number, alin: string, alt: string): string {
  const cx = Math.round(w * EMU_POR_CM), cy = Math.round(h * EMU_POR_CM);
  const jc = alin === "left" ? "left" : alin === "right" ? "right" : "center";
  const nombre = escapeXml(alt).replace(/"/g, "&quot;");
  return `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${9000 + n}" name="Imagen ${n}" descr="${nombre}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${9000 + n}" name="Imagen ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const parrafoPie = (t: string, alin: string) =>
  `<w:p><w:pPr><w:jc w:val="${alin === "left" ? "left" : alin === "right" ? "right" : "center"}"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`;

export const officeEditarDocxTool: Tool = {
  name: "office_editar_docx",
  description:
    "Editar un Word (.docx) existente: reemplazar texto y/o añadir párrafos al final, conservando estilos, tablas e imágenes. Guarda una copia (no pisa el original) y devuelve su ruta para enviarla con send_file. Spanish: editar word, corregir word, reemplazar texto en docx, mejorar documento",
  parameters: {
    type: "object",
    properties: {
      ruta: { type: "string", description: "Ruta del .docx a editar" },
      artifact_id: ARTIFACT_ID_PARAM,
      reemplazos: {
        type: "array",
        description: "Pares buscar → reemplazar (todas las apariciones, en el cuerpo del documento). Para borrar un texto usa reemplazar vacío.",
        items: {
          type: "object",
          properties: { buscar: { type: "string" }, reemplazar: { type: "string" } },
          required: ["buscar", "reemplazar"],
        },
      },
      anadir_parrafos: { type: "array", items: { type: "string" }, description: "Párrafos nuevos al final del documento" },
      anadir_imagenes: {
        type: "array",
        description: "Imágenes a insertar: [{artifact_id | ruta, ancho (cm, default ancho útil), alineacion (left|center|right), pie, despues_de (texto de un párrafo existente; sin él van al final)}]. artifact_id es el que devolvió image_generate. PNG, JPEG o GIF.",
        items: { type: "object" },
      },
      guardar_como: { type: "string", description: "Ruta de salida (default: <nombre>_corregido.docx junto al original)" },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const entrada = await resolveOfficeInput(params);
    if ("error" in entrada) return { ok: false, error: entrada.error };
    const reemplazos = Array.isArray(params.reemplazos) ? (params.reemplazos as { buscar: string; reemplazar: string }[]) : [];
    const nuevos = Array.isArray(params.anadir_parrafos) ? (params.anadir_parrafos as unknown[]).map(String) : [];
    const imagenesPedidas = Array.isArray(params.anadir_imagenes) ? (params.anadir_imagenes as Array<Record<string, unknown>>) : [];
    if (reemplazos.length === 0 && nuevos.length === 0 && imagenesPedidas.length === 0) {
      return { ok: false, error: "Indica 'reemplazos', 'anadir_parrafos' y/o 'anadir_imagenes'." };
    }

    try {
      const workspace = getWorkspace(config);
      const origen = path.resolve(entrada.ruta);
      if (!fs.existsSync(origen)) return { ok: false, error: `Archivo no encontrado: ${origen}` };
      if (!/\.docx$/i.test(origen)) return { ok: false, error: "Solo se pueden editar archivos .docx." };

      const base = path.basename(origen).replace(/\.docx$/i, "");
      const pedido = typeof params.guardar_como === "string" && params.guardar_como.trim() ? params.guardar_como.trim() : null;
      const destino = path.resolve(
        pedido
          ? resolveInWorkspace(pedido, workspace)
          : workspace
            ? resolveInWorkspace(`${base}_corregido.docx`, workspace)
            : path.join(path.dirname(origen), `${base}_corregido.docx`),
      );
      if (destino === origen) return { ok: false, error: "El destino no puede ser el archivo original." };

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(fs.readFileSync(origen));
      const entradaXml = zip.file("word/document.xml");
      if (!entradaXml) return { ok: false, error: "El archivo no parece un .docx válido (falta word/document.xml)." };
      let xml = await entradaXml.async("string");

      const resumen: { buscar: string; apariciones: number }[] = [];
      for (const r of reemplazos) {
        if (typeof r.buscar !== "string" || !r.buscar) continue;
        let total = 0;
        xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (parrafo) => {
          const res = reemplazarEnParrafo(parrafo, r.buscar, String(r.reemplazar ?? ""));
          total += res.cuenta;
          return res.xml;
        });
        resumen.push({ buscar: r.buscar, apariciones: total });
      }

      if (nuevos.length) {
        const parrafos = nuevos
          .map((t) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`)
          .join("");
        // Antes de sectPr (propiedades de página) para que el texto quede dentro del cuerpo.
        xml = /<w:sectPr(?=[\s/>])/.test(xml)
          ? xml.replace(/(<w:sectPr(?=[\s/>])(?![\s\S]*<w:sectPr(?=[\s/>])))/, `${parrafos}$1`)
          : xml.replace("</w:body>", `${parrafos}</w:body>`);
      }

      // ─── Imágenes: media + relación + tipo de contenido + párrafo en línea ───
      let imagenesAnadidas = 0;
      const imagenesFallidas: string[] = [];
      if (imagenesPedidas.length) {
        const relsArchivo = zip.file("word/_rels/document.xml.rels");
        const tiposArchivo = zip.file("[Content_Types].xml");
        if (!relsArchivo || !tiposArchivo) return { ok: false, error: "El .docx no tiene word/_rels/document.xml.rels o [Content_Types].xml." };
        let rels = await relsArchivo.async("string");
        let tipos = await tiposArchivo.async("string");
        if (!/xmlns:wp=/.test(xml)) xml = xml.replace(/<w:document\b/, '<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"');
        if (!/xmlns:r=/.test(xml)) xml = xml.replace(/<w:document\b/, '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
        const anchoUtilCm = 16;
        for (const ref of imagenesPedidas.slice(0, 20)) {
          const cargada = cargarImagen(ref, config);
          if ("error" in cargada) { imagenesFallidas.push(cargada.error); continue; }
          const img = cargada.imagen;
          const n = ++imagenesAnadidas;
          const ext = img.tipo === "jpg" ? "jpeg" : img.tipo;
          const archivoMedia = `hive_img_${Date.now().toString(36)}_${n}.${ext}`;
          const rId = `rIdHive${Date.now().toString(36)}${n}`;
          zip.file(`word/media/${archivoMedia}`, img.bytes);
          rels = rels.replace("</Relationships>", `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${archivoMedia}"/></Relationships>`);
          if (!new RegExp(`<Default[^>]*Extension="${ext}"`, "i").test(tipos)) {
            tipos = tipos.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="image/${ext}"/>`);
          }
          const ancho = Number(ref.ancho ?? ref.width);
          const cm = ajustarCm(img, Number.isFinite(ancho) && ancho > 0 ? ancho : undefined, anchoUtilCm, 22);
          const alin = typeof ref.alineacion === "string" ? ref.alineacion : "center";
          const pie = typeof ref.pie === "string" && ref.pie ? ref.pie : (typeof ref.caption === "string" ? ref.caption : "");
          const bloque = parrafoConImagen(rId, n, cm.w, cm.h, alin, pie || "Imagen") + (pie ? parrafoPie(pie, alin) : "");
          const despues = typeof ref.despues_de === "string" ? ref.despues_de.trim() : "";
          let colocada = false;
          if (despues) {
            xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (parrafo) => {
              if (colocada) return parrafo;
              const texto = unescapeXml([...parrafo.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
              if (!texto.includes(despues)) return parrafo;
              colocada = true;
              return parrafo + bloque;
            });
            if (!colocada) { imagenesFallidas.push(`${img.origen}: no se halló el párrafo "${despues}"; se añadió al final.`); }
          }
          if (!colocada) {
            xml = /<w:sectPr(?=[\s/>])/.test(xml)
              ? xml.replace(/(<w:sectPr(?=[\s/>])(?![\s\S]*<w:sectPr(?=[\s/>])))/, `${bloque}$1`)
              : xml.replace("</w:body>", `${bloque}</w:body>`);
          }
        }
        zip.file("word/_rels/document.xml.rels", rels);
        zip.file("[Content_Types].xml", tipos);
      }

      const sinCambios = resumen.length > 0 && resumen.every((r) => r.apariciones === 0) && nuevos.length === 0 && imagenesAnadidas === 0;
      if (sinCambios) {
        return { ok: false, error: "Ninguno de los textos a buscar aparece en el cuerpo del documento.", resumen };
      }

      zip.file("word/document.xml", xml);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      log.info(`DOCX editado → ${destino}`);
      return {
        ok: true,
        ruta: destino,
        reemplazos: resumen,
        parrafos_anadidos: nuevos.length,
        imagenes_anadidas: imagenesAnadidas,
        ...(imagenesFallidas.length ? { aviso_imagenes: imagenesFallidas.join(" | ") } : {}),
        nota: "Solo se edita el cuerpo del documento (no encabezados ni pies). Envíalo con send_file.",
      };
    } catch (error) {
      return { ok: false, error: `No se pudo editar el Word: ${(error as Error).message}` };
    }
  },
};
