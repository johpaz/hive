import { getDb } from "../../storage/sqlite"

export async function handleGetCronJobs(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const jobs = getDb().query(`
    SELECT * FROM cron_jobs ORDER BY id ASC
  `).all() as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({ cronJobs: jobs }), req)
}

export async function handleGetCronChannels(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const channels = getDb().query(`
    SELECT DISTINCT channel FROM user_channels WHERE channel IS NOT NULL
  `).all() as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({ channels: channels.map(c => c.channel) }), req)
}

export async function handleUpdateCronJob(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const jobId = url.pathname.split("/").pop()
  const body = await req.json().catch(() => ({}))
  
  if (!jobId) {
    return addCorsHeaders(new Response("Missing ID", { status: 400 }), req)
  }
  
  const updates: string[] = []
  const params: unknown[] = []
  
  if (body.active !== undefined) {
    updates.push("active = ?")
    params.push(body.active ? 1 : 0)
  }
  
  if (updates.length > 0) {
    params.push(jobId)
    getDb().query(`UPDATE cron_jobs SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }
  
  return addCorsHeaders(Response.json({ ok: true }), req)
}
