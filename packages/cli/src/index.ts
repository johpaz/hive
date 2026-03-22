#!/usr/bin/env bun
import { onboard } from "./commands/onboard";
import { start, stop, status, reload } from "./commands/gateway";
import { dev } from "./commands/dev";
import { agents } from "./commands/agents";
import { mcp } from "./commands/mcp";
import { skills } from "./commands/skills";
import { config } from "./commands/config";
import { logs } from "./commands/logs";
import { chat } from "./commands/chat";
import { sessions } from "./commands/sessions";
import { cron } from "./commands/cron";
import { doctor } from "./commands/doctor";
import { securityAudit } from "./commands/security";
import { installService } from "./commands/service";
import { update } from "./commands/update";
import { message } from "./commands/message";
import { agent } from "./commands/agent-run";

const VERSION = "0.0.2";

const HELP = `
🐝 Hive — Personal Swarm AI Gateway v${VERSION}

Usage: hive <command> [subcommand] [options]

Commands:
  start [--daemon]           Arrancar el Gateway (abre setup web si es primera vez)
  dev                        Modo desarrollo con hot-reload
  stop                       Detener el Gateway
  reload                     Recargar config sin reiniciar
  status                     Estado del Gateway y agentes
  chat [--agent <id>]        Chat directo en terminal
  logs [--follow] [--level]  Ver logs del Gateway

  message send --to <id> --content <text>
                             Enviar mensaje por canal
  agent run --message <text> Ejecutar agente con mensaje

  agents add <id>            Crear nuevo agente
  agents list [--bindings]   Listar agentes
  agents remove <id>         Eliminar agente

  mcp list                   Listar servidores MCP
  mcp add                    Añadir servidor MCP
  mcp test <nombre>          Verificar servidor MCP
  mcp tools <nombre>         Listar tools de un servidor
  mcp remove <nombre>        Eliminar servidor MCP

  skills list                Listar skills instaladas
  skills search <query>      Buscar skills
  skills install <slug>      Instalar skill
  skills remove <nombre>     Eliminar skill
  skills update              Actualizar skills

  config get <key>           Leer valor de config
  config set <key> <value>   Escribir valor de config
  config show                Mostrar config completa

  sessions list              Listar sesiones
  sessions view <id>         Ver transcripción
  sessions prune             Eliminar sesiones inactivas

  cron list                  Listar cron jobs
  cron add                   Añadir cron job
  cron remove <id>           Eliminar cron job
  cron logs                  Ver logs de cron

  doctor                     Diagnóstico y auto-reparación
  security audit             Auditoría de seguridad
  install-service            Instalar servicio systemd
  update                     Actualizar Hive

Options:
  --help, -h                 Mostrar ayuda
  --version, -v              Mostrar versión

Examples:
  hive start                 Arrancar Hive (el browser se abre automáticamente)
  hive chat                  Chatear con el agente en terminal
  hive message send --to 123 --content "Hola"
  hive agent run --message "Analiza README.md" --wait
  hive agents add work       Crear agente "work"
  hive mcp add               Añadir servidor MCP
  hive doctor                Diagnosticar problemas

Documentation:
  English: https://github.com/johpaz/hive/docs
  Español: https://github.com/johpaz/hive/docs/es
`;

async function main(): Promise<void> {
  // In compiled Bun binaries, process.argv is [binaryPath, arg0, arg1, ...]
  // In dev mode (bun run script.ts), it is [bun, scriptPath, arg0, arg1, ...]
  // We detect compiled mode by checking if argv[1] looks like a command (no path separator)
  const isCompiled = !process.argv[1]?.includes("/") && !process.argv[1]?.endsWith(".ts");
  const args = process.argv.slice(isCompiled ? 1 : 2);
  const command = args[0];
  const subcommand = args[1];
  const flags = args.filter((a) => a.startsWith("--"));

  switch (command) {
    case "onboard":
      await onboard();
      break;
    case "dev":
      await dev();
      break;
    case "start":
      await start(flags);
      break;
    case "stop":
      await stop();
      break;
    case "reload":
      await reload();
      break;
    case "status":
      await status(flags);
      break;
    case "chat":
      await chat(flags);
      break;
    case "logs":
      await logs(flags);
      break;
    case "message":
      await message(subcommand, args.slice(2));
      break;
    case "agent":
      await agent(subcommand, args.slice(2));
      break;
    case "agents":
      await agents(subcommand, args.slice(2));
      break;
    case "mcp":
      await mcp(subcommand, args.slice(2));
      break;
    case "skills":
      await skills(subcommand, args.slice(2));
      break;
    case "config":
      await config(subcommand, args.slice(2));
      break;
    case "sessions":
      await sessions(subcommand, args.slice(2));
      break;
    case "cron":
      await cron(subcommand, args.slice(2));
      break;
    case "doctor":
      await doctor();
      break;
    case "security":
      if (subcommand === "audit") {
        await securityAudit();
      } else {
        console.log("Usage: hive security audit");
      }
      break;
    case "install-service":
      await installService();
      break;
    case "update":
      await update();
      break;
    case "--version":
    case "-v":
    case "version":
      console.log(`Hive v${VERSION}`);
      break;
    case "--help":
    case "-h":
    case "help":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`❌ Comando desconocido: "${command}"\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
