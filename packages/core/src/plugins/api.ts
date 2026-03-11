import type { Logger, ChildLogger } from "../utils/logger.ts";
import type { eventBus, EventMap, EventKey } from "../events/event-bus.ts";
import type { StateStore } from "../state/store.ts";

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  hiveVersion?: string;
  main?: string;
  enabled?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterDefinition>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ParameterDefinition {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  items?: ParameterDefinition;
  properties?: Record<string, ParameterDefinition>;
}

export interface ChannelDefinition {
  name: string;
  type: string;
  config: Record<string, unknown>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  send: (sessionId: string, message: unknown) => Promise<void>;
}

export interface CLICommand {
  name: string;
  description: string;
  handler: (args: string[], options: Record<string, unknown>) => Promise<void>;
  options?: Record<string, CommandOption>;
}

export interface CommandOption {
  alias?: string;
  description?: string;
  type?: "string" | "boolean" | "number";
  default?: unknown;
}

export interface PluginContext {
  pluginName: string;
  logger: ChildLogger;
  config: Record<string, unknown>;
  registerTool: (tool: ToolDefinition) => void;
  unregisterTool: (name: string) => void;
  registerChannel: (channel: ChannelDefinition) => void;
  unregisterChannel: (name: string) => void;
  registerCommand: (command: CLICommand) => void;
  unregisterCommand: (name: string) => void;
  events: {
    emit: <K extends EventKey>(event: K, data: EventMap[K]) => void;
    on: <K extends EventKey>(event: K, handler: (data: EventMap[K]) => void | Promise<void>) => () => void;
    once: <K extends EventKey>(event: K, handler: (data: EventMap[K]) => void | Promise<void>) => void;
  };
  state: {
    get: () => ReturnType<StateStore["getState"]>;
    subscribe: (listener: (state: ReturnType<StateStore["getState"]>) => void) => () => void;
  };
  getTool: (name: string) => ToolDefinition | undefined;
  getTools: () => ToolDefinition[];
}

export interface InboundMessage {
  sessionId: string;
  channel: string;
  userId: string;
  content: string;
  timestamp: number;
}

export interface AgentResponse {
  sessionId: string;
  content: string;
  toolsUsed: string[];
  duration: number;
}

export interface PluginToolCall {
  name: string;
  args: Record<string, unknown>;
  sessionId: string;
}

export type MiddlewareNext = () => Promise<void>;
export type MiddlewareResult = Promise<void>;

export interface HivePlugin {
  name: string;
  version: string;
  dependencies?: string[];
  manifest?: PluginManifest;

  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;

  onMessage?: (message: InboundMessage, next: MiddlewareNext) => MiddlewareResult;
  onAgentResponse?: (response: AgentResponse, next: MiddlewareNext) => MiddlewareResult;
  onToolCall?: (call: PluginToolCall, next: () => Promise<unknown>) => Promise<unknown>;
  onError?: (error: Error, context: Record<string, unknown>) => Promise<void>;
}

export interface PluginState {
  name: string;
  status: "inactive" | "activating" | "active" | "deactivating" | "error";
  version: string;
  enabled: boolean;
  error?: string;
  loadedAt?: number;
  activatedAt?: number;
}

export type PluginConstructor = new () => HivePlugin;
