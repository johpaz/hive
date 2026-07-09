import { col, updateDoc } from "../../storage/hive"
import type { EthicsDoc } from "../../storage/collections"

export async function handleGetEthics(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const ethicsCol = await col<EthicsDoc>("ethics")
  const entries = await ethicsCol.scan({})
  const ethics = entries.map(e => e.doc).sort((a, b) => a.name.localeCompare(b.name))

  return addCorsHeaders(Response.json({
    ethics: ethics.map(e => ({
      id: e.id,
      name: e.name,
      description: e.description,
      content: e.content,
      active: e.active,
      enabled: e.enabled,
    }))
  }), req)
}

export async function handleActivateEthics(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { ethicsId, active } = body

  if (!ethicsId) {
    return addCorsHeaders(Response.json({ success: false, error: "ethicsId required" }), req)
  }

  await updateDoc<EthicsDoc>("ethics", ethicsId, { active: !!active, enabled: !!active }).catch(() => { /* not found */ })

  return addCorsHeaders(Response.json({ success: true, ethicsId, active }), req)
}

export async function handleDeleteEthics(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const id = url.pathname.split("/").pop()

  if (!id) {
    return addCorsHeaders(Response.json({ success: false, error: "id required" }), req)
  }

  const ethicsCol = await col<EthicsDoc>("ethics")
  await ethicsCol.delete(id)

  return addCorsHeaders(Response.json({ success: true }), req)
}
