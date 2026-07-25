import type { Agent } from "@/types";

export interface AssignedCapability {
  id: string;
  suppliedName?: string;
}

export function parseAssignments(value?: string): AssignedCapability[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    const capabilities = parsed.flatMap((entry): AssignedCapability[] => {
      if (typeof entry === "string" && entry.trim()) return [{ id: entry.trim() }];
      if (typeof entry === "object" && entry !== null) {
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string"
          ? record.id
          : typeof record.name === "string"
            ? record.name
            : "";
        if (!id) return [];
        return [{ id, suppliedName: typeof record.name === "string" ? record.name : undefined }];
      }
      return [];
    });

    return Array.from(new Map(capabilities.map((capability) => [capability.id, capability])).values());
  } catch {
    return [];
  }
}

export function getAgentToolIds(agent: Agent) {
  return Array.from(new Set([
    ...(agent.role === "coordinator" ? agent.minimalTools ?? [] : []),
    ...parseAssignments(agent.toolsJson).map((tool) => tool.id),
  ]));
}

export function getAgentSkillIds(agent: Agent) {
  return Array.from(new Set([
    ...(agent.role === "coordinator" ? (agent.minimalSkills ?? []).map((skill) => skill.id) : []),
    ...parseAssignments(agent.skillsJson).map((skill) => skill.id),
  ]));
}
