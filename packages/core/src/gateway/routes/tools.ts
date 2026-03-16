import { getDb } from "../../storage/sqlite"

export async function handleGetTools(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const tools = getDb().query(`
    SELECT id, name, description, category, active, enabled
    FROM tools
    ORDER BY name
  `).all() as Record<string, unknown>[]

  return addCorsHeaders(Response.json({
    tools: tools.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      active: t.active === 1,
      enabled: t.enabled === 1,
    }))
  }), req)
}

export async function handleActivateTool(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const toolId = url.pathname.split("/")[3]
  const body = await req.json().catch(() => ({}))
  const { active } = body

  if (!toolId) {
    return addCorsHeaders(Response.json({ success: false, error: "toolId required" }), req)
  }

  getDb().query(`UPDATE tools SET active = ?, enabled = ? WHERE id = ?`).run(active ? 1 : 0, active ? 1 : 0, toolId)

  return addCorsHeaders(Response.json({ success: true, toolId, active }), req)
}

export async function handleUpdateTool(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const toolId = url.pathname.split("/")[3]
  const body = await req.json().catch(() => ({}))

  if (!toolId) {
    return addCorsHeaders(Response.json({ success: false, error: "toolId required" }), req)
  }

  const updates: string[] = []
  const params: unknown[] = []

  if (body.name !== undefined)        { updates.push("name = ?");        params.push(body.name) }
  if (body.description !== undefined) { updates.push("description = ?"); params.push(body.description) }
  if (body.category !== undefined)    { updates.push("category = ?");    params.push(body.category) }

  if (updates.length > 0) {
    params.push(toolId)
    getDb().query(`UPDATE tools SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}
