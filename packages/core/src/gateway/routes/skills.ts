import { col, updateDoc } from "../../storage/hive"
import type { SkillDoc } from "../../storage/collections"
import { emitCanvas } from "../../canvas/emitter"
import { syncSkillsToIndex } from "../../agent/skill-selector"

export async function handleGetSkills(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const skillsCol = await col<SkillDoc>("skills")
  const entries = await skillsCol.scan({})
  const skills = entries.map(e => e.doc).sort((a, b) => a.name.localeCompare(b.name))

  return addCorsHeaders(Response.json({
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      tools: s.tools,
      triggers: s.triggers,
      preferred_agents: s.preferred_agents,
      body: s.body,
      version: s.version,
      version_num: s.version_num,
      active: s.active,
    }))
  }), req)
}

export async function handleActivateSkill(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split("/").filter(Boolean)
  // /api/skills/:id/toggle → parts[2] = id
  const skillId = parts[2]
  const body = await req.json().catch(() => ({}))
  const { active } = body

  if (!skillId) {
    return addCorsHeaders(Response.json({ success: false, error: "skillId required" }), req)
  }

  await updateDoc<SkillDoc>("skills", skillId, { active: !!active }).catch(() => { /* not found */ })

  // Re-sync the HiveDB index so semantic matching respects the new active state immediately
  syncSkillsToIndex().catch(() => {})

  return addCorsHeaders(Response.json({ success: true, skillId, active }), req)
}

export async function handleUpdateSkill(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split("/").filter(Boolean)
  const skillId = parts[2]
  const body = await req.json().catch(() => ({}))

  if (!skillId) {
    return addCorsHeaders(Response.json({ success: false, error: "skillId required" }), req)
  }

  const patch: Partial<SkillDoc> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.category !== undefined) patch.category = body.category
  if (body.tools !== undefined) patch.tools = body.tools
  if (body.triggers !== undefined) patch.triggers = body.triggers
  if (body.preferred_agents !== undefined) patch.preferred_agents = typeof body.preferred_agents === 'object' ? JSON.stringify(body.preferred_agents) : body.preferred_agents
  if (body.body !== undefined) patch.body = body.body
  if (body.version !== undefined) patch.version = body.version
  if (body.active !== undefined) patch.active = !!body.active

  if (Object.keys(patch).length > 0) {
    patch.updated_at = Date.now()
    await updateDoc<SkillDoc>("skills", skillId, patch).catch(() => { /* not found */ })
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleDeleteSkill(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const skillId = url.pathname.split("/").pop()

  if (!skillId) {
    return addCorsHeaders(Response.json({ success: false, error: "skillId required" }), req)
  }

  const skillsCol = await col<SkillDoc>("skills")
  await skillsCol.delete(skillId)

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleCreateSkill(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { name, description, category, tools, triggers, preferred_agents, body: bodyContent } = body;

  if (!name) {
    return addCorsHeaders(new Response("Missing name", { status: 400 }), req);
  }

  const { randomUUID } = await import("crypto");
  const id = randomUUID();
  const now = Date.now();

  const skillsCol = await col<SkillDoc>("skills")
  await skillsCol.put(id, {
    id, name, description: description || "", version: "0.0.1", author: "Anonymous", icon: "🧩",
    category: category || "", permissions: "[]", dependencies: "[]",
    tools: tools || "", triggers: triggers || "",
    preferred_agents: typeof preferred_agents === 'object' ? JSON.stringify(preferred_agents || []) : (preferred_agents || "[]"),
    body: bodyContent || "", version_num: 1, active: true, created_at: now, updated_at: now,
  }, { expectedVersion: 0 })

  return addCorsHeaders(Response.json({ success: true, id }), req);
}
