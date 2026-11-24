process.env.HIVE_DB_PATH = ":memory:";
process.env.HIVE_PUBLIC_URL = "https://hive.test";
process.env.HIVE_AUTH_TOKEN = "tok-test";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import { saveUserProfile } from "../packages/core/src/storage/onboarding";
import type { AgentDoc, ToolDoc } from "../packages/core/src/storage/collections";
import { handleGoogleCallback, handleGoogleConnect, handleGoogleDisconnect, handleGoogleStatus } from "../packages/core/src/gateway/routes/google";
import { handleUpdateAgent } from "../packages/core/src/gateway/routes/agents";
import { resetGoogleHostState } from "../packages/core/src/gateway/google-host";
import { syncGoogleCapabilities } from "../packages/core/src/storage/google-capabilities";
import { MemoryGoogleTokenStore, configureGoogle, getGoogleConfig, resetGoogle } from "../packages/core/src/google";
import { searchCapabilities } from "../packages/core/src/agent/capability-search";
import { syncToolCatalogToIndex } from "../packages/core/src/agent/tool-selector";
import { syncCatalogAgentsToIndex } from "../packages/core/src/agent/catalog-selector";

const cors = (r: Response) => r;
const GM = "https://www.googleapis.com/auth/gmail";

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
  resetGoogleHostState();
  configureGoogle({
    clientId: "cid", clientSecret: "sec", redirectUri: "https://hive.test/api/google/oauth/callback",
    tokenStore: new MemoryGoogleTokenStore(),
    fetch: (async () => new Response(JSON.stringify({
      access_token: "AT", refresh_token: "RT", expires_in: 3600,
      scope: `openid email profile ${GM}.modify ${GM}.send`,
      id_token: `x.${Buffer.from(JSON.stringify({ sub: "g1", email: "ada@example.com", email_verified: true })).toString("base64url")}.y`,
    }), { status: 200 })) as unknown as typeof fetch,
  }) ;
  await syncGoogleCapabilities("seed"); // el seed corre antes de que Google esté configurado en producción: se repite aquí
});

afterEach(() => { resetGoogle(); closeHiveDb(); });

const agent = async (id: string) => (await (await col<AgentDoc>("agents")).get(id))!.doc;
const toolsOf = async (prefix: string) =>
  (await (await col<ToolDoc>("tools")).scan({})).map((e) => e.doc).filter((t) => t.name.startsWith(prefix));

async function connectGmail() {
  await saveUserProfile({ userName: "Ada" });
  const r = await handleGoogleConnect(new Request("https://hive.test/api/google/connect", { method: "POST", body: JSON.stringify({ services: ["gmail"] }) }), cors);
  const state = new URL((await r.json() as { url: string }).url).searchParams.get("state");
  await handleGoogleCallback(new Request(`https://hive.test/api/google/oauth/callback?code=c&state=${state}`));
}

const patchAgent = (id: string, body: unknown) =>
  handleUpdateAgent(new Request(`https://hive.test/api/agents/${id}`, { method: "PUT", body: JSON.stringify(body) }), cors);

describe("agentes y tools de Google", () => {
  test("nacen inactivos y aparecen en la lista de tools con categoría google", async () => {
    for (const id of ["google_mail_agent", "google_calendar_agent", "google_drive_agent"]) {
      expect((await agent(id)).enabled).toBe(false);
    }
    const all = (await (await col<ToolDoc>("tools")).scan({})).map((e) => e.doc).filter((t) => t.category === "google");
    expect(all.length).toBe(21);
    expect(all.every((t) => !t.active && !t.enabled)).toBe(true);
    expect(all.map((t) => t.name)).toContain("gmail_reply");
  });

  test("conectar activa solo lo autorizado", async () => {
    await connectGmail();
    expect((await agent("google_mail_agent")).enabled).toBe(true);
    expect((await agent("google_calendar_agent")).enabled).toBe(false);
    expect((await agent("google_drive_agent")).enabled).toBe(false);
    expect((await toolsOf("gmail_")).every((t) => t.active)).toBe(true);
    expect((await toolsOf("gcal_")).every((t) => !t.active)).toBe(true);
    expect((await toolsOf("gdrive_")).every((t) => !t.active)).toBe(true);
  });

  test("no se puede activar a mano un agente de un servicio sin conectar", async () => {
    await connectGmail();
    const res = await patchAgent("google_calendar_agent", { enabled: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needs_google: true });
    expect((await agent("google_calendar_agent")).enabled).toBe(false);
    expect((await patchAgent("google_mail_agent", { enabled: true })).status).toBe(200);
  });

  test("desconectar los apaga todos", async () => {
    await connectGmail();
    await handleGoogleDisconnect(new Request("https://hive.test/api/google/disconnect", { method: "POST" }), cors);
    expect((await agent("google_mail_agent")).enabled).toBe(false);
    expect((await toolsOf("gmail_")).every((t) => !t.active)).toBe(true);
  });

  test("al arrancar no reactiva lo que el usuario apagó a mano", async () => {
    await connectGmail();
    await patchAgent("google_mail_agent", { enabled: false });
    await syncGoogleCapabilities("boot");
    expect((await agent("google_mail_agent")).enabled).toBe(false);
  });

  test("migración: una conexión que ya existía activa sus agentes una sola vez y luego respeta lo apagado a mano", async () => {
    // Estado de quien conectó antes de que los agentes nacieran apagados: tokens + vínculo, agentes inactivos.
    const userId = await saveUserProfile({ userName: "Ada" });
    await getGoogleConfig().tokenStore.put(userId, {
      accessToken: "A", refreshToken: "R", expiresAt: Date.now() + 3_600_000, email: "ada@example.com",
      scopes: [`${GM}.modify`, `${GM}.send`],
    });
    expect((await agent("google_mail_agent")).enabled).toBe(false);

    await syncGoogleCapabilities("boot");
    expect((await agent("google_mail_agent")).enabled).toBe(true);
    expect((await agent("google_calendar_agent")).enabled).toBe(false); // sin ese permiso

    await patchAgent("google_mail_agent", { enabled: false });
    await syncGoogleCapabilities("boot");
    await syncGoogleCapabilities("seed");
    expect((await agent("google_mail_agent")).enabled).toBe(false);
  });

  test("el modelo no descubre tools ni agentes de Google hasta que hay conexión, y deja de verlos al desconectar", async () => {
    const seen = async () => ({
      tools: (await searchCapabilities("enviar correo gmail responder", { types: ["tool"], k: 20 })).map((h) => h.rawId),
      agents: (await searchCapabilities("correo gmail", { types: ["agent"], k: 20 })).map((h) => h.rawId),
    });
    await syncToolCatalogToIndex();
    await syncCatalogAgentsToIndex();
    let now = await seen();
    expect(now.tools.filter((n) => n.startsWith("gmail_"))).toEqual([]);
    expect(now.agents).not.toContain("google_mail_agent");

    await connectGmail(); // sincroniza capacidades y reindexa
    now = await seen();
    expect(now.tools.some((n) => n.startsWith("gmail_"))).toBe(true);
    expect(now.agents).toContain("google_mail_agent");

    await handleGoogleDisconnect(new Request("https://hive.test/api/google/disconnect", { method: "POST" }), cors);
    now = await seen();
    expect(now.tools.filter((n) => n.startsWith("gmail_"))).toEqual([]);
    expect(now.agents).not.toContain("google_mail_agent");
  });

  test("el estado informa qué agente activa cada servicio y la URI de retorno", async () => {
    await connectGmail();
    const st = await (await handleGoogleStatus(new Request("https://hive.test/api/google/status"), cors)).json() as any;
    expect(st.redirectUri).toBe("https://hive.test/api/google/oauth/callback");
    expect(st.agents.gmail).toMatchObject({ id: "google_mail_agent", enabled: true });
    expect(st.agents.calendar.enabled).toBe(false);
  });
});
