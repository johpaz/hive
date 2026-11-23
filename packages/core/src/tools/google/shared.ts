import type { Tool } from "../types.ts";
import {
  GoogleNotConfiguredError, GoogleNotConnectedError, GoogleScopeError,
} from "../../google/config.ts";
import { GoogleApiError } from "../../google/client.ts";
import { GoogleOAuthError } from "../../google/oauth.ts";

type Params = Record<string, unknown>;
type Ctx = { userId: string; config: any };

/**
 * Envuelve una tool de Google: resuelve el usuario, traduce los errores de
 * conexión a una respuesta que el agente sabe interpretar y nunca deja escapar
 * tokens en el mensaje.
 */
export function googleTool(def: Omit<Tool, "execute"> & {
  run: (params: Params, ctx: Ctx) => Promise<object>;
}): Tool {
  const { run, ...rest } = def;
  return {
    ...rest,
    execute: async (params: Params, config?: any) => {
      const userId = config?.configurable?.user_id;
      if (!userId) return { ok: false, error: "No se pudo determinar el usuario de la sesión." };
      try {
        return await run(params ?? {}, { userId, config });
      } catch (err) {
        if (err instanceof GoogleNotConfiguredError) {
          return { ok: false, error: err.message, hint: "El administrador debe configurar las credenciales de Google." };
        }
        if (err instanceof GoogleNotConnectedError || err instanceof GoogleScopeError) {
          return { ok: false, error: err.message, needs_connection: true, hint: "Pídele al usuario que conecte su cuenta de Google en Ajustes → Integraciones." };
        }
        if (err instanceof GoogleApiError) {
          return { ok: false, error: err.message, status: err.status };
        }
        if (err instanceof GoogleOAuthError) {
          return { ok: false, error: err.message };
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Las acciones con efecto externo irreversible (enviar, borrar, modificar) no
 * se ejecutan hasta que el coordinador confirma con el usuario y repite la
 * llamada con `confirmed: true`.
 */
export function needsConfirmation(params: Params, preview: Record<string, unknown>) {
  if (params.confirmed === true) return null;
  return {
    ok: false,
    needs_confirmation: true,
    error: "Acción pendiente de confirmación del usuario.",
    preview,
    hint: "Devuelve status=needs_input al agente principal con este preview. Cuando el usuario confirme, repite la llamada con confirmed=true.",
  };
}

export const CONFIRMED_PARAM = {
  type: "boolean",
  description: "Debe ser true solo después de que el usuario aprobó explícitamente la acción.",
} as const;

/** Rechaza saltos de línea en valores que irán a una cabecera (inyección de cabeceras). */
export function headerSafe(value: string, field: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`${field} no puede contener saltos de línea.`);
  return value;
}
