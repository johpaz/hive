import * as z from "zod";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const DMPolicySchema = z.enum(["open", "pairing", "allowlist"]);
const TransportSchema = z.enum(["stdio", "sse", "websocket"]);

export function loadEnv(hiveDir: string): void {
  const envPath = path.join(hiveDir, ".env");
  if (existsSync(envPath)) {
    try {
      const text = readFileSync(envPath, "utf8");
      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
          process.env[key.trim()] = value;
        }
      }
    } catch (e) {
      // Ignore errors loading .env
    }
  }
}

export function getHiveDir(): string {
  // Priority 1: HIVE_HOME explicitly set
  if (process.env.HIVE_HOME) {
    const hiveDir = process.env.HIVE_HOME.startsWith("~")
      ? path.join(process.env.HOME || "", process.env.HIVE_HOME.slice(1))
      : process.env.HIVE_HOME;
    loadEnv(hiveDir);
    return hiveDir;
  }

  // Priority 2: HIVE_DEV mode defaults (Local folder)
  // Only check process.env.HIVE_DEV directly - don't load from .env files
  // This ensures production mode is the default unless explicitly set
  if (process.env.HIVE_DEV === "1" || process.env.HIVE_DEV === "true") {
    const localDir = path.join(process.cwd(), ".hive-dev");
    loadEnv(localDir);
    return localDir;
  }

  // Priority 3: Default ~/.hive
  const defaultDir = path.join(process.env.HOME || "", ".hive");
  loadEnv(defaultDir);
  return defaultDir;
}

const expandPath = (p: string): string => {
  if (p.startsWith("~/.hive")) {
    const hiveDir = getHiveDir();
    return p.replace("~/.hive", hiveDir);
  }
  if (p.startsWith("~")) {
    return path.join(process.env.HOME || "", p.slice(1));
  }
  return p;
};

const expandEnvVars = (value: string): string => {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    return process.env[key] || "";
  });
};

const expandEnvInObject = <T>(obj: T): T => {
  if (typeof obj === "string") {
    return expandEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvInObject) as T;
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvInObject(value);
    }
    return result as T;
  }
  return obj;
};

const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  rateLimit: z.number().optional(),
  retries: z.number().optional(),
  retryDelayMs: z.number().optional(),
});

const ToolRestrictionsSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const ExecConfigSchema = z.object({
  enabled: z.boolean().optional(),
  allowlist: z.array(z.string()).optional(),
  denylist: z.array(z.string()).optional(),
  timeoutSeconds: z.number().optional(),
  workDir: z.string().optional(),
});

const WebConfigSchema = z.object({
  allowlist: z.array(z.string()).optional(),
  denylist: z.array(z.string()).optional(),
  timeoutSeconds: z.number().optional(),
});

const BrowserConfigSchema = z.object({
  enabled: z.boolean().optional(),
  cdpUrl: z.string().optional(),
  headless: z.boolean().optional(),
  timeoutMs: z.number().optional(),
});

const CanvasConfigSchema = z.object({
  enabled: z.boolean().optional(),
  port: z.number().optional(),
});

const SandboxConfigSchema = z.object({
  dm: ToolRestrictionsSchema.optional(),
  group: ToolRestrictionsSchema.optional(),
});

const ToolsConfigSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  exec: ExecConfigSchema.optional(),
  web: WebConfigSchema.optional(),
  browser: BrowserConfigSchema.optional(),
  canvas: CanvasConfigSchema.optional(),
  sandbox: SandboxConfigSchema.optional(),
});

const ContextConfigSchema = z.object({
  maxTokens: z.number().optional(),
  compactionThreshold: z.number().optional(),
  minMessagesAfterCompaction: z.number().optional(),
  maxCompactionRetries: z.number().optional(),
});

const AgentEntrySchema = z.object({
  id: z.string(),
  default: z.boolean().optional(),
  workspace: z.string(),
  description: z.string().optional(),
});

const AccountConfigSchema = z.object({
  botToken: z.string().optional(),
  applicationId: z.string().optional(),
  appToken: z.string().optional(),
  signingSecret: z.string().optional(),
  dmPolicy: DMPolicySchema.optional(),
  allowFrom: z.array(z.string()).optional(),
});

const ChannelConfigSchema = z.object({
  enabled: z.boolean().optional(),
  accounts: z.record(z.string(), AccountConfigSchema).optional(),
  dmPolicy: DMPolicySchema.optional(),
  allowFrom: z.array(z.string()).optional(),
  groups: z.boolean().optional(),
  guilds: z.record(z.string(), z.unknown()).optional(),
  experimental: z.boolean().optional(),
});

const PeerMatchSchema = z.object({
  kind: z.enum(["direct", "group"]).optional(),
  id: z.string().optional(),
});

const BindingMatchSchema = z.object({
  channel: z.string().optional(),
  accountId: z.string().optional(),
  peer: PeerMatchSchema.optional(),
  guildId: z.string().optional(),
  teamId: z.string().optional(),
  roles: z.array(z.string()).optional(),
});

const BindingSchema = z.object({
  agentId: z.string(),
  match: BindingMatchSchema,
});

const MCPServerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  transport: TransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  reconnect: z.object({
    enabled: z.boolean().optional(),
    maxRetries: z.number().optional(),
    delayMs: z.number().optional(),
    backoffMultiplier: z.number().optional(),
  }).optional(),
});

const MCPConfigSchema = z.object({
  enabled: z.boolean().optional(),
  servers: z.record(z.string(), MCPServerConfigSchema).optional(),
  healthCheck: z.object({
    enabled: z.boolean().optional(),
    intervalSeconds: z.number().optional(),
  }).optional(),
});

const EpisodicMemoryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["openai", "local"]).optional(),
  maxEpisodesPerSession: z.number().optional(),
});

const MemoryConfigSchema = z.object({
  dbPath: z.string().optional(),
  notesDir: z.string().optional(),
  episodic: EpisodicMemoryConfigSchema.optional(),
});

const CronConfigSchema = z.object({
  enabled: z.boolean().optional(),
  dbPath: z.string().optional(),
  maxConcurrentJobs: z.number().optional(),
  timezone: z.string().optional(),
});

const RetryConfigSchema = z.object({
  maxAttempts: z.number().optional(),
  initialDelayMs: z.number().optional(),
  backoffMultiplier: z.number().optional(),
  maxDelayMs: z.number().optional(),
});

const HooksConfigSchema = z.object({
  scripts: z.object({
    before_model_resolve: z.string().optional(),
    before_prompt_build: z.string().optional(),
    before_tool_call: z.string().optional(),
    after_tool_call: z.string().optional(),
    tool_result_persist: z.string().optional(),
    before_compaction: z.string().optional(),
    after_compaction: z.string().optional(),
    message_received: z.string().optional(),
    message_sending: z.string().optional(),
    message_sent: z.string().optional(),
    session_start: z.string().optional(),
    session_end: z.string().optional(),
    gateway_start: z.string().optional(),
    gateway_stop: z.string().optional(),
  }).optional(),
});

const LoggingConfigSchema = z.object({
  level: LogLevelSchema.optional(),
  dir: z.string().optional(),
  maxSizeMB: z.number().optional(),
  maxFiles: z.number().optional(),
  redactSensitive: z.boolean().optional(),
  console: z.boolean().optional(),
});

const GatewayConfigSchema = z.object({
  host: z.string().optional(),
  port: z.number().optional(),
  authToken: z.string().optional(),
  pidFile: z.string().optional(),
  tools: ToolRestrictionsSchema.optional(),
});

const ModelsConfigSchema = z.object({
  defaultProvider: z.enum(["openai", "anthropic", "gemini", "mistral", "kimi", "ollama", "openrouter", "deepseek"]).optional(),
  defaults: z.record(z.string(), z.string()).optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
});

const SessionsConfigSchema = z.object({
  dir: z.string().optional(),
  pruneAfterHours: z.number().optional(),
  maxTranscriptSizeMB: z.number().optional(),
});

const SkillsConfigSchema = z.object({
  allowBundled: z.array(z.string()).optional(),
  managedDir: z.string().optional(),
  extraDirs: z.array(z.string()).optional(),
  hotReload: z.boolean().optional(),
  maxSkillSizeKB: z.number().optional(),
});

const SecurityConfigSchema = z.object({
  maxMessageLength: z.record(z.string(), z.number()).optional(),
  skillScanning: z.boolean().optional(),
  warnOnInsecureConfig: z.boolean().optional(),
  allowedUsers: z.array(z.string()).optional(),
});

const CaptchaConfigSchema = z.object({
  enabled: z.boolean().optional(),
  autoSolve: z.boolean().optional(),
  visionProvider: z.enum(["gemini", "openai", "anthropic"]).optional(),
  visionModel: z.string().optional(),
  maxAttempts: z.number().optional(),
  maxRounds: z.number().optional(),
  apiKey: z.string().optional(),
  enabledSites: z.array(z.string()).optional(),
});

const UserConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  channels: z.record(z.string(), z.string()).optional(),
});

const ConfigSchema = z.object({
  gateway: GatewayConfigSchema.optional(),
  logging: LoggingConfigSchema.optional(),
  user: UserConfigSchema.optional(),
  agent: z.object({
    defaultAgentId: z.string().optional(),
    baseDir: z.string().optional(),
    context: ContextConfigSchema.optional(),
  }).optional(),
  models: ModelsConfigSchema.optional(),
  sessions: SessionsConfigSchema.optional(),
  agents: z.object({
    list: z.array(AgentEntrySchema).optional(),
  }).optional(),
  bindings: z.array(BindingSchema).optional(),
  channels: z.record(z.string(), ChannelConfigSchema).optional(),
  tools: ToolsConfigSchema.optional(),
  skills: SkillsConfigSchema.optional(),
  mcp: MCPConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  cron: CronConfigSchema.optional(),
  retry: RetryConfigSchema.optional(),
  security: SecurityConfigSchema.optional(),
  hooks: HooksConfigSchema.optional(),
  captcha: CaptchaConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type AgentEntry = z.infer<typeof AgentEntrySchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type UserConfig = z.infer<typeof UserConfigSchema>;
export type CaptchaConfig = z.infer<typeof CaptchaConfigSchema>;

function buildDefaultConfig(): Config {
  const hiveDir = getHiveDir();
  return {
    gateway: {
      host: process.env.HIVE_HOST || "127.0.0.1",
      port: parseInt(process.env.HIVE_PORT || "18790", 10),
      pidFile: path.join(hiveDir, "gateway.pid"),
      authToken: process.env.HIVE_AUTH_TOKEN || undefined,
      tools: {
        allow: ["*"],
        deny: [],
      },
    },
    logging: {
      level: (process.env.HIVE_LOG_LEVEL as any) || "info",
      dir: path.join(hiveDir, "logs"),
      maxSizeMB: 10,
      maxFiles: 5,
      redactSensitive: true,
      console: true,
    },
    agent: {
      defaultAgentId: "main",
      baseDir: path.join(hiveDir, "agents"),
      context: {
        maxTokens: 0,
        compactionThreshold: 0.8,
        minMessagesAfterCompaction: 4,
        maxCompactionRetries: 3,
      },
    },
    models: {
      defaultProvider: "openai",
      defaults: {
        openai: "gpt-4o",
        anthropic: "claude-sonnet-4-20250514",
        ollama: "llama3.2",
        openrouter: "anthropic/claude-sonnet-4",
      },
      providers: {},
    },
    sessions: {
      dir: path.join(hiveDir, "sessions"),
      pruneAfterHours: 24,
      maxTranscriptSizeMB: 50,
    },
    agents: {
      list: [
        {
          id: "main",
          default: true,
          workspace: path.join(hiveDir, "agents", "main", "workspace"),
          description: "Default personal assistant",
        },
      ],
    },
    bindings: [],
    channels: {
      webchat: { enabled: true },
    },
    tools: {
      allow: ["*"],
      deny: [],
      exec: {
        enabled: true,
        allowlist: [],
        denylist: ["rm -rf /", "sudo", "chmod 777", "> /dev/", "mkfs"],
        timeoutSeconds: 30,
        workDir: path.join(process.env.HOME || "", "exec"), // Points to home for exec by default
      },
      web: {
        allowlist: [],
        denylist: ["file://", "ftp://"],
        timeoutSeconds: 30,
      },
      browser: {
        enabled: true,
        cdpUrl: "ws://127.0.0.1:9222",
        headless: true,
        timeoutMs: 30000,
      },
      canvas: {
        enabled: true,
        port: 18793,
      },
      sandbox: {
        dm: { allow: ["*"], deny: [] },
        group: { allow: ["*"], deny: [] },
      },
    },
    skills: {
      allowBundled: [],
      managedDir: path.join(hiveDir, "skills"),
      extraDirs: [],
      hotReload: true,
      maxSkillSizeKB: 100,
    },
    mcp: {
      enabled: true,
      servers: {},
      healthCheck: {
        enabled: true,
        intervalSeconds: 60,
      },
    },
    memory: {
      dbPath: path.join(hiveDir, "memory.db"),
      notesDir: path.join(hiveDir, "agents", "main", "workspace", "memory"),
      episodic: {
        enabled: false,
        provider: "openai",
        maxEpisodesPerSession: 100,
      },
    },
    cron: {
      enabled: true,
      dbPath: path.join(hiveDir, "cron.db"),
      maxConcurrentJobs: 5,
      timezone: "UTC",
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 30000,
    },
    security: {
      maxMessageLength: {
        telegram: 4096,
        discord: 2000,
        slack: 40000,
        webchat: 100000,
        whatsapp: 65536,
      },
      skillScanning: true,
      warnOnInsecureConfig: true,
    },
    hooks: {
      scripts: {},
    },
    captcha: {
      enabled: false,
      autoSolve: true,
      visionProvider: 'gemini',
      visionModel: 'gemini-2.0-flash-exp',
      maxAttempts: 3,
      maxRounds: 5,
      enabledSites: [],
    },
  };
}


// deepMerge kept for potential future use
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== undefined &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}
export function loadConfig(): Config {
  return buildDefaultConfig();
}

export function expandConfigPath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  return expandPath(p);
}

export { expandPath };
