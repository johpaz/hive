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
import * as googleRoutes from "../packages/core/src/gateway/routes/google";
import {
  handleGoogleCallback, handleGoogleConnect, handleGoogleStatus, handleGoogleTicket,
} from "../packages/core/src/gateway/routes/google";
import * as googleHost from "../packages/core/src/gateway/google-host";
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

/** redirect_uri que Hive manda a Google al conectar desde una solicitud dada. */
async function redirectUriFor(req: Request): Promise<string> {
  const r = await handleGoogleConnect(req, cors);
  return new URL((await r.json() as { url: string }).url).searchParams.get("redirect_uri")!;
}
const connectReq = (origin: string, headers?: Record<string, string>) =>
  new Request(`${origin}/api/google/connect`, { method: "POST", body: JSON.stringify({ services: [] }), headers });

describe("redirect por solicitud (localhost / escritorio)", () => {
  const prev = process.env.GOOGLE_REDIRECT_URI;
  afterEach(() => { if (prev === undefined) delete process.env.GOOGLE_REDIRECT_URI; else process.env.GOOGLE_REDIRECT_URI = prev; });

  test("en loopback usa el origen real, con su puerto, y vuelve a ese mismo origen", async () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    await saveUserProfile({ userName: "Ada" });
    expect(await redirectUriFor(connectReq("http://127.0.0.1:41337"))).toBe("http://127.0.0.1:41337/api/google/oauth/callback");

    // vincular desde 127.0.0.1:41337 y comprobar que el retorno es a ese origen, no a HIVE_PUBLIC_URL
    const c = await handleGoogleConnect(connectReq("http://127.0.0.1:41337"), cors);
    const st = stateOf((await c.json() as { url: string }).url);
    const r = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c&state=${st}`));
    expect(loc(r)).toBe("http://127.0.0.1:41337/settings/perfil?google=connected");
  });

  test("tras un proxy (X-Forwarded-For) no se trata como loopback", async () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    await saveUserProfile({ userName: "Ada" });
    expect(await redirectUriFor(connectReq("http://127.0.0.1:18790", { "x-forwarded-for": "8.8.8.8" }))).toBe("https://hive.test/api/google/oauth/callback");
  });

  test("GOOGLE_REDIRECT_URI fijo manda sobre todo lo demás", async () => {
    process.env.GOOGLE_REDIRECT_URI = "https://otro.test/cb";
    await saveUserProfile({ userName: "Ada" });
    expect(await redirectUriFor(connectReq("http://127.0.0.1:18790"))).toBe("https://otro.test/cb");
  });
});

describe("traspaso al navegador del sistema (app de escritorio)", () => {
  const prev = process.env.HIVE_GATEWAY_CHILD;
  const desktop = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:18790${path}`, init);
  let opened: string[];
  beforeEach(() => { opened = []; setExternalOpener((u) => { opened.push(u); }); process.env.HIVE_GATEWAY_CHILD = "1"; delete process.env.GOOGLE_REDIRECT_URI; });
  afterEach(() => { if (prev === undefined) delete process.env.HIVE_GATEWAY_CHILD; else process.env.HIVE_GATEWAY_CHILD = prev; });

  const externalConnect = (init?: { remote?: boolean }) => {
    const url = init?.remote ? "https://hive.test/api/google/connect" : "http://127.0.0.1:18790/api/google/connect";
    return new Request(url, { method: "POST", body: JSON.stringify({ external: true, services: ["gmail"] }) });
  };

  test("solo funciona en el gateway hijo del escritorio y por loopback", async () => {
    await saveUserProfile({ userName: "Ada" });
    delete process.env.HIVE_GATEWAY_CHILD;
    expect((await handleGoogleConnect(externalConnect(), cors)).status).toBe(403);
    process.env.HIVE_GATEWAY_CHILD = "1";
    expect((await handleGoogleConnect(externalConnect({ remote: true }), cors)).status).toBe(403);
    expect(opened).toEqual([]);
  });

  test("conectar con external abre solo accounts.google.com y la app lo sabe por el ticket, sin tocar la sesión", async () => {
    await saveUserProfile({ userName: "Ada" });
    const { ticket } = await (await handleGoogleConnect(externalConnect(), cors)).json() as { ticket: string };
    expect(new URL(opened[0]!).origin).toBe("https://accounts.google.com");
    expect(new URL(opened[0]!).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:18790/api/google/oauth/callback");
    const poll = async () => await (await handleGoogleTicket(get(`/api/google/ticket?id=${ticket}`), cors)).json() as any;
    expect(await poll()).toEqual({ status: "pending" });

    const page = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c&state=${stateOf(opened[0]!)}`));
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("ya puedes volver a Hive");

    const done = await poll();
    expect(done).toEqual({ status: "done", purpose: "connect" }); // sin authToken: Google no abre sesión
    expect(JSON.stringify(done)).not.toContain("tok-test");
    expect((await poll()).status).toBe("error"); // se entrega una sola vez
  });

  test("ticket desconocido o vencido", async () => {
    expect(await (await handleGoogleTicket(get("/api/google/ticket?id=nada"), cors)).json()).toEqual({ status: "error", error: "expired" });
  });
});

describe("Google no es un inicio de sesión", () => {
  test("las rutas y utilidades de login con Google ya no existen", () => {
    for (const name of ["handleGoogleLoginStart", "handleGoogleLoginStartExternal", "handleGoogleExchange"]) {
      expect(name in googleRoutes).toBe(false);
    }
    for (const name of ["issueLoginCode", "consumeLoginCode"]) expect(name in googleHost).toBe(false);
  });

  test("solo la contraseña protege el acceso: una cuenta de Google vinculada sin contraseña NO lo activa", () => {
    expect(isAuthEnabled({ email: "ada@example.com", password_hash: null })).toBe(false);
    expect(isAuthEnabled({ email: "ada@example.com", password_hash: undefined })).toBe(false);
    expect(isAuthEnabled({ email: null, password_hash: "hash" })).toBe(false);
    expect(isAuthEnabled({ email: "ada@example.com", password_hash: "hash" })).toBe(true);
    expect(isAuthEnabled(undefined)).toBe(false);
    // aunque el usuario tenga google_sub, la decisión no lo mira
    expect(isAuthEnabled({ email: "ada@example.com", password_hash: null, google_sub: "g-1" } as never)).toBe(false);
  });
});

describe("conexión con Google", () => {
  test("conectar vincula la cuenta y guarda tokens, pero no protege ni pide iniciar sesión", async () => {
    const userId = await saveUserProfile({ userName: "Ada" });
    const r = await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${await connect()}`));
    expect(loc(r)).toBe("https://hive.test/settings/perfil?google=connected");

    const user = (await (await col<UserDoc>("users")).get(userId))!.doc;
    expect(user).toMatchObject({ google_sub: "g-1", google_email: "ada@example.com", email: "ada@example.com" });
    expect(isAuthEnabled(user)).toBe(false);
    expect((await store.get(userId))?.refreshToken).toBe("RT");

    const status = await (await handleAuthStatus(get("/api/auth/status"), cors)).json() as any;
    expect(status).toMatchObject({ hasCredentials: false, hasPassword: false });
    expect("googleLogin" in status).toBe(false);

    const g = await (await handleGoogleStatus(get("/api/google/status"), cors)).json() as any;
    expect(g).toMatchObject({ configured: true, linked: true, connected: true, services: ["gmail"] });
  });

  test("con una cuenta ya vinculada y sin contraseña, el acceso sigue abierto tras reiniciar", async () => {
    const userId = await saveUserProfile({ userName: "Ada" });
    await handleGoogleCallback(get(`/api/google/oauth/callback?code=c1&state=${await connect()}`));
    // el estado se vuelve a leer desde la base de datos, como después de un reinicio
    const reread = (await (await col<UserDoc>("users")).get(userId))!.doc;
    expect(reread.google_sub).toBe("g-1");
    expect(isAuthEnabled(reread)).toBe(false);
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
    expect(await (await handleGoogleStatus(get("/api/google/status"), cors)).json()).toEqual({ configured: false });
  });
});
