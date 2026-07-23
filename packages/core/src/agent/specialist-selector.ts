import { col } from "../storage/hive";
import type { SpecialistDoc } from "../storage/collections";
import {
  applyRelativeCutoff,
  replaceCapabilityDocs,
  searchCapabilities,
  type CapabilityDoc,
} from "./capability-search";
import { logger } from "../utils/logger";

const log = logger.child("specialist-selector");
const RELEVANCE_RATIO = 0.35;

export async function getSpecialist(id: string): Promise<SpecialistDoc | null> {
  const entry = await (await col<SpecialistDoc>("specialists")).get(id);
  return entry?.doc.active ? entry.doc : null;
}

export async function listActiveSpecialists(): Promise<SpecialistDoc[]> {
  const c = await col<SpecialistDoc>("specialists");
  return (await c.findBy("active", true)).map((entry) => entry.doc);
}

export async function searchSpecialists(query: string, k = 5): Promise<Array<{ specialist: SpecialistDoc; score: number }>> {
  const hits = applyRelativeCutoff(
    await searchCapabilities(query, { types: ["specialist"], k }),
    RELEVANCE_RATIO,
  );
  const c = await col<SpecialistDoc>("specialists");
  const results: Array<{ specialist: SpecialistDoc; score: number }> = [];
  for (const hit of hits) {
    const entry = await c.get(hit.rawId);
    if (entry?.doc.active) results.push({ specialist: entry.doc, score: hit.score });
  }
  return results;
}

export async function syncSpecialistsToIndex(): Promise<void> {
  const specialists = await listActiveSpecialists();
  const docs: CapabilityDoc[] = specialists.map((specialist) => ({
    type: "specialist",
    rawId: specialist.id,
    name: `${specialist.name} ${specialist.id}`,
    tags: [
      ...specialist.routing_examples,
      ...specialist.routing_exclusions.map((item) => `NO:${item}`),
      ...specialist.tool_allowlist,
      ...specialist.skill_ids,
    ].join(" "),
    // The complete system prompt is intentionally excluded: it adds routing
    // noise and may contain operational policy not meant for retrieval.
    body: specialist.description,
  }));
  await replaceCapabilityDocs("specialist", docs);
  log.info(`[specialist-selector] Synced ${docs.length} specialists to HiveDB index`);
}

export function renderSpecialistRoutingCatalog(specialists: SpecialistDoc[]): string {
  return specialists
    .filter((s) => s.id !== "acceptance_verifier")
    .map((s) => `- ${s.id}: ${s.description}`)
    .join("\n");
}
