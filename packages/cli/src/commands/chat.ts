import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import * as readline from "readline";
import { loadConfig, getHiveDir } from "@johpaz/hive-core/config/loader";

const getHiveDirConst = () => getHiveDir();

export async function chat(flags: string[]): Promise<void> {
  const config = loadConfig();
  const HIVE_DIR = getHiveDirConst();

  if (!fs.existsSync(HIVE_DIR)) {
    console.log("❌ Directorio Hive no encontrado. Ejecuta: hive onboard");
    return;
  }

  const agentId = flags.find((f) => f.startsWith("--agent"))?.split("=")[1] ||
    flags[flags.indexOf("--agent") + 1] ||
    "main";

  console.log(`\n🐝 Chat con agente: ${agentId}`);
  console.log("   Escribe /exit para salir, /new para nueva sesión\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  const messages: Array<{ role: string; content: string }> = [];

  while (true) {
    const input = await question("> ");
    const trimmed = input.trim();

    if (!trimmed) continue;

    if (trimmed === "/exit" || trimmed === "/quit") {
      console.log("👋 ¡Hasta luego!");
      rl.close();
      break;
    }

    if (trimmed === "/new") {
      messages.length = 0;
      console.log("📝 Nueva sesión iniciada\n");
      continue;
    }

    if (trimmed === "/help") {
      console.log(`
Comandos disponibles:
  /exit, /quit  - Salir del chat
  /new          - Iniciar nueva sesión
  /help         - Mostrar esta ayuda
`);
      continue;
    }

    messages.push({ role: "user", content: trimmed });

    console.log("\n🤖 Pensando...\n");

    try {
      const response = await callLLM(config, messages);
      messages.push({ role: "assistant", content: response });
      console.log(`\n${response}\n`);
    } catch (error) {
      console.log(`❌ Error: ${(error as Error).message}\n`);
    }
  }
}

async function callLLM(config: any, messages: Array<{ role: string; content: string }>): Promise<string> {
  const models = config.models as Record<string, unknown> | undefined;
  const provider = models?.defaultProvider as string || "anthropic";
  const defaults = (models as any)?.defaults as Record<string, string> | undefined;
  const model = defaults?.default || (defaults as any)?.[provider] || "claude-sonnet-4-5";
  const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;
  const providerConfig = providers?.[provider] as Record<string, unknown> | undefined;

  // Try to get API key from config, then process.env
  const apiKey = (providerConfig?.apiKey as string) ||
    process.env[`${provider.toUpperCase()}_API_KEY`] ||
    "";

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
        model,
        max_tokens: 4096,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Anthropic API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = (await response.json()) as { content: Array<{ text: string }> };
    return data.content[0]?.text || "Sin respuesta";
  }

  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || "Sin respuesta";
  }

  return `Proveedor '${provider}' no soportado en modo chat CLI. Usa 'hive start' para el Gateway completo.`;
}
