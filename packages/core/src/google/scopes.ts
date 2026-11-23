/**
 * Servicios de Google que el SDK sabe operar y los scopes mínimos de cada uno.
 *
 * Se piden por servicio (autorización incremental): quien sólo conecta Gmail no
 * le da al agente acceso a Drive. `drive.readonly` y `gmail.*` son scopes
 * restringidos: la app de Google Cloud necesita verificación para producción.
 */
export type GoogleService = "gmail" | "calendar" | "drive";

export const GOOGLE_SERVICES: readonly GoogleService[] = ["gmail", "calendar", "drive"];

const BASE = "https://www.googleapis.com/auth/";

export const GOOGLE_SERVICE_SCOPES: Record<GoogleService, string[]> = {
  // modify cubre leer, marcar, etiquetar, archivar, borradores y papelera (no borrado permanente).
  gmail: [`${BASE}gmail.modify`, `${BASE}gmail.send`],
  calendar: [`${BASE}calendar.events`, `${BASE}calendar.readonly`],
  drive: [`${BASE}drive.readonly`, `${BASE}drive.file`],
};

/** Siempre se piden: identifican la cuenta conectada. */
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"];

export function scopesForServices(services: readonly GoogleService[]): string[] {
  const out = new Set<string>(GOOGLE_IDENTITY_SCOPES);
  for (const s of services) for (const scope of GOOGLE_SERVICE_SCOPES[s]) out.add(scope);
  return [...out];
}

/** Parsea `GOOGLE_SCOPES=gmail,calendar` ignorando lo desconocido. */
export function parseServices(raw: string | undefined | null): GoogleService[] {
  if (!raw) return [...GOOGLE_SERVICES];
  const wanted = raw.split(",").map((s) => s.trim().toLowerCase());
  return GOOGLE_SERVICES.filter((s) => wanted.includes(s));
}

/** Servicios cubiertos por un conjunto de scopes concedidos. */
export function servicesCovered(granted: readonly string[]): GoogleService[] {
  const have = new Set(granted);
  return GOOGLE_SERVICES.filter((s) => GOOGLE_SERVICE_SCOPES[s].every((sc) => have.has(sc)));
}
