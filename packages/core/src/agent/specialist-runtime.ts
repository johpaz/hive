import { createHash } from "node:crypto";
import { col, toIndexable } from "../storage/hive";
import type {
  AgentDoc,
  McpServerDoc,
  ModelDoc,
  ProviderDoc,
  SkillDoc,
  SpecialistDoc,
} from "../storage/collections";
import { createAllTools } from "../tools";
import { loadConfig } from "../config/loader";
import { getSpecialist } from "./specialist-selector";
import type { MCPClientManager } from "@johpaz/hive-agents-mcp";
import { logger } from "../utils/logger";
import { emitCanvas } from "../canvas/emitter";

const log = logger.child("specialist-runtime");
const AWAKE_TTL_MS = 5 * 60_000;
const MCP_IDLE_TTL_MS = 2 * 60_000;

export interface WakeSpecialistOptions {
  specialistId: string;
  userId: string;
  parentAgentId: string;
  workspace: string | null;
  mcpServerIds?: string[];
  executorModelId?: string | null;
  mcpManager?: MCPClientManager | null;
}

export interface AwakeSpecialist {
  specialist: SpecialistDoc;
  workerId: string;
  toolNames: string[];
  skillIds: string[];
  mcpServerIds: string[];
  release(): Promise<void>;
}

interface CachedAwake {
  workerId: string;
  expiresAt: number;
}

interface McpLease {
  refs: number;
  serverName: string;
  timer?: ReturnType<typeof setTimeout>;
}

const awakeCache = new Map<string, CachedAwake>();
const mcpLeases = new Map<string, McpLease>();

function stableWorkerId(userId: string, parentAgentId: string, specialistId: string, workspace: string | null): string {
  const digest = createHash("sha256")
    .update([userId, parentAgentId, specialistId, workspace ?? ""].join("\0"))
    .digest("hex")
    .slice(0, 20);
  return `sp_${digest}`;
}

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

async function resolveSpecialistModel(
  specialist: SpecialistDoc,
  parent: AgentDoc,
  executorModelId?: string | null,
): Promise<{ providerId: string; modelId: string }> {
  const fallback = {
    providerId: parent.provider_id,
    modelId: parent.model_id,
  };
  const policy = specialist.model_override;
  if (!policy) return fallback;

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
    if (!policy.required_capabilities.every((cap) => caps.includes(cap))) return false;
    if (policy.prefer_different_family && executorModelId) {
      const currentFamily = executorModelId.split(/[/:]/)[0];
      const candidateFamily = model.id.split(/[/:]/)[0];
      if (currentFamily === candidateFamily) return false;
    }
    return true;
  };

  for (const preferred of policy.preferred_model_ids) {
    const exact = models.find((model) => model.id === preferred && compatible(model));
    if (exact) return { providerId: exact.provider_id, modelId: exact.id };
  }
  const candidate = models.find(compatible);
  return candidate ? { providerId: candidate.provider_id, modelId: candidate.id } : fallback;
}

async function validateSkillIds(skillIds: string[]): Promise<string[]> {
  const skills = await col<SkillDoc>("skills");
  const valid: string[] = [];
  for (const id of skillIds) {
    const entry = await skills.get(id);
    if (!entry?.doc.active) throw new Error(`Specialist references missing or inactive skill: ${id}`);
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
      .catch((err) => log.warn(`[specialist-runtime] MCP disconnect failed: ${(err as Error).message}`))
      .finally(() => mcpLeases.delete(serverId));
  }, MCP_IDLE_TTL_MS);
}

export async function wakeSpecialist(opts: WakeSpecialistOptions): Promise<AwakeSpecialist> {
  const specialist = await getSpecialist(opts.specialistId);
  if (!specialist) throw new Error(`Specialist not found or inactive: ${opts.specialistId}`);

  const agents = await col<AgentDoc>("agents");
  const parentEntry = await agents.get(opts.parentAgentId);
  if (!parentEntry?.doc.enabled) throw new Error(`Parent agent not found or disabled: ${opts.parentAgentId}`);

  const toolNames = expandToolAllowlist(specialist.tool_allowlist);
  const skillIds = await validateSkillIds(specialist.skill_ids);
  const dynamicMcpIds = opts.mcpServerIds ?? [];
  if (dynamicMcpIds.length > 0 && specialist.id !== "mcp_integration_operator") {
    throw new Error(`Specialist ${specialist.id} does not allow task-scoped MCP servers`);
  }
  const requestedMcp = [...new Set([...(specialist.mcp_server_ids ?? []), ...dynamicMcpIds])];
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

  const workerId = stableWorkerId(opts.userId, opts.parentAgentId, specialist.id, opts.workspace);
  const model = await resolveSpecialistModel(specialist, parentEntry.doc, opts.executorModelId);
  const now = Date.now();
  const existing = await agents.get(workerId);
  const worker: AgentDoc = {
    id: workerId,
    user_id: opts.userId,
    name: specialist.name,
    description: specialist.description,
    system_prompt: specialist.system_prompt_addon,
    tone: "professional",
    role: "worker",
    status: "idle",
    enabled: true,
    provider_id: toIndexable(model.providerId),
    model_id: toIndexable(model.modelId),
    tools_json: JSON.stringify(toolNames),
    skills_json: JSON.stringify(skillIds),
    active_mcp_json: JSON.stringify(requestedMcp),
    parent_id: toIndexable(opts.parentAgentId),
    max_iterations: specialist.id === "acceptance_verifier" ? 8 : 20,
    workspace: opts.workspace,
    lastTraceAt: existing?.doc.lastTraceAt ?? null,
    specialist_id: specialist.id,
    created_at: existing?.doc.created_at ?? now,
    updated_at: now,
  };
  await agents.put(workerId, worker, existing ? { expectedVersion: existing.version } : { expectedVersion: 0 });
  awakeCache.set(workerId, { workerId, expiresAt: now + AWAKE_TTL_MS });

  if (!existing) {
    emitCanvas("canvas:node_add", {
      id: workerId,
      name: specialist.name,
      status: "idle",
      type: "agent",
      data: { role: "worker", specialistId: specialist.id, currentTool: null },
    });
  }

  let released = false;
  return {
    specialist,
    workerId,
    toolNames,
    skillIds,
    mcpServerIds: requestedMcp,
    release: async () => {
      if (released) return;
      released = true;
      if (opts.mcpManager) {
        await Promise.all(requestedMcp.map((id) => releaseMcpLease(id, opts.mcpManager!)));
      }
      const cached = awakeCache.get(workerId);
      if (cached) cached.expiresAt = Date.now() + AWAKE_TTL_MS;
    },
  };
}

export function sweepSleepingSpecialists(now = Date.now()): string[] {
  const expired: string[] = [];
  for (const [key, value] of awakeCache) {
    if (value.expiresAt <= now) {
      awakeCache.delete(key);
      expired.push(value.workerId);
    }
  }
  return expired;
}

export function getSpecialistRuntimeStats(): { awake: number; mcpLeases: number } {
  return { awake: awakeCache.size, mcpLeases: mcpLeases.size };
}
