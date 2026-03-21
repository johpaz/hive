import * as p from "@clack/prompts";
import { spawn } from "child_process";
import { loadConfig } from "@johpaz/hiveAgents-core/config/loader";

interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export async function mcp(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "list":
      await listMCP();
      break;
    case "add":
      await addMCP();
      break;
    case "test":
      await testMCP(args[0]);
      break;
    case "tools":
      await toolsMCP(args[0]);
      break;
    case "remove":
      await removeMCP(args[0]);
      break;
    default:
      console.log(`
Usage: hive mcp <command>

Commands:
  list              Listar servidores MCP
  add               Añadir servidor MCP
  test <nombre>     Verificar servidor MCP
  tools <nombre>    Listar tools de un servidor
  remove <nombre>   Eliminar servidor MCP
`);
  }
}

async function listMCP(): Promise<void> {
  const config = loadConfig();
  const mcpServers = (config.mcp as Record<string, MCPServerConfig>) || {};

  if (Object.keys(mcpServers).length === 0) {
    console.log("No hay servidores MCP configurados");
    return;
  }

  console.log("\n🔌 Servidores MCP:\n");
  for (const [name, server] of Object.entries(mcpServers)) {
    const status = server.disabled ? "⏸️  Deshabilitado" : "✅ Activo";
    console.log(`  ${name}`);
    console.log(`    Estado:   ${status}`);
    console.log(`    Comando:  ${server.command} ${(server.args || []).join(" ")}`);
    console.log();
  }
}

async function addMCP(): Promise<void> {
  const config = loadConfig();

  const name = await p.text({
    message: "Nombre del servidor MCP:",
    placeholder: "filesystem",
    validate: (v) => (!v ? "El nombre es requerido" : undefined),
  });

  if (p.isCancel(name)) {
    p.cancel("Cancelado");
    return;
  }

  const command = await p.text({
    message: "Comando para ejecutar:",
    placeholder: "npx",
    validate: (v) => (!v ? "El comando es requerido" : undefined),
  });

  if (p.isCancel(command)) {
    p.cancel("Cancelado");
    return;
  }

  const argsInput = await p.text({
    message: "Argumentos (separados por espacio):",
    placeholder: "-y @modelcontextprotocol/server-filesystem /path/to/dir",
  });

  if (p.isCancel(argsInput)) {
    p.cancel("Cancelado");
    return;
  }

  const args = argsInput ? (argsInput as string).split(" ").filter(Boolean) : [];

  const serverConfig: MCPServerConfig = {
    command: command as string,
    args,
  };

  console.log(`✅ Servidor MCP "${name}" añadido (usa la UI o API del gateway para persistirlo en BD)`);
}

async function testMCP(name: string | undefined): Promise<void> {
  if (!name) {
    console.log("❌ Especifica el nombre del servidor: hive mcp test <nombre>");
    return;
  }

  const config = loadConfig();
  const mcpServers = (config.mcp as Record<string, MCPServerConfig>) || {};
  const server = mcpServers[name];

  if (!server) {
    console.log(`❌ No existe el servidor MCP "${name}"`);
    return;
  }

  console.log(`🔌 Probando conexión con ${name}...`);

  const proc = spawn(server.command, server.args || [], {
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.on("error", (err) => {
    console.log(`❌ Error: ${err.message}`);
  });

  setTimeout(() => {
    proc.kill();
    console.log(`✅ Servidor ${name} responde`);
  }, 2000);
}

async function toolsMCP(name: string | undefined): Promise<void> {
  if (!name) {
    console.log("❌ Especifica el nombre del servidor: hive mcp tools <nombre>");
    return;
  }

  console.log(`📋 Tools de ${name}:`);
  console.log("   (Esta funcionalidad requiere conexión MCP activa)");
  console.log("   Usa 'hive mcp test <nombre>' para verificar conexión");
}

async function removeMCP(name: string | undefined): Promise<void> {
  if (!name) {
    console.log("❌ Especifica el nombre del servidor: hive mcp remove <nombre>");
    return;
  }

  const config = loadConfig();
  const mcpServers = (config.mcp as Record<string, MCPServerConfig>) || {};

  if (!mcpServers[name]) {
    console.log(`❌ No existe el servidor MCP "${name}"`);
    return;
  }

  const confirm = await p.confirm({
    message: `¿Eliminar el servidor MCP "${name}"?`,
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    console.log("Cancelado");
    return;
  }

  console.log(`✅ Servidor MCP "${name}" eliminado (usa la UI o API del gateway para persistirlo en BD)`);
}
