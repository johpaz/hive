import type { Config, Binding } from "../config/loader.ts";

export interface RoutingContext {
  channel: string;
  accountId?: string;
  peerKind?: "direct" | "group";
  peerId?: string;
  guildId?: string;
  teamId?: string;
  roles?: string[];
}

export function matchBinding(binding: Binding, ctx: RoutingContext): number {
  const match = binding.match;
  let score = 0;

  if (match.peer?.id && match.peer?.kind) {
    if (ctx.peerId === match.peer.id && ctx.peerKind === match.peer.kind) {
      score += 1000;
    } else {
      return 0;
    }
  } else if (match.peer?.id) {
    if (ctx.peerId === match.peer.id) {
      score += 900;
    } else {
      return 0;
    }
  } else if (match.peer?.kind) {
    if (ctx.peerKind === match.peer.kind) {
      score += 50;
    } else {
      return 0;
    }
  }

  if (match.guildId && match.roles && match.roles.length > 0) {
    if (ctx.guildId === match.guildId && ctx.roles?.some((r) => match.roles?.includes(r))) {
      score += 800;
    } else {
      return 0;
    }
  } else if (match.guildId) {
    if (ctx.guildId === match.guildId) {
      score += 200;
    } else {
      return 0;
    }
  }

  if (match.teamId) {
    if (ctx.teamId === match.teamId) {
      score += 300;
    } else {
      return 0;
    }
  }

  if (match.accountId) {
    if (ctx.accountId === match.accountId) {
      score += 400;
    } else {
      return 0;
    }
  }

  if (match.channel) {
    if (ctx.channel === match.channel) {
      score += 100;
    } else {
      return 0;
    }
  }

  return score || 1;
}

export function resolveAgent(
  config: Config,
  ctx: RoutingContext
): string {
  const bindings = config.bindings ?? [];
  
  if (bindings.length === 0) {
    return config.agent?.defaultAgentId ?? "main";
  }

  let bestMatch: { agentId: string; score: number } | null = null;

  for (const binding of bindings) {
    const score = matchBinding(binding, ctx);
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { agentId: binding.agentId, score };
    }
  }

  if (bestMatch) {
    return bestMatch.agentId;
  }

  return config.agent?.defaultAgentId ?? "main";
}

export class Router {
  constructor(private config: Config) {}

  route(ctx: RoutingContext): string {
    return resolveAgent(this.config, ctx);
  }

  getAgentWorkspace(agentId: string): string {
    const agents = this.config.agents?.list ?? [];
    const agent = agents.find((a) => a.id === agentId);
    
    if (agent?.workspace) {
      return agent.workspace.replace(/^~/, process.env.HOME ?? "");
    }

    const baseDir = this.config.agent?.baseDir?.replace(/^~/, process.env.HOME ?? "") 
      ?? `${process.env.HOME}/.hive/agents`;
    
    return `${baseDir}/${agentId}/workspace`;
  }
}
