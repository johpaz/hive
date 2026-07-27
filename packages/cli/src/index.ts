#!/usr/bin/env bun
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
import { causal } from "./commands/causal";
import { doctor } from "./commands/doctor";
import { securityAudit } from "./commands/security";
import { installService } from "./commands/service";
import { update } from "./commands/update";
import { message } from "./commands/message";
import { agent } from "./commands/agent-run";
import { migrate } from "./commands/migrate";
import pkg from "../../../package.json";

const VERSION = pkg.version;

const HELP = `
🐝 Hive — Personal Swarm AI Gateway v${VERSION}

Usage: hive <command> [subcommand] [options]

Gateway:
  start [--daemon]           Arrancar el Gateway (abre setup web si es primera vez)
  dev                        Modo desarrollo con hot-reload (usa ~/.hive-dev)
  stop                       Detener el Gateway
  reload                     Recargar config sin reiniciar
  status                     Estado del Gateway y agentes

Chat y mensajes:
  chat [--agent <id>]        Chat directo en terminal
  logs [--follow] [--level]  Ver logs del Gateway en tiempo real
  message send --to <id> --content <text>
                             Enviar mensaje por canal
  agent run --message <text> [--wait]
                             Ejecutar agente con mensaje

Agentes:
  agents list [--bindings]   Listar agentes activos e hibernados
  agents create              Crear agente con asistente interactivo
  agents add <id>            Crear agente (forma rápida)
  agents remove <id>         Eliminar agente
  agents logs <agent-id>     Ver logs de un agente específico
  agents hibernate <id>      Poner agente en sleep (conserva contexto)
  agents wake <id>           Despertar agente hibernado
  agents terminate <id>      Terminar agente permanentemente
  agents tree                Mostrar árbol jerárquico de agentes

MCP:
  mcp list                   Listar servidores MCP conectados
  mcp add                    Añadir servidor MCP (asistente interactivo)
  mcp test <nombre>          Verificar conectividad de un servidor MCP
  mcp tools <nombre>         Listar tools disponibles en un servidor
  mcp remove <nombre>        Eliminar servidor MCP

Skills:
  skills list                Listar skills instaladas
  skills search <query>      Buscar skills en el catálogo
  skills install <slug>      Instalar skill
  skills remove <nombre>     Eliminar skill
  skills update              Actualizar todas las skills

Configuración:
  config show                Mostrar config completa
  config edit                Mostrar mecanismos de configuración admitidos

Sesiones y cron:
  sessions list              Listar sesiones de conversación
  sessions view <id>         Ver transcripción de una sesión
  sessions prune             Eliminar sesiones inactivas
  cron list                  Listar tareas programadas
  cron add                   Añadir tarea programada
  cron pause <id|name>       Pausar una tarea programada
  cron resume <id|name>      Reanudar una tarea programada
  cron delete <id|name>      Eliminar una tarea programada
  cron trigger <id|name>     Ejecutar una tarea ahora
  cron history <id|name>     Ver historial de ejecuciones
  cron status                Estado del scheduler
  causal watch [--agent <id>] [--stream <id>]
                             Live-tail del event log causal G9 (sin replay histórico)

Sistema:
  doctor                     Diagnóstico completo y auto-reparación
  update                     Actualizar Hive a la última versión
  migrate                    Migrar schema y datos de la BD existente
  security audit             Auditoría de seguridad del entorno
  install-service            Instalar servicio systemd (Linux)

Options:
  --help, -h                 Mostrar esta ayuda
  --version, -v              Mostrar versión

Examples:
  hive start                 Arrancar Hive (el browser se abre automáticamente,
                             y abre el asistente de configuración si es la primera vez)
  hive chat                  Chatear con el agente en terminal
  hive message send --to 123 --content "Hola"
  hive agent run --message "Analiza README.md" --wait
  hive agents create         Crear nuevo agente con asistente
  hive mcp add               Añadir servidor MCP
  hive doctor                Diagnosticar problemas del sistema
  hive update                Actualizar a la última versión
`;

async function main(): Promise<void> {
  // In compiled Bun binaries, process.argv is [binaryPath, arg0, arg1, ...]
  // In dev mode (bun run script.ts), it is [bun, scriptPath, arg0, arg1, ...]
  // We detect dev mode by checking if argv[1] ends with .ts
  const isDev = process.argv[1]?.endsWith(".ts");
  // Skip bun executable and script path in dev mode
  const args = process.argv.slice(isDev ? 2 : 1);
  // Skip script path in compiled mode (first arg is the script/binary path)
  const normalizedArgs = args[0]?.includes("\\") || args[0]?.includes("/") ? args.slice(1) : args;
  const command = normalizedArgs[0];
  const subcommand = normalizedArgs[1];
  const flags = normalizedArgs.filter((a) => a.startsWith("--"));

  switch (command) {
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
    case "causal":
      await causal(subcommand, args.slice(2));
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
    case "migrate":
      await migrate();
      break;
    case "--version":
    case "-v":
    case "version":
      console.log(`Hive v${VERSION}`);
      process.exit(0);
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
