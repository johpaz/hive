import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import {
  initOnboardingDb,
  saveUserProfile,
  saveProviderConfig,
  saveAgentConfig,
  saveOnboardingProgress,
  activateChannel,
  activateEthics,
  activateCodeBridge,
  getAllEthics,
  getAllCodeBridge,
  saveVoiceConfig,
} from "@johpaz/hiveAgents-core/storage/onboarding";
import { generateAuthToken } from "../utils/token";
import { getHiveDir } from "../../../core/src/config/loader";

// Log helper for @clack/prompts v0.5.1 (log export not available)
const log = {
  success: (msg: string) => console.log(`\x1b[32m✔\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m✖\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m⚠\x1b[0m ${msg}`),
  info: (msg: string) => console.log(`\x1b[36mℹ\x1b[0m ${msg}`),
  step: (msg: string) => console.log(`\n\x1b[36m›\x1b[0m ${msg}`),
};

function getEnvApiKey(keyName: string): string | null {
  const hiveDir = getHiveDir();
  const envPath = path.join(hiveDir, ".env");
  if (!fs.existsSync(envPath)) return null;

  const envContent = fs.readFileSync(envPath, "utf-8");
  const match = envContent.match(new RegExp(`${keyName}=(.+)`));
  return match ? match[1].trim() : null;
}

function reloadEnvToProcess(hiveDir: string): void {
  const envPath = path.join(hiveDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const envContent = fs.readFileSync(envPath, "utf-8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (key && valueParts.length > 0) {
      process.env[key] = valueParts.join("=").trim();
    }
  }
}

const VERSION = "0.0.2";

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.2",
  gemini: "gemini-3.1-flash-preview",
  mistral: "mistral-large-latest",
  deepseek: "deepseek-chat",
  kimi: "kimi-k2.5",
  openrouter: "meta-llama/llama-3.3-70b-instruct",
  ollama: "llama3.3:8b",
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com",
  kimi: "https://api.moonshot.cn",
  openrouter: "https://openrouter.ai/api",
  ollama: "http://localhost:11434",
};

const API_KEY_PLACEHOLDERS: Record<string, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  gemini: "AIza...",
  mistral: "sk-...",
  deepseek: "sk-...",
  kimi: "sk-...",
  openrouter: "sk-or-...",
  ollama: "",
};

const API_KEY_LINKS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/app/apikey",
  mistral: "https://console.mistral.ai/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  kimi: "https://platform.moonshot.cn/console/api-keys",
  openrouter: "https://openrouter.ai/keys",
  ollama: "",
};

const AVAILABLE_MODELS: Record<string, Array<{ value: string; label: string; hint?: string }>> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Recomendado — mejor equilibrio, 1M contexto" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "Más potente — agentic coding, 1M contexto" },
    { value: "claude-haiku-4-6", label: "Claude Haiku 4.6", hint: "Más rápido y económico" },
  ],
  openai: [
    { value: "gpt-5.2", label: "GPT-5.2", hint: "Recomendado — 400K contexto, latest" },
    { value: "gpt-5.1", label: "GPT-5.1", hint: "Versión anterior estable" },
    { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", hint: "Especializado en código" },
    { value: "o4-mini", label: "o4-mini", hint: "Razonamiento avanzado, económico" },
  ],
  gemini: [
    { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash (Preview)", hint: "Frontier-class, muy económico" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", hint: "Frontier-class, muy económico" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Recomendado — estable, rápido" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Más potente — razonamiento profundo" },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", hint: "Latest — tareas complejas" },
  ],
  mistral: [
    { value: "mistral-large-latest", label: "Mistral Large", hint: "Recomendado — potente, 1M contexto" },
    { value: "mistral-small-latest", label: "Mistral Small", hint: "Económico y rápido" },
    { value: "pixtral-large-latest", label: "Pixtral Large", hint: "Multimodal — visión" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek-V3", hint: "Recomendado — muy económico, capaz" },
    { value: "deepseek-reasoner", label: "DeepSeek-R1", hint: "Razonamiento profundo" },
    { value: "deepseek-coder", label: "DeepSeek Coder", hint: "Especializado en código" },
  ],
  kimi: [
    { value: "kimi-k2.5", label: "Kimi K2.5", hint: "Recomendado — multimodal, agentic, 1T params" },
    { value: "kimi-k2-thinking", label: "Kimi K2 Thinking", hint: "Largo razonamiento" },
    { value: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo", hint: "Rápido, preview" },
  ],
  openrouter: [
    { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", hint: "Gratis — GPT-4 level" },
    { value: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash", hint: "Gratis — 1M contexto" },
    { value: "deepseek/deepseek-r1:free", label: "DeepSeek R1", hint: "Gratis — razonamiento fuerte" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Vía OpenRouter" },
  ],
  ollama: [
    { value: "llama3.3:8b", label: "Llama 3.3 8B", hint: "Recomendado — general, ~5GB RAM" },
    { value: "qwen2.5:7b", label: "Qwen 2.5 7B", hint: "Multilingual, código, ~4.5GB RAM" },
    { value: "mistral:7b", label: "Mistral 7B", hint: "Rápido, ~4GB RAM" },
    { value: "phi4:14b", label: "Phi-4 14B", hint: "Mejor calidad, ~8GB RAM" },
  ],
};

const BUNDLED_SKILLS = [
  { name: "web_search", label: "Web Search", hint: "Buscar en la web", default: true },
  { name: "shell", label: "Shell", hint: "Ejecutar comandos", default: true },
  { name: "file_manager", label: "File Manager", hint: "Operaciones de archivos", default: true },
  { name: "http_client", label: "HTTP Client", hint: "Peticiones HTTP", default: true },
  { name: "memory", label: "Memory", hint: "Memoria persistente", default: true },
  { name: "cron_manager", label: "Cron Manager", hint: "Tareas programadas", default: false },
  { name: "system_notify", label: "System Notify", hint: "Notificaciones desktop", default: false },
  { name: "browser_automation", label: "Browser Automation", hint: "Automatizar navegador", default: false },
  { name: "context_compact", label: "Context Compact", hint: "Compactar contexto", default: false },
];

type NavAction = "next" | "prev" | "cancel";

async function askNavigation(): Promise<NavAction> {
  const action = await p.select({
    message: "Acciones:",
    options: [
      { value: "next", label: "➡️  Siguiente", hint: "Continuar" },
      { value: "prev", label: "⬅️  Anterior", hint: "Volver atrás" },
      { value: "cancel", label: "❌  Cancelar", hint: "Salir del onboarding" },
    ],
  });

  if (p.isCancel(action) || action === "cancel") {
    return "cancel";
  }
  return action as NavAction;
}

function showProgress(current: number, total: number, title: string): void {
  const filled = "█".repeat(current);
  const empty = "░".repeat(total - current);
  p.note(`${filled}${empty} Sección ${current}/${total}: ${title}`, "Progreso");
}

interface OnboardConfig {
  agentName: string;
  agentId: string;
  userName: string;
  userId: string;
  provider: string;
  model: string;
  apiKey: string;
  channel: string;
  channelToken: string;
  workspace: string;
  tools: string[];
  mcp?: { servers: Record<string, unknown> };
  agentTone: "formal" | "friendly" | "direct";

  codeBridge: {
    enabled: boolean;
    clis: string[];
    port: number;
  };
  userLanguage?: string;
  userTimezone?: string;
  userOccupation?: string;
  userNotes?: string;
  ethicsChoice?: string;
  agentDescription: string;
}

async function checkCommand(cmd: string): Promise<boolean> {
  const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" })
  const code = await proc.exited
  return code === 0
}









function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function verifyTelegramToken(token: string): Promise<{ ok: boolean; username?: string }> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = (await res.json()) as {
      ok: boolean;
      result?: { username: string; first_name: string };
    };
    return {
      ok: data.ok,
      username: data.result?.username,
    };
  } catch {
    return { ok: false };
  }
}

function validateDiscordToken(token: string): boolean {
  return token.length >= 50;
}

function validateSlackToken(token: string): boolean {
  return token.startsWith("xoxb-") || token.startsWith("xoxp-");
}

async function testLLMConnection(provider: string, apiKey: string, model: string): Promise<boolean> {
  if (provider === "ollama") {
    try {
      const response = await fetch("http://localhost:11434/api/tags");
      return response.ok;
    } catch {
      return false;
    }
  }

  const testMessages = [{ role: "user" as const, content: "Say 'ok' if you can read this." }];

  try {
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 10,
          messages: testMessages,
        }),
      });
      return response.ok;
    }

    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 10,
          messages: testMessages,
        }),
      });
      return response.ok;
    }

    if (provider === "gemini") {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Say ok" }] }],
          }),
        }
      );
      return response.ok;
    }

    if (provider === "deepseek") {
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 10,
          messages: testMessages,
        }),
      });
      return response.ok;
    }

    if (provider === "kimi") {
      const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 10,
          messages: testMessages,
        }),
      });
      return response.ok;
    }

    if (provider === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 10,
          messages: testMessages,
        }),
      });
      return response.ok;
    }

    return false;
  } catch {
    return false;
  }
}

async function generateWorkspace(workspace: string, agentName: string, userName: string, userId: string, userLanguage: string, userTimezone: string, ethicsChoice: string): Promise<void> {
  // Create workspace directory - .md files are now stored in SQLite
  if (!fs.existsSync(workspace)) {
    fs.mkdirSync(workspace, { recursive: true });
  }

  // Files are loaded from SQLite via the agent service
  // Workspace directory is created but .md files are not generated here
  // The system will use default prompts from the database
}

async function installSystemdService(): Promise<void> {
  const home = process.env.HOME || "";
  const systemdDir = path.join(home, ".config", "systemd", "user");

  if (!fs.existsSync(systemdDir)) {
    fs.mkdirSync(systemdDir, { recursive: true });
  }

  const serviceContent = `[Unit]
Description=Hive Personal AI Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${home}/.bun/bin/hive start
ExecStop=${home}/.bun/bin/hive stop
Restart=on-failure
RestartSec=5
Environment=PATH=${home}/.bun/bin:${home}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=${home}

[Install]
WantedBy=default.target
`;

  const servicePath = path.join(systemdDir, "hive.service");
  fs.writeFileSync(servicePath, serviceContent, "utf-8");

  const { spawnSync } = require("child_process");
  spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  spawnSync("systemctl", ["--user", "enable", "hive"], { stdio: "inherit" });
}

async function isGatewayRunning(): Promise<boolean> {
  const pidFile = path.join(getHiveDir(), "gateway.pid");
  if (!fs.existsSync(pidFile)) return false;

  try {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function reloadGateway(): Promise<void> {
  const pidFile = path.join(getHiveDir(), "gateway.pid");
  if (!fs.existsSync(pidFile)) return;

  try {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    process.kill(pid, "SIGHUP");
  } catch {
    // Gateway not running
  }
}

interface ExistingConfig {
  agentName: string;
  provider: string;
  model: string;
  channels: string[];
  apiKey: string;
  workspace: string;
  skills: string[];
  raw: Record<string, unknown>;
}

function parseExistingConfig(raw: Record<string, unknown>): ExistingConfig {
  const agents = (raw.agents as Record<string, unknown>)?.list as Array<Record<string, unknown>> | undefined;
  const models = raw.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;
  const defaultProvider = models?.defaultProvider as string | undefined;
  const providerConfig = providers?.[defaultProvider || ""] as Record<string, unknown> | undefined;

  return {
    agentName: (agents?.[0]?.name as string) ?? "Hive",
    provider: defaultProvider ?? "gemini",
    model: (models?.defaults as Record<string, string>)?.[defaultProvider || ""] ?? "",
    channels: Object.keys((raw.channels as Record<string, unknown>) ?? {}),
    apiKey: (providerConfig?.apiKey as string) ?? "",
    workspace: (agents?.[0]?.workspace as string) ?? path.join(getHiveDir(), "workspace"),
    skills: ((raw.skills as Record<string, unknown>)?.allowBundled as string[]) ?? [],
    raw,
  };
}

async function runUpdateWizard(existing: ExistingConfig): Promise<void> {
  p.note(
    "Presiona Enter para mantener el valor actual de cada campo.",
    "✏️  Modo actualización"
  );

  // Nombre del agente
  const agentName = await p.text({
    message: "Nombre del agente:",
    placeholder: existing.agentName,
    defaultValue: existing.agentName,
  });

  if (p.isCancel(agentName)) {
    p.cancel("Actualización cancelada.");
    process.exit(0);
  }

  // Proveedor LLM
  const changeProvider = await p.confirm({
    message: `Proveedor actual: ${existing.provider} (${existing.model || "no configurado"}). ¿Cambiar?`,
    initialValue: false,
  });

  if (p.isCancel(changeProvider)) {
    p.cancel("Actualización cancelada.");
    process.exit(0);
  }

  let provider = existing.provider;
  let model = existing.model;
  let apiKey = existing.apiKey;

  if (changeProvider) {
    provider = await p.select({
      message: "Nuevo proveedor LLM:",
      options: [
        { value: "anthropic", label: "Anthropic (Claude)", hint: "Recomendado — Claude 4.6" },
        { value: "openai", label: "OpenAI (GPT-5)", hint: "GPT-5.2" },
        { value: "gemini", label: "Google Gemini", hint: "Gemini 3 Flash" },
        { value: "mistral", label: "Mistral AI", hint: "Mistral Large" },
        { value: "deepseek", label: "DeepSeek", hint: "Muy económico" },
        { value: "kimi", label: "Kimi (Moonshot AI)", hint: "Contexto largo" },
        { value: "openrouter", label: "OpenRouter", hint: "Multi-modelo" },
        { value: "ollama", label: "Ollama (local)", hint: "Sin costo" },
      ],
    }) as string;

    if (p.isCancel(provider)) {
      p.cancel("Actualización cancelada.");
      process.exit(0);
    }

    const models = AVAILABLE_MODELS[provider] || [{ value: DEFAULT_MODELS[provider], label: DEFAULT_MODELS[provider] }];

    if (models.length > 1) {
      model = await p.select({
        message: `Modelo de ${provider}:`,
        options: models,
      }) as string;

      if (p.isCancel(model)) {
        p.cancel("Actualización cancelada.");
        process.exit(0);
      }
    } else {
      model = models[0].value;
    }

    if (provider !== "ollama") {
      const link = API_KEY_LINKS[provider];
      if (link) {
        p.note(`Obtén tu API key en:\n${link}`, `API key de ${provider}`);
      }

      const keyResult = await p.password({
        message: `API key de ${provider}:`,
        validate: (v) => (!v || v.length < 10 ? "La key parece muy corta" : undefined),
      });

      if (p.isCancel(keyResult)) {
        p.cancel("Actualización cancelada.");
        process.exit(0);
      }
      apiKey = keyResult;

      const spinner = p.spinner();
      spinner.start(`Verificando conexión con ${provider}...`);

      const connected = await testLLMConnection(provider, apiKey, model as string);

      if (!connected) {
        spinner.stop(`❌ Error conectando con ${provider}`);
        p.outro("API key inválida. Ejecuta 'hive onboard' de nuevo con la key correcta.");
        process.exit(1);
      }

      spinner.stop(`✅ Conexión con ${provider} verificada`);
    }
  }

  // Canales
  const currentChannels = existing.channels.length > 0 ? existing.channels.join(", ") : "ninguno";
  const changeChannel = await p.confirm({
    message: `Canales configurados: ${currentChannels}. ¿Añadir o cambiar?`,
    initialValue: false,
  });

  if (p.isCancel(changeChannel)) {
    p.cancel("Actualización cancelada.");
    process.exit(0);
  }

  let channels = existing.raw.channels as Record<string, unknown> | undefined;

  if (changeChannel) {
    const channel = await p.select({
      message: "Canal a configurar:",
      options: [
        { value: "telegram", label: "Telegram", hint: "Recomendado" },
        { value: "discord", label: "Discord" },
        { value: "webchat", label: "WebChat (local)" },
        { value: "none", label: "Ninguno" },
      ],
    }) as string;

    if (p.isCancel(channel)) {
      p.cancel("Actualización cancelada.");
      process.exit(0);
    }

    if (channel === "telegram") {
      p.note(
        "1. Abre Telegram y busca @BotFather\n" +
        "2. Escribe /newbot y sigue las instrucciones\n" +
        "3. Copia el token que te da BotFather",
        "Cómo obtener el token de Telegram"
      );

      const tokenResult = await p.password({
        message: "Token de Telegram BotFather:",
        validate: (v) => (!v?.trim() ? "El token no puede estar vacío" : undefined),
      });

      if (p.isCancel(tokenResult)) {
        p.cancel("Actualización cancelada.");
        process.exit(0);
      }

      const spinner = p.spinner();
      spinner.start("Verificando token de Telegram...");
      const tg = await verifyTelegramToken(tokenResult as string);
      if (tg.ok && tg.username) {
        spinner.stop(`✅ Bot verificado: @${tg.username}`);
      } else {
        spinner.stop("⚠️  Token no verificado — se guardará de todas formas");
        p.note(
          "El token se guardó pero no pudo verificarse.\n" +
          "Si es incorrecto, ejecuta: hive onboard (opción actualizar)",
          "Aviso"
        );
      }

      const telegramAccount: Record<string, unknown> = {
        botToken: tokenResult,
        dmPolicy: "open",
      };

      channels = {
        telegram: {
          accounts: {
            default: telegramAccount,
          },
        },
      };
    } else if (channel === "discord") {
      p.note(
        "1. Ve a https://discord.com/developers/applications\n" +
        "2. Crea una nueva aplicación\n" +
        "3. Ve a Bot → Reset Token\n" +
        "4. Habilita 'Message Content Intent'",
        "Cómo obtener el token de Discord"
      );

      const tokenResult = await p.password({
        message: "Token del bot de Discord:",
        validate: (v) => (!v?.trim() ? "El token no puede estar vacío" : undefined),
      });

      if (p.isCancel(tokenResult)) {
        p.cancel("Actualización cancelada.");
        process.exit(0);
      }

      channels = {
        discord: {
          accounts: {
            default: {
              token: tokenResult,
            },
          },
        },
      };
    }
  }

  // Guardar cambios
  const spinner = p.spinner();
  spinner.start("Guardando cambios...");

  const baseUrlMap: Record<string, string> = {
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    deepseek: "https://api.deepseek.com/v1",
    kimi: "https://api.moonshot.cn/v1",
    ollama: "http://localhost:11434/api",
  };

  const providersConfig: Record<string, Record<string, unknown>> = {};
  if (provider !== "ollama" && apiKey) {
    providersConfig[provider] = { apiKey };
    if (baseUrlMap[provider]) {
      providersConfig[provider].baseUrl = baseUrlMap[provider];
    }
  }

  const updatedConfig: Record<string, unknown> = {
    ...existing.raw,
    name: agentName,
    agents: {
      list: [
        {
          id: "main",
          default: true,
          name: agentName,
          workspace: existing.workspace,
          agentDir: path.join(getHiveDir(), "agents", "main", "agent"),
        },
      ],
    },
    models: {
      defaultProvider: provider,
      defaults: {
        [provider]: model,
      },
      providers: providersConfig,
    },
  };

  if (channels) {
    updatedConfig.channels = channels;
  }

  log.success("✅ Configuración actualizada en BD");
  // Also update SQLite
  try {
    const { initializeDatabase, getDb } = await import("../../../core/src/storage/sqlite");
    initializeDatabase();
    const sqliteDb = getDb();

    const apiKeyVal = (providersConfig[provider]?.apiKey as string) || null;
    const baseUrlVal = (providersConfig[provider]?.baseUrl as string) || null;

    sqliteDb.query(`
      UPDATE providers SET api_key = ?, base_url = ?
      WHERE id = ?
    `).run(apiKeyVal, baseUrlVal, provider);

    sqliteDb.query(`
      UPDATE agents SET name = ?, provider_id = ?, model_id = ?
      WHERE id = 'main'
    `).run(agentName, provider, model);

    console.log("✅ SQLite actualizado");
  } catch (error) {
    console.log("⚠️ Error actualizando SQLite:", (error as Error).message);
  }

  spinner.stop("Cambios guardados ✅");

  // Recargar Gateway si está corriendo
  const running = await isGatewayRunning();
  if (running) {
    const reload = await p.confirm({
      message: "El Gateway está corriendo. ¿Recargar configuración ahora?",
      initialValue: true,
    });

    if (reload) {
      await reloadGateway();
      log.success("Configuración recargada ✅");
    }
  }

  const channelDisplay = channels ? Object.keys(channels).join(", ") || "ninguno" : existing.channels.join(", ") || "ninguno";

  p.outro(
    `✅ Configuración actualizada.\n\n` +
    `  Agente:    ${agentName}\n` +
    `  Proveedor: ${provider} (${model})\n` +
    `  Canales:   ${channelDisplay}\n\n` +
    `  hive status   → ver estado actual\n` +
    `  hive reload   → recargar manualmente`
  );
}

async function runFullWizard(): Promise<void> {
  p.intro("🐝 Bienvenido a Hive — Personal AI Gateway");

  // Initialize DB at start
  initOnboardingDb();

  const TOTAL_STEPS = 8;
  let step = 1;

  // Shared wizard state — pre-populated with defaults
  const state = {
    // Step 1: User Profile
    agentName: "Hive",
    userName: "Usuario",
    userId: "", // Se genera automáticamente en la BD
    userLanguage: "Spanish",
    userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Bogota",
    userOccupation: "",
    userNotes: "",
    sessionToken: "", // For webchat user_identity
    // Step 2: Agent Profile
    agentId: "", // Se genera automáticamente en la BD
    agentTone: "friendly" as "formal" | "friendly" | "direct",
    agentDescription: "Asistente personal inteligente y desarrollador senior.",
    // Step 3: Ethics
    ethicsId: "default",
    // Step 4: Tools
    tools: [] as string[],
    // Step 5: Provider
    provider: "gemini",
    model: "gemini-2.5-flash",
    apiKey: "",
    // Voice config
    voiceEnabled: false,
    sttProvider: "",
    ttsProvider: "",
    ttsVoiceId: "",
    elevenlabsApiKey: "",
    // Step 6: Channel
    channel: "webchat",
    channelToken: "",
    // Step 7: Code Bridge
    codeBridgeEnabled: false,
    codeBridgeClis: [] as string[],
  };

  const hiveDir = getHiveDir();

  // ─────────────────────────────────────
  // Step machine: 9 steps in correct order
  // ─────────────────────────────────────

  while (step <= TOTAL_STEPS) {
    switch (step) {

      // ═══════════════════════════════════
      // STEP 1: User Profile
      // ═══════════════════════════════════
      case 1: {
        showProgress(step, TOTAL_STEPS, "Tu perfil");

        const userName = await p.text({
          message: "👤 ¿Cómo te llamas?",
          placeholder: "Usuario",
          defaultValue: state.userName,
        });
        if (p.isCancel(userName)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.userName = userName;

        const userLanguage = await p.select({
          message: "🌐 ¿En qué idioma prefieres que te responda?",
          options: [
            { value: "Spanish", label: "Español" },
            { value: "English", label: "English" },
            { value: "Spanish, English", label: "Ambos / Both" },
          ],
          initialValue: state.userLanguage,
        });
        if (p.isCancel(userLanguage)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.userLanguage = userLanguage as string;

        const userTimezone = await p.text({
          message: "🕐 ¿Cuál es tu zona horaria?",
          placeholder: "America/Bogota",
          defaultValue: state.userTimezone,
        });
        if (p.isCancel(userTimezone)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.userTimezone = userTimezone as string;

        const userOccupation = await p.text({
          message: "💼 ¿A qué te dedicas?",
          placeholder: "desarrollador de software",
          defaultValue: state.userOccupation || undefined,
        });
        if (p.isCancel(userOccupation)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.userOccupation = userOccupation || "";

        const userNotes = await p.text({
          message: "💡 ¿Algo importante que el agente deba recordar de ti?",
          placeholder: "Prefiero respuestas directas.",
          defaultValue: state.userNotes || undefined,
        });
        if (p.isCancel(userNotes)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.userNotes = userNotes || "";

        // Generate session token for webchat (user_identity)
        state.sessionToken = generateAuthToken();

        // ✅ Save user to DB (agent will be saved in Step 2)
        // userId se genera automáticamente en la BD (randomblob)
        state.userId = saveUserProfile({
          userName: state.userName,
          userLanguage: state.userLanguage,
          userTimezone: state.userTimezone,
          userOccupation: state.userOccupation,
          userNotes: state.userNotes,
          channelUserId: state.sessionToken, // For webchat user_identity
        });

        saveOnboardingProgress({
          step: "user",
          userId: state.userId,
          data: { userName: state.userName, userLanguage: state.userLanguage, userTimezone: state.userTimezone, userOccupation: state.userOccupation, userNotes: state.userNotes },
        });

        log.success(`✅ Usuario guardado con ID: ${state.userId}`);

        const nav = await askNavigation();
        if (nav === "cancel") { p.cancel("Onboarding cancelado."); process.exit(0); }
        if (nav === "prev") { step = 1; break; }
        step = 2;
        break;
      }

      // ═══════════════════════════════════
      // STEP 2: Perfil del Agente
      // ═══════════════════════════════════
      case 2: {
        showProgress(step, TOTAL_STEPS, "Tu agente");

        const agentName = await p.text({
          message: "🤖 ¿Cómo se llamará tu agente?",
          placeholder: "Bee",
          defaultValue: state.agentName,
        });
        if (p.isCancel(agentName)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.agentName = agentName;

        const agentDescription = await p.text({
          message: "📝 ¿Qué quieres que haga este agente? (Su objetivo principal)",
          placeholder: "Ser un asistente personal inteligente y experto en desarrollo.",
          defaultValue: state.agentDescription,
        });
        if (p.isCancel(agentDescription)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.agentDescription = agentDescription;

        const agentTone = await p.select({
          message: "🎭 Elige el tono de comunicación del agente:",
          options: [
            { value: "friendly", label: "Amigable y cercano" },
            { value: "professional", label: "Profesional y formal" },
            { value: "direct", label: "Directo y conciso" },
            { value: "casual", label: "Casual y relajado" },
          ],
          initialValue: state.agentTone,
        });
        if (p.isCancel(agentTone)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.agentTone = agentTone as "formal" | "friendly" | "direct";

        // ✅ Save agent to DB (agentId se genera automáticamente)
        state.agentId = saveAgentConfig({
          userId: state.userId,
          agentName: state.agentName,
          description: state.agentDescription,
          tone: state.agentTone,
          providerId: "",
          modelId: "",
        });

        // Activate default ethics
        activateEthics(state.userId, "default");

        saveOnboardingProgress({
          step: "agent",
          userId: state.userId,
          data: { agentName: state.agentName, agentDescription: state.agentDescription, agentTone: state.agentTone, agentId: state.agentId },
        });

        log.success(`✅ Agente creado con ID: ${state.agentId}`);

        const nav = await askNavigation();
        if (nav === "cancel") { p.cancel("Onboarding cancelado."); process.exit(0); }
        if (nav === "prev") { step = 1; break; }
        step = 3;
        break;
      }

      // ═══════════════════════════════════
      // STEP 3: Ethics
      // ═══════════════════════════════════
      case 3: {
        showProgress(step, TOTAL_STEPS, "Ética");

        p.note("Los lineamientos éticos tienen MÁXIMA prioridad.", "Ética del agente");

        const ethicsOptions = getAllEthics();
        console.log("📋 Ethics options:", ethicsOptions);

        if (ethicsOptions.length === 0) {
          log.warn("No hay éticas disponibles en la BD. Usando ética por defecto.");
          state.ethicsId = "default";
        } else {
          const selectedEthics = await p.select({
            message: "¿Qué lineamientos éticos prefieres?",
            options: ethicsOptions.map(e => ({
              value: e.id,
              label: e.name,
              hint: e.isDefault ? "Recomendado" : e.description,
            })),
            initialValue: state.ethicsId,
          });
          if (p.isCancel(selectedEthics)) { p.cancel("Onboarding cancelado."); process.exit(0); }
          state.ethicsId = selectedEthics as string;
        }

        // ✅ Activate ethics in DB
        activateEthics(state.userId, state.ethicsId);

        saveOnboardingProgress({
          step: "ethics",
          userId: state.userId,
          data: { ethicsId: state.ethicsId },
        });

        const nav = await askNavigation();
        if (nav === "cancel") { p.cancel("Onboarding cancelado."); process.exit(0); }
        if (nav === "prev") { step = 2; break; }
        step = 4;
        break;
      }

      // ═══════════════════════════════════
      // STEP 4: Provider & Model
      // ═══════════════════════════════════
      case 4: {
        showProgress(step, TOTAL_STEPS, "Proveedor LLM");

        const provider = await p.select({
          message: "¿Qué proveedor de LLM quieres usar?",
          options: [
            { value: "gemini", label: "Google Gemini", hint: "Recomendado — económico, gran contexto" },
            { value: "anthropic", label: "Anthropic Claude", hint: "Premium — mejor calidad" },
            { value: "openai", label: "OpenAI", hint: "Estándar de la industria" },
            { value: "ollama", label: "Ollama (Local)", hint: "Gratis, corre localmente" },
            { value: "openrouter", label: "OpenRouter", hint: "Múltiples proveedores" },
          ],
          initialValue: state.provider,
        });
        if (p.isCancel(provider)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.provider = provider as string;

        const models = AVAILABLE_MODELS[state.provider] || [];
        const model = await p.select({
          message: `¿Qué modelo de ${provider}?`,
          options: models,
          initialValue: DEFAULT_MODELS[state.provider],
        });
        if (p.isCancel(model)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.model = model as string;

        let apiKey = "";
        if (state.provider !== "ollama") {
          const link = API_KEY_LINKS[state.provider];
          if (link) {
            p.note(`Obtén tu API key en: ${link}`, "API Key");
          }
          const keyResult = await p.password({
            message: `API key de ${state.provider}:`,
            validate: (v) => (!v || v.length < 10 ? "La key parece muy corta" : undefined),
          });
          if (p.isCancel(keyResult)) { p.cancel("Onboarding cancelado."); process.exit(0); }
          apiKey = keyResult;
        }
        state.apiKey = apiKey;

        // ✅ Save provider & activate model in DB
        await saveProviderConfig({
          userId: state.userId,
          provider: state.provider,
          model: state.model,
          apiKey: state.apiKey,
          baseUrl: PROVIDER_BASE_URLS[state.provider],
        });

        saveOnboardingProgress({
          step: "provider",
          userId: state.userId,
          data: { provider: state.provider, model: state.model },
        });

        const nav = await askNavigation();
        if (nav === "cancel") { p.cancel("Onboarding cancelado."); process.exit(0); }
        if (nav === "prev") { step = 3; break; }
        step = 5;
        break;
      }

      // ═══════════════════════════════════
      // STEP 5: Voice Configuration
      // ═══════════════════════════════════
      case 5: {
        showProgress(step, TOTAL_STEPS, "Voz");

        p.note("Configura el reconocimiento de voz y síntesis de audio.", "Voz");

        const wantsVoice = await p.confirm({
          message: "¿Quieres habilitar voz en tu agente?",
          initialValue: false,
        });
        if (p.isCancel(wantsVoice)) { p.cancel("Onboarding cancelado."); process.exit(0); }

        state.voiceEnabled = wantsVoice as boolean;

        if (wantsVoice) {
          // Variables to store API keys for saving to DB later
          let sttApiKeyValue: string | null = null;
          let ttsApiKeyValue: string | null = null;

          // Ask for STT provider (speech-to-text)
          const sttProvider = await p.select({
            message: "¿Qué servicio de transcripción de voz (STT)?",
            options: [
              { value: "whisper-large-v3-turbo", label: "Groq Whisper Large V3 Turbo", hint: "Recomendado - rápido" },
              { value: "whisper-large-v3", label: "Groq Whisper Large V3", hint: "Máxima precisión" },
              { value: "distil-whisper-large-v3-en", label: "Groq Distil Whisper Large V3", hint: "Solo inglés" },
              { value: "whisper-1", label: "OpenAI Whisper 1", hint: "Alternativa" },
            ],
            initialValue: state.sttProvider || "whisper-large-v3-turbo",
          });
          if (p.isCancel(sttProvider)) { p.cancel("Onboarding cancelado."); process.exit(0); }
          state.sttProvider = sttProvider as string;

          // Ask for API key based on STT provider
          const isGroqStt = ["whisper-large-v3", "whisper-large-v3-turbo", "distil-whisper-large-v3-en"].includes(sttProvider);
          const isOpenAiStt = sttProvider === "whisper-1";

          if (isGroqStt) {
            const existingGroqKey = getEnvApiKey("GROQ_API_KEY");
            let groqKey: string | null = existingGroqKey;

            if (!groqKey) {
              const groqKeyInput = await p.password({
                message: "Ingresa tu GROQ_API_KEY:",
                validate: (value) => {
                  if (!value || value.length < 10) return "API key inválida";
                },
              });
              if (p.isCancel(groqKeyInput)) { p.cancel("Onboarding cancelado."); process.exit(0); }
              groqKey = groqKeyInput as string;
              sttApiKeyValue = groqKey;

              // Save Groq API key to .env
              const hiveDir = getHiveDir();
              const envPath = path.join(hiveDir, ".env");
              const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
              const newEnv = envContent.includes("GROQ_API_KEY")
                ? envContent.replace(/GROQ_API_KEY=.*/g, `GROQ_API_KEY=${groqKey}`)
                : envContent + `\nGROQ_API_KEY=${groqKey}`;
              fs.writeFileSync(envPath, newEnv);
              reloadEnvToProcess(hiveDir);
              log.success("✅ API key de Groq guardada en .env");
            } else {
              log.info("✅ GROQ_API_KEY ya configurada en .env");
              sttApiKeyValue = groqKey;
            }
          } else if (isOpenAiStt) {
            const existingOpenAiKey = getEnvApiKey("OPENAI_API_KEY");
            let openaiKey: string | null = existingOpenAiKey;

            if (!openaiKey) {
              const openaiKeyInput = await p.password({
                message: "Ingresa tu OPENAI_API_KEY:",
                validate: (value) => {
                  if (!value || value.length < 10) return "API key inválida";
                },
              });
              if (p.isCancel(openaiKeyInput)) { p.cancel("Onboarding cancelado."); process.exit(0); }
              openaiKey = openaiKeyInput as string;
              sttApiKeyValue = openaiKey;

              // Save OpenAI API key to .env
              const hiveDir = getHiveDir();
              const envPath = path.join(hiveDir, ".env");
              const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
              const newEnv = envContent.includes("OPENAI_API_KEY")
                ? envContent.replace(/OPENAI_API_KEY=.*/g, `OPENAI_API_KEY=${openaiKey}`)
                : envContent + `\nOPENAI_API_KEY=${openaiKey}`;
              fs.writeFileSync(envPath, newEnv);
              reloadEnvToProcess(hiveDir);
              log.success("✅ API key de OpenAI guardada en .env");
            } else {
              log.info("✅ OPENAI_API_KEY ya configurada en .env");
              sttApiKeyValue = openaiKey;
            }
          }

          // Ask for TTS provider (text-to-speech)
          const ttsProvider = await p.select({
            message: "¿Qué servicio de síntesis de voz (TTS)?",
            options: [
              { value: "eleven_flash_v2_5", label: "ElevenLabs Flash V2.5", hint: "Tiempo real - recomendado" },
              { value: "eleven_turbo_v2_5", label: "ElevenLabs Turbo V2.5", hint: "Balance calidad/velocidad" },
              { value: "eleven_multilingual_v2", label: "ElevenLabs Multilingual V2", hint: "Alta calidad" },
              { value: "eleven_v3", label: "ElevenLabs V3", hint: "Más expresivo" },
              { value: "qwen3-tts-instruct-flash", label: "Qwen TTS Flash", hint: "Gratis - recomendado" },
              { value: "gpt-4o-mini-tts", label: "OpenAI GPT-4o Mini TTS", hint: "Usa tu API key" },
              { value: "tts-1", label: "OpenAI TTS-1", hint: "Estándar" },
              { value: "tts-1-hd", label: "OpenAI TTS-1 HD", hint: "Alta calidad" },
              { value: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS", hint: "Google" },
              { value: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS", hint: "Google Pro" },
            ],
            initialValue: state.ttsProvider || "eleven_flash_v2_5",
          });
          if (p.isCancel(ttsProvider)) { p.cancel("Onboarding cancelado."); process.exit(0); }
          state.ttsProvider = ttsProvider as string;

          // Ask for API key based on TTS provider
          const isElevenLabs = ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_v3"].includes(ttsProvider);
          const isOpenAI = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"].includes(ttsProvider);
          const isGemini = ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"].includes(ttsProvider);
          const isQwen = ["qwen3-tts-instruct-flash", "qwen3-tts-flash", "qwen-tts"].includes(ttsProvider);

          if (isElevenLabs) {
            const existingElevenKey = getEnvApiKey("ELEVENLABS_API_KEY");
            let elevenKey: string | null = existingElevenKey;

            if (!elevenKey) {
              const elevenKeyInput = await p.password({
                message: "Ingresa tu ELEVENLABS_API_KEY:",
                validate: (value) => {
                  if (!value || value.length < 10) return "API key inválida";
                },
              });
              if (p.isCancel(elevenKeyInput)) { p.cancel("Onboarding cancelado."); process.exit(0); }
              elevenKey = elevenKeyInput as string;
              state.elevenlabsApiKey = elevenKey;

              // Save to .env
              const hiveDir = getHiveDir();
              const envPath = path.join(hiveDir, ".env");
              const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
              const newEnv = envContent.includes("ELEVENLABS_API_KEY")
                ? envContent.replace(/ELEVENLABS_API_KEY=.*/g, `ELEVENLABS_API_KEY=${elevenKey}`)
                : envContent + `\nELEVENLABS_API_KEY=${elevenKey}`;
              fs.writeFileSync(envPath, newEnv);
              reloadEnvToProcess(hiveDir);
              log.success("✅ API key de ElevenLabs guardada en .env");
            } else {
              log.info("✅ ELEVENLABS_API_KEY ya configurada en .env");
              state.elevenlabsApiKey = elevenKey;
            }
            ttsApiKeyValue = elevenKey;
          } else if (isOpenAI) {
            const existingOpenAiKey = getEnvApiKey("OPENAI_API_KEY");
            let openaiKey: string | null = existingOpenAiKey;

            if (!openaiKey) {
              const openaiKeyInput = await p.password({
                message: "Ingresa tu OPENAI_API_KEY:",
                validate: (value) => {
                  if (!value || value.length < 10) return "API key inválida";
                },
              });
              if (p.isCancel(openaiKeyInput)) { p.cancel("Onboarding cancelado."); process.exit(0); }
              openaiKey = openaiKeyInput as string;

              // Save to .env
              const hiveDir = getHiveDir();
              const envPath = path.join(hiveDir, ".env");
              const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
              const newEnv = envContent.includes("OPENAI_API_KEY")
                ? envContent.replace(/OPENAI_API_KEY=.*/g, `OPENAI_API_KEY=${openaiKey}`)
                : envContent + `\nOPENAI_API_KEY=${openaiKey}`;
              fs.writeFileSync(envPath, newEnv);
              reloadEnvToProcess(hiveDir);
              log.success("✅ API key de OpenAI guardada en .env");
            } else {
              log.info("✅ OPENAI_API_KEY ya configurada en .env");
            }
            ttsApiKeyValue = openaiKey;
          } else if (isGemini) {
            const existingGeminiKey = getEnvApiKey("GEMINI_API_KEY");
            let geminiKey: string | null = existingGeminiKey;

            if (!geminiKey) {
              const geminiKeyInput = await p.password({
                message: "Ingresa tu GEMINI_API_KEY:",
                validate: (value) => {
                  if (!value || value.length < 10) return "API key inválida";
                },
              });
              if (p.isCancel(geminiKeyInput)) { p.cancel("Onboarding cancelado."); process.exit(0); }
              geminiKey = geminiKeyInput as string;

              // Save to .env
              const hiveDir = getHiveDir();
              const envPath = path.join(hiveDir, ".env");
              const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
              const newEnv = envContent.includes("GEMINI_API_KEY")
                ? envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${geminiKey}`)
                : envContent + `\nGEMINI_API_KEY=${geminiKey}`;
              fs.writeFileSync(envPath, newEnv);
              reloadEnvToProcess(hiveDir);
              log.success("✅ API key de Gemini guardada en .env");
            } else {
              log.info("✅ GEMINI_API_KEY ya configurada en .env");
            }
            ttsApiKeyValue = geminiKey;
          } else if (isQwen) {
            const existingQwenKey = getEnvApiKey("DASHSCOPE_API_KEY");
            let qwenKey: string | null = existingQwenKey;

            if (!qwenKey) {
              const qwenKeyInput = await p.password({
                message: "Ingresa tu DASHSCOPE_API_KEY (Qwen/Alibaba):",
                validate: (value) => {
                  if (!value || value.length < 10) return "API key inválida";
                },
              });
              if (p.isCancel(qwenKeyInput)) { p.cancel("Onboarding cancelado."); process.exit(0); }
              qwenKey = qwenKeyInput as string;

              // Save to .env
              const hiveDir = getHiveDir();
              const envPath = path.join(hiveDir, ".env");
              const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
              const newEnv = envContent.includes("DASHSCOPE_API_KEY")
                ? envContent.replace(/DASHSCOPE_API_KEY=.*/g, `DASHSCOPE_API_KEY=${qwenKey}`)
                : envContent + `\nDASHSCOPE_API_KEY=${qwenKey}`;
              fs.writeFileSync(envPath, newEnv);
              reloadEnvToProcess(hiveDir);
              log.success("✅ API key de Qwen guardada en .env");
            } else {
              log.info("✅ DASHSCOPE_API_KEY ya configurada en .env");
            }
            ttsApiKeyValue = qwenKey;
          }

          // Save voice config to channel (for webchat as default)
          // API keys are saved in .env and encrypted in BD
          await saveVoiceConfig({
            userId: state.userId,
            channelId: "webchat",
            voiceEnabled: true,
            sttProvider: sttProvider as string,
            ttsProvider: ttsProvider as string,
            sttApiKey: sttApiKeyValue || undefined,
            ttsApiKey: ttsApiKeyValue || undefined,
          });
          log.success("✅ Configuración de voz guardada en BD");
        }

        const nav2 = await askNavigation();
        if (nav2 === "cancel") { p.cancel("Onboarding cancelado."); process.exit(0); }
        if (nav2 === "prev") { step = 4; break; }
        step = 6;
        break;
      }

      // ═══════════════════════════════════
      // STEP 6: Channels
      // ═══════════════════════════════════
      case 6: {
        showProgress(step, TOTAL_STEPS, "Canales");

        // WebChat siempre activado por defecto
        state.channel = "webchat";

        // ✅ Activar WebChat en BD (UPDATE del seed)
        await activateChannel(state.userId, {
          channelId: "webchat",
          channelUserId: state.sessionToken,
        });

        log.success("✅ WebChat activado por defecto (http://localhost:18790/ui)");

        // Preguntar si quiere activar Telegram (recomendado)
        const activateTelegram = await p.confirm({
          message: "¿Quieres activar Telegram? (recomendado para notificaciones)",
          initialValue: false,
        });
        if (p.isCancel(activateTelegram)) { p.cancel("Onboarding cancelado."); process.exit(0); }

        if (activateTelegram) {
          p.note(
            "1. Abre Telegram y busca @BotFather\n" +
            "2. Escribe /newbot y sigue las instrucciones\n" +
            "3. Copia el token",
            "Cómo obtener token de Telegram"
          );
          const tokenResult = await p.password({
            message: "Token de Telegram:",
            validate: (v) => (!v?.trim() ? "El token no puede estar vacío" : undefined),
          });
          if (p.isCancel(tokenResult)) { p.cancel("Onboarding cancelado."); process.exit(0); }
          state.channelToken = tokenResult;

          // ✅ Activar Telegram en BD (UPDATE del seed)
          await activateChannel(state.userId, {
            channelId: "telegram",
            config: { botToken: state.channelToken, dmPolicy: "open" },
          });

          log.success("✅ Telegram activado");
        }

        saveOnboardingProgress({
          step: "channel",
          userId: state.userId,
          data: { channel: "webchat", telegram: activateTelegram },
        });

        const nav = await askNavigation();
        if (nav === "cancel") { p.cancel("Onboarding cancelado."); process.exit(0); }
        if (nav === "prev") { step = 4; break; }
        step = 7;
        break;
      }

      // ═══════════════════════════════════
      // STEP 7: Code Bridge
      // ═══════════════════════════════════
      case 7: {
        showProgress(step, TOTAL_STEPS, "Code Bridge");

        const codeBridgeEnabled = await p.confirm({
          message: "¿Quieres delegar tareas de código a CLIs externos? (claude-code, gemini, qwen, opencode)",
          initialValue: state.codeBridgeEnabled,
        });
        if (p.isCancel(codeBridgeEnabled)) { p.cancel("Onboarding cancelado."); process.exit(0); }
        state.codeBridgeEnabled = codeBridgeEnabled as boolean;

        let codeBridgeClis: string[] = [];
        if (state.codeBridgeEnabled) {
          const availableClis = getAllCodeBridge();

          if (availableClis.length === 0) {
            log.warn("⚠️  No hay CLIs de code bridge configurados. Puedes agregar más desde el dashboard.");
          } else {
            log.info("Selecciona los CLIs que tengas instalados (presiona Espacio para seleccionar, Enter para continuar):");
            const selectedClis = await p.multiselect({
              message: "¿Qué CLIs tienes instalados?",
              options: availableClis.map(cb => ({
                value: cb.id,
                label: cb.name,
                hint: cb.cliCommand,
              })),
              required: false,
            });
            if (p.isCancel(selectedClis)) { p.cancel("Onboarding cancelado."); process.exit(0); }
            codeBridgeClis = (selectedClis as string[]) || [];
          }
        }
        state.codeBridgeClis = codeBridgeClis;

        // ✅ Save code bridge config in DB
        const codeBridgeConfig = getAllCodeBridge().map(cb => ({
          id: cb.id,
          enabled: codeBridgeClis.includes(cb.id),
          port: cb.port,
        }));
        activateCodeBridge(state.userId, codeBridgeConfig);

        // ✅ MCP servers se agregan desactivados (se configuran desde el dashboard)
        log.info("ℹ️  MCP servers disponibles (configura desde el dashboard)");

        saveOnboardingProgress({
          step: "codebridge",
          userId: state.userId,
          data: { enabled: state.codeBridgeEnabled, clis: codeBridgeClis },
        });

        const nav = await askNavigation();
        if (nav === "cancel") { p.cancel("Onboarding cancelado."); process.exit(0); }
        if (nav === "prev") { step = 5; break; }
        step = 8;
        break;
      }

      // ═══════════════════════════════════
      // STEP 8: Resumen Final
      // ═══════════════════════════════════
      case 8: {
        showProgress(step, TOTAL_STEPS, "Resumen final");


        // Show summary
        p.note(
          `  Agente:     ${state.agentName}\n` +
          `  Usuario:    ${state.userName}\n` +
          `  Idioma:     ${state.userLanguage}\n` +
          `  Proveedor:  ${state.provider} (${state.model})\n` +
          `  Voz:        ${state.voiceEnabled ? `STT: ${state.sttProvider}, TTS: ${state.ttsProvider}` : "no"}\n` +
          `  Canal:      ${state.channel}${state.channelToken ? ' (Telegram configurado)' : ''}\n` +
          `  Code Bridge: ${state.codeBridgeEnabled ? state.codeBridgeClis.join(", ") : "no"}`,
          "📋 Resumen final"
        );

        const confirm = await p.select({
          message: "¿Confirmar configuración?",
          options: [
            { value: "confirm", label: "✅ Confirmar", hint: "Crear agente" },
            { value: "prev", label: "⬅️ Atrás", hint: "Editar" },
            { value: "cancel", label: "❌ Cancelar", hint: "Salir" },
          ],
        });

        if (p.isCancel(confirm) || confirm === "cancel") {
          p.cancel("Onboarding cancelado.");
          process.exit(0);
        }

        if (confirm === "prev") {
          step = 7;
          break;
        }

        // ✅ Create agent in DB (FINAL STEP)
        saveAgentConfig({
          userId: state.userId,
          agentId: state.agentId,
          agentName: state.agentName,
          providerId: state.provider,
          modelId: state.model,
          tone: state.agentTone,
          description: state.agentDescription,
        });

        saveOnboardingProgress({
          step: "agent",
          userId: state.userId,
          data: { agentId: state.agentId, agentName: state.agentName },
        });

        // 📝 Guardar IDs en .env
        const envPath = path.join(hiveDir, ".env");
        let envContent = "";
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf-8");
        }

        const envVars = {
          HIVE_USER_ID: state.userId,
          HIVE_AGENT_ID: state.agentId,
        };

        let newEnvContent = envContent;
        for (const [key, value] of Object.entries(envVars)) {
          const regex = new RegExp(`^${key}=.*`, "m");
          if (regex.test(newEnvContent)) {
            newEnvContent = newEnvContent.replace(regex, `${key}=${value}`);
          } else {
            newEnvContent += `\n${key}=${value}`;
          }
        }
        fs.writeFileSync(envPath, newEnvContent.trim() + "\n");
        log.info(`IDs de identidad persistidos en ${envPath}`);

        step = TOTAL_STEPS + 1;
        break;
      }
    }
  }

  // ═══════════════════════════════════
  // FINAL: Show success message
  // ═══════════════════════════════════

  p.outro(
    `✅ ¡Configuración completada!\n\n` +
    `  🤖 Agente:   ${state.agentName}\n` +
    `  👤 Usuario:  ${state.userName}\n` +
    `  🧠 Provider: ${state.provider}/${state.model}\n` +
    `  📢 Canal:    WebChat (UI web)\n` +
    `${state.channelToken ? `  ✈️  Telegram: Configurado\n` : ''}` +
    `${state.voiceEnabled ? `  🎤 Voz:      STT (${state.sttProvider}) + TTS (${state.ttsProvider})\n` : ''}` +
    `${state.codeBridgeEnabled ? `  🔧 Code Bridge: ${state.codeBridgeClis.join(', ')}\n` : ''}` +
    `\n` +
    `🌐 ABRE TU DASHBOARD:\n` +
    `  👉 http://localhost:5173\n\n` +
    `📋 COMANDOS:\n` +
    `  hive start   → Arrancar gateway\n` +
    `  hive chat    → Chatear en terminal\n\n` +
    `💡 DESDE EL DASHBOARD puedes activar:\n` +
    `  • Canales adicionales (Discord, Slack, WhatsApp, etc.)\n` +
    `  • Voz (STT/TTS) para audio en tiempo real\n` +
    `  • Code Bridge para delegar tareas de código\n` +
    `  • MCP servers para herramientas externas\n` +
    `  • Tools y funciones personalizadas\n` +
    `\n` +
    `🎉 ¡Gracias por configurar Hive!`
  );

  // Ask if user wants to start the gateway
  const shouldStart = await p.confirm({
    message: "¿Quieres iniciar el gateway ahora?",
    initialValue: true,
  });

  if (p.isCancel(shouldStart) || !shouldStart) {
    log.info("¡Perfecto! Ejecuta 'hive start' cuando quieras iniciar.");
    return;
  }

  log.info("🚀 Iniciando Hive gateway...");
}

export async function onboard(): Promise<void> {
  const hiveDir = getHiveDir();

  // Create Hive directory if it doesn't exist
  if (!fs.existsSync(hiveDir)) {
    log.info(`📁 Creando carpeta de configuración: ${hiveDir}`);
    fs.mkdirSync(hiveDir, { recursive: true });
  }

  // Initialize DB first to check existing configuration
  initOnboardingDb();

  // Check if there's already an agent in the database
  const { getDb } = await import("../../../core/src/storage/sqlite");
  const db = getDb();
  // We look for the coordinator agent. In a personal gateway, there is usually only one.
  const existingAgent = db.query("SELECT id, name, provider_id, model_id, status FROM agents WHERE role = 'coordinator' ORDER BY created_at DESC LIMIT 1").get() as any;

  // If agent exists and is completed (status = 'idle'), don't show onboarding menu
  if (existingAgent && existingAgent.status === 'idle') {
    p.intro("✅ Configuración completada detectada");

    p.note(
      `  Agente:    ${existingAgent.name}\n` +
      `  ID:        ${existingAgent.id}\n` +
      `  Provider:  ${existingAgent.provider_id || "no configurado"}\n` +
      `  Model:     ${existingAgent.model_id || "no configurado"}\n` +
      `  Status:    idle (listo para usar)`,
      "Config actual en BD"
    );

    console.log("\n💡 Para iniciar el gateway: hive start\n");
    return;
  }

  if (existingAgent) {
    p.intro("🔍 Configuración existente detectada");

    p.note(
      `  Agente:    ${existingAgent.name}\n` +
      `  ID:        ${existingAgent.id}\n` +
      `  Provider:  ${existingAgent.provider_id || "no configurado"}\n` +
      `  Model:     ${existingAgent.model_id || "no configurado"}\n` +
      `  Status:    ${existingAgent.status}`,
      "Config actual en BD"
    );

    const action = await p.select({
      message: "¿Qué quieres hacer?",
      options: [
        { value: "update", label: "Actualizar", hint: "Modificar configuración" },
        { value: "reset", label: "Reiniciar", hint: "Borrar BD y crear desde cero" },
        { value: "cancel", label: "Cancelar", hint: "Salir sin cambios" },
      ],
    });

    if (p.isCancel(action) || action === "cancel") {
      p.cancel("Operación cancelada.");
      process.exit(0);
    }

    if (action === "reset") {
      const confirm = await p.confirm({
        message: "⚠️  Esto BORRARÁ toda la base de datos y reiniciará la configuración. ¿Continuar?",
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.cancel("Operación cancelada.");
        process.exit(0);
      }

      // Backup and delete database
      const dbPath = path.join(hiveDir, "data", "hive.db");
      if (fs.existsSync(dbPath)) {
        const backupPath = path.join(hiveDir, `hive.db.backup.${Date.now()}`);
        fs.copyFileSync(dbPath, backupPath);
        log.info(`Backup BD creado: ${backupPath}`);

        // Delete the database file
        fs.unlinkSync(dbPath);
        log.info("Base de datos eliminada");
      }

      // Reinitialize DB (creates fresh with seed)
      initOnboardingDb();

      log.success("BD reiniciada con datos del sistema");
    }

    // After reset or update, run the wizard
    await runFullWizard();
  } else {
    // No existing configuration - run full wizard
    await runFullWizard();
  }
}
