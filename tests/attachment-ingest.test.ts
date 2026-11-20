import { describe, expect, test } from "bun:test";
import { classifyAttachment, formatAttachmentManifest } from "../packages/core/src/multimodal/attachment-ingest";

describe("classifyAttachment", () => {
  test("la extensión manda sobre el mime (WhatsApp declara pdf por defecto)", () => {
    expect(classifyAttachment("balance.xlsx", "application/pdf").kind).toBe("xlsx");
    expect(classifyAttachment("carta.DOCX", "application/octet-stream").kind).toBe("docx");
  });
  test("csv y md ya no se descartan", () => {
    expect(classifyAttachment("datos.csv", "text/csv").kind).toBe("text");
    expect(classifyAttachment("notas.md", "").kind).toBe("text");
  });
  test("sin extensión usa el mime", () => {
    expect(classifyAttachment("adjunto", "application/pdf").kind).toBe("pdf");
    expect(classifyAttachment("adjunto", "application/x-foo").kind).toBe("other");
  });
});

describe("formatAttachmentManifest", () => {
  test("incluye ruta, artifact_id, lector y vista previa", () => {
    const m = formatAttachmentManifest({
      fileName: "a.xlsx", mimeType: "x", size: 2048, kind: "xlsx",
      artifactId: "id-1", path: "/tmp/a.xlsx", preview: "# Hoja", needsVision: false,
    });
    expect(m).toContain("Ruta: /tmp/a.xlsx");
    expect(m).toContain("artifact_id: id-1");
    expect(m).toContain("office_leer_xlsx");
    expect(m).toContain("2 KB");
    expect(m).toContain("Vista previa:");
  });
  test("sin texto avisa que no hubo extracción", () => {
    const m = formatAttachmentManifest({
      fileName: "s.pdf", mimeType: "x", size: 10, kind: "pdf",
      artifactId: "i", path: "/p", preview: "", needsVision: true,
    });
    expect(m).toContain("No se pudo extraer texto");
  });
});
