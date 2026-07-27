import { col, updateDoc } from "../../storage/hive.ts"
import type { McpServerDoc } from "../../storage/collections.ts"
import { storeMcpHeaders, loadMcpHeaders, deleteMcpSecrets } from "../../storage/crypto.ts"
import { logger } from "../../utils/logger.ts"

const mcpLog = logger.child("mcp:api")

/** Servers are looked up by id or by human-readable name, matching the old `WHERE id = ? OR name = ?`. */
async function findMcpServer(idOrName: string) {
  const mcpCol = await col<McpServerDoc>("mcpServers")
  const byId = await mcpCol.get(idOrName)
  if (byId) return byId
  const all = await mcpCol.scan({})
  return all.find(e => e.doc.name === idOrName)
}

export async function handleGetMcpServers(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  mcpManager?: any
): Promise<Response> {
  // Get real-time server status from MCP manager
  const mcpServers = new Map<string, { status: string; tools: any[] }>()
  if (mcpManager) {
    try {
      const servers = mcpManager.listServers?.() || []
      mcpLog.info(`[GET] MCP Manager returned ${servers.length} servers:`, servers.map((s: any) => `${s.name}:${s.status}`))
      for (const s of servers) {
        mcpServers.set(s.name, {
          status: s.status,
          tools: s.tools || [],
        })
      }
    } catch (e) {
      mcpLog.warn(`Failed to get MCP servers: ${(e as Error).message}`)
    }
  } else {
    mcpLog.warn(`[GET] No MCP Manager provided`)
  }

  // Get all servers from the database
  const mcpCol = await col<McpServerDoc>("mcpServers")
  const dbServers = (await mcpCol.scan({})).map(e => e.doc).sort((a, b) => a.name.localeCompare(b.name))

  // Combine DB info with real-time status from MCP manager
  const allServers = await Promise.all(dbServers.map(async s => {
    // Try to find matching server in MCP Manager (by name or normalized name)
    const normalizedName = s.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const mcpServer = mcpServers.get(s.name) || mcpServers.get(normalizedName)
    const isEnabled = s.enabled

    // Redact headers for safe UI display
    const rawHeaders = await loadMcpHeaders(s.id)
    const headers = Object.keys(rawHeaders).length > 0
      ? Object.fromEntries(
          Object.entries(rawHeaders).map(([k, v]) => [
            k,
            k.toLowerCase().includes("auth") ||
              k.toLowerCase().includes("token") ||
              k.toLowerCase().includes("key")
              ? `${(v as string).slice(0, 4)}••••••••`
              : v,
          ])
        )
      : undefined

    return {
      id: s.id,
      name: s.name,
      enabled: isEnabled,
      status: mcpServer?.status || (isEnabled ? "disconnected" : "disconnected"),
      config: {
        transport: s.transport,
        command: s.command,
        args: s.args ? JSON.parse(s.args) : [],
        url: s.url,
        headers,
        enabled: isEnabled
      },
      tools_count: mcpServer?.tools.length || s.tools_count || 0,
      tools: mcpServer?.tools || [],
    }
  }))

  return addCorsHeaders(Response.json(allServers), req)
}

export async function handleCreateMcpServer(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))

  if (!body.name || !body.config) {
    return addCorsHeaders(new Response("Missing name or config", { status: 400 }), req)
  }

  mcpLog.info(`Creating MCP server: ${body.name}`)

  // Generate unique ID (name-based for consistency)
  const serverId = body.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const mcpCol = await col<McpServerDoc>("mcpServers")
  await mcpCol.put(serverId, {
    id: serverId, name: body.name, transport: body.config.transport || "stdio",
    command: body.config.command || null, args: body.config.args ? JSON.stringify(body.config.args) : null,
    url: body.config.url || null, enabled: body.config.enabled !== false, active: false,
    builtin: false, status: "disconnected", tools_count: 0,
  })

  if (body.config.headers) {
    await storeMcpHeaders(serverId, body.config.headers)
  }

  return addCorsHeaders(Response.json({ success: true, id: serverId }), req)
}

export async function handleDeleteMcpServer(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  // Extract server name from path: /api/mcp/servers/{name}
  const parts = url.pathname.split("/").filter(Boolean)
  const serverName = parts[parts.length - 1]

  if (!serverName || serverName === "servers") {
    return addCorsHeaders(Response.json({ success: false, error: "server name required" }), req)
  }

  // Delete from DB and keychain
  const entry = await findMcpServer(serverName)
  if (entry) {
    const mcpCol = await col<McpServerDoc>("mcpServers")
    await mcpCol.delete(entry.id)
    await deleteMcpSecrets(entry.id)
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleGetMcpServerDetail(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  serverId: string
): Promise<Response> {
  const entry = await findMcpServer(serverId)

  if (!entry) {
    return addCorsHeaders(new Response("Server not found", { status: 404 }), req)
  }
  const server = entry.doc

  // Load headers — unredacted, for editing
  const rawDetail = await loadMcpHeaders(server.id)
  const headers = Object.keys(rawDetail).length > 0 ? rawDetail as Record<string, string> : undefined

  return addCorsHeaders(Response.json({
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? null,
    args: server.args ? JSON.parse(server.args) : [],
    url: server.url ?? null,
    headers,
    enabled: server.enabled,
    builtin: server.builtin,
    status: server.status,
    tools_count: server.tools_count ?? 0,
  }), req)
}

export async function handleUpdateMcpServer(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  // Extract server name from path: /api/mcp/servers/{name}
  const parts = url.pathname.split("/").filter(Boolean)
  const serverName = parts[parts.length - 1]
  const body = await req.json().catch(() => ({}))

  if (!serverName || serverName === "servers") {
    return addCorsHeaders(new Response("Missing server name", { status: 400 }), req)
  }

  mcpLog.info(`Updating MCP server: ${serverName}`)

  const patch: Partial<McpServerDoc> = {}
  if (body.transport !== undefined) patch.transport = body.transport
  if (body.name !== undefined) patch.name = body.name
  if (body.command !== undefined) patch.command = body.command
  if (body.args !== undefined) patch.args = JSON.stringify(body.args)
  if (body.url !== undefined) patch.url = body.url
  if (body.enabled !== undefined) patch.enabled = !!body.enabled

  if (Object.keys(patch).length > 0) {
    const entry = await findMcpServer(serverName)
    if (entry) {
      const mcpCol = await col<McpServerDoc>("mcpServers")
      await mcpCol.put(entry.id, { ...entry.doc, ...patch }, { expectedVersion: entry.version })
    }
  }

  if (body.headers) {
    await storeMcpHeaders(serverName, body.headers)
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleToggleMcpServer(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  mcpId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { active } = body

  if (active === undefined) {
    return addCorsHeaders(Response.json({ success: false, error: "Missing active field", message: "Falta el campo 'active'" }, { status: 400 }), req)
  }

  await updateDoc<McpServerDoc>("mcpServers", mcpId, { active: !!active, enabled: !!active }).catch(() => { /* not found */ })

  return addCorsHeaders(Response.json({ success: true, active, message: active ? "Servidor MCP activado" : "Servidor MCP desactivado" }), req)
}

/**
 * Get tools for a specific MCP server
 * Note: Tools are loaded from MCP Manager at runtime, not from DB
 */
export async function handleGetMCPServerTools(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  serverId: string,
  mcpManager?: any
): Promise<Response> {
  if (!mcpManager) {
    return addCorsHeaders(new Response("MCP is disabled", { status: 404 }), req);
  }

  const tools = mcpManager.getServerTools(serverId) || [];

  return addCorsHeaders(Response.json({ tools }), req);
}

// Note: handleToggleMCPTool and handleDeleteMCPTool removed
// MCP tools are not stored in DB - they are loaded at runtime from servers
