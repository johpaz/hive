/**
 * El estudio de video y su agente (Director de video) solo están activos mientras
 * haya una API key de Gemini. Sin ella las tools y el agente quedan inactivos y la
 * pestaña muestra cómo conectarla. Misma idea que google-capabilities.ts.
 */
import { col } from "./hive.ts";
import type { AgentDoc, ToolDoc } from "./collections.ts";
import { isVideoStudioEnabled } from "../video/studio.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child("video-capabilities");

export const VIDEO_AGENT_ID = "video_director_agent";

/** Alinea las filas de tools y del agente con la presencia de la clave de Gemini. */
export async function syncVideoCapabilities(reason: "key-changed" | "boot" | "seed"): Promise<boolean> {
  const enabled = await isVideoStudioEnabled();
  let changed = 0;

  const toolsCol = await col<ToolDoc>("tools");
  for (const row of await toolsCol.scan({})) {
    if (row.doc.category !== "video") continue;
    if (row.doc.active === enabled && row.doc.enabled === enabled) continue;
    await toolsCol.put(row.id, { ...row.doc, active: enabled, enabled, updated_at: Date.now() }, { expectedVersion: row.version });
    changed++;
  }

  const agents = await col<AgentDoc>("agents");
  const agent = await agents.get(VIDEO_AGENT_ID);
  if (agent && agent.doc.enabled !== enabled) {
    await agents.put(VIDEO_AGENT_ID, { ...agent.doc, enabled, updated_at: Date.now() }, { expectedVersion: agent.version });
    changed++;
  }
  if (changed > 0) log.info(`[video] estudio ${enabled ? "activado" : "desactivado"} (${reason}); ${changed} fila(s) sincronizada(s)`);
  return enabled;
}

/**
 * Para llamar cuando la clave de Gemini se guarda o se borra: sincroniza las filas y
 * refresca lo que ve el modelo (tools y agentes indexados). Nunca lanza.
 */
export async function refreshVideoCapabilities(providerId: string): Promise<void> {
  if (providerId !== "gemini") return;
  try {
    await syncVideoCapabilities("key-changed");
    const [{ syncToolCatalogToIndex }, { syncCatalogAgentsToIndex }] = await Promise.all([
      import("../agent/tool-selector"),
      import("../agent/catalog-selector"),
    ]);
    await Promise.all([syncToolCatalogToIndex(), syncCatalogAgentsToIndex()]);
  } catch (err) {
    log.warn(`Sincronizar el estudio de video falló: ${(err as Error).message}`);
  }
}
