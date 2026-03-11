import { mkdirSync, readdirSync, existsSync } from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.ts";
import { eventBus } from "../events/event-bus.ts";
import { stateStore } from "../state/store.ts";
import type {
  HivePlugin,
  PluginManifest,
  PluginState,
  PluginContext,
  ToolDefinition,
  ChannelDefinition,
  CLICommand,
  PluginConstructor,
} from "./api.ts";

export interface PluginLoaderOptions {
  pluginDir: string;
  enableSandbox?: boolean;
  autoActivate?: boolean;
  pluginConfig?: Record<string, Record<string, unknown>>;
}

export class PluginLoader {
  private plugins: Map<string, HivePlugin> = new Map();
  private pluginStates: Map<string, PluginState> = new Map();
  private manifests: Map<string, PluginManifest> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private channels: Map<string, ChannelDefinition> = new Map();
  private commands: Map<string, CLICommand> = new Map();
  private log = logger.child("plugins");

  constructor(private options: PluginLoaderOptions) {
    if (!existsSync(options.pluginDir)) {
      mkdirSync(options.pluginDir, { recursive: true });
    }
  }

  async discover(): Promise<string[]> {
    const pluginDir = this.options.pluginDir;
    const discovered: string[] = [];

    try {
      const entries = readdirSync(pluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifestPath = path.join(pluginDir, entry.name, "manifest.json");
          if (existsSync(manifestPath)) {
            discovered.push(entry.name);
          }
        }
      }
    } catch (error) {
      this.log.error("Failed to discover plugins", { error: (error as Error).message });
    }

    return discovered;
  }

  async load(pluginName: string): Promise<void> {
    if (this.plugins.has(pluginName)) {
      this.log.warn(`Plugin ${pluginName} already loaded`);
      return;
    }

    const pluginPath = path.join(this.options.pluginDir, pluginName);
    const manifestPath = path.join(pluginPath, "manifest.json");

    this.updateState(pluginName, "activating");

    try {
      this.log.debug(`Reading plugin manifest: ${manifestPath}`);
      const manifestContent = await Bun.file(manifestPath).text();
      const manifest: PluginManifest = JSON.parse(manifestContent);
      this.manifests.set(pluginName, manifest);

      if (manifest.enabled === false) {
        this.updateState(pluginName, "inactive", "Disabled in manifest");
        return;
      }

      const mainFile = manifest.main ?? "index.js";
      const mainPath = path.join(pluginPath, mainFile);

      if (!(await Bun.file(mainPath).exists())) {
        throw new Error(`Main file not found: ${mainPath}`);
      }

      const PluginClass = await this.loadPluginClass(mainPath);
      const plugin = new PluginClass();
      const context = this.createContext(pluginName);

      await plugin.activate(context);

      this.plugins.set(pluginName, plugin);
      this.updateState(pluginName, "active");

      eventBus.emit("gateway:started", {
        host: "plugin",
        port: 0,
      });

      this.log.info(`Plugin ${pluginName} loaded`, {
        name: plugin.name,
        version: plugin.version,
      });
    } catch (error) {
      const errorMsg = (error as Error).message;
      this.updateState(pluginName, "error", errorMsg);
      this.log.error(`Failed to load plugin ${pluginName}`, { error: errorMsg });
      throw error;
    }
  }

  private async loadPluginClass(mainPath: string): Promise<PluginConstructor> {
    if (this.options.enableSandbox) {
      return this.loadSandboxed(mainPath);
    }
    return this.loadDirect(mainPath);
  }

  private async loadDirect(mainPath: string): Promise<PluginConstructor> {
    const module = await import(mainPath);
    const PluginClass = module.default ?? module[Object.keys(module)[0]!];

    if (typeof PluginClass !== "function") {
      throw new Error("Plugin must export a class as default");
    }

    return PluginClass;
  }

  private async loadSandboxed(mainPath: string): Promise<PluginConstructor> {
    this.log.debug(`Reading plugin source for sandboxed execution: ${mainPath}`);
    const code = await Bun.file(mainPath).text();

    const safeGlobals = this.createSafeGlobals();
    const wrappedCode = `
      (function(module, exports, __dirname, __filename) {
        ${code}
      })
    `;

    const module = { exports: {} };
    const exports = {};

    try {
      const fn = eval(wrappedCode);
      fn(module, exports, path.dirname(mainPath), mainPath);

      const PluginClass = (module.exports as any).default ?? (exports as any).default;

      if (typeof PluginClass !== "function") {
        throw new Error("Plugin must export a class as default");
      }

      return PluginClass;
    } catch (error) {
      throw new Error(`Sandboxed plugin execution failed: ${(error as Error).message}`);
    }
  }

  private createSafeGlobals(): Record<string, unknown> {
    return {
      console: {
        log: (...args: unknown[]) => this.log.debug(String(args[0])),
        error: (...args: unknown[]) => this.log.error(String(args[0])),
        warn: (...args: unknown[]) => this.log.warn(String(args[0])),
        info: (...args: unknown[]) => this.log.info(String(args[0])),
      },
      setTimeout: () => 0,
      clearTimeout: () => { },
      setInterval: () => 0,
      clearInterval: () => { },
      Buffer: {
        from: () => Buffer.from,
        isBuffer: () => false,
      },
      URL: URL,
      URLSearchParams: URLSearchParams,
      JSON: JSON,
      Object: Object,
      Array: Array,
      String: String,
      Number: Number,
      Boolean: Boolean,
      Date: Date,
      Error: Error,
      Promise: Promise,
    };
  }

  async unload(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);

    if (!plugin) {
      this.log.warn(`Plugin ${pluginName} not loaded`);
      return;
    }

    this.updateState(pluginName, "deactivating");

    try {
      await plugin.deactivate();

      for (const [toolName, tool] of this.tools) {
        if (toolName.startsWith(`${pluginName}:`)) {
          this.tools.delete(toolName);
        }
      }

      for (const [channelName, channel] of this.channels) {
        if (channelName.startsWith(`${pluginName}:`)) {
          await channel.stop();
          this.channels.delete(channelName);
        }
      }

      for (const [cmdName] of this.commands) {
        if (cmdName.startsWith(`${pluginName}:`)) {
          this.commands.delete(cmdName);
        }
      }

      this.plugins.delete(pluginName);
      this.updateState(pluginName, "inactive");

      this.log.info(`Plugin ${pluginName} unloaded`);
    } catch (error) {
      const errorMsg = (error as Error).message;
      this.updateState(pluginName, "error", errorMsg);
      this.log.error(`Failed to unload plugin ${pluginName}`, { error: errorMsg });
      throw error;
    }
  }

  async reload(pluginName: string): Promise<void> {
    this.log.info(`Reloading plugin ${pluginName}`);
    await this.unload(pluginName);
    await this.load(pluginName);
  }

  private createContext(pluginName: string): PluginContext {
    const pluginLogger = logger.child(pluginName);
    const pluginConfig = this.options.pluginConfig?.[pluginName] ?? {};

    return {
      pluginName,
      logger: pluginLogger,
      config: pluginConfig,
      registerTool: (tool: ToolDefinition) => {
        const fullName = `${pluginName}:${tool.name}`;
        this.tools.set(fullName, tool);
        this.log.debug(`Tool registered: ${fullName}`);
      },
      unregisterTool: (name: string) => {
        const fullName = `${pluginName}:${name}`;
        this.tools.delete(fullName);
      },
      registerChannel: (channel: ChannelDefinition) => {
        const fullName = `${pluginName}:${channel.name}`;
        this.channels.set(fullName, channel);
        this.log.debug(`Channel registered: ${fullName}`);
      },
      unregisterChannel: (name: string) => {
        const fullName = `${pluginName}:${name}`;
        this.channels.delete(fullName);
      },
      registerCommand: (command: CLICommand) => {
        const fullName = `${pluginName}:${command.name}`;
        this.commands.set(fullName, command);
        this.log.debug(`Command registered: ${fullName}`);
      },
      unregisterCommand: (name: string) => {
        const fullName = `${pluginName}:${name}`;
        this.commands.delete(fullName);
      },
      events: {
        emit: (event, data) => eventBus.emit(event as any, data as any),
        on: (event, handler) => eventBus.on(event as any, handler as any),
        once: (event, handler) => eventBus.once(event as any, handler as any),
      },
      state: {
        get: () => stateStore.getState(),
        subscribe: (listener) => stateStore.subscribe(listener),
      },
      getTool: (name: string) => this.tools.get(name) ?? this.tools.get(`${pluginName}:${name}`),
      getTools: () => Array.from(this.tools.values()),
    };
  }

  private updateState(name: string, status: PluginState["status"], error?: string): void {
    const existing = this.pluginStates.get(name);
    const manifest = this.manifests.get(name);

    this.pluginStates.set(name, {
      name,
      status,
      version: manifest?.version ?? existing?.version ?? "unknown",
      enabled: manifest?.enabled ?? true,
      error,
      loadedAt: existing?.loadedAt ?? Date.now(),
      activatedAt: status === "active" ? Date.now() : existing?.activatedAt,
    });
  }

  getPlugin(name: string): HivePlugin | undefined {
    return this.plugins.get(name);
  }

  getPluginState(name: string): PluginState | undefined {
    return this.pluginStates.get(name);
  }

  getAllPluginStates(): PluginState[] {
    return Array.from(this.pluginStates.values());
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getChannel(name: string): ChannelDefinition | undefined {
    return this.channels.get(name);
  }

  getChannels(): ChannelDefinition[] {
    return Array.from(this.channels.values());
  }

  getCommand(name: string): CLICommand | undefined {
    return this.commands.get(name);
  }

  getCommands(): CLICommand[] {
    return Array.from(this.commands.values());
  }

  async loadAll(): Promise<void> {
    const discovered = await this.discover();

    for (const pluginName of discovered) {
      try {
        await this.load(pluginName);
      } catch (error) {
        this.log.error(`Failed to load ${pluginName}`, { error: (error as Error).message });
      }
    }
  }

  async unloadAll(): Promise<void> {
    for (const pluginName of this.plugins.keys()) {
      try {
        await this.unload(pluginName);
      } catch (error) {
        this.log.error(`Failed to unload ${pluginName}`, { error: (error as Error).message });
      }
    }
  }
}
