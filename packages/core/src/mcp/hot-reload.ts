/**
 * MCP Hot Reload
 *
 * Watches for MCP server changes in DB and updates MCP Manager automatically
 *
 * Architecture: Direct Connection
 * - MCP servers are tracked in the `mcpServers` HiveDB collection
 * - MCP tools are loaded at runtime from connected servers (not stored in DB)
 */

import { col, updateDoc } from "../storage/hive";
import type { McpServerDoc } from "../storage/collections";
import { logger } from "../utils/logger";
import { loadMcpHeaders } from "../storage/crypto";
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
    const mcpServersCol = await col<McpServerDoc>("mcpServers");
    const dbServers = (await mcpServersCol.scan({})).map(e => e.doc).filter(s => s.enabled);

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

          const mcpHeaders = await loadMcpHeaders(server.id || server.name);
          if (Object.keys(mcpHeaders).length > 0) {
            mcpServerConfig.headers = mcpHeaders;
          }

          // Register (or refresh) the server's config in the manager.
          const currentConfig = (mcpManager as any).config || { servers: {} };
          await mcpManager.updateConfig({
            ...currentConfig,
            servers: {
              ...currentConfig.servers,
              [serverName]: mcpServerConfig,
            },
          });

          // updateConfig() only reconnects a server whose config changed AND was
          // already connected — it never connects a server that's merely registered
          // (true for both a brand-new server and one restored from DB on boot).
          // Connect explicitly so "new to this process" always means "usable now".
          await mcpManager.connectServer(serverName).catch((err) => {
            log.error(`Failed to connect MCP server ${serverName}: ${err.message}`);
          });

          // Get tools count and update status from the manager's real state —
          // never assume success.
          const tools = mcpManager.getServerTools(serverName) || [];
          const connected = mcpManager.getServerStatus(serverName) === "connected";
          await updateDoc<McpServerDoc>("mcpServers", server.id, { status: connected ? "connected" : "error", tools_count: tools.length }).catch(() => { /* not found */ });

          // Persist MCP tool definitions to DB and the HiveDB index
          // Use server.name (human-readable) for mcpToolId consistency with context-compiler
          await syncMCPToolsToDB(server.id || server.name, server.name || serverName, tools);
          await syncMCPToolsToFTS();

          log.info(`MCP server ${serverName} connected: ${tools.length} tools available`);
        } catch (err) {
          log.error(`Failed to connect MCP server ${serverName}: ${(err as Error).message}`);
          await updateDoc<McpServerDoc>("mcpServers", server.id, { status: "error" }).catch(() => { /* not found */ });
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

          // Delete MCP tool definitions from DB and the HiveDB index
          await clearMCPToolsFromDB(oldServerName);

          // Update DB status
          await updateDoc<McpServerDoc>("mcpServers", oldServerName, { status: "disconnected", tools_count: 0 }).catch(() => { /* not found */ });

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
