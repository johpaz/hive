import { getDb } from "../../storage/sqlite"
import { emitCanvas } from "../../canvas/emitter"
import { syncSkillsToFTS } from "../../agent/skill-selector"

export async function handleGetSkills(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const skills = getDb().query(`
    SELECT id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active
    FROM skills
    ORDER BY name
  `).all() as Record<string, unknown>[]

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
      active: s.active === 1,
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

  getDb().query(`UPDATE skills SET active = ? WHERE id = ?`).run(active ? 1 : 0, skillId)

  // Re-sync FTS5 index so semantic matching respects the new active state immediately
  syncSkillsToFTS().catch(() => {})

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

  const updates: string[] = []
  const params: unknown[] = []

  if (body.name !== undefined)           { updates.push("name = ?");           params.push(body.name) }
  if (body.description !== undefined)    { updates.push("description = ?");    params.push(body.description) }
  if (body.category !== undefined)       { updates.push("category = ?");       params.push(body.category) }
  if (body.tools !== undefined)          { updates.push("tools = ?");          params.push(body.tools) }
  if (body.triggers !== undefined)       { updates.push("triggers = ?");       params.push(body.triggers) }
  if (body.preferred_agents !== undefined) { updates.push("preferred_agents = ?"); params.push(typeof body.preferred_agents === 'object' ? JSON.stringify(body.preferred_agents) : body.preferred_agents) }
  if (body.body !== undefined)           { updates.push("body = ?");            params.push(body.body) }
  if (body.version !== undefined)         { updates.push("version = ?");        params.push(body.version) }
  if (body.active !== undefined)          { updates.push("active = ?");          params.push(body.active ? 1 : 0) }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')")
    params.push(skillId)
    getDb().query(`UPDATE skills SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleDeleteSkill(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const skillId = url.pathname.split("/").pop()

  if (!skillId) {
    return addCorsHeaders(Response.json({ success: false, error: "skillId required" }), req)
  }

  getDb().query(`DELETE FROM skills WHERE id = ?`).run(skillId)

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

  getDb().query(
    `INSERT INTO skills(id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active) VALUES(?, ?, ?, ?, ?, ?, ?, ?, '0.0.1', 1, 1)`
  ).run(id, name, description || "", category || "", tools || "", triggers || "",
    typeof preferred_agents === 'object' ? JSON.stringify(preferred_agents || []) : (preferred_agents || "[]"),
    bodyContent || "");

  return addCorsHeaders(Response.json({ success: true, id }), req);
}
