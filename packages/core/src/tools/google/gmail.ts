/**
 * Gmail: buscar, leer y enviar.
 *
 * @category google
 * @spanish correo, gmail, email, bandeja de entrada, enviar correo, leer correo
 */
import type { ToolParameter } from "../types.ts";
import { googleJson } from "../../google/client.ts";
import { getWorkspace, resolveInWorkspace } from "../filesystem/workspace-guard.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { createArtifact, readArtifactBytes } from "../../artifacts/store.ts";
import { CONFIRMED_PARAM, googleTool, headerSafe, needsConfirmation, num, str } from "./shared.ts";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const b64urlDecode = (s: string) => Buffer.from(s, "base64url").toString("utf-8");

function header(msg: any, name: string): string {
  return msg.payload?.headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Primer text/plain; si no hay, text/html sin etiquetas. */
function extractBody(payload: any): string {
  const walk = (p: any, mime: string): string | null => {
    if (!p) return null;
    if (p.mimeType === mime && p.body?.data) return b64urlDecode(p.body.data);
    for (const part of p.parts ?? []) {
      const found = walk(part, mime);
      if (found) return found;
    }
    return null;
  };
  const plain = walk(payload, "text/plain");
  if (plain) return plain;
  const html = walk(payload, "text/html");
  return html ? html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function attachments(payload: any): Array<{ filename: string; mime_type: string; size: number; attachment_id: string }> {
  const out: Array<{ filename: string; mime_type: string; size: number; attachment_id: string }> = [];
  const walk = (p: any) => {
    if (p?.filename && p.body?.attachmentId) out.push({ filename: p.filename, mime_type: p.mimeType, size: p.body?.size ?? 0, attachment_id: p.body.attachmentId });
    for (const part of p?.parts ?? []) walk(part);
  };
  walk(payload);
  return out;
}

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`);

export const gmailSearchTool = googleTool({
  name: "gmail_search",
  description:
    "Search the user's Gmail. Accepts Gmail query syntax (from:, to:, subject:, is:unread, after:2026/01/31, has:attachment, label:). " +
    "Returns id, sender, subject, date and snippet. Spanish: buscar correos, correos sin leer, correos de, bandeja de entrada",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail search query. Empty = most recent messages." },
      max_results: { type: "number", description: "1-20. Default 10.", minimum: 1, maximum: 20 },
    },
  },
  run: async (p, { userId }) => {
    const max = num(p.max_results, 10, 1, 20);
    const list = await googleJson<{ messages?: Array<{ id: string }> }>(userId, "gmail", `${API}/messages`, {
      query: { q: str(p.query), maxResults: max },
    });
    const ids = (list.messages ?? []).map((m) => m.id);
    const full = await Promise.all(ids.map((id) =>
      googleJson<any>(
        userId, "gmail",
        `${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      ).catch(() => null)));
    return {
      ok: true,
      count: full.filter(Boolean).length,
      messages: full.filter(Boolean).map((m) => ({
        id: m.id,
        thread_id: m.threadId,
        from: header(m, "From"),
        subject: header(m, "Subject"),
        date: header(m, "Date"),
        snippet: m.snippet,
        unread: (m.labelIds ?? []).includes("UNREAD"),
      })),
    };
  },
});

export const gmailReadTool = googleTool({
  name: "gmail_read",
  description:
    "Read one Gmail message in full (headers, text body, attachment names) by id from gmail_search. Spanish: leer correo, abrir correo, contenido del correo",
  parameters: {
    type: "object",
    properties: { message_id: { type: "string", description: "Message id returned by gmail_search." } },
    required: ["message_id"],
  },
  run: async (p, { userId }) => {
    const id = str(p.message_id);
    if (!id) return { ok: false, error: "message_id es obligatorio." };
    const m = await googleJson<any>(userId, "gmail", `${API}/messages/${encodeURIComponent(id)}`, { query: { format: "full" } });
    const body = extractBody(m.payload);
    const MAX = 20_000;
    return {
      ok: true,
      id: m.id,
      thread_id: m.threadId,
      from: header(m, "From"),
      to: header(m, "To"),
      cc: header(m, "Cc"),
      subject: header(m, "Subject"),
      date: header(m, "Date"),
      message_id_header: header(m, "Message-ID"),
      body: body.slice(0, MAX),
      truncated: body.length > MAX,
      attachments: attachments(m.payload),
    };
  },
});


// ─── Construcción de mensajes ───────────────────────────────────────────────

const MAX_ATTACH_TOTAL = 18 * 1024 * 1024; // el límite de Gmail es 25 MB y base64 infla ~33 %

const ATTACHMENTS_PARAM: ToolParameter = {
  type: "array",
  description:
    "Files to attach. Each item needs EITHER artifact_id (Hive artifact, e.g. from image_generate, office_*, gdrive_download) OR path (file inside the workspace). filename is optional (defaults to the original name).",
  items: {
    type: "object",
    properties: {
      artifact_id: { type: "string", description: "Hive artifact id." },
      path: { type: "string", description: "Workspace file path, used when there is no artifact_id." },
      filename: { type: "string", description: "Name shown to the recipient, with extension." },
    },
  },
};

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const looksLikeHtml = (t: string) => /<\/?(p|div|br|h[1-6]|ul|ol|li|table|a|strong|b|em|span|html|body)\b[^>]*>/i.test(t);

/** El cuerpo siempre sale como HTML: si el agente mandó texto plano, se convierte en párrafos. */
function toHtmlBody(body: string): string {
  const inner = looksLikeHtml(body)
    ? body
    : body.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
  return /<html[\s>]/i.test(inner)
    ? inner
    : `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${inner}</body></html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<head[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}

interface RawMessage {
  to: string; cc?: string; bcc?: string; subject: string; body: string;
  inReplyTo?: string; references?: string;
  attachments?: Array<{ filename: string; mimeType: string; bytes: Uint8Array }>;
}

function buildRaw(m: RawMessage): string {
  const lines = [`To: ${headerSafe(m.to, "to")}`];
  if (m.cc) lines.push(`Cc: ${headerSafe(m.cc, "cc")}`);
  if (m.bcc) lines.push(`Bcc: ${headerSafe(m.bcc, "bcc")}`);
  lines.push(`Subject: ${encodeWord(headerSafe(m.subject, "subject"))}`);
  if (m.inReplyTo) lines.push(`In-Reply-To: ${headerSafe(m.inReplyTo, "Message-ID")}`);
  if (m.references) lines.push(`References: ${headerSafe(m.references, "References")}`);
  lines.push("MIME-Version: 1.0");
  const html = toHtmlBody(m.body);
  const text = looksLikeHtml(m.body) ? htmlToText(m.body) : m.body;
  const b64 = (t: string) => wrap76(Buffer.from(t, "utf-8").toString("base64"));
  const alt = `hive_alt_${crypto.randomUUID()}`;
  const altPart = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(text),
    `--${alt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(html),
    `--${alt}--`,
  ];
  const files = m.attachments ?? [];
  if (!files.length) {
    lines.push(...altPart);
  } else {
    const b = `hive_${crypto.randomUUID()}`;
    lines.push(`Content-Type: multipart/mixed; boundary="${b}"`, "", `--${b}`, ...altPart);
    for (const f of files) {
      const name = encodeWord(headerSafe(f.filename, "filename")).replace(/"/g, "");
      lines.push(`--${b}`, `Content-Type: ${f.mimeType}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64", "", wrap76(Buffer.from(f.bytes).toString("base64")));
    }
    lines.push(`--${b}--`);
  }
  return Buffer.from(lines.join("\r\n"), "utf-8").toString("base64url");
}

async function loadAttachments(p: Record<string, unknown>, config?: any) {
  const list = Array.isArray(p.attachments) ? (p.attachments as Array<Record<string, unknown>>) : [];
  const out: NonNullable<RawMessage["attachments"]> = [];
  let total = 0;
  for (const a of list.slice(0, 10)) {
    const id = str(a.artifact_id), filePath = str(a.path);
    let filename = str(a.filename);
    let bytes: Uint8Array, mimeType: string;
    if (id) {
      const art = await readArtifactBytes(id);
      if (!art) throw new Error(`No existe el artifact ${id} o ya expiró. Usa el artifact_id exacto que devolvió la tool que generó el archivo, o pasa path.`);
      ({ bytes, mimeType } = art);
      filename ??= `adjunto-${id.slice(0, 8)}${extname(id)}`;
    } else if (filePath) {
      const resolved = resolveInWorkspace(filePath, getWorkspace(config));
      if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`No existe el archivo ${filePath}.`);
      bytes = readFileSync(resolved);
      mimeType = Bun.file(resolved).type.split(";")[0] || "application/octet-stream";
      filename ??= basename(resolved);
    } else {
      throw new Error("Cada adjunto necesita artifact_id o path.");
    }
    total += bytes.byteLength;
    if (total > MAX_ATTACH_TOTAL) throw new Error("Los adjuntos superan los 18 MB permitidos por correo.");
    out.push({ filename, mimeType, bytes });
  }
  return out;
}

const attachSummary = (p: Record<string, unknown>) =>
  (Array.isArray(p.attachments) ? (p.attachments as Array<Record<string, unknown>>) : []).map((a) => a.filename);

/** Cabeceras necesarias para contestar un mensaje y mantener el hilo. */
async function replyContext(userId: string, messageId: string, replyAll: boolean) {
  const orig = await googleJson<any>(userId, "gmail", `${API}/messages/${encodeURIComponent(messageId)}?format=metadata` +
    ["From", "To", "Cc", "Reply-To", "Subject", "Message-ID", "References"].map((h) => `&metadataHeaders=${h}`).join(""));
  const mid = header(orig, "Message-ID");
  let to = header(orig, "Reply-To") || header(orig, "From");
  let cc = "";
  if (replyAll) {
    const me = (await googleJson<any>(userId, "gmail", `${API}/profile`)).emailAddress?.toLowerCase();
    const others = [header(orig, "To"), header(orig, "Cc")].join(",").split(",").map((x) => x.trim()).filter(Boolean)
      .filter((x) => !(me && x.toLowerCase().includes(me)) && !to.includes(x));
    cc = others.join(", ");
  }
  const subject = header(orig, "Subject");
  const refs = [header(orig, "References"), mid].filter(Boolean).join(" ");
  return {
    threadId: orig.threadId as string, to, cc: cc || undefined,
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    inReplyTo: mid || undefined, references: refs || undefined,
  };
}

// ─── Enviar y responder ─────────────────────────────────────────────────────

export const gmailSendTool = googleTool({
  name: "gmail_send",
  description:
    "Send a NEW email from the user's Gmail (to reply use gmail_reply). IRREVERSIBLE: first call returns a preview and needs_confirmation; repeat with confirmed=true only after the user approves. " +
    "Spanish: enviar correo, mandar email, escribir un correo, enviar con adjunto",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipients, comma separated." },
      subject: { type: "string" },
      body: { type: "string", description: "Email body as HTML (<p>, <strong>, <ul>, <a href>, <table>…). Plain text is auto-converted." },
      cc: { type: "string" },
      bcc: { type: "string" },
      attachments: ATTACHMENTS_PARAM,
      confirmed: CONFIRMED_PARAM,
    },
    required: ["to", "subject", "body"],
  },
  run: async (p, { userId, config }) => {
    const to = str(p.to), subject = str(p.subject), body = typeof p.body === "string" ? p.body : "";
    if (!to || !subject || !body) return { ok: false, error: "to, subject y body son obligatorios." };
    const cc = str(p.cc), bcc = str(p.bcc);
    const pending = needsConfirmation(p, { to, cc, bcc, subject, body: body.slice(0, 500), attachments: attachSummary(p) });
    if (pending) return pending;
    const raw = buildRaw({ to, cc, bcc, subject, body, attachments: await loadAttachments(p, config) });
    const sent = await googleJson<any>(userId, "gmail", `${API}/messages/send`, { method: "POST", body: { raw } });
    return { ok: true, id: sent.id, thread_id: sent.threadId };
  },
});

export const gmailReplyTool = googleTool({
  name: "gmail_reply",
  description:
    "Reply to an email in its thread (keeps subject, In-Reply-To and recipients). reply_all=true also includes the other recipients. " +
    "IRREVERSIBLE unless save_as_draft=true: first call returns a preview and needs_confirmation; repeat with confirmed=true after the user approves. " +
    "Spanish: responder correo, contestar email, responder a todos",
  parameters: {
    type: "object",
    properties: {
      message_id: { type: "string", description: "Id of the message being answered (from gmail_search/gmail_read)." },
      body: { type: "string", description: "Reply body as HTML. Plain text is auto-converted." },
      reply_all: { type: "boolean", description: "Include the original To/Cc recipients. Default false." },
      save_as_draft: { type: "boolean", description: "Save the reply as a draft instead of sending." },
      attachments: ATTACHMENTS_PARAM,
      confirmed: CONFIRMED_PARAM,
    },
    required: ["message_id", "body"],
  },
  run: async (p, { userId, config }) => {
    const id = str(p.message_id), body = typeof p.body === "string" ? p.body : "";
    if (!id || !body) return { ok: false, error: "message_id y body son obligatorios." };
    const ctx = await replyContext(userId, id, p.reply_all === true);
    const draft = p.save_as_draft === true;
    if (!draft) {
      const pending = needsConfirmation(p, { to: ctx.to, cc: ctx.cc, subject: ctx.subject, body: body.slice(0, 500), attachments: attachSummary(p) });
      if (pending) return pending;
    }
    const raw = buildRaw({ ...ctx, body, attachments: await loadAttachments(p, config) });
    if (draft) {
      const d = await googleJson<any>(userId, "gmail", `${API}/drafts`, { method: "POST", body: { message: { raw, threadId: ctx.threadId } } });
      return { ok: true, draft_id: d.id, message_id: d.message?.id, thread_id: ctx.threadId };
    }
    const sent = await googleJson<any>(userId, "gmail", `${API}/messages/send`, { method: "POST", body: { raw, threadId: ctx.threadId } });
    return { ok: true, id: sent.id, thread_id: sent.threadId, to: ctx.to, cc: ctx.cc };
  },
});

// ─── Borradores ─────────────────────────────────────────────────────────────

export const gmailDraftSaveTool = googleTool({
  name: "gmail_draft_save",
  description:
    "Create a Gmail draft, or EDIT an existing one by passing draft_id (the whole draft is replaced: read it first with gmail_read and resend every field). Never sends anything. " +
    "Spanish: crear borrador, editar borrador, guardar borrador",
  parameters: {
    type: "object",
    properties: {
      draft_id: { type: "string", description: "Existing draft to replace. Omit to create a new one." },
      to: { type: "string" }, subject: { type: "string" }, body: { type: "string", description: "HTML body (plain text is auto-converted)." },
      cc: { type: "string" }, bcc: { type: "string" },
      attachments: ATTACHMENTS_PARAM,
    },
    required: ["to", "subject", "body"],
  },
  run: async (p, { userId, config }) => {
    const to = str(p.to), subject = str(p.subject), body = typeof p.body === "string" ? p.body : "";
    if (!to || !subject || !body) return { ok: false, error: "to, subject y body son obligatorios." };
    const raw = buildRaw({ to, cc: str(p.cc), bcc: str(p.bcc), subject, body, attachments: await loadAttachments(p, config) });
    const id = str(p.draft_id);
    const d = await googleJson<any>(userId, "gmail", id ? `${API}/drafts/${encodeURIComponent(id)}` : `${API}/drafts`, {
      method: id ? "PUT" : "POST", body: { message: { raw } },
    });
    return { ok: true, draft_id: d.id, message_id: d.message?.id, updated: !!id };
  },
});

export const gmailDraftListTool = googleTool({
  name: "gmail_draft_list",
  description: "List the user's Gmail drafts (draft_id, message_id, recipients, subject). Use gmail_read with message_id for the body. Spanish: ver borradores, mis borradores",
  parameters: { type: "object", properties: { max_results: { type: "number", minimum: 1, maximum: 20, description: "Default 10." } } },
  run: async (p, { userId }) => {
    const list = await googleJson<{ drafts?: Array<{ id: string }> }>(userId, "gmail", `${API}/drafts`, { query: { maxResults: num(p.max_results, 10, 1, 20) } });
    const drafts = await Promise.all((list.drafts ?? []).map(async (d) => {
      const full = await googleJson<any>(userId, "gmail", `${API}/drafts/${d.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null);
      return full && { draft_id: d.id, message_id: full.message?.id, to: header(full.message, "To"), subject: header(full.message, "Subject"), snippet: full.message?.snippet };
    }));
    return { ok: true, drafts: drafts.filter(Boolean) };
  },
});

export const gmailDraftSendTool = googleTool({
  name: "gmail_draft_send",
  description: "Send an existing draft. IRREVERSIBLE: needs_confirmation first, then confirmed=true after user approval. Spanish: enviar borrador",
  parameters: { type: "object", properties: { draft_id: { type: "string" }, confirmed: CONFIRMED_PARAM }, required: ["draft_id"] },
  run: async (p, { userId }) => {
    const id = str(p.draft_id);
    if (!id) return { ok: false, error: "draft_id es obligatorio." };
    const d = await googleJson<any>(userId, "gmail", `${API}/drafts/${encodeURIComponent(id)}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`);
    const pending = needsConfirmation(p, { draft_id: id, to: header(d.message, "To"), subject: header(d.message, "Subject"), snippet: d.message?.snippet });
    if (pending) return pending;
    const sent = await googleJson<any>(userId, "gmail", `${API}/drafts/send`, { method: "POST", body: { id } });
    return { ok: true, id: sent.id, thread_id: sent.threadId };
  },
});

export const gmailDraftDeleteTool = googleTool({
  name: "gmail_draft_delete",
  description: "Permanently delete a draft. Needs confirmation (needs_confirmation, then confirmed=true). Spanish: borrar borrador, eliminar borrador",
  parameters: { type: "object", properties: { draft_id: { type: "string" }, confirmed: CONFIRMED_PARAM }, required: ["draft_id"] },
  run: async (p, { userId }) => {
    const id = str(p.draft_id);
    if (!id) return { ok: false, error: "draft_id es obligatorio." };
    const pending = needsConfirmation(p, { draft_id: id, action: "delete_draft" });
    if (pending) return pending;
    await googleJson(userId, "gmail", `${API}/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { ok: true, deleted: id };
  },
});

// ─── Organizar: leído, destacado, archivo, papelera, etiquetas ──────────────

const MODIFY_ACTIONS = [
  "mark_read", "mark_unread", "star", "unstar", "archive", "move_to_inbox",
  "mark_important", "mark_not_important", "trash", "untrash",
] as const;

const LABEL_EFFECT: Record<string, { add?: string[]; remove?: string[] }> = {
  mark_read: { remove: ["UNREAD"] },
  mark_unread: { add: ["UNREAD"] },
  star: { add: ["STARRED"] },
  unstar: { remove: ["STARRED"] },
  archive: { remove: ["INBOX"] },
  move_to_inbox: { add: ["INBOX"] },
  mark_important: { add: ["IMPORTANT"] },
  mark_not_important: { remove: ["IMPORTANT"] },
};

async function resolveLabels(userId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { labels = [] } = await googleJson<{ labels?: Array<{ id: string; name: string }> }>(userId, "gmail", `${API}/labels`);
  return names.map((n) => {
    const hit = labels.find((l) => l.id === n || l.name.toLowerCase() === n.toLowerCase());
    if (!hit) throw new Error(`No existe la etiqueta "${n}". Usa gmail_labels para listarlas o crearla.`);
    return hit.id;
  });
}

export const gmailModifyTool = googleTool({
  name: "gmail_modify",
  description:
    "Organize one or many messages (up to 50): mark read/unread, star/unstar, archive, move back to inbox, mark important, send to trash or restore, and add/remove labels. Reversible, no confirmation needed. " +
    "Spanish: marcar como leído, marcar no leído, archivar correo, destacar, mover a la papelera, poner etiqueta",
  parameters: {
    type: "object",
    properties: {
      message_ids: { type: "array", items: { type: "string" }, description: "Message ids (from gmail_search). Max 50." },
      action: { type: "string", enum: [...MODIFY_ACTIONS], description: "Optional preset action." },
      add_labels: { type: "array", items: { type: "string" }, description: "Label names or ids to add." },
      remove_labels: { type: "array", items: { type: "string" }, description: "Label names or ids to remove." },
    },
    required: ["message_ids"],
  },
  run: async (p, { userId }) => {
    const ids = (Array.isArray(p.message_ids) ? p.message_ids : []).filter((x): x is string => typeof x === "string" && !!x).slice(0, 50);
    if (!ids.length) return { ok: false, error: "message_ids es obligatorio." };
    const action = str(p.action);
    if (action && !(MODIFY_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: `action inválida: ${action}.` };
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);
    const extraAdd = strs(p.add_labels), extraRemove = strs(p.remove_labels);
    if (!action && !extraAdd.length && !extraRemove.length) return { ok: false, error: "Indica action, add_labels o remove_labels." };

    if (action === "trash" || action === "untrash") {
      await Promise.all(ids.map((id) => googleJson(userId, "gmail", `${API}/messages/${encodeURIComponent(id)}/${action}`, { method: "POST" })));
      if (!extraAdd.length && !extraRemove.length) return { ok: true, action, count: ids.length };
    }
    const effect = action ? LABEL_EFFECT[action] : undefined;
    const addLabelIds = [...(effect?.add ?? []), ...(await resolveLabels(userId, extraAdd))];
    const removeLabelIds = [...(effect?.remove ?? []), ...(await resolveLabels(userId, extraRemove))];
    if (addLabelIds.length || removeLabelIds.length) {
      await googleJson(userId, "gmail", `${API}/messages/batchModify`, { method: "POST", body: { ids, addLabelIds, removeLabelIds } });
    }
    return { ok: true, action: action ?? "labels", count: ids.length, added: addLabelIds, removed: removeLabelIds };
  },
});

export const gmailLabelsTool = googleTool({
  name: "gmail_labels",
  description:
    "Manage Gmail labels: list them (no params), create (create=<name>), rename (label + new_name) or delete (delete=<label>, needs confirmation; mails keep existing but lose the label). System labels cannot be changed. " +
    "Spanish: ver etiquetas, crear etiqueta, renombrar etiqueta, borrar etiqueta, carpetas de gmail",
  parameters: {
    type: "object",
    properties: {
      create: { type: "string", description: "Name of a label to create." },
      label: { type: "string", description: "Label name or id to rename (use with new_name)." },
      new_name: { type: "string" },
      delete: { type: "string", description: "Label name or id to delete." },
      confirmed: CONFIRMED_PARAM,
    },
  },
  run: async (p, { userId }) => {
    const create = str(p.create), label = str(p.label), del = str(p.delete);
    const all = async () => (await googleJson<{ labels?: any[] }>(userId, "gmail", `${API}/labels`)).labels ?? [];
    const find = async (name: string) => {
      const hit = (await all()).find((l) => l.id === name || l.name.toLowerCase() === name.toLowerCase());
      if (!hit) throw new Error(`No existe la etiqueta "${name}".`);
      if (hit.type === "system") throw new Error(`"${hit.name}" es una etiqueta del sistema y no se puede modificar.`);
      return hit;
    };
    if (create) {
      const l = await googleJson<any>(userId, "gmail", `${API}/labels`, { method: "POST", body: { name: create, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      return { ok: true, created: { id: l.id, name: l.name } };
    }
    if (label) {
      const newName = str(p.new_name);
      if (!newName) return { ok: false, error: "new_name es obligatorio para renombrar." };
      const l = await find(label);
      const r = await googleJson<any>(userId, "gmail", `${API}/labels/${encodeURIComponent(l.id)}`, { method: "PATCH", body: { name: newName } });
      return { ok: true, renamed: { id: r.id, from: l.name, to: r.name } };
    }
    if (del) {
      const l = await find(del);
      const pending = needsConfirmation(p, { action: "delete_label", label: l.name });
      if (pending) return pending;
      await googleJson(userId, "gmail", `${API}/labels/${encodeURIComponent(l.id)}`, { method: "DELETE" });
      return { ok: true, deleted: l.name };
    }
    return { ok: true, labels: (await all()).map((l) => ({ id: l.id, name: l.name, type: l.type })) };
  },
});

// ─── Reenviar ───────────────────────────────────────────────────────────────

export const gmailForwardTool = googleTool({
  name: "gmail_forward",
  description:
    "Forward an email to new recipients with an optional note, including the original text and (by default) its attachments. IRREVERSIBLE: needs_confirmation first, then confirmed=true after user approval. " +
    "Spanish: reenviar correo, forward, pasar este correo a",
  parameters: {
    type: "object",
    properties: {
      message_id: { type: "string" },
      to: { type: "string", description: "Recipients, comma separated." },
      note: { type: "string", description: "Optional text placed above the forwarded message." },
      cc: { type: "string" },
      include_attachments: { type: "boolean", description: "Default true." },
      confirmed: CONFIRMED_PARAM,
    },
    required: ["message_id", "to"],
  },
  run: async (p, { userId }) => {
    const id = str(p.message_id), to = str(p.to);
    if (!id || !to) return { ok: false, error: "message_id y to son obligatorios." };
    const m = await googleJson<any>(userId, "gmail", `${API}/messages/${encodeURIComponent(id)}`, { query: { format: "full" } });
    const files = attachments(m.payload);
    const withFiles = p.include_attachments !== false;
    const subject = header(m, "Subject");
    const pending = needsConfirmation(p, {
      to, cc: str(p.cc), subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
      note: str(p.note), original_from: header(m, "From"), attachments: withFiles ? files.map((f) => f.filename) : [],
    });
    if (pending) return pending;

    const body = [
      str(p.note) ?? "",
      "",
      "---------- Mensaje reenviado ----------",
      `De: ${header(m, "From")}`, `Fecha: ${header(m, "Date")}`, `Asunto: ${subject}`, `Para: ${header(m, "To")}`,
      "", extractBody(m.payload),
    ].join("\n");

    const loaded: NonNullable<RawMessage["attachments"]> = [];
    let total = 0;
    if (withFiles) {
      for (const f of files.slice(0, 10)) {
        total += f.size;
        if (total > MAX_ATTACH_TOTAL) return { ok: false, error: "Los adjuntos del original superan los 18 MB; reenvía con include_attachments=false." };
        const a = await googleJson<{ data?: string }>(userId, "gmail", `${API}/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(f.attachment_id)}`);
        loaded.push({ filename: f.filename, mimeType: f.mime_type || "application/octet-stream", bytes: new Uint8Array(Buffer.from(a.data ?? "", "base64url")) });
      }
    }
    const raw = buildRaw({ to, cc: str(p.cc), subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`, body, attachments: loaded });
    const sent = await googleJson<any>(userId, "gmail", `${API}/messages/send`, { method: "POST", body: { raw } });
    return { ok: true, id: sent.id, thread_id: sent.threadId, forwarded_attachments: loaded.length };
  },
});

// ─── Hilos y adjuntos recibidos ─────────────────────────────────────────────

export const gmailThreadTool = googleTool({
  name: "gmail_thread",
  description: "Read a whole conversation thread (all messages in order, text bodies trimmed). Spanish: leer conversación, hilo de correos, historial del correo",
  parameters: { type: "object", properties: { thread_id: { type: "string" } }, required: ["thread_id"] },
  run: async (p, { userId }) => {
    const id = str(p.thread_id);
    if (!id) return { ok: false, error: "thread_id es obligatorio." };
    const t = await googleJson<any>(userId, "gmail", `${API}/threads/${encodeURIComponent(id)}`, { query: { format: "full" } });
    const PER = 4000, TOTAL = 24_000;
    let used = 0;
    const messages = (t.messages ?? []).map((m: any) => {
      const body = extractBody(m.payload).slice(0, PER);
      used += body.length;
      return {
        id: m.id, from: header(m, "From"), to: header(m, "To"), date: header(m, "Date"), subject: header(m, "Subject"),
        body: used > TOTAL ? "[omitido por tamaño: usa gmail_read]" : body, attachments: attachments(m.payload),
      };
    });
    return { ok: true, thread_id: t.id, count: messages.length, messages };
  },
});

export const gmailAttachmentTool = googleTool({
  name: "gmail_attachment_download",
  description:
    "Download an attachment of a received email into a Hive artifact (ids come from gmail_read: message id + attachment_id). Spanish: descargar adjunto, guardar adjunto del correo",
  parameters: {
    type: "object",
    properties: { message_id: { type: "string" }, attachment_id: { type: "string" }, filename: { type: "string", description: "Original file name (for the extension)." } },
    required: ["message_id", "attachment_id"],
  },
  run: async (p, { userId, config }) => {
    const mid = str(p.message_id), aid = str(p.attachment_id);
    if (!mid || !aid) return { ok: false, error: "message_id y attachment_id son obligatorios." };
    const a = await googleJson<{ data?: string; size?: number }>(userId, "gmail", `${API}/messages/${encodeURIComponent(mid)}/attachments/${encodeURIComponent(aid)}`);
    const bytes = new Uint8Array(Buffer.from(a.data ?? "", "base64url"));
    if (!bytes.byteLength) return { ok: false, error: "El adjunto está vacío." };
    const filename = str(p.filename);
    const ext = filename ? /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase() : undefined;
    const mime = ext === "pdf" ? "application/pdf" : "application/octet-stream";
    const artifact = await createArtifact({
      bytes, mimeType: mime, kind: "gmail_attachment", userId, extension: ext,
      visible: { workspace: getWorkspace(config), folder: "descargas", label: filename ? filename.replace(/\.[^.]+$/, "") : "adjunto" },
      runId: config?.configurable?.run_id ?? null, taskId: config?.configurable?.task_id ?? null,
    });
    return { ok: true, artifact_id: artifact.id, size: bytes.byteLength, filename };
  },
});

export const gmailTools = [
  gmailSearchTool, gmailReadTool, gmailThreadTool,
  gmailSendTool, gmailReplyTool, gmailForwardTool,
  gmailDraftSaveTool, gmailDraftListTool, gmailDraftSendTool, gmailDraftDeleteTool,
  gmailModifyTool, gmailLabelsTool, gmailAttachmentTool,
];
