import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPConfig, MCPServerConfig } from "./config";
import { logger, type LogHandler } from "./logger";
import * as path from "node:path";
import {
  createTransport,
  type TransportType,
} from "./transports/index";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

interface MCPServerState {
  name: string;
  config: MCPServerConfig;
  client: Client | null;
  transport: Transport | null;
  status: "connected" | "disconnected" | "error" | "connecting";
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  reconnectAttempts: number;
  lastError?: string;  // CORRECCIÓN 3 — guardar el mensaje de error
}

export class MCPClientManager {
  private servers: Map<string, MCPServerState> = new Map();
  private config: MCPConfig;
  private log = logger.child("mcp");

  constructor(config: MCPConfig) {
    this.config = config;
  }

  setLogHandler(handler: LogHandler): void {
    logger.setHandler(handler);
  }

  async initialize(): Promise<void> {
    const servers = this.config.servers ?? {};

    for (const [name, serverConfig] of Object.entries(servers)) {
      if (serverConfig.enabled !== false) {
        this.servers.set(name, {
          name,
          config: serverConfig as MCPServerConfig,
          client: null,
          transport: null,
          status: "disconnected",
          tools: [],
          resources: [],
          prompts: [],
          reconnectAttempts: 0,
        });
      }
    }

    this.log.info(`MCP Client initialized with ${this.servers.size} servers`);

    // CORRECCIÓN 1 — conectar todos los servers al inicializar
    // initialize() solo registraba los servers pero nunca llamaba connectAll()
    // por eso el log mostraba "initialized with 2 servers" pero nunca conectaba
    await this.connectAll();
  }

  async updateConfig(config: MCPConfig): Promise<void> {
    this.config = config;
    const newServers = this.config.servers ?? {};

    // Eliminar servers que ya no están en la config o fueron deshabilitados
    for (const name of this.servers.keys()) {
      if (!newServers[name] || newServers[name].enabled === false) {
        await this.disconnectServer(name);
        this.servers.delete(name);
      }
    }

    // Añadir o actualizar servers
    for (const [name, serverConfig] of Object.entries(newServers)) {
      if (serverConfig.enabled !== false) {
        const existing = this.servers.get(name);
        if (existing) {
          const configChanged =
            JSON.stringify(existing.config) !== JSON.stringify(serverConfig);
          if (configChanged) {
            const wasConnected = existing.status === "connected";
            await this.disconnectServer(name);
            existing.config = serverConfig as MCPServerConfig;
            if (wasConnected) {
              await this.connectServer(name).catch((err) => {
                this.log.error(
                  `Failed to reconnect ${name} after config update: ${err.message}`
                );
              });
            }
          }
        } else {
          // Server nuevo — añadir y conectar inmediatamente
          this.servers.set(name, {
            name,
            config: serverConfig as MCPServerConfig,
            client: null,
            transport: null,
            status: "disconnected",
            tools: [],
            resources: [],
            prompts: [],
            reconnectAttempts: 0,
          });
          // CORRECCIÓN 2 — conectar el server nuevo inmediatamente
          await this.connectServer(name).catch((err) => {
            this.log.error(`Failed to connect new server ${name}: ${err.message}`);
          });
        }
      }
    }
  }

  private expandPath(p: string): string {
    if (p.startsWith("~")) {
      return path.join(process.env.HOME ?? "", p.slice(1));
    }
    return p;
  }

  private createTransportForServer(state: MCPServerState): Transport {
    const transportType = state.config.transport as TransportType;

    switch (transportType) {
      case "stdio": {
        const command = state.config.command ?? "npx";
        const args = state.config.args ?? [];

        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) env[key] = value;
        }
        if (state.config.env) {
          for (const [key, value] of Object.entries(state.config.env)) {
            env[key] = this.expandPath(value);
          }
        }

        return createTransport({ type: "stdio", stdio: { command, args, env } });
      }

      case "sse": {
        const url = state.config.url;
        if (!url) throw new Error("SSE transport requires 'url' config");
        return createTransport({
          type: "sse",
          sse: { url, headers: state.config.headers },
        });
      }

      case "websocket": {
        const url = state.config.url;
        if (!url) throw new Error("WebSocket transport requires 'url' config");
        return createTransport({
          type: "websocket",
          websocket: { url, headers: state.config.headers },
        });
      }

      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }

  async connectServer(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) throw new Error(`MCP server not found: ${name}`);
    if (state.status === "connected") return;

    state.status = "connecting";
    state.lastError = undefined;  // limpiar error anterior
    this.log.info(`Connecting to MCP server: ${name}`);

    try {
      const transport = this.createTransportForServer(state);

      const client = new Client(
        { name: "hive", version: "0.1.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      state.client = client;
      state.transport = transport;
      state.status = "connected";
      state.reconnectAttempts = 0;

      await this.discoverCapabilities(name);

      this.log.info(`Connected to MCP server: ${name}`, {
        tools: state.tools.length,
        resources: state.resources.length,
        prompts: state.prompts.length,
      });
    } catch (error) {
      state.status = "error";
      // CORRECCIÓN 3 — guardar el mensaje de error para mostrarlo en el dashboard
      state.lastError = (error as Error).message;
      this.log.error(`Failed to connect to MCP server ${name}: ${state.lastError}`);
      throw error;
    }
  }

  private async discoverCapabilities(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state?.client) return;

    try {
      const toolsResult = await state.client.listTools();
      state.tools = (toolsResult.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
    } catch {
      this.log.debug(`No tools from MCP server: ${name}`);
    }

    try {
      const resourcesResult = await state.client.listResources();
      state.resources = (resourcesResult.resources ?? []).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }));
    } catch {
      this.log.debug(`No resources from MCP server: ${name}`);
    }

    try {
      const promptsResult = await state.client.listPrompts();
      state.prompts = (promptsResult.prompts ?? []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      }));
    } catch {
      this.log.debug(`No prompts from MCP server: ${name}`);
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) return;

    if (state.client) {
      try {
        await state.client.close();
      } catch {
        // Ignorar errores al cerrar
      }
    }

    state.client = null;
    state.transport = null;
    state.status = "disconnected";
    state.lastError = undefined;

    this.log.info(`Disconnected from MCP server: ${name}`);
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const state = this.servers.get(serverName);
    if (!state?.client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    this.log.debug(`Calling MCP tool: ${serverName}/${toolName}`, { args });

    const result = await state.client.callTool({
      name: toolName,
      arguments: args,
    });

    return result.content;
  }

  async readResource(serverName: string, uri: string): Promise<unknown> {
    const state = this.servers.get(serverName);
    if (!state?.client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const result = await state.client.readResource({ uri });
    return result.contents;
  }

  getServerStatus(name: string): MCPServerState["status"] | undefined {
    return this.servers.get(name)?.status;
  }

  getServerTools(name: string): MCPTool[] {
    return this.servers.get(name)?.tools ?? [];
  }

  getServerResources(name: string): MCPResource[] {
    return this.servers.get(name)?.resources ?? [];
  }

  getAllTools(): Map<string, MCPTool[]> {
    const result = new Map<string, MCPTool[]>();
    for (const [name, state] of this.servers) {
      if (state.status === "connected") {
        result.set(name, state.tools);
      }
    }
    return result;
  }

  listServers(): Array<{
    name: string;
    status: string;
    tools: MCPTool[];
    resources: MCPResource[];
    prompts: MCPPrompt[];
    url?: string;
    error?: string;
  }> {
    return Array.from(this.servers.values()).map((s) => ({
      name: s.name,
      status: s.status,
      tools: s.tools,
      resources: s.resources,
      prompts: s.prompts,
      url: s.config.transport === "stdio" ? `${s.config.command} ${s.config.args?.join(" ")}` : s.config.url,
      error: s.lastError,
    }));
  }

  getServerDetails(
    name: string
  ):
    | {
      name: string;
      status: string;
      tools: MCPTool[];
      resources: MCPResource[];
      prompts: MCPPrompt[];
      config: MCPServerConfig;
      error?: string;
    }
    | undefined {
    const s = this.servers.get(name);
    if (!s) return undefined;

    // CORRECCIÓN 4 — redactar headers con tokens antes de exponer al dashboard
    const safeConfig: MCPServerConfig = {
      ...s.config,
      headers: s.config.headers
        ? Object.fromEntries(
          Object.entries(s.config.headers).map(([k, v]) => [
            k,
            k.toLowerCase().includes("auth") ||
              k.toLowerCase().includes("token") ||
              k.toLowerCase().includes("key")
              ? `${(v as string).slice(0, 4)}••••••••`
              : v,
          ])
        )
        : undefined,
    };

    return {
      name: s.name,
      status: s.status,
      tools: s.tools,
      resources: s.resources,
      prompts: s.prompts,
      config: safeConfig,
      error: s.lastError,
    };
  }

  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const name of this.servers.keys()) {
      promises.push(
        this.connectServer(name).catch((error) => {
          // No relanzar — el Gateway sigue funcionando sin ese server
          this.log.error(`Failed to connect ${name}: ${error.message}`);
        })
      );
    }

    await Promise.allSettled(promises);
  }

  async reconnectAll(): Promise<void> {
    await this.disconnectAll();
    await this.connectAll();
  }

  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const name of this.servers.keys()) {
      promises.push(this.disconnectServer(name));
    }

    await Promise.allSettled(promises);
  }
}

export function createMCPManager(config: MCPConfig): MCPClientManager {
  return new MCPClientManager(config);
}