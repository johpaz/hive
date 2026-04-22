/**
 * MCP Hot Reload
 *
 * Watches for MCP server changes in DB and updates MCP Manager automatically
 * 
 * Architecture: Direct Connection
 * - MCP servers are tracked in DB (mcp_servers table)
 * - MCP tools are loaded at runtime from connected servers (not stored in DB)
 */

import { getDb } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { decryptConfig } from "../storage/crypto";
import { syncMCPToolsToDB, syncMCPToolsToFTS, clearMCPToolsFromDB } from "./tool-sync";
import type { MCPClientManager } from "@johpaz/hive-agents-mcp";

const log = logger.child("mcp:hot-reload");

let _watchInterval: Timer | null = null;
let _lastKnownServers = new Set<string>();

/**
 * Start watching for MCP server changes
 * Checks every 2 seconds for new/removed servers
 */
export function startMCPHotReload(mcpManager: MCPClientManager): void {
  if (_watchInterval) {
    log.warn("MCP Hot Reload already running");
    return;
  }

  log.info("Starting MCP Hot Reload watcher (2s interval)");

  // Initial sync - sync all currently connected servers
  syncMCPServers(mcpManager).then(() => {
    log.info("Initial MCP server sync complete");
  }).catch(err => {
    log.error(`Initial MCP server sync failed: ${err.message}`);
  });

  // Watch for changes
  _watchInterval = setInterval(() => {
    syncMCPServers(mcpManager);
  }, 2000);
}

/**
 * Stop watching
 */
export function stopMCPHotReload(): void {
  if (_watchInterval) {
    clearInterval(_watchInterval);
    _watchInterval = null;
    log.info("MCP Hot Reload stopped");
  }
}

/**
 * Sync MCP servers from DB to MCP Manager
 * Note: Only server status is tracked, tools are loaded at runtime
 */
async function syncMCPServers(mcpManager: MCPClientManager): Promise<void> {
  try {
    const db = getDb();
    const dbServers = db.query(`SELECT * FROM mcp_servers WHERE enabled = 1`).all() as Record<string, any>[];

    const currentServerNames = new Set(dbServers.map(s => s.id || s.name));

    // Detect new servers
    for (const server of dbServers) {
      const serverName = server.id || server.name;

      if (!_lastKnownServers.has(serverName)) {
        log.info(`New MCP server detected: ${serverName} - connecting...`);

        try {
          const mcpServerConfig: any = {
            transport: server.transport,
            command: server.command,
            args: server.args ? JSON.parse(server.args) : [],
            url: server.url,
            enabled: true,
          };

          if (server.headers_encrypted && server.headers_iv) {
            mcpServerConfig.headers = decryptConfig(server.headers_encrypted, server.headers_iv);
          }

          // Update MCP Manager config (auto-connects new servers)
          const currentConfig = (mcpManager as any).config || { servers: {} };
          await mcpManager.updateConfig({
            ...currentConfig,
            servers: {
              ...currentConfig.servers,
              [serverName]: mcpServerConfig,
            },
          });

          // Wait a bit for connection to establish
          await new Promise(resolve => setTimeout(resolve, 500));

          // Get tools count and update status
          const tools = mcpManager.getServerTools(serverName) || [];
          db.query(`UPDATE mcp_servers SET status = ?, tools_count = ? WHERE id = ?`).run("connected", tools.length, serverName);

          // Persist MCP tool definitions to DB and FTS5
          // Use server.name (human-readable) for mcpToolId consistency with context-compiler
          syncMCPToolsToDB(server.id || server.name, server.name || serverName, tools);
          await syncMCPToolsToFTS();

          log.info(`MCP server ${serverName} connected: ${tools.length} tools available`);
        } catch (err) {
          log.error(`Failed to connect MCP server ${serverName}: ${(err as Error).message}`);
          db.query(`UPDATE mcp_servers SET status = ? WHERE id = ?`).run("error", serverName);
        }
      }
    }

    // Detect removed servers
    for (const oldServerName of _lastKnownServers) {
      if (!currentServerNames.has(oldServerName)) {
        log.info(`MCP server removed: ${oldServerName} - disconnecting...`);

        try {
          // Remove from MCP Manager
          const currentConfig = (mcpManager as any).config || { servers: {} };
          delete currentConfig.servers[oldServerName];
          await mcpManager.updateConfig(currentConfig);

          // Delete MCP tool definitions from DB and FTS5
          clearMCPToolsFromDB(oldServerName);

          // Update DB status
          db.query(`UPDATE mcp_servers SET status = ?, tools_count = 0 WHERE id = ?`).run("disconnected", oldServerName);

          log.info(`MCP server ${oldServerName} disconnected`);
        } catch (err) {
          log.error(`Failed to disconnect MCP server ${oldServerName}: ${(err as Error).message}`);
        }
      }
    }

    _lastKnownServers = currentServerNames;
  } catch (err) {
    log.error(`MCP server sync failed: ${(err as Error).message}`);
  }
}
