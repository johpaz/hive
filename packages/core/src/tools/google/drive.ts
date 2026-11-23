/**
 * Google Drive: buscar, descargar/exportar y subir archivos.
 *
 * @category google
 * @spanish drive, archivos, documentos de google, hojas de cálculo, subir archivo
 */
import { googleFetch, googleJson, GoogleApiError } from "../../google/client.ts";
import { createArtifact, readArtifactBytes } from "../../artifacts/store.ts";
import { googleTool, num, str } from "./shared.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const MAX_DOWNLOAD = 50 * 1024 * 1024;
const INLINE_TEXT = 20_000;

/** Google Docs/Sheets/Slides no se descargan: se exportan. */
const EXPORTS: Record<string, { mime: string; ext: string; text: boolean }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: "txt", text: true },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv", text: true },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf", text: false },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: "pdf", text: false },
};

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export const gdriveSearchTool = googleTool({
  name: "gdrive_search",
  description:
    "Search the user's Google Drive by text (name and content) or with a raw Drive query. Returns id, name, type, modified time and link. " +
    "Spanish: buscar en drive, encontrar archivo, documentos de google",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to find in the file name or content." },
      raw_query: { type: "string", description: "Advanced Drive `q` expression, e.g. \"mimeType='application/pdf' and modifiedTime > '2026-01-01T00:00:00'\". Overrides query." },
      folder_id: { type: "string", description: "Only search inside this folder." },
      max_results: { type: "number", minimum: 1, maximum: 50, description: "Default 15." },
    },
  },
  run: async (p, { userId }) => {
    const clauses = ["trashed = false"];
    const raw = str(p.raw_query), text = str(p.query), folder = str(p.folder_id);
    if (raw) clauses.push(`(${raw})`);
    else if (text) clauses.push(`(name contains '${esc(text)}' or fullText contains '${esc(text)}')`);
    if (folder) clauses.push(`'${esc(folder)}' in parents`);
    const data = await googleJson<any>(userId, "drive", `${API}/files`, {
      query: {
        q: clauses.join(" and "),
        pageSize: num(p.max_results, 15, 1, 50),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,owners(emailAddress))",
      },
    });
    return {
      ok: true,
      count: (data.files ?? []).length,
      files: (data.files ?? []).map((f: any) => ({
        id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime,
        size: f.size ? Number(f.size) : undefined, link: f.webViewLink, owner: f.owners?.[0]?.emailAddress,
      })),
    };
  },
});

export const gdriveDownloadTool = googleTool({
  name: "gdrive_download",
  description:
    "Download a Drive file (or export a Google Doc as text, a Sheet as CSV, Slides as PDF) into a Hive artifact. Text content up to 20k chars is also returned inline. " +
    "Spanish: descargar de drive, leer documento de google, abrir archivo de drive",
  parameters: {
    type: "object",
    properties: { file_id: { type: "string", description: "Id returned by gdrive_search." } },
    required: ["file_id"],
  },
  run: async (p, { userId, config }) => {
    const id = str(p.file_id);
    if (!id) return { ok: false, error: "file_id es obligatorio." };
    const meta = await googleJson<any>(userId, "drive", `${API}/files/${encodeURIComponent(id)}`, {
      query: { fields: "id,name,mimeType,size" },
    });
    const exp = EXPORTS[meta.mimeType];
    if (!exp && meta.mimeType?.startsWith("application/vnd.google-apps.")) {
      return { ok: false, error: `Los archivos de tipo ${meta.mimeType} no se pueden descargar.` };
    }
    if (meta.size && Number(meta.size) > MAX_DOWNLOAD) {
      return { ok: false, error: `El archivo pesa ${Math.round(Number(meta.size) / 1048576)} MB; el límite es ${MAX_DOWNLOAD / 1048576} MB.` };
    }
    const res = exp
      ? await googleFetch(userId, "drive", `${API}/files/${encodeURIComponent(id)}/export`, { query: { mimeType: exp.mime } })
      : await googleFetch(userId, "drive", `${API}/files/${encodeURIComponent(id)}`, { query: { alt: "media" } });
    if (!res.ok) throw new GoogleApiError(res.status, (await res.text()).slice(0, 300));
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = exp?.mime ?? meta.mimeType ?? "application/octet-stream";
    const ext = exp?.ext ?? (/\.([A-Za-z0-9]{1,8})$/.exec(meta.name)?.[1]?.toLowerCase());
    const artifact = await createArtifact({
      bytes, mimeType, kind: "gdrive_download", userId, extension: ext,
      runId: config?.configurable?.run_id ?? null, taskId: config?.configurable?.task_id ?? null,
    });
    const isText = exp?.text ?? /^text\//.test(mimeType);
    const text = isText ? Buffer.from(bytes).toString("utf-8") : undefined;
    return {
      ok: true, name: meta.name, mime_type: mimeType, size: bytes.byteLength, artifact_id: artifact.id,
      ...(text !== undefined ? { text: text.slice(0, INLINE_TEXT), truncated: text.length > INLINE_TEXT } : {}),
    };
  },
});

export const gdriveUploadTool = googleTool({
  name: "gdrive_upload",
  description:
    "Upload a file to the user's Google Drive from text `content` or from a Hive artifact (artifact_id). Creates a new file; never overwrites. " +
    "Spanish: subir a drive, guardar en drive, enviar archivo a drive",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "File name including extension." },
      content: { type: "string", description: "Text content (alternative to artifact_id)." },
      artifact_id: { type: "string", description: "Hive artifact to upload (alternative to content)." },
      mime_type: { type: "string", description: "Default: taken from the artifact, or text/plain." },
      folder_id: { type: "string", description: "Destination folder id. Default: Drive root." },
    },
    required: ["name"],
  },
  run: async (p, { userId }) => {
    const name = str(p.name);
    if (!name) return { ok: false, error: "name es obligatorio." };
    let bytes: Uint8Array, mime = str(p.mime_type);
    const artifactId = str(p.artifact_id);
    if (artifactId) {
      const art = await readArtifactBytes(artifactId);
      if (!art) return { ok: false, error: `No existe el artifact ${artifactId} o ya expiró.` };
      bytes = art.bytes; mime ??= art.mimeType;
    } else if (typeof p.content === "string") {
      bytes = new TextEncoder().encode(p.content); mime ??= "text/plain";
    } else {
      return { ok: false, error: "Indica content o artifact_id." };
    }
    if (bytes.byteLength > MAX_DOWNLOAD) return { ok: false, error: "El archivo supera el límite de 50 MB." };

    const boundary = `hive_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, ...(str(p.folder_id) ? { parents: [str(p.folder_id)] } : {}) });
    const enc = new TextEncoder();
    const body = Buffer.concat([
      enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes,
      enc.encode(`\r\n--${boundary}--`),
    ]);
    const file = await googleJson<any>(userId, "drive", UPLOAD, {
      method: "POST",
      query: { uploadType: "multipart", fields: "id,name,webViewLink" },
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return { ok: true, id: file.id, name: file.name, link: file.webViewLink };
  },
});

export const driveTools = [gdriveSearchTool, gdriveDownloadTool, gdriveUploadTool];
