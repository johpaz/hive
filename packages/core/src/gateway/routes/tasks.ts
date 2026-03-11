import { getDb } from "../../storage/sqlite"

export async function handleGetTasks(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const agentId = url.searchParams.get("agentId")
  
  let tasks
  if (agentId) {
    tasks = getDb().query("SELECT * FROM tasks WHERE agent_id = ? ORDER BY id ASC").all(agentId)
  } else {
    tasks = getDb().query("SELECT * FROM tasks ORDER BY id ASC").all()
  }
  
  return addCorsHeaders(Response.json({ tasks }), req)
}

export async function handleUpdateTask(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const taskId = url.pathname.split("/").pop()
  const body = await req.json().catch(() => ({}))
  
  if (!taskId) {
    return addCorsHeaders(new Response("Missing ID", { status: 400 }), req)
  }
  
  const updates: string[] = []
  const params: unknown[] = []
  
  if (body.status !== undefined) {
    updates.push("status = ?")
    params.push(body.status)
  }
  if (body.result !== undefined) {
    updates.push("result = ?")
    params.push(body.result)
  }
  
  if (updates.length > 0) {
    params.push(taskId)
    getDb().query(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }
  
  return addCorsHeaders(Response.json({ ok: true }), req)
}
