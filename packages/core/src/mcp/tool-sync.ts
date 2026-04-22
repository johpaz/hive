/**
 * MCP Tool Sync — Persist MCP tool definitions to DB and FTS5
 *
 * When an MCP server connects, its tool definitions are persisted to
 * the mcp_tools table and indexed in mcp_tools_fts for search_knowledge.
 * When the server disconnects, all its tools are deleted from both.
 *
 * This enables:
 * 1. search_knowledge to find MCP tools via FTS5
 * 2. Tool definitions to survive across context compiler invocations
 * 3. Offline visibility of what MCP tools were available
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"

const log = logger.child("mcp:tool-sync")

export interface MCPToolDefinition {
    name: string
    description: string
    inputSchema?: Record<string, unknown>
}

/**
 * Generate a stable ID for an MCP tool based on server + tool name.
 * Uses the same sanitization as mcpToolFullName for consistency.
 */
export function mcpToolId(serverName: string, toolName: string): string {
    const safe = (s: string) => s.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.\-:]/g, '_')
    const full = `${safe(serverName)}__${safe(toolName)}`
    const trimmed = full.length > 64 ? full.substring(0, 64) : full
    return /^[a-zA-Z_]/.test(trimmed) ? trimmed : `_${trimmed}`.substring(0, 64)
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
 * Sync all active MCP tools from mcp_tools table to mcp_tools_fts.
 * Called after syncMCPToolsToDB or after startup to ensure FTS5 is in sync.
 *
 * This does a full clear + re-insert to avoid schema drift.
 */
export async function syncMCPToolsToFTS(): Promise<void> {
    const db = getDb()

    try {
        const syncTransaction = db.transaction(() => {
            // Verify table exists
            const tableCheck = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_tools_fts'").get()
            if (!tableCheck) {
                throw new Error("mcp_tools_fts table does not exist!")
            }

            // Clear existing FTS data
            db.run("DELETE FROM mcp_tools_fts")

            // Re-populate from mcp_tools where active
            const mcpTools = db.query(`
                SELECT id, server_name, tool_name, description, category
                FROM mcp_tools
                WHERE active = 1
            `).all() as Array<{ id: string; server_name: string; tool_name: string; description: string; category: string }>

            if (mcpTools.length === 0) {
                log.debug(`[mcp:tool-sync] No MCP tools to sync to FTS5`)
                return
            }

            const insert = db.prepare(`
                INSERT INTO mcp_tools_fts(id, server_name, tool_name, description, category)
                VALUES (?, ?, ?, ?, ?)
            `)

            for (const tool of mcpTools) {
                insert.run(tool.id, tool.server_name, tool.tool_name, tool.description, tool.category)
            }

            log.info(`[mcp:tool-sync] Synced ${mcpTools.length} MCP tools to mcp_tools_fts`)
        })

        syncTransaction()
    } catch (err) {
        log.error(`[mcp:tool-sync] Failed to sync MCP tools to FTS5:`, err)
    }
}

/**
 * Delete all MCP tool definitions for a server from both mcp_tools and mcp_tools_fts.
 * Called when a server disconnects or is removed.
 */
export function clearMCPToolsFromDB(serverId: string): void {
    const db = getDb()

    try {
        // Delete from mcp_tools (CASCADE will handle FTS5 via trigger or manual sync)
        const result = db.query("DELETE FROM mcp_tools WHERE server_id = ?").run(serverId)

        log.info(`[mcp:tool-sync] Cleared MCP tools for server_id=${serverId}`)

        // Re-sync FTS5 to remove stale entries
        syncMCPToolsToFTSSync()
    } catch (err) {
        log.error(`[mcp:tool-sync] Failed to clear MCP tools for server_id=${serverId}:`, err)
    }
}

/**
 * Synchronous version of syncMCPToolsToFTS for use in clearMCPToolsFromDB.
 * Avoids async/await in transaction that was already started.
 */
function syncMCPToolsToFTSSync(): void {
    const db = getDb()

    try {
        db.run("DELETE FROM mcp_tools_fts")

        const mcpTools = db.query(`
            SELECT id, server_name, tool_name, description, category
            FROM mcp_tools
            WHERE active = 1
        `).all() as Array<{ id: string; server_name: string; tool_name: string; description: string; category: string }>

        if (mcpTools.length === 0) return

        const insert = db.prepare(`
            INSERT INTO mcp_tools_fts(id, server_name, tool_name, description, category)
            VALUES (?, ?, ?, ?, ?)
        `)

        for (const tool of mcpTools) {
            insert.run(tool.id, tool.server_name, tool.tool_name, tool.description, tool.category)
        }

        log.debug(`[mcp:tool-sync] Re-synced ${mcpTools.length} MCP tools to FTS5 after deletion`)
    } catch (err) {
        log.error(`[mcp:tool-sync] Failed to re-sync MCP tools to FTS5:`, err)
    }
}