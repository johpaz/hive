import { getDb } from "../../storage/sqlite"
import { emitCanvas } from "../../canvas/emitter"

export async function handleGetSkills(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const skills = getDb().query(`
    SELECT id, name, category, tools, triggers, body, version, active
    FROM skills
    ORDER BY name
  `).all() as Record<string, unknown>[]

  return addCorsHeaders(Response.json({
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      tools: s.tools,
      triggers: s.triggers,
      body: s.body,
      version: s.version,
      active: s.active === 1,
    }))
  }), req)
}

export async function handleActivateSkill(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { skillId, active } = body

  if (!skillId) {
    return addCorsHeaders(Response.json({ success: false, error: "skillId required" }), req)
  }

  getDb().query(`UPDATE skills SET active = ? WHERE id = ?`).run(active ? 1 : 0, skillId)

  return addCorsHeaders(Response.json({ success: true, skillId, active }), req)
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
  const { name, category, tools, triggers, body: bodyContent } = body;

  if (!name) {
    return addCorsHeaders(new Response("Missing name", { status: 400 }), req);
  }

  const { randomUUID } = await import("crypto");
  const id = randomUUID();

  getDb().query(
    `INSERT INTO skills(id, name, category, tools, triggers, body, version, active) VALUES(?, ?, ?, ?, ?, ?, 1, 1)`
  ).run(id, name, category || "", tools || "", triggers || "", bodyContent || "", 1);

  return addCorsHeaders(Response.json({ success: true, id }), req);
}
