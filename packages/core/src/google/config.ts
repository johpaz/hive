import type { GoogleService } from "./scopes.ts";
import { GOOGLE_SERVICES } from "./scopes.ts";
import type { GoogleTokenStore } from "./token-store.ts";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Debe estar registrado tal cual en Google Cloud Console. */
  redirectUri: string;
  /** Servicios habilitados en esta instalación. Por omisión, todos. */
  services?: readonly GoogleService[];
  tokenStore: GoogleTokenStore;
  /** Inyectable para tests. */
  fetch?: typeof fetch;
}

let current: GoogleConfig | null = null;

export function configureGoogle(config: GoogleConfig): void {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error("configureGoogle: clientId, clientSecret y redirectUri son obligatorios");
  }
  current = { ...config, services: config.services ?? GOOGLE_SERVICES };
}

export function resetGoogle(): void {
  current = null;
}

export function isGoogleConfigured(): boolean {
  return current !== null;
}

export function getGoogleConfig(): GoogleConfig & { services: readonly GoogleService[] } {
  if (!current) {
    throw new GoogleNotConfiguredError();
  }
  return current as GoogleConfig & { services: readonly GoogleService[] };
}

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("La integración con Google no está configurada (faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
    this.name = "GoogleNotConfiguredError";
  }
}

export class GoogleNotConnectedError extends Error {
  constructor(message = "El usuario no ha conectado su cuenta de Google.") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export class GoogleScopeError extends Error {
  constructor(public readonly service: GoogleService) {
    super(`La cuenta de Google conectada no autorizó el servicio "${service}". Hay que volver a conectarla incluyéndolo.`);
    this.name = "GoogleScopeError";
  }
}
