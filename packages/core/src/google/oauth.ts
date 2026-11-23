/**
 * OAuth 2.0 con Google: código de autorización + PKCE. Sin dependencias.
 *
 * El host guarda `state` y `codeVerifier` entre `buildAuthUrl` y el callback
 * (cookie firmada o tabla con TTL corto) y los valida al volver.
 */
import { getGoogleConfig } from "./config.ts";
import { scopesForServices, type GoogleService } from "./scopes.ts";
import type { GoogleTokenSet } from "./token-store.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
}

export async function generatePkce(): Promise<Pkce> {
  const codeVerifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: b64url(new Uint8Array(digest)) };
}

export function generateState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

export function buildAuthUrl(opts: {
  state: string;
  codeChallenge: string;
  services?: readonly GoogleService[];
  loginHint?: string;
  /** Por solicitud: en escritorio y localhost el puerto cambia. Debe coincidir en el intercambio. */
  redirectUri?: string;
}): string {
  const cfg = getGoogleConfig();
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri ?? cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopesForServices(opts.services ?? cfg.services).join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const cfg = getGoogleConfig();
  const res = await (cfg.fetch ?? fetch)(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new GoogleOAuthError(body.error ?? String(res.status), body.error_description);
  }
  return body;
}

export class GoogleOAuthError extends Error {
  constructor(public readonly code: string, description?: string) {
    super(`Google OAuth: ${description ?? code}`);
    this.name = "GoogleOAuthError";
  }
  /** `invalid_grant` = refresh token revocado o caducado: hay que reconectar. */
  get needsReconnect(): boolean {
    return this.code === "invalid_grant";
  }
}

/** Identidad del id_token. Llega directo de Google por TLS en el intercambio de código, por eso no se revalida la firma. */
function parseIdToken(idToken?: string): { email: string | null; sub: string | null; emailVerified: boolean } {
  const empty = { email: null, sub: null, emailVerified: false };
  if (!idToken) return empty;
  try {
    const p = JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString("utf-8"));
    return {
      email: typeof p.email === "string" ? p.email.toLowerCase() : null,
      sub: typeof p.sub === "string" ? p.sub : null,
      emailVerified: p.email_verified === true || p.email_verified === "true",
    };
  } catch {
    return empty;
  }
}

export async function exchangeCode(code: string, codeVerifier: string, redirectUri?: string): Promise<GoogleTokenSet> {
  const cfg = getGoogleConfig();
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri ?? cfg.redirectUri,
  });
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: Date.now() + t.expires_in * 1000,
    scopes: (t.scope ?? "").split(" ").filter(Boolean),
    ...(({ email, sub, emailVerified }) => ({ email, sub, emailVerified }))(parseIdToken(t.id_token)),
  };
}

/** Renueva conservando el refresh token (Google no lo reenvía) y los scopes previos. */
export async function refreshTokens(previous: GoogleTokenSet): Promise<GoogleTokenSet> {
  if (!previous.refreshToken) throw new GoogleOAuthError("invalid_grant", "No hay refresh token guardado.");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: previous.refreshToken });
  return {
    ...previous,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? previous.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
    scopes: t.scope ? t.scope.split(" ").filter(Boolean) : previous.scopes,
  };
}

export async function revokeToken(token: string): Promise<void> {
  const cfg = getGoogleConfig();
  await (cfg.fetch ?? fetch)(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => {});
}
