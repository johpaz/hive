/**
 * Integración de Hive con el módulo `google/`: credenciales desde el entorno,
 * tokens cifrados en el almacén de secretos y estado efímero del flujo OAuth.
 */
import { configureGoogle, isGoogleConfigured } from "../google/config.ts";
import { parseServices } from "../google/scopes.ts";
import type { GoogleService } from "../google/scopes.ts";
import type { GoogleTokenSet, GoogleTokenStore } from "../google/token-store.ts";
import { deleteSecret, loadSecret, storeSecret } from "../storage/crypto.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child("google");

const secretKey = (userId: string) => `google:tokens:${userId}`;

/** Los tokens van por el almacén de secretos (keychain o colección cifrada), nunca en claro. */
export const secretTokenStore: GoogleTokenStore = {
  async get(userId) {
    const raw = await loadSecret(secretKey(userId));
    if (!raw) return null;
    try { return JSON.parse(raw) as GoogleTokenSet; } catch { return null; }
  },
  async put(userId, tokens) {
    await storeSecret(secretKey(userId), JSON.stringify(tokens));
  },
  async delete(userId) {
    await deleteSecret(secretKey(userId));
  },
};

export function publicBaseUrl(): string | null {
  const v = process.env.HIVE_PUBLIC_URL?.replace(/\/$/, "");
  return v || null;
}

/**
 * Activa Google si hay `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Idempotente.
 * Sin ellas no pasa nada: las tools no entran al loadout y la UI oculta el botón.
 */
export function initGoogleFromEnv(): boolean {
  if (isGoogleConfigured()) return true;
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return false;
  const base = publicBaseUrl() ?? `http://127.0.0.1:${process.env.HIVE_PORT ?? "18790"}`;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || `${base}/api/google/oauth/callback`;
  configureGoogle({
    clientId, clientSecret, redirectUri,
    services: parseServices(process.env.GOOGLE_SCOPES),
    tokenStore: secretTokenStore,
  });
  log.info(`Google activado (redirect ${redirectUri})`);
  return true;
}

// ─── Estado efímero del flujo OAuth (conectar Gmail/Calendar/Drive) ─────────

export interface OAuthState {
  purpose: "connect";
  userId: string;
  codeVerifier: string;
  services: GoogleService[];
  /** El mismo que se envió a Google: el intercambio debe repetirlo idéntico. */
  redirectUri: string;
  /** Origen al que se devuelve al navegador (el mismo desde el que se inició). */
  origin: string;
  /** Si el flujo se abrió en el navegador del sistema (app de escritorio): ticket que la app consulta. */
  ticket?: string;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60_000;
const states = new Map<string, OAuthState>();

function sweep(now = Date.now()) {
  for (const [k, v] of states) if (v.expiresAt <= now) states.delete(k);
}

export function saveState(state: string, data: Omit<OAuthState, "expiresAt">): void {
  sweep();
  states.set(state, { ...data, expiresAt: Date.now() + STATE_TTL_MS });
}

/** Un solo uso: el `state` se consume al leerlo. */
export function takeState(state: string | null): OAuthState | null {
  if (!state) return null;
  const s = states.get(state);
  states.delete(state);
  return s && s.expiresAt > Date.now() ? s : null;
}

// ─── Traspaso al navegador del sistema (app de escritorio) ──────────────────
//
// Google rechaza OAuth dentro de un WebView embebido (`disallowed_useragent`),
// así que en Tauri el flujo corre en el navegador del sistema y la ventana de
// la app consulta un ticket hasta que el callback lo resuelve.

export type TicketResult =
  | { status: "pending" }
  | { status: "done"; purpose: "connect" }
  | { status: "error"; error: string };

const tickets = new Map<string, { result: TicketResult; expiresAt: number }>();

export function createTicket(): string {
  sweep();
  const id = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  tickets.set(id, { result: { status: "pending" }, expiresAt: Date.now() + STATE_TTL_MS });
  return id;
}

export function resolveTicket(id: string, result: TicketResult): void {
  const t = tickets.get(id);
  if (t) t.result = result;
}

/** Devuelve el estado; un resultado final se entrega una sola vez. */
export function pollTicket(id: string | null): TicketResult {
  const t = id ? tickets.get(id) : undefined;
  if (!id || !t || t.expiresAt <= Date.now()) {
    if (id) tickets.delete(id);
    return { status: "error", error: "expired" };
  }
  if (t.result.status !== "pending") tickets.delete(id);
  return t.result;
}

// ─── Redirect URI y origen ──────────────────────────────────────────────────

const CALLBACK_PATH = "/api/google/oauth/callback";

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

const hasForwardHeaders = (req: Request) =>
  req.headers.has("x-forwarded-for") || req.headers.has("x-forwarded-host") || req.headers.has("forwarded");

/** Petición directa a una dirección de loopback, sin proxy de por medio. */
export function isLoopbackRequest(req: Request): boolean {
  return isLoopbackHostname(new URL(req.url).hostname) && !hasForwardHeaders(req);
}

/**
 * La app de escritorio lanza el gateway como hijo (`HIVE_GATEWAY_CHILD=1`) y
 * habla con él por loopback: solo ahí tiene sentido abrir el navegador del
 * sistema desde el servidor.
 */
export function isDesktopGatewayRequest(req: Request): boolean {
  return process.env.HIVE_GATEWAY_CHILD === "1" && isLoopbackRequest(req);
}

/**
 * URI de retorno de esta solicitud. En loopback el puerto cambia (18790 o uno
 * libre), así que se toma del origen real; un cliente OAuth de Google «de
 * escritorio» lo admite sin registrarlo, uno «web» exige registrar cada URI.
 */
export function resolveRedirectUri(req: Request): string {
  const forced = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (forced) return forced;
  const url = new URL(req.url);
  if (isLoopbackRequest(req)) return `${url.origin}${CALLBACK_PATH}`;
  return `${publicBaseUrl() ?? url.origin}${CALLBACK_PATH}`;
}

/** A dónde vuelve el navegador al terminar: la misma origin desde la que empezó. */
export function resolveReturnOrigin(req: Request): string {
  const url = new URL(req.url);
  return isLoopbackRequest(req) ? url.origin : publicBaseUrl() ?? url.origin;
}

// ─── Abrir el navegador del sistema ─────────────────────────────────────────

type Opener = (url: string) => void;

/** Sin shell ni interpolación: la URL va como argumento, no como texto de un comando. */
const defaultOpener: Opener = (url) => {
  const attempts: string[][] =
    process.platform === "win32" ? [["rundll32", "url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? [["open", url]]
    : [["gio", "open", url], ["xdg-open", url], ["sensible-browser", url], ["x-www-browser", url]];
  for (const argv of attempts) {
    try {
      Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
      return;
    } catch { /* probar el siguiente */ }
  }
  log.warn("No se encontró ningún navegador para abrir el flujo de Google");
};

let opener: Opener = defaultOpener;

/** Solo abre URLs de Google: este servidor nunca abre algo que no generó. */
export function openExternal(url: string): boolean {
  if (new URL(url).origin !== "https://accounts.google.com") return false;
  opener(url);
  return true;
}

/** Sólo para tests. */
export function setExternalOpener(fn: Opener | null): void {
  opener = fn ?? defaultOpener;
}

/** Sólo para tests. */
export function resetGoogleHostState(): void {
  states.clear();
  tickets.clear();
  opener = defaultOpener;
}
