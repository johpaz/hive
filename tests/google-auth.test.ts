process.env.HIVE_DB_PATH = ":memory:";
process.env.HIVE_PUBLIC_URL = "https://hive.test";
process.env.HIVE_AUTH_TOKEN = "tok-test";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import { saveUserProfile } from "../packages/core/src/storage/onboarding";
import type { UserDoc } from "../packages/core/src/storage/collections";
import { handleAuthStatus, isAuthEnabled } from "../packages/core/src/gateway/routes/auth";
import {
  handleGoogleCallback, handleGoogleConnect, handleGoogleExchange, handleGoogleLoginStart, handleGoogleStatus,
  handleGoogleLoginStartExternal, handleGoogleTicket,
} from "../packages/core/src/gateway/routes/google";
import { resetGoogleHostState, setExternalOpener } from "../packages/core/src/gateway/google-host";
import { MemoryGoogleTokenStore, configureGoogle, resetGoogle } from "../packages/core/src/google";

const cors = (r: Response) => r;
let store: MemoryGoogleTokenStore;
let idClaims: Record<string, unknown>;

const idToken = () => `x.${Buffer.from(JSON.stringify(idClaims)).toString("base64url")}.y`;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
  resetGoogleHostState();
  store = new MemoryGoogleTokenStore();
  idClaims = { sub: "g-1", email: "Ada@Example.com", email_verified: true };
  configureGoogle({
    clientId: "cid", clientSecret: "sec", redirectUri: "https://hive.test/api/google/oauth/callback", tokenStore: store,
    fetch: (async () => new Response(JSON.stringify({
      access_token: "AT", refresh_token: "RT", expires_in: 3600,
      scope: "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send",
      id_token: idToken(),
    }), { status: 200 })) as unknown as typeof fetch,
  });
});

afterEach(() => { resetGoogle(); closeHiveDb(); });

const get = (path: string) => new Request(`https://hive.test${path}`);
const post = (path: string, body: unknown) =>
  new Request(`https://hive.test${path}`, { method: "POST", body: JSON.stringify(body) });
const stateOf = (location: string) => new URL(location).searchParams.get("state")!;
const loc = (r: Response) => r.headers.get("location")!;

async function connect(): Promise<string> {
  const r = await handleGoogleConnect(post("/api/google/connect", { services: ["gmail"] }), cors);
  return stateOf((await r.json() as { url: string }).url);
}

describe("redirect por solicitud (localhost / escritorio)", () => {
  const prev = process.env.GOOGLE_REDIRECT_URI;
  afterEach(() => { if (prev === undefined) delete process.env.GOOGLE_REDIRECT_URI; else process.env.GOOGLE_REDIRECT_URI = prev; });

  test("en loopback usa el origen real, con su puerto, y vuelve a ese mismo origen", async () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    await saveUserProfile({ userName: "Ada" });
    const start = await handleGoogleLoginStart(new Request("http://127.0.0.1:41337/api/auth/google/start"), cors);
    const url = new URL(loc(start));
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:41337/api/google/oauth/callback");

    // vincular desde 127.0.0.1:41337 y comprobar que el retorno es a ese origen, no a HIVE_PUBLIC_URL
    const c = await handleGoogleConnect(new Request("http://127.0.0.1:41337/api/google/connect", { method: "POST", body: JSON.stringify({ services: [] }) }), cors);
    const st = stateOf((await c.json() as { url: string }).url);
    const r = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c&state=${st}`));
    expect(loc(r)).toStartWith("http://127.0.0.1:41337/login?google_code=");
  });

  test("tras un proxy (X-Forwarded-For) no se trata como loopback", async () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    const req = new Request("http://127.0.0.1:18790/api/auth/google/start", { headers: { "x-forwarded-for": "8.8.8.8" } });
    expect(new URL(loc(await handleGoogleLoginStart(req, cors))).searchParams.get("redirect_uri")).toBe("https://hive.test/api/google/oauth/callback");
  });

  test("GOOGLE_REDIRECT_URI fijo manda sobre todo lo demás", async () => {
    process.env.GOOGLE_REDIRECT_URI = "https://otro.test/cb";
    const start = await handleGoogleLoginStart(new Request("http://127.0.0.1:18790/api/auth/google/start"), cors);
    expect(new URL(loc(start)).searchParams.get("redirect_uri")).toBe("https://otro.test/cb");
  });
});

describe("traspaso al navegador del sistema (app de escritorio)", () => {
  const prev = process.env.HIVE_GATEWAY_CHILD;
  const desktop = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:18790${path}`, init);
  let opened: string[];
  beforeEach(() => { opened = []; setExternalOpener((u) => { opened.push(u); }); process.env.HIVE_GATEWAY_CHILD = "1"; delete process.env.GOOGLE_REDIRECT_URI; });
  afterEach(() => { if (prev === undefined) delete process.env.HIVE_GATEWAY_CHILD; else process.env.HIVE_GATEWAY_CHILD = prev; });

  test("solo funciona en el gateway hijo del escritorio y por loopback", async () => {
    delete process.env.HIVE_GATEWAY_CHILD;
    expect((await handleGoogleLoginStartExternal(desktop("/x", { method: "POST" }), cors)).status).toBe(403);
    process.env.HIVE_GATEWAY_CHILD = "1";
    const remote = new Request("https://hive.test/x", { method: "POST" });
    expect((await handleGoogleLoginStartExternal(remote, cors)).status).toBe(403);
    expect(opened).toEqual([]);
  });

  test("login: abre solo accounts.google.com, la app consulta el ticket y recibe el token una vez", async () => {
    await saveUserProfile({ userName: "Ada" });
    // vincular primero (flujo normal)
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c0&state=${await connect()}`));

    const r = await handleGoogleLoginStartExternal(desktop("/api/auth/google/start-external", { method: "POST" }), cors);
    const { ticket } = await r.json() as { ticket: string };
    expect(new URL(opened[0]!).origin).toBe("https://accounts.google.com");
    expect(new URL(opened[0]!).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:18790/api/google/oauth/callback");
    const poll = async () => await (await handleGoogleTicket(get(`/api/google/ticket?id=${ticket}`), cors)).json() as any;
    expect(await poll()).toEqual({ status: "pending" });

    const page = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${stateOf(opened[0]!)}`));
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("ya puedes volver a Hive");

    expect(await poll()).toMatchObject({ status: "done", purpose: "login", authToken: "tok-test" });
    expect((await poll()).status).toBe("error"); // se entrega una sola vez
  });

  test("un login con otra cuenta resuelve el ticket con error y sin token", async () => {
    await saveUserProfile({ userName: "Ada" });
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c0&state=${await connect()}`));
    idClaims = { sub: "intruso", email: "x@y.z", email_verified: true };
    const { ticket } = await (await handleGoogleLoginStartExternal(desktop("/s", { method: "POST" }), cors)).json() as { ticket: string };
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${stateOf(opened[0]!)}`));
    const res = await (await handleGoogleTicket(get(`/api/google/ticket?id=${ticket}`), cors)).json() as any;
    expect(res).toEqual({ status: "error", error: "not_linked" });
  });

  test("conectar con external vincula, y si la instancia estaba abierta entrega sesión por el ticket", async () => {
    await saveUserProfile({ userName: "Ada" });
    const req = desktop("/api/google/connect", { method: "POST", body: JSON.stringify({ external: true, services: ["gmail"] }) });
    const { ticket } = await (await handleGoogleConnect(req, cors)).json() as { ticket: string };
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c&state=${stateOf(opened[0]!)}`));
    expect(await (await handleGoogleTicket(get(`/api/google/ticket?id=${ticket}`), cors)).json()).toMatchObject({ status: "done", purpose: "login", authToken: "tok-test" });
  });

  test("ticket desconocido o vencido", async () => {
    expect(await (await handleGoogleTicket(get("/api/google/ticket?id=nada"), cors)).json()).toEqual({ status: "error", error: "expired" });
  });
});

describe("login y conexión con Google", () => {
  test("conectar vincula la cuenta, guarda tokens y protege una instancia abierta", async () => {
    const userId = await saveUserProfile({ userName: "Ada" });
    const r = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${await connect()}`));
    expect(loc(r)).toStartWith("https://hive.test/login?google_code=");

    const user = (await (await col<UserDoc>("users")).get(userId))!.doc;
    expect(user).toMatchObject({ google_sub: "g-1", google_email: "ada@example.com", email: "ada@example.com" });
    expect(isAuthEnabled(user)).toBe(true);
    expect((await store.get(userId))?.refreshToken).toBe("RT");

    const status = await (await handleAuthStatus(get("/api/auth/status"), cors)).json() as any;
    expect(status).toMatchObject({ hasCredentials: true, hasPassword: false, googleLogin: true });

    const g = await (await handleGoogleStatus(get("/api/google/status"), cors)).json() as any;
    expect(g).toMatchObject({ configured: true, linked: true, connected: true, services: ["gmail"] });
  });

  test("el código de login se canjea una sola vez", async () => {
    await saveUserProfile({ userName: "Ada" });
    const code = new URL(loc(await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${await connect()}`)))).searchParams.get("google_code");
    const ok = await handleGoogleExchange(post("/api/auth/google/exchange", { code }), cors);
    expect((await ok.json() as any).authToken).toBe("tok-test");
    expect((await handleGoogleExchange(post("/api/auth/google/exchange", { code }), cors)).status).toBe(401);
    expect((await handleGoogleExchange(post("/api/auth/google/exchange", { code: "inventado" }), cors)).status).toBe(401);
  });

  test("iniciar sesión solo funciona con la cuenta vinculada", async () => {
    await saveUserProfile({ userName: "Ada" });
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${await connect()}`));

    const start = await handleGoogleLoginStart(get("/api/auth/google/start"), cors);
    const url = new URL(loc(start));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).not.toContain("gmail");

    const okLogin = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c2&state=${url.searchParams.get("state")}`));
    expect(loc(okLogin)).toContain("/login?google_code=");

    idClaims = { sub: "otra-cuenta", email: "intruso@example.com", email_verified: true };
    const s2 = stateOf(loc(await handleGoogleLoginStart(get("/api/auth/google/start"), cors)));
    const denied = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c3&state=${s2}`));
    expect(loc(denied)).toBe("https://hive.test/login?google_error=not_linked");
  });

  test("rechaza emails sin verificar, state inválido o reutilizado y consentimiento denegado", async () => {
    await saveUserProfile({ userName: "Ada" });
    idClaims = { sub: "g-1", email: "ada@example.com", email_verified: false };
    expect(loc(await handleGoogleCallback(get(`/api/google/oauth/callback?code=c&state=${await connect()}`)))).toContain("google_error=unverified_email");

    idClaims = { sub: "g-1", email: "ada@example.com", email_verified: true };
    const state = await connect();
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c&state=${state}`));
    expect(loc(await handleGoogleCallback(get(`/api/google/oauth/callback?code=c&state=${state}`)))).toContain("google_error=invalid_state");
    expect(loc(await handleGoogleCallback(get("/api/google/oauth/callback?code=c")))).toContain("google_error=invalid_state");

    const denied = await handleGoogleCallback(get(`/api/google/oauth/callback?error=access_denied&state=${await connect()}`));
    expect(loc(denied)).toBe("https://hive.test/settings/perfil?google_error=denied");
  });

  test("una vez vinculada, otra cuenta de Google no puede reconectarse", async () => {
    const userId = await saveUserProfile({ userName: "Ada" });
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${await connect()}`));
    idClaims = { sub: "g-2", email: "otra@example.com", email_verified: true };
    const r = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c2&state=${await connect()}`));
    expect(loc(r)).toBe("https://hive.test/settings/perfil?google_error=other_account");
    expect((await (await col<UserDoc>("users")).get(userId))!.doc.google_sub).toBe("g-1");
  });

  test("sin configurar, las rutas responden 503 y el estado lo indica", async () => {
    resetGoogle();
    expect((await handleGoogleConnect(post("/api/google/connect", {}), cors)).status).toBe(503);
    expect((await handleGoogleLoginStart(get("/api/auth/google/start"), cors)).status).toBe(503);
    expect(await (await handleGoogleStatus(get("/api/google/status"), cors)).json()).toEqual({ configured: false });
  });
});
