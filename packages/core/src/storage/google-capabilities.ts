/**
 * Qué capacidades de Google están activas. Los especialistas y las tools de
 * Gmail/Calendar/Drive solo se activan mientras el usuario tenga esa parte
 * conectada; al desconectar (o sin credenciales) quedan inactivos.
 */
import { col } from "./hive.ts";
import type { AgentDoc, ToolDoc, UserDoc } from "./collections.ts";
import { getGoogleConfig, isGoogleConfigured } from "../google/config.ts";
import { servicesCovered, type GoogleService } from "../google/scopes.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child("google-capabilities");

const SETTINGS_COLLECTION = "system_settings";
const SETTING_ID = "google_capabilities";

export const GOOGLE_AGENT_BY_SERVICE: Record<GoogleService, string> = {
  gmail: "google_mail_agent",
  calendar: "google_calendar_agent",
  drive: "google_drive_agent",
};

const TOOL_PREFIX: Record<GoogleService, string> = { gmail: "gmail_", calendar: "gcal_", drive: "gdrive_" };

export const GOOGLE_AGENT_IDS = new Set(Object.values(GOOGLE_AGENT_BY_SERVICE));

export const isGoogleAgentId = (id: string) => GOOGLE_AGENT_IDS.has(id);

function serviceOfTool(name: string): GoogleService | null {
  for (const [service, prefix] of Object.entries(TOOL_PREFIX) as Array<[GoogleService, string]>) {
    if (name.startsWith(prefix)) return service;
  }
  return null;
}

/** Servicios que el usuario tiene conectados ahora mismo (vacío sin Google o sin conexión). */
export async function connectedGoogleServices(): Promise<GoogleService[]> {
  if (!isGoogleConfigured()) return [];
  const user = (await (await col<UserDoc>("users")).scan({ limit: 1 }))[0];
  if (!user) return [];
  const tokens = await getGoogleConfig().tokenStore.get(user.id);
  if (!tokens) return [];
  const allowed = getGoogleConfig().services;
  return servicesCovered(tokens.scopes).filter((s) => allowed.includes(s));
}

/**
 * Alinea filas de tools y agentes con la conexión real.
 *  · `reason: "connect"`  — activa lo conectado y desactiva lo demás.
 *  · `reason: "boot"`/`"seed"` — solo desactiva lo no conectado: respeta que el
 *    usuario haya apagado a mano algo que sí está conectado. Excepción: la primera
 *    vez que encuentra una conexión ya existente (migración), activa sus agentes.
 */
export async function syncGoogleCapabilities(reason: "connect" | "disconnect" | "boot" | "seed"): Promise<void> {
  const connected = new Set(await connectedGoogleServices());
  // Migración de una sola vez: quien conectó Google antes de que los agentes nacieran apagados
  // tiene una conexión viva y agentes inactivos. La primera vez que se ve una conexión se
  // activan; después, un arranque nunca reactiva lo que el usuario apagó a mano.
  const settings = await col<{ initialized: boolean }>(SETTINGS_COLLECTION);
  const initialized = (await settings.get(SETTING_ID))?.doc.initialized === true;
  const adopt = !initialized && connected.size > 0 && (reason === "boot" || reason === "seed");
  const enable = reason === "connect" || adopt;
  let changed = 0;

  const toolsCol = await col<ToolDoc>("tools");
  for (const row of await toolsCol.scan({})) {
    const service = serviceOfTool(row.doc.name);
    if (!service || row.doc.category !== "google") continue;
    const on = connected.has(service);
    const wanted = on ? (enable ? true : row.doc.active) : false;
    if (row.doc.active === wanted && row.doc.enabled === wanted) continue;
    await toolsCol.put(row.id, { ...row.doc, active: wanted, enabled: wanted, updated_at: Date.now() }, { expectedVersion: row.version });
    changed++;
  }

  const agentsCol = await col<AgentDoc>("agents");
  for (const [service, agentId] of Object.entries(GOOGLE_AGENT_BY_SERVICE) as Array<[GoogleService, string]>) {
    const row = await agentsCol.get(agentId);
    if (!row) continue;
    const on = connected.has(service);
    const wanted = on ? (enable ? true : row.doc.enabled) : false;
    if (row.doc.enabled === wanted) continue;
    await agentsCol.put(agentId, { ...row.doc, enabled: wanted, updated_at: Date.now() }, { expectedVersion: row.version });
    changed++;
  }
  if (enable && connected.size > 0 && !initialized) {
    const current = await settings.get(SETTING_ID);
    await settings.put(SETTING_ID, { initialized: true }, { expectedVersion: current?.version ?? 0 });
  }
  if (changed > 0) log.info(`[google] ${changed} capacidad(es) sincronizada(s) (${reason}; conectado: ${[...connected].join(", ") || "nada"})`);
}
