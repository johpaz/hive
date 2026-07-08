/** Parsea el campo capabilities de un modelo (JSON string en la BD) a un array. */
export function parseCapabilities(caps: string | string[] | null | undefined): string[] {
  if (!caps) return [];
  if (typeof caps === "string") {
    try { return JSON.parse(caps); } catch { return []; }
  }
  return Array.isArray(caps) ? caps : [];
}
