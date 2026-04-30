import type { Config } from "../config/loader";
import { logger } from "../utils/logger";
import { getDb, initializeDatabase, getDbPathLazy } from "../storage/sqlite";
import { buildAgentLoop } from "../agent/agent-loop";
import { AgentRunner } from "../agent/providers/index";
import { ChannelManager } from "../channels/manager";
import { syncToolsToFTS, syncSkillsToFTS, syncPlaybookToFTS } from "../agent/context-compiler";
import { syncMCPToolsToFTS } from "../mcp/tool-sync";
import { AgentService, createAgentService } from "../agent/service";
import { mkdirSync, existsSync } from "node:fs";
import * as path from "node:path";
import { resolveAgentId, runStartupMigrations } from "../storage/onboarding";
import { createMCPManager, type MCPClientManager } from "@johpaz/hive-agents-mcp";
import { setMCPManager } from "../mcp/singleton";
import { startMCPHotReload } from "../mcp/hot-reload";
import { initializeBrowserService } from "../tools/web/browser-service";
import { activateBrowserTools } from "../storage/onboarding";

const log = logger.child("gateway:init");

/**
 * Verifica que exista al menos un usuario en la base de datos
 */
export async function verifyDatabaseUsers(): Promise<void> {
  // Setup mode: no DB yet — skip verification, gateway starts to serve the web setup
  if (!existsSync(getDbPathLazy())) {
    log.info("Setup mode: no database found — gateway will serve web setup at /setup");
    return;
  }

  try {
    initializeDatabase();

    const db = getDb();
    const userCount = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };

    if (userCount.count === 0) {
      const error = new Error("No users found in the database. A valid user is required to start the Hive Gateway.");
      log.error(error.message);
      log.error("Please run the onboarding process or manually insert a user.");
      throw error;
    }

    log.info(`Database verified: ${userCount.count} user(s) found`);
  } catch (error) {
    log.error(`Database verification failed: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Escribe el archivo PID del proceso
 */
export async function writePidFile(pidFile: string): Promise<void> {
  try {
    const dir = path.dirname(pidFile);
    mkdirSync(dir, { recursive: true });
    await Bun.write(pidFile, process.pid.toString());
    log.info(`PID file written: ${pidFile}`);
  } catch (error) {
    log.warn(`Could not write PID file: ${(error as Error).message}`);
    // No throw - PID file is not critical
  }
}

/**
 * Carga la configuración del agente desde la base de datos
 * @returns Provider y modelo configurados
 */
export async function loadAgentConfigFromDB(
  config: Config
): Promise<{ provider: string; model: string }> {
  const defaultProvider = "gemini";
  const defaultModel = "gemini-2.5-flash";

  try {
    const db = getDb();

    // Get coordinator agent ID from database
    const coordinatorAgentId = resolveAgentId(null);

    // Obtener configuración del agente coordinador
    const agentConfig = db.query(`
      SELECT provider_id, model_id FROM agents
      WHERE id = ? OR role = 'coordinator'
      ORDER BY (CASE WHEN id = ? THEN 1 ELSE 0 END) DESC
      LIMIT 1
    `).get(coordinatorAgentId || "", coordinatorAgentId || "") as
      { provider_id: string | null; model_id: string | null } | undefined;

    let provider = agentConfig?.provider_id || defaultProvider;
    let model = agentConfig?.model_id || defaultModel;

    // Cargar API keys de los providers desde la DB
    const providers = db.query(`
      SELECT id, name, api_key_encrypted, api_key_iv, base_url
      FROM providers
      WHERE active = 1 AND api_key_encrypted IS NOT NULL
    `).all() as Array<{
      id: string;
      name: string;
      api_key_encrypted: string;
      api_key_iv: string;
      base_url: string | null
    }>;

    if (providers.length > 0) {
      config.models = config.models || {};
      config.models.providers = config.models.providers || {};

      const { decryptApiKey } = await import("../storage/crypto");

      for (const p of providers) {
        const apiKey = await decryptApiKey(p.api_key_encrypted, p.api_key_iv);

        config.models.providers[p.name] = {
          apiKey,
          baseUrl: p.base_url || undefined,
          defaultModel: model,
          availableModels: [],
          maxRetries: 3,
          timeoutMs: 30000,
        } as any;
      }

      log.info(`Loaded ${providers.length} provider(s) from DB with API keys`);
    }

    log.info(`Agent config loaded from DB: ${provider}/${model}`);
    return { provider, model };

  } catch (error) {
    log.debug(`Could not read agent config from DB, using defaults: ${defaultProvider}/${defaultModel}`);
    return { provider: defaultProvider, model: defaultModel };
  }
}

/**
 * Inicializa el agent loop
 */
export async function initializeAgentLoop(mcpManager?: any): Promise<void> {
  try {
    await buildAgentLoop({ mcpManager });
    log.info("Agent loop initialized");
  } catch (error) {
    log.warn(`Agent loop initialization failed: ${(error as Error).message}`);
    // No throw - agent loop can be rebuilt later
  }
}

/**
 * Inicializa el runner de LLM
 */
export async function initializeLLMRunner(
  config: Config,
  provider: string,
  model: string
): Promise<AgentRunner> {
  try {
    const runner = new AgentRunner(config);
    log.info(`LLM runner initialized: ${provider}/${model}`);
    return runner;
  } catch (error) {
    log.error(`Failed to initialize LLM runner: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Inicializa el manager de canales
 */
export async function initializeChannelManager(
  config: Config
): Promise<ChannelManager> {
  try {
    const channelManager = new ChannelManager(config);
    await channelManager.initialize();
    await channelManager.startAll();
    log.info("Channel manager initialized and started");
    return channelManager;
  } catch (error) {
    log.error(`Failed to initialize channel manager: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Función principal de inicialización que orquesta todos los módulos
 */
export interface GatewayInitializationResult {
  agent: AgentService;
  runner: AgentRunner;
  channelManager: ChannelManager;
  provider: string;
  model: string;
}

export async function initializeGateway(
  config: Config,
  pidFile: string
): Promise<GatewayInitializationResult> {
  // Setup mode: 0 usuarios (initializeDatabase() ya fue llamado antes en server.ts)
  let setupMode = false;
  try {
    const count = (getDb().query("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
    setupMode = count === 0;
  } catch {
    setupMode = true;
  }

  if (setupMode) {
    log.info("Setup mode: skipping full initialization — only setup routes will be available");
    await writePidFile(pidFile);
    // Return stubs; server.ts checks isSetupMode() before using these
    return {
      agent: null as any,
      runner: null as any,
      channelManager: null as any,
      provider: "",
      model: "",
    };
  }

  try {
    // 1. Verificar base de datos (crítico)
    await verifyDatabaseUsers();

    // 2. Escribir archivo PID (no crítico)
    await writePidFile(pidFile);

    // 3a. Startup migrations (idempotent, version-keyed)
    runStartupMigrations();

    // 3. Cargar configuración del agente desde DB
    const { provider, model } = await loadAgentConfigFromDB(config);

    // 4. Sync FTS5 indexes (tools + skills + playbook + mcp_tools)
    log.info("[initialize] Syncing FTS5 indexes (asynchronous & transactional)...")
    try {
      await Promise.all([
        syncToolsToFTS(),
        syncSkillsToFTS(),
        syncPlaybookToFTS(),
        syncMCPToolsToFTS()
      ]);
      log.info("[initialize] ✅ FTS5 indexes synced (tools, skills, playbook, mcp_tools)")
    } catch (err) {
      log.error(`[initialize] FTS5 sync failed during startup: ${(err as Error).message}`);
      // Consider if we should throw or continue. For now, continue but log error.
    }

    // 5. Crear AgentService (reemplaza la clase Agent legacy)
    const agent = createAgentService();
    await agent.initialize();

    // 5b. Initialize Browser Service (Chrome via Bun.WebView nativo)
    let browserAvailable = false;

    try {
      log.info("Detecting browser (lazy launch — will open on first agent use)...");

      const browserService = initializeBrowserService(config);
      browserAvailable = await browserService.start();

      if (browserAvailable) {
        activateBrowserTools();
      } else {
        log.warn("⚠️  No se encontró Chrome/Chromium - browser tools desactivadas");
        log.warn("   Linux: sudo dnf install chromium  |  macOS: brew install --cask google-chrome");
      }
    } catch (error) {
      log.warn(`Browser Service initialization skipped: ${(error as Error).message}`);
    }

    // 6. Inicializar MCP Manager y agent loop
    // MCP se inicializa con los servidores de la config + DB
    let mcpManager: MCPClientManager | null = null;
    
    // Load MCP servers from DB and merge with config
    const db = getDb();
    const dbServers = db.query(`SELECT * FROM mcp_servers WHERE enabled = 1`).all() as Record<string, any>[];
    
    const mcpServersFromDB: Record<string, any> = {};
    for (const server of dbServers) {
      try {
        const mcpServerConfig: any = {
          transport: server.transport,
          command: server.command,
          args: server.args ? JSON.parse(server.args) : [],
          url: server.url,
          enabled: true,
        };
        
        // Decrypt headers if present
        if (server.headers_encrypted && server.headers_iv) {
          const { decryptConfig } = await import("../storage/crypto");
          mcpServerConfig.headers = decryptConfig(server.headers_encrypted, server.headers_iv);
        }
        
        mcpServersFromDB[server.id || server.name] = mcpServerConfig;
      } catch (error) {
        log.warn(`Failed to load MCP server ${server.name} from DB: ${(error as Error).message}`);
      }
    }
    
    // Merge config MCP servers with DB servers
    const configMcpServers = config.mcp?.servers || {};
    const mergedMcpServers = { ...configMcpServers, ...mcpServersFromDB };
    
    if (Object.keys(mergedMcpServers).length > 0) {
      try {
        mcpManager = createMCPManager({
          ...config.mcp,
          servers: mergedMcpServers,
        });
        await mcpManager.initialize();
        setMCPManager(mcpManager); // Save to singleton for global access
        log.info(`MCP Manager initialized with ${Object.keys(mergedMcpServers).length} server(s) from config + DB`);
        
        // Start hot reload watcher for dynamic server changes
        startMCPHotReload(mcpManager);
        log.info("MCP Hot Reload started - new servers will auto-connect");
      } catch (error) {
        log.warn(`MCP Manager initialization failed: ${(error as Error).message}`);
      }
    } else {
      log.info("No MCP servers found in config or DB");
      // Initialize empty MCP Manager for hot reload to work
      try {
        mcpManager = createMCPManager({ servers: {} });
        await mcpManager.initialize();
        setMCPManager(mcpManager);
        startMCPHotReload(mcpManager);
        log.info("MCP Hot Reload started - waiting for first server");
      } catch (error) {
        log.warn(`Empty MCP Manager initialization failed: ${(error as Error).message}`);
      }
    }
    
    // Inicializar agent loop con MCP Manager
    await initializeAgentLoop(mcpManager || undefined);

    // 7. Inicializar LLM runner (crítico)
    const runner = await initializeLLMRunner(config, provider, model);

    // 8. Inicializar channel manager (crítico)
    const channelManager = await initializeChannelManager(config);

    return { agent, runner, channelManager, provider, model };

  } catch (error) {
    log.error(`Gateway initialization failed: ${(error as Error).message}`);
    throw error;
  }
}
