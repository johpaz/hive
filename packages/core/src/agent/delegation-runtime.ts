import { col, toIndexable, fromIndexable, updateDoc } from "../storage/hive";
import type {
  AgentDoc,
  McpServerDoc,
  ModelDoc,
  ProviderDoc,
  SkillDoc,
  AgentModelOverride,
} from "../storage/collections";
import { createAllTools } from "../tools";
import { loadConfig } from "../config/loader";
import type { MCPClientManager } from "@johpaz/hive-agents-mcp";
import { logger } from "../utils/logger";

const log = logger.child("delegation-runtime");
const MCP_IDLE_TTL_MS = 2 * 60_000;

export interface PrepareDelegationOptions {
  workspace: string | null;
  mcpServerIds?: string[];
  /** Fallback provider/model when the target row has none of its own (catalog agents are seeded without one — inherits the parent/coordinator's). */
  parentProviderId?: string | null;
  parentModelId?: string | null;
  /** Model to avoid only during capability-based DB fallback resolution. Explicit agent/parent configuration always wins. */
  executorModelId?: string | null;
  mcpManager?: MCPClientManager | null;
}

export interface PreparedDelegation {
  agent: AgentDoc;
  toolNames: string[];
  skillIds: string[];
  mcpServerIds: string[];
  providerId: string;
  modelId: string;
  release(): Promise<void>;
}

interface McpLease {
  refs: number;
  serverName: string;
  timer?: ReturnType<typeof setTimeout>;
}

const mcpLeases = new Map<string, McpLease>();

function matchesPattern(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

export function expandToolAllowlist(patterns: string[], availableNames?: string[]): string[] {
  const names = availableNames ?? createAllTools(loadConfig()).map((tool) => tool.name);
  const selected = names.filter((name) => patterns.some((pattern) => matchesPattern(name, pattern)));
  return [...new Set(selected)].sort();
}

function parseCapabilities(model: ModelDoc): string[] {
  try {
    return model.capabilities ? JSON.parse(model.capabilities) : [];
  } catch {
    return [];
  }
}

/**
 * Resolves the effective provider/model for a delegation. Persisted database
 * configuration is authoritative: the agent's complete provider/model pair
 * wins, otherwise the parent's complete pair is inherited. Capability metadata
 * is consulted only when neither row supplies a complete pair, and candidates
 * are selected exclusively from active database rows.
 */
export async function resolveAgentModel(
  modelOverride: AgentModelOverride | null,
  rowProviderId: string | null,
  rowModelId: string | null,
  parentProviderId: string | null,
  parentModelId: string | null,
  executorModelId?: string | null,
): Promise<{ providerId: string; modelId: string }> {
  if (rowProviderId && rowModelId) {
    return { providerId: rowProviderId, modelId: rowModelId };
  }
  if (parentProviderId && parentModelId) {
    return { providerId: parentProviderId, modelId: parentModelId };
  }

  const fallback = {
    providerId: rowProviderId ?? parentProviderId ?? "",
    modelId: rowModelId ?? parentModelId ?? "",
  };
  if (!modelOverride) return fallback;

  const models = (await (await col<ModelDoc>("models")).scan({})).map((entry) => entry.doc);
  const providers = new Map(
    (await (await col<ProviderDoc>("providers")).scan({}))
      .map((entry) => entry.doc)
      .filter((provider) => provider.enabled && provider.active)
      .map((provider) => [provider.id, provider]),
  );
  const compatible = (model: ModelDoc) => {
    if (!model.enabled || !providers.has(model.provider_id)) return false;
    const caps = parseCapabilities(model);
    if (!modelOverride.required_capabilities.every((cap) => caps.includes(cap))) return false;
    if (modelOverride.prefer_different_family && executorModelId) {
      const currentFamily = executorModelId.split(/[/:]/)[0];
      const candidateFamily = model.id.split(/[/:]/)[0];
      if (currentFamily === candidateFamily) return false;
    }
    return true;
  };

  const candidate = models.find(compatible);
  return candidate ? { providerId: candidate.provider_id, modelId: candidate.id } : fallback;
}

export async function validateSkillIds(skillIds: string[]): Promise<string[]> {
  const skills = await col<SkillDoc>("skills");
  const valid: string[] = [];
  for (const id of skillIds) {
    const entry = await skills.get(id);
    if (!entry?.doc.active) throw new Error(`Agent references missing or inactive skill: ${id}`);
    valid.push(id);
  }
  return valid;
}

async function acquireMcpLease(
  serverId: string,
  manager: MCPClientManager,
): Promise<{ serverId: string; serverName: string }> {
  const entry = await (await col<McpServerDoc>("mcpServers")).get(serverId);
  if (!entry?.doc.enabled) throw new Error(`MCP server is missing or disabled: ${serverId}`);
  // Gateway initialization registers DB-backed MCP servers under their stable
  // document id. The display name is only used in UI/tool labels.
  const serverName = entry.doc.id;
  const existing = mcpLeases.get(serverId);
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer);
    existing.timer = undefined;
    existing.refs++;
    return { serverId, serverName: existing.serverName };
  }
  await manager.connectServer(serverName);
  mcpLeases.set(serverId, { refs: 1, serverName });
  return { serverId, serverName };
}

async function releaseMcpLease(serverId: string, manager: MCPClientManager): Promise<void> {
  const lease = mcpLeases.get(serverId);
  if (!lease) return;
  lease.refs = Math.max(0, lease.refs - 1);
  if (lease.refs > 0) return;
  lease.timer = setTimeout(() => {
    const current = mcpLeases.get(serverId);
    if (!current || current.refs > 0) return;
    void manager.disconnectServer(current.serverName)
      .catch((err) => log.warn(`[delegation-runtime] MCP disconnect failed: ${(err as Error).message}`))
      .finally(() => mcpLeases.delete(serverId));
  }, MCP_IDLE_TTL_MS);
}

/**
 * Prepares a delegation target for execution: expands its tool allowlist
 * (when it has one — catalog agents do, plain agent_create workers use their
 * stored tools_json as-is), validates skills, resolves the effective
 * provider/model, and acquires any requested MCP leases.
 *
 * This never creates a new AgentDoc — the row already exists (seeded from
 * the catalog, or created via agent_create).
 * It does persist the resolved workspace/model back onto that row (same as
 * the old materialization did) so agent-loop.ts picks them up when it loads
 * the agent — which reintroduces a narrow, accepted race for the rare case
 * of two concurrent delegations to the *same* catalog agent with different
 * workspaces (catalog agents are global rows, not one-per-workspace anymore).
 * `updateDoc`'s OCC retry keeps this safe (last-write-wins), never corrupt.
 */
export async function prepareDelegation(agentId: string, opts: PrepareDelegationOptions): Promise<PreparedDelegation> {
  const agents = await col<AgentDoc>("agents");
  const entry = await agents.get(agentId);
  if (!entry?.doc.enabled) throw new Error(`Agent not found or disabled: ${agentId}`);
  const agentDoc = entry.doc;

  const toolNames = agentDoc.tool_allowlist_json
    ? expandToolAllowlist(JSON.parse(agentDoc.tool_allowlist_json))
    : (agentDoc.tools_json ? JSON.parse(agentDoc.tools_json) : []);

  const skillIds = agentDoc.skills_json ? await validateSkillIds(JSON.parse(agentDoc.skills_json)) : [];

  const dynamicMcpIds = opts.mcpServerIds ?? [];
  if (dynamicMcpIds.length > 0 && agentId !== "mcp_integration_operator") {
    throw new Error(`Agent ${agentId} does not allow task-scoped MCP servers`);
  }
  const fixedMcpIds: string[] = agentDoc.mcp_server_ids_json ? JSON.parse(agentDoc.mcp_server_ids_json) : [];
  const requestedMcp = [...new Set([...fixedMcpIds, ...dynamicMcpIds])];
  if (requestedMcp.length > 0 && !opts.mcpManager) throw new Error("MCP servers requested but MCP manager is unavailable");

  const acquired: string[] = [];
  try {
    for (const serverId of requestedMcp) {
      await acquireMcpLease(serverId, opts.mcpManager!);
      acquired.push(serverId);
    }
  } catch (err) {
    await Promise.all(acquired.map((id) => releaseMcpLease(id, opts.mcpManager!)));
    throw err;
  }

  const modelOverride: AgentModelOverride | null = agentDoc.model_override_json
    ? JSON.parse(agentDoc.model_override_json)
    : null;
  const resolved = await resolveAgentModel(
    modelOverride,
    fromIndexable(agentDoc.provider_id),
    fromIndexable(agentDoc.model_id),
    opts.parentProviderId ?? null,
    opts.parentModelId ?? null,
    opts.executorModelId ?? opts.parentModelId ?? null,
  );

  await updateDoc<AgentDoc>("agents", agentId, {
    workspace: opts.workspace,
    provider_id: toIndexable(resolved.providerId || null),
    model_id: toIndexable(resolved.modelId || null),
    active_mcp_json: JSON.stringify(requestedMcp),
    updated_at: Date.now(),
  }).catch((err) => log.warn(`[prepareDelegation] Failed to persist delegation context for ${agentId}: ${(err as Error).message}`));

  let released = false;
  return {
    agent: agentDoc,
    toolNames,
    skillIds,
    mcpServerIds: requestedMcp,
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    release: async () => {
      if (released) return;
      released = true;
      if (opts.mcpManager) {
        await Promise.all(requestedMcp.map((id) => releaseMcpLease(id, opts.mcpManager!)));
      }
    },
  };
}
