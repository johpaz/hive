/**
 * Rutas de Google: «Continuar con Google» y conexión de Gmail/Calendar/Drive.
 *
 * Un solo redirect URI (`/api/google/oauth/callback`) sirve a los dos flujos;
 * el propósito viaja en el `state`. Hive es de un solo usuario: iniciar sesión
 * con Google solo funciona con la cuenta que ese usuario vinculó antes desde
 * una sesión ya autenticada (no hay registro abierto).
 */
import { col } from "../../storage/hive";
import type { UserDoc } from "../../storage/collections";
import { normalizeUserEmail } from "../../storage/user-email";
import { buildAuthUrl, exchangeCode, generatePkce, generateState } from "../../google/oauth.ts";
import { disconnectGoogle } from "../../google/client.ts";
import { getGoogleConfig, isGoogleConfigured } from "../../google/config.ts";
import { GOOGLE_AGENT_BY_SERVICE, syncGoogleCapabilities } from "../../storage/google-capabilities.ts";
import { syncToolCatalogToIndex } from "../../agent/tool-selector";
import { syncCatalogAgentsToIndex } from "../../agent/catalog-selector";
import type { AgentDoc } from "../../storage/collections";
import { GOOGLE_SERVICES, servicesCovered, type GoogleService } from "../../google/scopes.ts";
import { currentAuthToken, isAuthEnabled } from "./auth";
import {
  consumeLoginCode, createTicket, isDesktopGatewayRequest, issueLoginCode, openExternal, pollTicket,
  resolveRedirectUri, resolveReturnOrigin, resolveTicket, saveState, takeState,
} from "../google-host.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("google-routes");

type Cors = (res: Response, req: Request) => Response;

async function getSingleUser(): Promise<{ id: string; version: number; doc: UserDoc } | undefined> {
  return (await (await col<UserDoc>("users")).scan({ limit: 1 }))[0];
}

/** Activa o desactiva lo de Google y refresca lo que ve el modelo (tools y agentes indexados). */
async function applyGoogleCapabilities(reason: "connect" | "disconnect"): Promise<void> {
  try {
    await syncGoogleCapabilities(reason);
    await Promise.all([syncToolCatalogToIndex(), syncCatalogAgentsToIndex()]);
  } catch (err) {
    log.warn(`Sincronizar capacidades de Google falló: ${(err as Error).message}`);
  }
}

function redirectTo(origin: string, path: string): Response {
  return Response.redirect(`${origin}${path}`, 302);
}

const ERROR_TEXT: Record<string, string> = {
  denied: "Cancelaste la autorización en Google.",
  invalid_state: "La solicitud caducó. Vuelve a intentarlo desde Hive.",
  exchange_failed: "Google rechazó la autorización. Vuelve a intentarlo desde Hive.",
  unverified_email: "La cuenta de Google no tiene el correo verificado.",
  other_account: "Ya hay otra cuenta de Google vinculada a este Hive.",
  not_linked: "Esa cuenta de Google no está vinculada a este Hive.",
  no_user: "Primero completa tu perfil en Hive.",
  not_configured: "Google no está configurado en este servidor.",
};

/** Página final en el navegador del sistema: la app de escritorio ya se entera por el ticket. */
function closingPage(ok: boolean, error?: string): Response {
  const title = ok ? "Listo, ya puedes volver a Hive" : "No se pudo completar";
  const detail = ok ? "Puedes cerrar esta pestaña." : ERROR_TEXT[error ?? ""] ?? "Vuelve a intentarlo desde Hive.";
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hive</title>
<body style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<main style="text-align:center;padding:2rem"><div style="font-size:3rem">${ok ? "🐝" : "⚠️"}</div><h1 style="font-size:1.25rem">${title}</h1><p style="color:#aaa">${detail}</p></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function notConfigured(req: Request, cors: Cors): Response {
  return cors(Response.json({ error: "Google no está configurado en este servidor (faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET)." }, { status: 503 }), req);
}

/** GET /api/google/status — requiere sesión */
export async function handleGoogleStatus(req: Request, cors: Cors): Promise<Response> {
  if (!isGoogleConfigured()) return cors(Response.json({ configured: false }), req);
  const user = await getSingleUser();
  const tokens = user ? await getGoogleConfig().tokenStore.get(user.id) : null;
  const agentsCol = await col<AgentDoc>("agents");
  const agents = Object.fromEntries(await Promise.all(
    (Object.entries(GOOGLE_AGENT_BY_SERVICE)).map(async ([service, id]) => {
      const row = await agentsCol.get(id);
      return [service, { id, name: row?.doc.name ?? id, enabled: !!row?.doc.enabled }] as const;
    }),
  ));
  return cors(Response.json({
    configured: true,
    // La URI que Hive enviará a Google desde este origen: debe estar registrada en el cliente OAuth.
    redirectUri: resolveRedirectUri(req),
    agents,
    availableServices: getGoogleConfig().services,
    linked: !!user?.doc.google_sub,
    email: user?.doc.google_email ?? null,
    connected: !!tokens,
    hasRefreshToken: !!tokens?.refreshToken,
    services: tokens ? servicesCovered(tokens.scopes) : [],
  }), req);
}

/** GET /api/auth/google/start — pública. Inicia «Continuar con Google». */
export async function handleGoogleLoginStart(req: Request, cors: Cors): Promise<Response> {
  if (!isGoogleConfigured()) return notConfigured(req, cors);
  const { codeVerifier, codeChallenge } = await generatePkce();
  const state = generateState();
  const redirectUri = resolveRedirectUri(req);
  saveState(state, { purpose: "login", userId: null, codeVerifier, services: [], redirectUri, origin: resolveReturnOrigin(req) });
  return Response.redirect(buildAuthUrl({ state, codeChallenge, services: [], redirectUri }), 302);
}

/**
 * POST /api/auth/google/start-external — pública, solo app de escritorio.
 * Abre el navegador del sistema y devuelve un ticket que la ventana consulta.
 */
export async function handleGoogleLoginStartExternal(req: Request, cors: Cors): Promise<Response> {
  if (!isGoogleConfigured()) return notConfigured(req, cors);
  if (!isDesktopGatewayRequest(req)) return cors(Response.json({ error: "Solo disponible en la app de escritorio." }, { status: 403 }), req);
  const { codeVerifier, codeChallenge } = await generatePkce();
  const state = generateState();
  const ticket = createTicket();
  const redirectUri = resolveRedirectUri(req);
  saveState(state, { purpose: "login", userId: null, codeVerifier, services: [], redirectUri, origin: resolveReturnOrigin(req), ticket });
  openExternal(buildAuthUrl({ state, codeChallenge, services: [], redirectUri }));
  return cors(Response.json({ ticket }), req);
}

/** GET /api/google/ticket?id=… — pública (el ticket es un secreto de 256 bits). */
export async function handleGoogleTicket(req: Request, cors: Cors): Promise<Response> {
  const result = pollTicket(new URL(req.url).searchParams.get("id"));
  if (result.status === "done" && result.purpose === "login") {
    return cors(Response.json({ ...result, authToken: currentAuthToken() }), req);
  }
  return cors(Response.json(result), req);
}

/** POST /api/google/connect — requiere sesión. body: { services?: string[] } → { url } */
export async function handleGoogleConnect(req: Request, cors: Cors): Promise<Response> {
  if (!isGoogleConfigured()) return notConfigured(req, cors);
  const user = await getSingleUser();
  if (!user) return cors(Response.json({ error: "No hay un usuario configurado." }, { status: 409 }), req);
  const body = await req.json().catch(() => ({})) as { services?: unknown; external?: boolean };
  const enabled = getGoogleConfig().services;
  const services = (Array.isArray(body.services) ? body.services : [...enabled])
    .filter((s): s is GoogleService => typeof s === "string" && (GOOGLE_SERVICES as readonly string[]).includes(s) && enabled.includes(s as GoogleService));
  const { codeVerifier, codeChallenge } = await generatePkce();
  const state = generateState();
  const redirectUri = resolveRedirectUri(req);
  const external = body.external === true;
  if (external && !isDesktopGatewayRequest(req)) {
    return cors(Response.json({ error: "Solo disponible en la app de escritorio." }, { status: 403 }), req);
  }
  const ticket = external ? createTicket() : undefined;
  saveState(state, { purpose: "connect", userId: user.id, codeVerifier, services, redirectUri, origin: resolveReturnOrigin(req), ticket });
  const url = buildAuthUrl({ state, codeChallenge, services, redirectUri, loginHint: user.doc.google_email ?? user.doc.email ?? undefined });
  if (external) {
    openExternal(url);
    return cors(Response.json({ ticket }), req);
  }
  return cors(Response.json({ url }), req);
}

/** GET /api/google/oauth/callback — pública (la llama Google). */
export async function handleGoogleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = takeState(url.searchParams.get("state"));
  // Con ticket (escritorio) el resultado va a la ventana de la app y el navegador solo muestra un cierre.
  const finish = (r: { ok: true; next: string; asLogin?: boolean } | { ok: false; error: string }): Response => {
    if ("error" in r) {
      if (state?.ticket) {
        resolveTicket(state.ticket, { status: "error", error: r.error });
        return closingPage(false, r.error);
      }
      const origin = state?.origin ?? resolveReturnOrigin(req);
      return redirectTo(origin, state?.purpose === "connect" ? `/settings/perfil?google_error=${r.error}` : `/login?google_error=${r.error}`);
    }
    if (state?.ticket) {
      resolveTicket(state.ticket, { status: "done", purpose: r.asLogin ? "login" : state.purpose });
      return closingPage(true);
    }
    return redirectTo(state?.origin ?? resolveReturnOrigin(req), r.next);
  };

  if (!isGoogleConfigured()) return finish({ ok: false, error: "not_configured" });
  if (!state) return finish({ ok: false, error: "invalid_state" });
  if (url.searchParams.get("error")) return finish({ ok: false, error: "denied" });
  const code = url.searchParams.get("code");
  if (!code) return finish({ ok: false, error: "denied" });

  let tokens;
  try {
    tokens = await exchangeCode(code, state.codeVerifier, state.redirectUri);
  } catch (err) {
    log.warn(`Intercambio de código falló: ${(err as Error).message}`);
    return finish({ ok: false, error: "exchange_failed" });
  }
  if (!tokens.sub || !tokens.email || !tokens.emailVerified) return finish({ ok: false, error: "unverified_email" });

  const usersCol = await col<UserDoc>("users");
  const user = await getSingleUser();
  if (!user) return finish({ ok: false, error: "no_user" });

  if (state.purpose === "login") {
    // Solo entra la cuenta ya vinculada: nunca se auto-registra a un tercero.
    if (user.doc.google_sub !== tokens.sub) return finish({ ok: false, error: "not_linked" });
    return finish({ ok: true, next: `/login?google_code=${issueLoginCode()}` });
  }

  // connect: la sesión que lo pidió debe ser la del usuario.
  if (state.userId !== user.id) return finish({ ok: false, error: "invalid_state" });
  // Una vez vinculada una cuenta, solo esa cuenta puede reconectarse.
  if (user.doc.google_sub && user.doc.google_sub !== tokens.sub) return finish({ ok: false, error: "other_account" });

  const wasProtected = isAuthEnabled(user.doc);
  if (!tokens.refreshToken) {
    const prev = await getGoogleConfig().tokenStore.get(user.id);
    tokens.refreshToken = prev?.refreshToken ?? null;
  }
  await getGoogleConfig().tokenStore.put(user.id, tokens);

  let email = user.doc.email;
  if (!email) {
    try { email = normalizeUserEmail(tokens.email); } catch { email = null; }
  }
  await usersCol.put(user.id, {
    ...user.doc, email, google_sub: tokens.sub, google_email: tokens.email,
  }, { expectedVersion: user.version });

  // Si la instancia estaba abierta, vincular Google la protege: la sesión que lo pidió
  // recibe un código de login para no quedar fuera (en escritorio basta con el ticket de "connect"
  // y la app reinicia sesión con "Continuar con Google").
  const nowProtected = isAuthEnabled({ email, password_hash: user.doc.password_hash, google_sub: tokens.sub });
  await applyGoogleCapabilities("connect");
  const promote = !wasProtected && nowProtected;
  return finish({ ok: true, next: promote ? `/login?google_code=${issueLoginCode()}` : "/settings/perfil?google=connected", asLogin: promote });
}

/** POST /api/auth/google/exchange — pública. body: { code } → { authToken } */
export async function handleGoogleExchange(req: Request, cors: Cors): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { code?: string };
  if (!consumeLoginCode(body.code)) {
    return cors(Response.json({ error: "Código inválido o vencido" }, { status: 401 }), req);
  }
  return cors(Response.json({ authToken: currentAuthToken() }), req);
}

/** POST /api/google/disconnect — requiere sesión. Revoca y borra los tokens; conserva el vínculo de inicio de sesión. */
export async function handleGoogleDisconnect(req: Request, cors: Cors): Promise<Response> {
  if (!isGoogleConfigured()) return notConfigured(req, cors);
  const user = await getSingleUser();
  if (user) await disconnectGoogle(user.id);
  await applyGoogleCapabilities("disconnect");
  return cors(Response.json({ ok: true }), req);
}
