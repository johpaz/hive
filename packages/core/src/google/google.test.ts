import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  MemoryGoogleTokenStore, configureGoogle, resetGoogle, buildAuthUrl, generatePkce,
  exchangeCode, googleJson, scopesForServices, servicesCovered, parseServices,
} from "./index.ts";
import {
  gmailSendTool, gmailSearchTool, gmailReplyTool, gmailModifyTool, gmailDraftSaveTool,
  gmailDraftSendTool, gmailDraftDeleteTool, gmailLabelsTool, gmailForwardTool,
} from "../tools/google/gmail.ts";
import { gcalCreateEventTool, gcalDeleteEventTool } from "../tools/google/calendar.ts";
import { gdriveSearchTool } from "../tools/google/drive.ts";
import { createAllTools } from "../tools/index.ts";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let store: MemoryGoogleTokenStore;
let responder: (url: URL, init: RequestInit) => Response;

const ALL = scopesForServices(["gmail", "calendar", "drive"]);
const ctx = { configurable: { user_id: "u1" } };

function setup(tokens?: Partial<Parameters<MemoryGoogleTokenStore["put"]>[1]>) {
  store = new MemoryGoogleTokenStore();
  calls = [];
  configureGoogle({
    clientId: "cid", clientSecret: "sec", redirectUri: "https://hive.test/cb", tokenStore: store,
    fetch: (async (input: any, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), init });
      return responder(url, init);
    }) as typeof fetch,
  });
  if (tokens !== undefined) {
    return store.put("u1", { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000, scopes: ALL, email: "a@b.c", ...tokens });
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { responder = () => json({}); });
afterEach(() => resetGoogle());

describe("scopes", () => {
  it("pide solo los servicios habilitados e identidad", () => {
    const s = scopesForServices(["calendar"]);
    expect(s).toContain("openid");
    expect(s.some((x) => x.includes("calendar.events"))).toBe(true);
    expect(s.some((x) => x.includes("gmail"))).toBe(false);
  });
  it("servicesCovered exige todos los scopes del servicio", () => {
    expect(servicesCovered(scopesForServices(["gmail"]))).toEqual(["gmail"]);
    expect(servicesCovered(["openid"])).toEqual([]);
  });
  it("parseServices ignora lo desconocido", () => {
    expect(parseServices("gmail, foo ,drive")).toEqual(["gmail", "drive"]);
  });
});

describe("oauth", () => {
  it("la URL lleva PKCE S256, offline y consent", async () => {
    await setup();
    const { codeChallenge } = await generatePkce();
    const url = new URL(buildAuthUrl({ state: "st", codeChallenge }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe("https://hive.test/cb");
  });
  it("el redirectUri por solicitud sustituye al de la configuración en la URL y en el intercambio", async () => {
    await setup();
    const { codeChallenge } = await generatePkce();
    const uri = "http://127.0.0.1:41337/api/google/oauth/callback";
    expect(new URL(buildAuthUrl({ state: "s", codeChallenge, redirectUri: uri })).searchParams.get("redirect_uri")).toBe(uri);
    responder = () => json({ access_token: "A", expires_in: 3600 });
    await exchangeCode("c", "v", uri);
    expect(String(calls[0]!.init.body)).toContain(`redirect_uri=${encodeURIComponent(uri)}`);
  });
  it("exchangeCode devuelve tokens y email del id_token", async () => {
    await setup();
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "Me@X.com", sub: "123", email_verified: true })).toString("base64url")}.y`;
    responder = () => json({ access_token: "A", refresh_token: "R", expires_in: 3600, scope: "openid email", id_token: idToken });
    const t = await exchangeCode("code", "verifier");
    expect(t).toMatchObject({ accessToken: "A", refreshToken: "R", email: "me@x.com", sub: "123", emailVerified: true });
    const body = String(calls[0]!.init.body);
    expect(body).toContain("code_verifier=verifier");
  });
});

describe("client", () => {
  it("renueva el access token caducado una sola vez para llamadas concurrentes", async () => {
    await setup({ expiresAt: Date.now() - 1000 });
    responder = (url) => url.hostname === "oauth2.googleapis.com"
      ? json({ access_token: "NEW", expires_in: 3600 })
      : json({ ok: 1 });
    await Promise.all([
      googleJson("u1", "gmail", "https://gmail.googleapis.com/x"),
      googleJson("u1", "gmail", "https://gmail.googleapis.com/y"),
    ]);
    expect(calls.filter((c) => c.url.includes("oauth2.googleapis.com")).length).toBe(1);
    expect((await store.get("u1"))!.accessToken).toBe("NEW");
    expect(new Headers(calls.at(-1)!.init.headers).get("Authorization")).toBe("Bearer NEW");
  });
  it("invalid_grant borra la conexión", async () => {
    await setup({ expiresAt: Date.now() - 1000 });
    responder = () => json({ error: "invalid_grant" }, 400);
    await expect(googleJson("u1", "gmail", "https://gmail.googleapis.com/x")).rejects.toThrow(/caducó|revocada/);
    expect(await store.get("u1")).toBeNull();
  });
  it("401 provoca una renovación y un reintento", async () => {
    await setup({});
    let n = 0;
    responder = (url) => {
      if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "N2", expires_in: 3600 });
      return n++ === 0 ? json({ error: { message: "expired" } }, 401) : json({ done: true });
    };
    expect(await googleJson<unknown>("u1", "drive", "https://www.googleapis.com/drive/v3/files")).toEqual({ done: true });
  });
});

describe("tools", () => {
  it("sin conexión devuelve needs_connection", async () => {
    await setup();
    const r: any = await gmailSearchTool.execute({ query: "x" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.needs_connection).toBe(true);
  });
  it("sin scope del servicio devuelve needs_connection", async () => {
    await setup({ scopes: scopesForServices(["gmail"]) });
    const r: any = await gdriveSearchTool.execute({ query: "x" }, ctx);
    expect(r.needs_connection).toBe(true);
  });
  it("gmail_send pide confirmación y no llama a Google", async () => {
    await setup({});
    const r: any = await gmailSendTool.execute({ to: "a@b.c", subject: "Hola", body: "Texto" }, ctx);
    expect(r.needs_confirmation).toBe(true);
    expect(calls.length).toBe(0);
  });
  it("gmail_send confirmado arma un RFC822 en base64url y rechaza inyección de cabeceras", async () => {
    await setup({});
    responder = () => json({ id: "m1", threadId: "t1" });
    const r: any = await gmailSendTool.execute({ to: "a@b.c", subject: "Reunión ñ", body: "Hola", confirmed: true }, ctx);
    expect(r).toMatchObject({ ok: true, id: "m1" });
    const raw = Buffer.from(JSON.parse(String(calls[0]!.init.body)).raw, "base64url").toString();
    expect(raw).toContain("To: a@b.c");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    const bad: any = await gmailSendTool.execute({ to: "a@b.c\r\nBcc: x@y.z", subject: "s", body: "b", confirmed: true }, ctx);
    expect(bad.ok).toBe(false);
  });
  it("gcal_create_event con invitados exige confirmación; sin invitados no", async () => {
    await setup({});
    responder = () => json({ id: "e1", summary: "S", start: { dateTime: "2026-12-01T10:00:00-05:00" }, end: { dateTime: "2026-12-01T11:00:00-05:00" } });
    const base = { summary: "S", start: "2026-12-01T10:00:00-05:00", end: "2026-12-01T11:00:00-05:00" };
    const pend: any = await gcalCreateEventTool.execute({ ...base, attendees: ["x@y.z"] }, ctx);
    expect(pend.needs_confirmation).toBe(true);
    expect(calls.length).toBe(0);
    const ok: any = await gcalCreateEventTool.execute(base, ctx);
    expect(ok.ok).toBe(true);
  });
  it("gcal_delete_event exige confirmación", async () => {
    await setup({});
    const r: any = await gcalDeleteEventTool.execute({ event_id: "e1" }, ctx);
    expect(r.needs_confirmation).toBe(true);
  });
  it("gdrive_search escapa comillas en la consulta", async () => {
    await setup({});
    responder = () => json({ files: [] });
    await gdriveSearchTool.execute({ query: "o'brien" }, ctx);
    expect(new URL(calls[0]!.url).searchParams.get("q")).toContain("o\\'brien");
  });
});

describe("gmail: responder, borradores y organizar", () => {
  const orig = {
    id: "m1", threadId: "t1",
    payload: { headers: [
      { name: "From", value: "Ana <ana@x.com>" }, { name: "To", value: "yo@me.com, bob@x.com" },
      { name: "Cc", value: "eve@x.com" }, { name: "Subject", value: "Presupuesto" }, { name: "Message-ID", value: "<abc@x>" },
    ] },
  };
  const rawOf = (c: Call) => Buffer.from(JSON.parse(String(c.init.body)).raw ?? JSON.parse(String(c.init.body)).message.raw, "base64url").toString();

  it("gmail_reply mantiene hilo y cabeceras, y pide confirmación", async () => {
    await setup({});
    responder = (url) => url.pathname.endsWith("/profile") ? json({ emailAddress: "yo@me.com" })
      : url.pathname.endsWith("/messages/send") ? json({ id: "s1", threadId: "t1" }) : json(orig);
    const pend: any = await gmailReplyTool.execute({ message_id: "m1", body: "Gracias" }, ctx);
    expect(pend.needs_confirmation).toBe(true);
    expect(pend.preview.subject).toBe("Re: Presupuesto");
    const r: any = await gmailReplyTool.execute({ message_id: "m1", body: "Gracias", reply_all: true, confirmed: true }, ctx);
    expect(r.ok).toBe(true);
    const sendCall = calls.find((c) => c.url.includes("/messages/send"))!;
    const raw = rawOf(sendCall);
    expect(raw).toContain("To: Ana <ana@x.com>");
    expect(raw).toContain("Cc: bob@x.com, eve@x.com");   // sin la propia cuenta
    expect(raw).toContain("In-Reply-To: <abc@x>");
    expect(JSON.parse(String(sendCall.init.body)).threadId).toBe("t1");
  });
  it("gmail_reply con save_as_draft no envía ni pide confirmación", async () => {
    await setup({});
    responder = (url) => url.pathname.endsWith("/drafts") ? json({ id: "d1", message: { id: "dm1" } }) : json(orig);
    const r: any = await gmailReplyTool.execute({ message_id: "m1", body: "Borrador", save_as_draft: true }, ctx);
    expect(r).toMatchObject({ ok: true, draft_id: "d1" });
    expect(calls.some((c) => c.url.includes("/messages/send"))).toBe(false);
  });
  it("gmail_modify mark_read quita UNREAD en lote; trash usa el endpoint de papelera", async () => {
    await setup({});
    responder = () => new Response(null, { status: 204 });
    const r: any = await gmailModifyTool.execute({ message_ids: ["a", "b"], action: "mark_read" }, ctx);
    expect(r).toMatchObject({ ok: true, count: 2, removed: ["UNREAD"] });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ids: ["a", "b"], addLabelIds: [], removeLabelIds: ["UNREAD"] });
    calls.length = 0;
    await gmailModifyTool.execute({ message_ids: ["a"], action: "trash" }, ctx);
    expect(calls[0]!.url).toContain("/messages/a/trash");
  });
  it("gmail_modify resuelve etiquetas por nombre y rechaza las inexistentes", async () => {
    await setup({});
    responder = (url) => url.pathname.endsWith("/labels") ? json({ labels: [{ id: "Label_7", name: "Clientes" }] }) : new Response(null, { status: 204 });
    const ok: any = await gmailModifyTool.execute({ message_ids: ["a"], add_labels: ["clientes"] }, ctx);
    expect(ok.added).toEqual(["Label_7"]);
    const bad: any = await gmailModifyTool.execute({ message_ids: ["a"], add_labels: ["nada"] }, ctx);
    expect(bad.ok).toBe(false);
    const empty: any = await gmailModifyTool.execute({ message_ids: ["a"] }, ctx);
    expect(empty.ok).toBe(false);
  });
  it("borradores: guardar nuevo = POST, editar = PUT; enviar y borrar piden confirmación", async () => {
    await setup({});
    responder = (url) => url.pathname.includes("/drafts/send") ? json({ id: "s", threadId: "t" })
      : json({ id: "d1", message: { id: "dm", payload: { headers: [{ name: "To", value: "a@b.c" }, { name: "Subject", value: "S" }] } } });
    const f = { to: "a@b.c", subject: "S", body: "B" };
    await gmailDraftSaveTool.execute(f, ctx);
    await gmailDraftSaveTool.execute({ ...f, draft_id: "d1" }, ctx);
    expect(calls.map((c) => c.init.method)).toEqual(["POST", "PUT"]);
    expect(calls[1]!.url).toContain("/drafts/d1");
    calls.length = 0;
    const send: any = await gmailDraftSendTool.execute({ draft_id: "d1" }, ctx);
    expect(send.needs_confirmation).toBe(true);
    expect(calls.some((c) => c.url.includes("/drafts/send"))).toBe(false);
    expect(((await gmailDraftSendTool.execute({ draft_id: "d1", confirmed: true }, ctx)) as any).ok).toBe(true);
    expect(((await gmailDraftDeleteTool.execute({ draft_id: "d1" }, ctx)) as any).needs_confirmation).toBe(true);
  });
  it("gmail_forward incluye el original, antepone Fwd: y reenvía los adjuntos", async () => {
    await setup({});
    const full = { id: "m1", threadId: "t1", payload: {
      headers: [{ name: "From", value: "Ana <ana@x.com>" }, { name: "Subject", value: "Contrato" }, { name: "Date", value: "hoy" }, { name: "To", value: "yo@me.com" }],
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("Texto original").toString("base64url") } },
        { filename: "c.pdf", mimeType: "application/pdf", body: { attachmentId: "att1", size: 3 } },
      ] } };
    responder = (url) => url.pathname.includes("/attachments/") ? json({ data: Buffer.from("PDF").toString("base64url") })
      : url.pathname.endsWith("/messages/send") ? json({ id: "f1", threadId: "t9" }) : json(full);
    const pend: any = await gmailForwardTool.execute({ message_id: "m1", to: "pedro@x.com" }, ctx);
    expect(pend.needs_confirmation).toBe(true);
    expect(pend.preview.attachments).toEqual(["c.pdf"]);
    const r: any = await gmailForwardTool.execute({ message_id: "m1", to: "pedro@x.com", note: "Mira esto", confirmed: true }, ctx);
    expect(r).toMatchObject({ ok: true, forwarded_attachments: 1 });
    const raw = Buffer.from(JSON.parse(String(calls.at(-1)!.init.body)).raw, "base64url").toString();
    expect(raw).toContain("Subject: Fwd: Contrato");
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain('filename="c.pdf"');
  });
  it("gmail_labels renombra, protege las del sistema y borra con confirmación", async () => {
    await setup({});
    responder = (url, init) => url.pathname.endsWith("/labels")
      ? json({ labels: [{ id: "Label_1", name: "Clientes", type: "user" }, { id: "INBOX", name: "INBOX", type: "system" }] })
      : init.method === "PATCH" ? json({ id: "Label_1", name: "VIP" }) : new Response(null, { status: 204 });
    expect(((await gmailLabelsTool.execute({ label: "clientes", new_name: "VIP" }, ctx)) as any).renamed).toEqual({ id: "Label_1", from: "Clientes", to: "VIP" });
    expect(((await gmailLabelsTool.execute({ label: "INBOX", new_name: "X" }, ctx)) as any).ok).toBe(false);
    expect(((await gmailLabelsTool.execute({ delete: "Clientes" }, ctx)) as any).needs_confirmation).toBe(true);
    expect(((await gmailLabelsTool.execute({ delete: "Clientes", confirmed: true }, ctx)) as any).deleted).toBe("Clientes");
  });
  it("gmail_labels crea una etiqueta", async () => {
    await setup({});
    responder = () => json({ id: "Label_9", name: "Urgente" });
    expect(((await gmailLabelsTool.execute({ create: "Urgente" }, ctx)) as any).created).toEqual({ id: "Label_9", name: "Urgente" });
  });
});

describe("loadout", () => {
  it("las tools de Google solo entran si el host configuró Google", async () => {
    const names = (t: Array<{ name: string }>) => t.map((x) => x.name);
    expect(names(createAllTools({} as any))).not.toContain("gmail_search");
    await setup();
    expect(names(createAllTools({} as any))).toContain("gmail_search");
  });
});
