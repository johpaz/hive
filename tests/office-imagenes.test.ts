process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import JSZip from "../packages/core/node_modules/jszip";
import { officeLeerImagenesTool } from "../packages/core/src/tools/image/office-leer-imagenes";
import { officeLeerPptxTool } from "../packages/core/src/tools/office/office-leer-pptx";
import { officeLeerDocxTool } from "../packages/core/src/tools/office/office-leer-docx";
import { multimodalService } from "../packages/core/src/multimodal";
import { aPixeles, codificarPng, reducir, MAX_LADO_PX } from "../packages/core/src/tools/office/office-pdf-images";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PIC = (rid: string) => `<p:pic><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill></p:pic>`;
const rels = (items: Array<[string, string]>) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  items.map(([id, target]) => `<Relationship Id="${id}" Type="${REL}/image" Target="${target}"/>`).join("") + `</Relationships>`;

// Contenido distinto en cada imagen para que el hash (y la caché) las distinga.
const grande = () => randomBytes(8_000);
const icono = () => randomBytes(200);

async function pptx(dir: string, slides: Array<{ texto: string; imagenes: string[] }>, media: Record<string, Buffer>): Promise<string> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file("ppt/presentation.xml",
    `<p:presentation xmlns:r="${REL}"><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels",
    `<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`);
  slides.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`,
      `<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="${REL}"><a:p><a:r><a:t>${s.texto}</a:t></a:r></a:p>${s.imagenes.map((_, k) => PIC(`rIdImg${k}`)).join("")}</p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(s.imagenes.map((m, k) => [`rIdImg${k}`, `../media/${m}`])));
  });
  for (const [nombre, bytes] of Object.entries(media)) zip.file(`ppt/media/${nombre}`, bytes);
  const ruta = join(dir, "demo.pptx");
  writeFileSync(ruta, await zip.generateAsync({ type: "nodebuffer" }));
  return ruta;
}

async function docx(dir: string, parrafos: Array<{ texto?: string; imagen?: string }>, media: Record<string, Buffer>): Promise<string> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`);
  const cuerpo = parrafos.map((p) =>
    `<w:p>${p.texto ? `<w:r><w:t>${p.texto}</w:t></w:r>` : ""}${p.imagen ? `<w:r><w:drawing><a:blip r:embed="${p.imagen}"/></w:drawing></w:r>` : ""}</w:p>`).join("");
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><w:body>${cuerpo}</w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", rels(Object.keys(media).map((m, i) => [`rId${i + 10}`, `media/${m}`])));
  for (const [nombre, bytes] of Object.entries(media)) zip.file(`word/media/${nombre}`, bytes);
  const ruta = join(dir, "demo.docx");
  writeFileSync(ruta, await zip.generateAsync({ type: "nodebuffer" }));
  return ruta;
}

const dir = () => mkdtempSync(join(tmpdir(), "imgs-"));
let espia: ReturnType<typeof spyOn> | undefined;
const simular = (fn: (img: any) => Promise<string> = async () => "Un gráfico de barras con ventas 2026") => {
  espia = spyOn(multimodalService, "ocrImage").mockImplementation(fn as never);
  return espia;
};
afterEach(() => { espia?.mockRestore(); espia = undefined; });

describe("office_leer_imagenes · PowerPoint", () => {
  test("analiza las imágenes útiles, dice en qué diapositiva estaban y descarta íconos", async () => {
    const ruta = await pptx(dir(), [
      { texto: "Portada", imagenes: ["icono.png"] },
      { texto: "Ventas", imagenes: ["grafico.png"] },
    ], { "icono.png": icono(), "grafico.png": grande() });
    const llamadas = simular();
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.totalImagenes).toBe(1);
    expect(r.omitidas).toBe(1);
    expect(r.imagenes[0].ubicacion).toBe("Diapositiva 2");
    expect(r.imagenes[0].descripcion).toContain("gráfico de barras");
    expect(llamadas).toHaveBeenCalledTimes(1);
    const entrada = llamadas.mock.calls[0][0] as any;
    expect(entrada.type).toBe("buffer");
    expect(entrada.mimeType).toBe("image/png");
    expect(entrada.caption).toContain("Diapositiva 2");
  });

  test("una imagen repetida en varias diapositivas se analiza una sola vez", async () => {
    const ruta = await pptx(dir(), [
      { texto: "A", imagenes: ["logo.png"] },
      { texto: "B", imagenes: ["logo.png"] },
    ], { "logo.png": grande() });
    const llamadas = simular();
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.totalImagenes).toBe(1);
    expect(r.imagenes[0].ubicacion).toBe("Diapositiva 1 · Diapositiva 2");
    expect(llamadas).toHaveBeenCalledTimes(1);
  });

  test("pagina con max_imagenes y dice por dónde seguir", async () => {
    const ruta = await pptx(dir(), [
      { texto: "A", imagenes: ["a.png"] },
      { texto: "B", imagenes: ["b.png"] },
      { texto: "C", imagenes: ["c.jpg"] },
    ], { "a.png": grande(), "b.png": grande(), "c.jpg": grande() });
    simular();
    const primera: any = await officeLeerImagenesTool.execute({ ruta, max_imagenes: 2 });
    expect(primera.imagenes.map((i: any) => i.numero)).toEqual([1, 2]);
    expect(primera.truncado).toBe(true);
    expect(primera.siguiente_imagen).toBe(3);
    const segunda: any = await officeLeerImagenesTool.execute({ ruta, desde_imagen: 3 });
    expect(segunda.imagenes.map((i: any) => i.numero)).toEqual([3]);
    expect(segunda.truncado).toBeUndefined();
  });

  test("releer el mismo documento no vuelve a llamar al modelo (caché por hash)", async () => {
    const ruta = await pptx(dir(), [{ texto: "A", imagenes: ["a.png"] }], { "a.png": grande() });
    const llamadas = simular();
    await officeLeerImagenesTool.execute({ ruta });
    await officeLeerImagenesTool.execute({ ruta });
    expect(llamadas).toHaveBeenCalledTimes(1);
  });

  test("office_leer_pptx avisa que hay imágenes que su texto no incluye", async () => {
    const ruta = await pptx(dir(), [{ texto: "Ventas", imagenes: ["g.png"] }], { "g.png": grande() });
    const r: any = await officeLeerPptxTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.imagenes).toBe(1);
    expect(r.aviso_imagenes).toContain("office_leer_imagenes");
  });
});

describe("office_leer_imagenes · Word", () => {
  test("ubica cada imagen junto al texto que la rodea", async () => {
    const ruta = await docx(dir(), [
      { imagen: "rId10" },
      { texto: "Resultados del trimestre" },
      { imagen: "rId11" },
      { texto: "Pie con figura", imagen: "rId12" },
    ], { "a.png": grande(), "b.png": grande(), "c.jpeg": grande() });
    simular();
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.totalImagenes).toBe(3);
    expect(r.imagenes.map((i: any) => i.ubicacion)).toEqual([
      "Al inicio del documento",
      "Después de: «Resultados del trimestre»",
      "Junto a: «Pie con figura»",
    ]);
  });

  test("office_leer_docx avisa de las imágenes", async () => {
    const ruta = await docx(dir(), [{ texto: "Hola" }, { imagen: "rId10" }], { "a.png": grande() });
    const r: any = await officeLeerDocxTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.imagenes).toBe(1);
    expect(r.aviso_imagenes).toContain("office_leer_imagenes");
  });
});

describe("office_leer_imagenes · casos límite", () => {
  test("un documento sin imágenes útiles responde ok con un aviso", async () => {
    const ruta = await pptx(dir(), [{ texto: "Solo texto", imagenes: [] }], {});
    const llamadas = simular();
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.totalImagenes).toBe(0);
    expect(llamadas).not.toHaveBeenCalled();
  });

  test("si el modelo falla en todas, devuelve el motivo y dónde configurarlo", async () => {
    const ruta = await pptx(dir(), [{ texto: "A", imagenes: ["a.png"] }], { "a.png": grande() });
    simular(async () => { throw new Error("Falta la API key de nvidia"); });
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Falta la API key de nvidia");
    expect(r.error).toContain("Providers");
  });

  test("si falla solo una, devuelve las demás y marca la que falló", async () => {
    const ruta = await pptx(dir(), [
      { texto: "A", imagenes: ["a.png"] }, { texto: "B", imagenes: ["b.png"] },
    ], { "a.png": grande(), "b.png": grande() });
    let n = 0;
    simular(async () => { if (n++ === 0) throw new Error("timeout"); return "ok"; });
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.imagenes.filter((i: any) => i.error).length).toBe(1);
    expect(r.imagenes.filter((i: any) => i.descripcion).length).toBe(1);
  });

  test("rechaza un archivo que no es docx/pptx y un número de imagen fuera de rango", async () => {
    const d = dir();
    const txt = join(d, "a.txt");
    writeFileSync(txt, "hola");
    expect(((await officeLeerImagenesTool.execute({ ruta: txt })) as any).ok).toBe(false);
    const ruta = await pptx(d, [{ texto: "A", imagenes: ["a.png"] }], { "a.png": grande() });
    simular();
    const r: any = await officeLeerImagenesTool.execute({ ruta, desde_imagen: 9 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("entre 1 y 1");
  });
});

// ── PDF ──────────────────────────────────────────────────────────────────────

/** Gradiente RGB sencillo: píxeles reales, no ruido, para poder comparar tras codificar. */
function rgb(w: number, h: number): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    b[i] = x % 256; b[i + 1] = y % 256; b[i + 2] = (x + y) % 256;
  }
  return b;
}

/** PDF mínimo válido: una imagen RGB (Flate) por página, sin una sola letra de texto, como un escaneado. */
function pdfEscaneado(paginas: Array<{ w: number; h: number }>): Buffer {
  const objs: Buffer[] = [];
  const add = (cuerpo: string | Buffer) => { objs.push(Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, "latin1")); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Count ${paginas.length} /Kids [${paginas.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  paginas.forEach(({ w, h }, i) => {
    const pag = 3 + i * 3;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${pag + 1} 0 R /Resources << /XObject << /Im0 ${pag + 2} 0 R >> >> >>`);
    const cont = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    add(`<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`);
    const datos = deflateSync(rgb(w, h));
    add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${datos.length} >>\nstream\n`, "latin1"),
      datos, Buffer.from("\nendstream", "latin1"),
    ]));
  });
  let salida = Buffer.from("%PDF-1.4\n", "latin1");
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(salida.length);
    salida = Buffer.concat([salida, Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
  });
  const xref = salida.length;
  const tabla = ["0000000000 65535 f "].concat(offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `)).join("\n");
  return Buffer.concat([salida, Buffer.from(`xref\n0 ${objs.length + 1}\n${tabla}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`, "latin1")]);
}

const guardarPdf = (paginas: Array<{ w: number; h: number }>) => {
  const ruta = join(dir(), "escaneado.pdf");
  writeFileSync(ruta, pdfEscaneado(paginas));
  return ruta;
};
const alto = (png: Buffer) => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });

describe("office_leer_imagenes · PDF", () => {
  test("lee un PDF escaneado: una imagen por página, con su número de página", async () => {
    const ruta = guardarPdf([{ w: 200, h: 300 }, { w: 200, h: 300 }]);
    const llamadas = simular();
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.ok).toBe(true);
    expect(r.totalImagenes).toBe(2);
    expect(r.imagenes.map((i: any) => i.ubicacion)).toEqual(["Página 1", "Página 2"]);
    const enviada = llamadas.mock.calls[0][0] as any;
    expect(enviada.mimeType).toBe("image/png");
    expect(Buffer.from(enviada.data).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  test("descarta imágenes diminutas (viñetas, filetes) y avisa cuántas", async () => {
    const ruta = guardarPdf([{ w: 40, h: 40 }, { w: 200, h: 300 }]);
    simular();
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.totalImagenes).toBe(1);
    expect(r.omitidas).toBe(1);
    expect(r.imagenes[0].ubicacion).toBe("Página 2");
  });

  test("una página escaneada enorme se reduce antes de mandarla al modelo", async () => {
    const ruta = guardarPdf([{ w: 3000, h: 1500 }]);
    const llamadas = simular();
    await officeLeerImagenesTool.execute({ ruta });
    const { w, h } = alto(Buffer.from((llamadas.mock.calls[0][0] as any).data));
    expect(Math.max(w, h)).toBeLessThanOrEqual(MAX_LADO_PX);
    expect(w / h).toBeCloseTo(2, 1); // conserva la proporción
  });

  test("un PDF dañado da un error claro", async () => {
    const ruta = join(dir(), "roto.pdf");
    writeFileSync(ruta, "esto no es un pdf");
    const r: any = await officeLeerImagenesTool.execute({ ruta });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PDF/);
  });
});

describe("codificación de imágenes de PDF", () => {
  test("codificarPng produce un PNG que se decodifica a los mismos píxeles", () => {
    const w = 7, h = 5;
    const px = new Uint8Array(rgb(w, h));
    const png = codificarPng(w, h, 3, px);
    expect(alto(png)).toEqual({ w, h });
    // IDAT: 4 (largo) + 4 (tipo) tras IHDR (8 firma + 25 chunk IHDR)
    const largo = png.readUInt32BE(33);
    const crudo = inflateSync(png.subarray(41, 41 + largo));
    for (let y = 0; y < h; y++) {
      expect(crudo[y * (w * 3 + 1)]).toBe(0); // byte de filtro
      expect([...crudo.subarray(y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1))]).toEqual([...px.subarray(y * w * 3, (y + 1) * w * 3)]);
    }
  });

  test("gris de 1 bit y RGBA (sobre blanco) pasan a píxeles de 8 bits", () => {
    // 10 px de ancho → 2 bytes por fila; 1 = blanco. Fila 0: 1010101010 ; fila 1: todo negro
    const g = aPixeles({ width: 10, height: 2, kind: 1, data: new Uint8Array([0b10101010, 0b10000000, 0, 0]) });
    expect(g.canales).toBe(1);
    expect([...g.pixeles.subarray(0, 10)]).toEqual([255, 0, 255, 0, 255, 0, 255, 0, 255, 0]);
    expect([...g.pixeles.subarray(10, 20)]).toEqual(new Array(10).fill(0));
    const c = aPixeles({ width: 2, height: 1, kind: 3, data: new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0]) });
    expect([...c.pixeles]).toEqual([10, 20, 30, 255, 255, 255]); // el píxel transparente queda blanco
  });

  test("reducir no toca lo que ya cabe y promedia lo que no", () => {
    const px = new Uint8Array(4 * 4).fill(100);
    expect(reducir(4, 4, 1, px, 10).pixeles).toBe(px);
    const r = reducir(4, 4, 1, px, 2);
    expect([r.ancho, r.alto]).toEqual([2, 2]);
    expect([...r.pixeles]).toEqual([100, 100, 100, 100]);
  });
});
