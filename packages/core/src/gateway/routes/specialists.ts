import { col } from "../../storage/hive"
import type { AgentDoc, SpecialistDoc, VerificationDoc } from "../../storage/collections"
import { getAgentLiveState } from "../../canvas/emitter"
import { syncSpecialistsToIndex } from "../../agent/specialist-selector"

export async function handleGetSpecialists(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const specialistsCol = await col<SpecialistDoc>("specialists")
  const agentsCol = await col<AgentDoc>("agents")
  const verificationsCol = await col<VerificationDoc>("verifications")

  const rows = (await specialistsCol.scan({})).map(e => e.doc)
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name))

  const specialists = await Promise.all(sorted.map(async (s) => {
    const workerRows = await agentsCol.findBy("specialist_id", s.id)
    const workers = workerRows.map((row) => {
      const live = getAgentLiveState(row.doc.id)
      return {
        id: row.doc.id,
        status: live?.status ?? row.doc.status,
        currentTool: live?.currentTool ?? null,
        parentId: row.doc.parent_id,
        workspace: row.doc.workspace,
        updatedAt: row.doc.updated_at,
      }
    })

    const verificationRows = await verificationsCol.findBy("executor_specialist_id", s.id)
    const lastVerification = verificationRows.length
      ? verificationRows.map(e => e.doc).sort((a, b) => b.created_at - a.created_at)[0]
      : null

    return {
      id: s.id,
      name: s.name,
      description: s.description,
      active: s.active,
      source: s.source,
      seedVersion: s.seed_version,
      tools: s.tool_allowlist,
      skills: s.skill_ids,
      mcpServerIds: s.mcp_server_ids,
      workspaceScope: s.workspace_scope,
      modelOverride: s.model_override,
      acceptance: s.default_acceptance,
      ace: { helpful: s.helpful_count, harmful: s.harmful_count },
      runtime: {
        state: workers.length > 0 ? "awake" : "dormant",
        workers,
      },
      lastVerification: lastVerification
        ? { status: lastVerification.status, taskId: lastVerification.task_id, createdAt: lastVerification.created_at }
        : null,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }
  }))

  return addCorsHeaders(Response.json({ specialists }), req)
}

export async function handlePatchSpecialist(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const specialistId = url.pathname.split("/").pop()
  if (!specialistId) {
    return addCorsHeaders(new Response("Missing ID", { status: 400 }), req)
  }

  const specialistsCol = await col<SpecialistDoc>("specialists")
  const existing = await specialistsCol.get(specialistId)
  if (!existing) {
    return addCorsHeaders(new Response("Specialist not found", { status: 404 }), req)
  }

  const body = await req.json().catch(() => ({})) as { active?: unknown }
  if (typeof body.active !== "boolean") {
    return addCorsHeaders(new Response("Body must include boolean 'active'", { status: 400 }), req)
  }

  const updated: SpecialistDoc = { ...existing.doc, active: body.active, updated_at: Date.now() }
  await specialistsCol.put(specialistId, updated, { expectedVersion: existing.version })
  await syncSpecialistsToIndex()

  return addCorsHeaders(Response.json({
    ok: true,
    specialist: { id: updated.id, active: updated.active, updatedAt: updated.updated_at },
  }), req)
}
