import { getDb } from "../../storage/sqlite.ts"
import { encryptConfig, decryptConfig } from "../../storage/crypto.ts"
import { logger } from "../../utils/logger.ts"

const mcpLog = logger.child("mcp:api")

export async function handleGetMcpServers(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  mcpManager?: any
): Promise<Response> {
  const db = getDb()

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

  // Get all servers from database
  const dbServers = db.query(`
    SELECT * FROM mcp_servers ORDER BY name
  `).all() as Record<string, unknown>[]

  // Combine DB info with real-time status from MCP manager
  const allServers = dbServers.map(s => {
    // Try to find matching server in MCP Manager (by name or normalized name)
    const normalizedName = (s.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const mcpServer = mcpServers.get(s.name as string) || mcpServers.get(normalizedName)
    const isEnabled = s.enabled === 1

    // Redact headers for safe UI display
    let headers = undefined
    if (s.headers_encrypted && s.headers_iv) {
      try {
        const decryptedHeaders = decryptConfig(s.headers_encrypted as string, s.headers_iv as string)
        headers = Object.fromEntries(
          Object.entries(decryptedHeaders).map(([k, v]) => [
            k,
            k.toLowerCase().includes("auth") ||
              k.toLowerCase().includes("token") ||
              k.toLowerCase().includes("key")
              ? `${(v as string).slice(0, 4)}••••••••`
              : v,
          ])
        )
      } catch (e) {
        mcpLog.error(`Failed to decrypt headers for ${s.name}: ${(e as Error).message}`)
      }
    }

    return {
      id: s.id,
      name: s.name,
      enabled: isEnabled,
      status: mcpServer?.status || (isEnabled ? "disconnected" : "disconnected"),
      config: {
        transport: s.transport,
        command: s.command,
        args: s.args ? JSON.parse(s.args as string) : [],
        url: s.url,
        headers,
        enabled: isEnabled
      },
      tools_count: mcpServer?.tools.length || s.tools_count || 0,
      tools: mcpServer?.tools || [],
    }
  })

  return addCorsHeaders(Response.json(allServers), req)
}

export async function handleCreateMcpServer(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const db = getDb()

  if (!body.name || !body.config) {
    return addCorsHeaders(new Response("Missing name or config", { status: 400 }), req)
  }

  mcpLog.info(`Creating MCP server: ${body.name}`)

  // Generate unique ID (name-based for consistency)
  const serverId = body.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  // Encrypt headers if present
  let headersEncrypted: string | undefined
  let headersIv: string | undefined
  if (body.config.headers) {
    const encrypted = encryptConfig(body.config.headers)
    headersEncrypted = encrypted.encrypted
    headersIv = encrypted.iv
  }

  // Save to database
  db.query(`
    INSERT INTO mcp_servers(id, name, transport, command, args, url, headers_encrypted, headers_iv, enabled, builtin, status)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'disconnected')
  `).run(
    serverId,
    body.name,
    body.config.transport || "stdio",
    body.config.command || null,
    body.config.args ? JSON.stringify(body.config.args) : null,
    body.config.url || null,
    headersEncrypted,
    headersIv,
    body.config.enabled !== false ? 1 : 0
  )

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

  getDb().query(`DELETE FROM mcp_servers WHERE id = ? OR name = ?`).run(serverName, serverName)

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleGetMcpServerDetail(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  serverId: string
): Promise<Response> {
  const db = getDb()
  const server = db.query(`SELECT * FROM mcp_servers WHERE id = ? OR name = ?`).get(serverId, serverId) as Record<string, unknown> | undefined

  if (!server) {
    return addCorsHeaders(new Response("Server not found", { status: 404 }), req)
  }

  // Decrypt headers — unredacted, for editing
  let headers: Record<string, string> | undefined
  if (server.headers_encrypted && server.headers_iv) {
    try {
      headers = decryptConfig(server.headers_encrypted as string, server.headers_iv as string)
    } catch (e) {
      mcpLog.error(`Failed to decrypt headers for ${server.name}: ${(e as Error).message}`)
    }
  }

  return addCorsHeaders(Response.json({
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? null,
    args: server.args ? JSON.parse(server.args as string) : [],
    url: server.url ?? null,
    headers,
    enabled: server.enabled === 1,
    builtin: server.builtin === 1,
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
  const db = getDb()

  if (!serverName || serverName === "servers") {
    return addCorsHeaders(new Response("Missing server name", { status: 400 }), req)
  }

  mcpLog.info(`Updating MCP server: ${serverName}`)

  const updates: string[] = []
  const params: unknown[] = []

  if (body.transport !== undefined) {
    updates.push("transport = ?")
    params.push(body.transport)
  }
  if (body.name !== undefined) {
    updates.push("name = ?")
    params.push(body.name)
  }
  if (body.command !== undefined) {
    updates.push("command = ?")
    params.push(body.command)
  }
  if (body.args !== undefined) {
    updates.push("args = ?")
    params.push(JSON.stringify(body.args))
  }
  if (body.url !== undefined) {
    updates.push("url = ?")
    params.push(body.url)
  }
  if (body.enabled !== undefined) {
    updates.push("enabled = ?")
    params.push(body.enabled ? 1 : 0)
  }
  if (body.headers) {
    const { encrypted, iv } = encryptConfig(body.headers)
    updates.push("headers_encrypted = ?")
    params.push(encrypted)
    updates.push("headers_iv = ?")
    params.push(iv)
  }

  if (updates.length > 0) {
    params.push(serverName)
    params.push(serverName)
    db.query(`UPDATE mcp_servers SET ${updates.join(", ")} WHERE id = ? OR name = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleStartMcpServer(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const serverId = url.pathname.split("/").pop()

  if (!serverId) {
    return addCorsHeaders(Response.json({ success: false, error: "serverId required" }), req)
  }

  getDb().query(`UPDATE mcp_servers SET enabled = 1 WHERE id = ?`).run(serverId)

  return addCorsHeaders(Response.json({ success: true, serverId, enabled: true }), req)
}

export async function handleGetMcpServerTools(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  serverName: string,
  mcpManager?: any
): Promise<Response> {
  if (!mcpManager) {
    return addCorsHeaders(Response.json([]), req)
  }

  const tools = mcpManager.getServerTools(serverName)
  return addCorsHeaders(Response.json(tools), req)
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

  getDb().query(`UPDATE mcp_servers SET active = ?, enabled = ? WHERE id = ?`).run(active ? 1 : 0, active ? 1 : 0, mcpId)

  return addCorsHeaders(Response.json({ success: true, active, message: active ? "Servidor MCP activado" : "Servidor MCP desactivado" }), req)
}

export async function handleMcpServerAction(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  serverName: string,
  action: "connect" | "disconnect",
  mcpManager?: any
): Promise<Response> {
  if (!mcpManager) {
    return addCorsHeaders(new Response("MCP is disabled", { status: 404 }), req)
  }

  const db = getDb()

  if (action === "connect") {
    // Check if server exists and is enabled in DB
    const dbServer = db.query(`SELECT * FROM mcp_servers WHERE name = ? AND enabled = 1`).get(serverName)
    if (!dbServer) {
      return new Response("Server not found or disabled", { status: 400 })
    }

    await mcpManager.connectServer(serverName)

    // Update tools count after connection
    const tools = mcpManager.getServerTools(serverName) || []
    db.query(`UPDATE mcp_servers SET status = ?, tools_count = ? WHERE name = ?`).run("connected", tools.length, serverName)

    return addCorsHeaders(Response.json({ success: true, tools_count: tools.length }), req)
  }

  if (action === "disconnect") {
    await mcpManager.disconnectServer(serverName)
    return addCorsHeaders(Response.json({ success: true }), req)
  }

  return addCorsHeaders(new Response("Invalid action", { status: 400 }), req)
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
