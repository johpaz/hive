/**
 * MCP Tool Sync — Persist MCP tool definitions to DB and the HiveDB index
 *
 * When an MCP server connects, its tool definitions are persisted to
 * the mcp_tools table (SQLite) and indexed in the HiveDB capability index
 * for search_knowledge. When the server disconnects, all its tools are
 * deleted from both (the index side uses a `server_id` filter, so only
 * that server's documents are removed).
 *
 * This enables:
 * 1. search_knowledge to find MCP tools via HiveDB BM25
 * 2. Tool definitions to survive across context compiler invocations
 * 3. Offline visibility of what MCP tools were available
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"
import { mcpToolFullName } from "../agent/tool-selector"
import {
    replaceCapabilityDocs,
    deleteCapabilitiesByServer,
    type CapabilityDoc,
} from "../agent/capability-search"

const log = logger.child("mcp:tool-sync")

export interface MCPToolDefinition {
    name: string
    description: string
    inputSchema?: Record<string, unknown>
}

/**
 * Generate a stable ID for an MCP tool based on server + tool name.
 *
 * MUST be identical to the LLM function name the agent calls — agent-loop
 * resolves search results against executors by this exact string — so it
 * delegates to mcpToolFullName instead of duplicating the algorithm.
 */
export function mcpToolId(serverName: string, toolName: string): string {
    return mcpToolFullName(serverName, toolName)
}

/**
 * Persist MCP tool definitions to the mcp_tools table.
 * Called when a server connects or reconnects.
 * Deletes existing tools for the server first, then inserts fresh data.
 */
export function syncMCPToolsToDB(
    serverId: string,
    serverName: string,
    tools: MCPToolDefinition[]
): void {
    const db = getDb()

    try {
        const deleteExisting = db.prepare("DELETE FROM mcp_tools WHERE server_id = ?")
        deleteExisting.run(serverId)

        if (tools.length === 0) {
            log.debug(`[mcp:tool-sync] No tools to persist for server ${serverName}`)
            return
        }

        const insertTool = db.prepare(`
            INSERT INTO mcp_tools(id, server_id, server_name, tool_name, description, category, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'mcp', 1, (unixepoch()), (unixepoch()))
        `)

        let count = 0
        for (const tool of tools) {
            const id = mcpToolId(serverName, tool.name)
            insertTool.run(id, serverId, serverName, tool.name, tool.description || "")
            count++
        }

        log.info(`[mcp:tool-sync] Persisted ${count} MCP tools for server ${serverName} to mcp_tools`)
    } catch (err) {
        log.error(`[mcp:tool-sync] Failed to persist MCP tools for server ${serverName}:`, err)
    }
}

/**
 * Sync all active MCP tools from mcp_tools table to the HiveDB capability
 * index. Called after syncMCPToolsToDB or after startup to ensure the index
 * is in sync.
 *
 * This does a full replace of `type=mcp` documents to avoid drift.
 */
export async function syncMCPToolsToFTS(): Promise<void> {
    const db = getDb()

    try {
        const mcpTools = db.query(`
            SELECT id, server_id, server_name, tool_name, description, category
            FROM mcp_tools
            WHERE active = 1
        `).all() as Array<{ id: string; server_id: string; server_name: string; tool_name: string; description: string; category: string }>

        // Searchable text is the tool's OWN name/description only. The server
        // name is deliberately NOT indexed: generic server names (e.g.
        // "herramientas administrativas") would make every query matching the
        // server name flood the results with that server's entire tool set.
        // The server stays reachable via the server_id filter and appears in
        // hydrated results.
        //
        // camelCase names ("crearEvento") tokenize as a single word, so a
        // space-split variant goes into the searchable text ("crear Evento").
        const splitCamel = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        const docs: CapabilityDoc[] = mcpTools.map(tool => ({
            type: "mcp" as const,
            rawId: tool.id,
            name: `${tool.tool_name} ${splitCamel(tool.tool_name)}`,
            body: tool.description || tool.tool_name,
            tags: tool.category ?? "",
            extraFilters: [{ field: "server_id", value: tool.server_id }],
        }))

        await replaceCapabilityDocs("mcp", docs)

        log.info(`[mcp:tool-sync] Synced ${mcpTools.length} MCP tools to HiveDB index`)
    } catch (err) {
        log.error(`[mcp:tool-sync] Failed to sync MCP tools to HiveDB index:`, err)
    }
}

/**
 * Delete all MCP tool definitions for a server from both mcp_tools and the
 * HiveDB capability index. Called when a server disconnects or is removed.
 */
export async function clearMCPToolsFromDB(serverId: string): Promise<void> {
    const db = getDb()

    try {
        db.query("DELETE FROM mcp_tools WHERE server_id = ?").run(serverId)

        // Remove only this server's documents from the index
        await deleteCapabilitiesByServer(serverId)

        log.info(`[mcp:tool-sync] Cleared MCP tools for server_id=${serverId}`)
    } catch (err) {
        log.error(`[mcp:tool-sync] Failed to clear MCP tools for server_id=${serverId}:`, err)
    }
}