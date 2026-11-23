/**
 * `fetch` autenticado contra las APIs de Google: renueva el access token antes
 * de que caduque (una sola renovación en vuelo por usuario), reintenta una vez
 * ante 401 y backoff corto ante 429/5xx.
 */
import { getGoogleConfig, GoogleNotConnectedError, GoogleScopeError } from "./config.ts";
import { refreshTokens, GoogleOAuthError, revokeToken } from "./oauth.ts";
import { servicesCovered, type GoogleService } from "./scopes.ts";
import type { GoogleTokenSet } from "./token-store.ts";

const SKEW_MS = 60_000;
const inflight = new Map<string, Promise<GoogleTokenSet>>();

async function renew(userId: string, tokens: GoogleTokenSet): Promise<GoogleTokenSet> {
  const pending = inflight.get(userId);
  if (pending) return pending;
  const job = (async () => {
    const { tokenStore } = getGoogleConfig();
    try {
      const next = await refreshTokens(tokens);
      await tokenStore.put(userId, next);
      return next;
    } catch (err) {
      if (err instanceof GoogleOAuthError && err.needsReconnect) {
        await tokenStore.delete(userId);
        throw new GoogleNotConnectedError("La conexión con Google caducó o fue revocada. Hay que volver a conectar la cuenta.");
      }
      throw err;
    } finally {
      inflight.delete(userId);
    }
  })();
  inflight.set(userId, job);
  return job;
}

export async function getGoogleTokens(userId: string, service?: GoogleService): Promise<GoogleTokenSet> {
  const { tokenStore } = getGoogleConfig();
  const stored = await tokenStore.get(userId);
  if (!stored) throw new GoogleNotConnectedError();
  if (service && !servicesCovered(stored.scopes).includes(service)) throw new GoogleScopeError(service);
  return stored.expiresAt - Date.now() < SKEW_MS ? renew(userId, stored) : stored;
}

/** Cuerpo crudo (string/bytes) o un objeto que se serializa como JSON. */
type RawBody = string | Uint8Array | ArrayBuffer | URLSearchParams | Blob | FormData;

export interface GoogleFetchInit extends Omit<RequestInit, "body"> {
  body?: RawBody | Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
}

export class GoogleApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Google API ${status}: ${message}`);
    this.name = "GoogleApiError";
  }
}

export async function googleFetch(
  userId: string,
  service: GoogleService,
  url: string,
  init: GoogleFetchInit = {},
): Promise<Response> {
  const cfg = getGoogleConfig();
  const doFetch = cfg.fetch ?? fetch;
  const target = new URL(url);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) target.searchParams.set(k, String(v));

  const isJson = init.body !== undefined && typeof init.body === "object" &&
    !(init.body instanceof ArrayBuffer) && !(init.body instanceof Uint8Array) &&
    !(init.body instanceof Blob) && !(init.body instanceof URLSearchParams) && !(init.body instanceof FormData);

  let tokens = await getGoogleTokens(userId, service);
  let refreshedOn401 = false;
  for (let attempt = 0; ; attempt++) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    if (isJson) headers.set("Content-Type", "application/json");
    const res = await doFetch(target, {
      ...init,
      headers,
      body: isJson ? JSON.stringify(init.body) : (init.body as RequestInit["body"]),
    });
    if (res.status === 401 && !refreshedOn401) {
      refreshedOn401 = true;
      tokens = await renew(userId, tokens);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }
    return res;
  }
}

/** `googleFetch` + parseo JSON + error legible. */
export async function googleJson<T = any>(
  userId: string,
  service: GoogleService,
  url: string,
  init: GoogleFetchInit = {},
): Promise<T> {
  const res = await googleFetch(userId, service, url, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).error?.message ?? msg; } catch { /* texto plano */ }
    throw new GoogleApiError(res.status, msg);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Desconecta: revoca en Google y borra del almacén. */
export async function disconnectGoogle(userId: string): Promise<void> {
  const { tokenStore } = getGoogleConfig();
  const stored = await tokenStore.get(userId);
  if (stored) await revokeToken(stored.refreshToken ?? stored.accessToken);
  await tokenStore.delete(userId);
}
