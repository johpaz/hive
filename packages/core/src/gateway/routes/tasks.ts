import { col } from "../../storage/hive"
import type { TaskDoc } from "../../storage/collections"

export async function handleGetTasks(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const agentId = url.searchParams.get("agentId")

  const tasksCol = await col<TaskDoc>("tasks")
  let tasks = agentId
    ? (await tasksCol.findBy("agent_id", agentId)).map(e => e.doc)
    : (await tasksCol.scan({})).map(e => e.doc)
  tasks = tasks.sort((a, b) => a.id.localeCompare(b.id))

  return addCorsHeaders(Response.json({ tasks }), req)
}

export async function handleUpdateTask(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const taskIdParam = url.pathname.split("/").pop()
  const body = await req.json().catch(() => ({}))

  if (!taskIdParam) {
    return addCorsHeaders(new Response("Missing ID", { status: 400 }), req)
  }

  const taskId = /^\d+$/.test(taskIdParam) ? taskIdParam.padStart(15, "0") : taskIdParam

  const tasksCol = await col<TaskDoc>("tasks")
  const existing = await tasksCol.get(taskId)
  if (!existing) {
    return addCorsHeaders(Response.json({ ok: true }), req)
  }

  const patch: Partial<TaskDoc> = { updated_at: Date.now() }
  if (body.status !== undefined) patch.status = body.status
  if (body.result !== undefined) patch.result = body.result

  await tasksCol.put(taskId, { ...existing.doc, ...patch }, { expectedVersion: existing.version })

  return addCorsHeaders(Response.json({ ok: true }), req)
}
