/**
 * Adjuntos de punta a punta (sin canales reales): el documento entra como
 * artifact con su extensión, las tools office_leer_* lo abren por artifact_id y
 * send_file lo entrega al canal con el nombre correcto.
 */
process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { ingestDocument } from "../packages/core/src/multimodal/attachment-ingest";
import { sendFileTool } from "../packages/core/src/tools/core/index";
import { setChannelFileFn } from "../packages/core/src/gateway/channel-notify";
import { cargarXlsx } from "../packages/core/src/tools/office/xlsx-loader";
import { officeLeerXlsxTool } from "../packages/core/src/tools/office/office-leer-xlsx";

let home = "";
beforeEach(async () => {
  closeHiveDb();
  home = mkdtempSync(join(tmpdir(), "hive-attach-"));
  process.env.HIVE_HOME = home;
  await ensureHiveDb();
});
afterEach(() => closeHiveDb());

async function xlsxBytes(): Promise<Buffer> {
  const XLSX = await cargarXlsx();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["producto", "precio"], ["café", 12000]]), "Ventas");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("ingesta de documentos", () => {
  test("un xlsx conserva extensión, trae vista previa y se lee por artifact_id", async () => {
    const att = await ingestDocument({ buffer: await xlsxBytes(), fileName: "ventas.xlsx", mimeType: "application/pdf", userId: "u1" });
    expect(att.kind).toBe("xlsx");
    expect(att.path.endsWith(".xlsx")).toBe(true);
    expect(att.preview).toContain("café");
    const res: any = await officeLeerXlsxTool.execute({ artifact_id: att.artifactId });
    expect(res.ok).toBe(true);
  });
  test("un PDF con texto trae vista previa y páginas, sin pasar por modelos", async () => {
    const { PDFDocument, StandardFonts } = await import("../packages/core/node_modules/pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 300]).drawText("Factura 1024 total 50000", { x: 20, y: 250, size: 12, font });
    doc.addPage([300, 300]);
    const att = await ingestDocument({ buffer: Buffer.from(await doc.save()), fileName: "factura.pdf", userId: "u1" });
    expect(att.kind).toBe("pdf");
    expect(att.pages).toBe(2);
    expect(att.preview).toContain("Factura 1024 total 50000");
    expect(att.scanned).toBe(false);
  });
  test("un adjunto vacío se rechaza con mensaje claro", async () => {
    await expect(ingestDocument({ buffer: Buffer.alloc(0), fileName: "x.pdf", userId: "u1" })).rejects.toThrow("vacío");
  });
});

describe("send_file", () => {
  test("entrega el archivo al canal con nombre y mime", async () => {
    const sent: any[] = [];
    setChannelFileFn(async (channel, sessionId, file) => { sent.push({ channel, sessionId, file }); });
    const ruta = join(home, "informe.csv");
    writeFileSync(ruta, "a,b\n1,2\n");
    const res: any = await sendFileTool.execute({ ruta, mensaje: "listo" }, { configurable: { channel: "telegram", user_id: "u1" } });
    expect(res.ok).toBe(true);
    expect(sent[0].channel).toBe("telegram");
    expect(sent[0].file.filename).toBe("informe.csv");
    expect(sent[0].file.mimeType).toBe("text/csv");
    expect(sent[0].file.caption).toBe("listo");
  });
  test("respeta el workspace del agente", async () => {
    const res: any = await sendFileTool.execute({ ruta: "/etc/hostname" }, { configurable: { channel: "webchat", user_id: "u1", workspace: home } });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("outside workspace");
  });
  test("sin ruta ni artifact_id pide uno", async () => {
    const res: any = await sendFileTool.execute({}, { configurable: {} });
    expect(res.ok).toBe(false);
  });
});

describe("ingesta de presentaciones", () => {
  test("un pptx trae diapositivas y vista previa", async () => {
    const PptxGenJS = (await import("../packages/core/node_modules/pptxgenjs")).default;
    const p = new PptxGenJS();
    p.addSlide().addText("Resultados Q3", { x: 1, y: 1, w: 5, h: 1 });
    p.addSlide().addText("Próximos pasos", { x: 1, y: 1, w: 5, h: 1 });
    const att = await ingestDocument({ buffer: Buffer.from(await p.write({ outputType: "nodebuffer" }) as ArrayBuffer), fileName: "q3.pptx", userId: "u1" });
    expect(att.kind).toBe("pptx");
    expect(att.pages).toBe(2);
    expect(att.preview).toContain("Resultados Q3");
    expect(att.path.endsWith(".pptx")).toBe(true);
  });
});
