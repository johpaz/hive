import { getDb } from "../../storage/sqlite"
import { emitCanvas } from "../../canvas/emitter"

export async function handleGetProjects(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const projects = getDb().query(`
    SELECT p.*, 
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') as done_count
    FROM projects p
    ORDER BY p.created_at DESC
  `).all() as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      createdAt: new Date((p.created_at as number) * 1000).toISOString(),
      taskCount: p.task_count,
      doneCount: p.done_count,
    }))
  }), req)
}

export async function handleGetActiveProject(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const project = getDb().query(`
    SELECT p.*, 
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') as done_count
    FROM projects p
    WHERE p.status = 'active'
    ORDER BY p.created_at DESC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined
  
  if (!project) {
    return addCorsHeaders(Response.json({ project: null }), req)
  }
  
  const tasks = getDb().query(`
    SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC
  `).all(project.id as string) as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({
    project: {
      ...project,
      tasks,
      taskCount: project.task_count,
      doneCount: project.done_count,
    }
  }), req)
}

export async function handleCreateProject(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  
  const result = getDb().query(`
    INSERT INTO projects(name, description, status)
    VALUES(?, ?, 'active')
    RETURNING id
  `).get(body.name || "New Project", body.description || "") as { id: string } | undefined
  
  const projectId = result?.id
  
  if (projectId) {
    emitCanvas("canvas:node_add", {
      node: { id: projectId, name: body.name || "New Project", status: "active", type: "project" }
    })
  }
  
  return addCorsHeaders(Response.json({ ok: true, projectId }), req)
}

export async function handleUpdateProject(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const projectId = url.pathname.split("/").pop()
  const body = await req.json().catch(() => ({}))

  if (!projectId) {
    return addCorsHeaders(new Response("Missing ID", { status: 400 }), req)
  }

  const updates: string[] = []
  const params: unknown[] = []

  if (body.name !== undefined) {
    updates.push("name = ?")
    params.push(body.name)
  }
  if (body.description !== undefined) {
    updates.push("description = ?")
    params.push(body.description)
  }
  if (body.status !== undefined) {
    updates.push("status = ?")
    params.push(body.status)
  }

  if (updates.length > 0) {
    params.push(projectId)
    getDb().query(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleGetProjectHistory(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;
  const db = getDb();

  const projects = db.query(
    "SELECT * FROM projects WHERE status IN ('done','failed') ORDER BY completed_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset) as Record<string, unknown>[];

  const total = db.query(
    "SELECT COUNT(*) as count FROM projects WHERE status IN ('done', 'failed')"
  ).get() as { count: number };

  return addCorsHeaders(Response.json({
    data: projects.map(p => ({
      ...p,
      tasks: db.query("SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC").all(p.id as string)
    })),
    pagination: { page, limit, total: total.count, pages: Math.ceil(total.count / limit) }
  }), req);
}

export async function handleGetProjectDetail(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  projectId: string
): Promise<Response> {
  const db = getDb();
  const project = db.query(
    "SELECT * FROM projects WHERE id = ?"
  ).get(projectId) as Record<string, unknown> | undefined;

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const tasks = db.query(
    "SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC"
  ).all(projectId);

  const subprojects = db.query(
    "SELECT * FROM projects WHERE parent_id = ?"
  ).all(projectId);

  return addCorsHeaders(Response.json({ ...project, tasks, subprojects }), req);
}

export async function handleGetProjectTasks(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  projectId: string
): Promise<Response> {
  const db = getDb();
  const project = db.query(
    "SELECT id FROM projects WHERE id = ?"
  ).get(projectId);

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const tasks = db.query(
    "SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC"
  ).all(projectId);

  return addCorsHeaders(Response.json(tasks), req);
}
