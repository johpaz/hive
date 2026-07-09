import { col, updateDoc } from "../../storage/hive"
import type { ToolDoc } from "../../storage/collections"

export async function handleGetTools(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const toolsCol = await col<ToolDoc>("tools")
  const entries = await toolsCol.scan({})
  const tools = entries.map(e => e.doc).sort((a, b) => a.name.localeCompare(b.name))

  return addCorsHeaders(Response.json({
    tools: tools.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      active: t.active,
      enabled: t.enabled,
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

  await updateDoc<ToolDoc>("tools", toolId, { active: !!active, enabled: !!active }).catch(() => { /* not found */ })

  return addCorsHeaders(Response.json({ success: true, toolId, active }), req)
}

export async function handleUpdateTool(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const toolId = url.pathname.split("/")[3]
  const body = await req.json().catch(() => ({}))

  if (!toolId) {
    return addCorsHeaders(Response.json({ success: false, error: "toolId required" }), req)
  }

  const patch: Partial<ToolDoc> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.category !== undefined) patch.category = body.category

  if (Object.keys(patch).length > 0) {
    await updateDoc<ToolDoc>("tools", toolId, patch).catch(() => { /* not found */ })
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}
