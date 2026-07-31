import { col } from "../storage/hive";
import type { AgentDoc } from "../storage/collections";
import {
  applyRelativeCutoff,
  replaceCapabilityDocs,
  searchCapabilities,
  type CapabilityDoc,
} from "./capability-search";
import { logger } from "../utils/logger";

const log = logger.child("catalog-selector");
const RELEVANCE_RATIO = 0.35;
const ROUTING_STOP_WORDS = new Set([
  "a", "al", "de", "del", "el", "en", "la", "las", "lo", "los",
  "o", "otro", "otra", "un", "una", "y",
]);

function routingTokens(value: string): Set<string> {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}_]+/u)
    .filter(Boolean)
    .map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter((token) => !ROUTING_STOP_WORDS.has(token));
  return new Set(normalized);
}

function matchesRoutingExclusion(query: string, agent: AgentDoc): boolean {
  if (!agent.routing_exclusions_json) return false;
  const queryTokens = routingTokens(query);
  const exclusions = JSON.parse(agent.routing_exclusions_json) as string[];

  return exclusions.some((exclusion) => {
    const excludedTokens = routingTokens(exclusion);
    const shared = [...excludedTokens].filter((token) => queryTokens.has(token)).length;
    return shared >= 2 && shared / Math.max(excludedTokens.size, 1) >= 0.35;
  });
}

export async function getCatalogAgent(id: string): Promise<AgentDoc | null> {
  const entry = await (await col<AgentDoc>("agents")).get(id);
  return entry?.doc.source === "catalog" && entry.doc.enabled ? entry.doc : null;
}

export async function listCatalogAgents(): Promise<AgentDoc[]> {
  const c = await col<AgentDoc>("agents");
  return (await c.findBy("source", "catalog")).map((entry) => entry.doc).filter((doc) => doc.enabled);
}

export async function searchCatalogAgents(query: string, k = 5): Promise<Array<{ agent: AgentDoc; score: number }>> {
  const hits = applyRelativeCutoff(
    await searchCapabilities(query, { types: ["agent"], k }),
    RELEVANCE_RATIO,
  );
  const c = await col<AgentDoc>("agents");
  const results: Array<{ agent: AgentDoc; score: number }> = [];
  for (const hit of hits) {
    const entry = await c.get(hit.rawId);
    if (
      entry?.doc.source === "catalog" &&
      entry.doc.enabled &&
      !matchesRoutingExclusion(query, entry.doc)
    ) {
      results.push({ agent: entry.doc, score: hit.score });
    }
  }
  return results;
}

export async function syncCatalogAgentsToIndex(): Promise<void> {
  const agents = await listCatalogAgents();
  const docs: CapabilityDoc[] = agents.map((agent) => ({
    type: "agent",
    rawId: agent.id,
    name: `${agent.name} ${agent.id}`,
    tags: [
      ...(agent.routing_examples_json ? JSON.parse(agent.routing_examples_json) : []),
      ...(agent.tool_allowlist_json ? JSON.parse(agent.tool_allowlist_json) : []),
      ...(agent.skills_json ? JSON.parse(agent.skills_json) : []),
    ].join(" "),
    // The complete system prompt is intentionally excluded: it adds routing
    // noise and may contain operational policy not meant for retrieval.
    body: agent.description ?? "",
  }));
  await replaceCapabilityDocs("agent", docs);
  log.info(`[catalog-selector] Synced ${docs.length} catalog agents to HiveDB index`);
}

export function renderAgentRoutingCatalog(agents: AgentDoc[]): string {
  return agents
    .map((a) => {
      const exclusions = a.routing_exclusions_json
        ? JSON.parse(a.routing_exclusions_json) as string[]
        : [];
      const exclusionText = exclusions.length > 0
        ? ` NO usar para: ${exclusions.join("; ")}.`
        : "";
      return `- ${a.id}: ${a.description ?? ""}${exclusionText}`;
    })
    .join("\n");
}
