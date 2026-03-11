import { getDb } from "../../storage/sqlite"

export async function handleGetEthics(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const ethics = getDb().query(`
    SELECT id, name, description, content, active, enabled
    FROM ethics
    ORDER BY name
  `).all() as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({
    ethics: ethics.map(e => ({
      id: e.id,
      name: e.name,
      description: e.description,
      content: e.content,
      active: e.active === 1,
      enabled: e.enabled === 1,
    }))
  }), req)
}

export async function handleActivateEthics(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { ethicsId, active } = body
  
  if (!ethicsId) {
    return addCorsHeaders(Response.json({ success: false, error: "ethicsId required" }), req)
  }
  
  getDb().query(`UPDATE ethics SET active = ?, enabled = ? WHERE id = ?`).run(active ? 1 : 0, active ? 1 : 0, ethicsId)
  
  return addCorsHeaders(Response.json({ success: true, ethicsId, active }), req)
}

export async function handleDeleteEthics(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const id = url.pathname.split("/").pop()
  
  if (!id) {
    return addCorsHeaders(Response.json({ success: false, error: "id required" }), req)
  }
  
  getDb().query("DELETE FROM ethics WHERE id = ?").run(id)
  
  return addCorsHeaders(Response.json({ success: true }), req)
}
