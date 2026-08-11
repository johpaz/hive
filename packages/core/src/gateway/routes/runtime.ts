import { col } from "../../storage/hive.ts";
import type { AgentDoc, SkillDoc } from "../../storage/collections.ts";
import { getHiveDir } from "../../config/loader.ts";
import pkg from "../../../../../package.json";

const REQUIRED_CATALOG_SKILLS = ["a2ui_form", "a2ui_dashboard", "a2ui_interactive"];

function parseSkillIds(value: string | null | undefined): string[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Runtime facts used by the desktop UI to distinguish an empty database from
 * an old/incomplete gateway sidecar. This endpoint deliberately reports
 * catalog metadata only; skill bodies and secrets are never included.
 */
export async function handleGetRuntimeStatus(
  req: Request,
  addCorsHeaders: (response: Response, request: Request) => Response,
): Promise<Response> {
  const skills = (await (await col<SkillDoc>("skills")).scan({})).map((entry) => entry.doc);
  const agents = (await (await col<AgentDoc>("agents")).scan({})).map((entry) => entry.doc);
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const a2uiBuilder = agents.find((agent) => agent.id === "a2ui_builder");
  const required = REQUIRED_CATALOG_SKILLS.map((name) => ({
    name,
    present: byName.has(name),
    active: byName.get(name)?.active === true,
  }));

  return addCorsHeaders(Response.json({
    version: pkg.version,
    process: {
      execPath: process.execPath,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
    hiveHome: process.env.HIVE_HOME ?? getHiveDir(),
    skills: {
      total: skills.length,
      active: skills.filter((skill) => skill.active).length,
      required,
    },
    agents: {
      a2ui_builder: a2uiBuilder
        ? {
            enabled: a2uiBuilder.enabled,
            skills: parseSkillIds(a2uiBuilder.skills_json),
          }
        : null,
    },
    healthy: required.every((skill) => skill.present && skill.active),
  }), req);
}
