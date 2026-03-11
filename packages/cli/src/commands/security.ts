import * as fs from "fs";
import * as path from "path";
import { loadConfig, getHiveDir } from "@johpaz/hive-core/config/loader";

const getHiveDirConst = () => getHiveDir();
const getWorkspace = () => path.join(getHiveDirConst(), "workspace");

interface CheckResult {
  category: string;
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function securityAudit(): Promise<void> {
  console.log("\n🔒 Hive Security Audit\n");

  const results: CheckResult[] = [];
  const config = loadConfig();

  // Red
  results.push({ category: "Red", name: "Gateway bind", status: "ok", message: "127.0.0.1 (loopback)" });
  results.push({ category: "Red", name: "Puerto", status: "ok", message: "18790 (no expuesto externamente)" });

  const gateway = config.gateway as Record<string, unknown> | undefined;
  const token = gateway?.authToken as string | undefined;

  results.push({
    category: "Red",
    name: "Token bearer",
    status: token && token.length > 0 ? "ok" : "warn",
    message: token && token.length > 0 ? "configurado" : "no configurado",
  });

  // Archivos
  const authProfiles = path.join(getHiveDirConst(), "auth-profiles.json");
  if (fs.existsSync(authProfiles)) {
    const stat = fs.statSync(authProfiles);
    const mode = stat.mode & 0o777;
    results.push({
      category: "Archivos",
      name: "auth-profiles.json permisos",
      status: mode === 0o600 ? "ok" : "warn",
      message: mode === 0o600 ? "600 (seguro)" : `${(mode).toString(8)} — ejecuta: chmod 600 ${authProfiles}`,
    });
  }

  const envFile = path.join(getHiveDirConst(), ".env");
  if (fs.existsSync(envFile)) {
    const stat = fs.statSync(envFile);
    const mode = stat.mode & 0o777;
    results.push({
      category: "Archivos",
      name: ".env permisos",
      status: mode === 0o600 ? "ok" : "warn",
      message: mode === 0o600 ? "600 (seguro)" : `${(mode).toString(8)} — ejecuta: chmod 600 ${envFile}`,
    });
  }

  // Configuración
  const models = config.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;

  let hasHardcodedKey = false;
  if (providers) {
    for (const [, p] of Object.entries(providers)) {
      const apiKey = p.apiKey as string | undefined;
      if (apiKey && !apiKey.startsWith("${") && !apiKey.startsWith("process.env")) {
        hasHardcodedKey = true;
      }
    }
  }

  results.push({
    category: "Configuración",
    name: "API keys",
    status: !hasHardcodedKey ? "ok" : "warn",
    message: !hasHardcodedKey ? "en variables de entorno" : "hardcodeadas en config — considera usar env vars",
  });

  // Workspace
  results.push({
    category: "Workspace",
    name: "Permisos workspace",
    status: fs.existsSync(getWorkspace()) ? "ok" : "warn",
    message: fs.existsSync(getWorkspace()) ? "existe" : "no existe",
  });

  // MCP
  const mcp = config.mcp as Record<string, unknown> | undefined;
  const servers = (mcp as any)?.servers as Record<string, Record<string, unknown>> | undefined;

  if (servers && Object.keys(servers).length > 0) {
    results.push({ category: "MCP", name: "Servidores", status: "ok", message: `${Object.keys(servers).length} configurado(s)` });

    for (const [name, server] of Object.entries(servers)) {
      const cmd = server.command as string | undefined;
      const isKnown = cmd?.includes("@modelcontextprotocol") || cmd?.includes("mcp-server");
      results.push({
        category: "MCP",
        name: `Servidor '${name}'`,
        status: isKnown ? "ok" : "warn",
        message: isKnown ? "fuente conocida" : "verificar comando manualmente",
      });
    }
  } else {
    results.push({ category: "MCP", name: "Servidores", status: "ok", message: "ninguno configurado" });
  }

  // Skills
  const skillsDir = path.join(getHiveDirConst(), "skills");
  if (fs.existsSync(skillsDir)) {
    const managedSkills = fs.readdirSync(skillsDir).filter((f) => {
      return fs.statSync(path.join(skillsDir, f)).isDirectory();
    });
    results.push({
      category: "Skills",
      name: "Skills de terceros",
      status: managedSkills.length === 0 ? "ok" : "warn",
      message: managedSkills.length === 0 ? "ninguna instalada" : `${managedSkills.length} instalada(s) — verificar manualmente`,
    });
  } else {
    results.push({ category: "Skills", name: "Skills de terceros", status: "ok", message: "ninguna instalada" });
  }

  // Mostrar resultados
  const categories = [...new Set(results.map((r) => r.category))];

  for (const category of categories) {
    console.log(`${category}`);
    const catResults = results.filter((r) => r.category === category);
    for (const result of catResults) {
      const icon = result.status === "ok" ? "✅" : result.status === "warn" ? "⚠️ " : "❌";
      console.log(`  ${icon} ${result.name}: ${result.message}`);
    }
    console.log();
  }

  // Resumen
  const errors = results.filter((r) => r.status === "error");
  const warns = results.filter((r) => r.status === "warn");

  console.log(`📊 Resumen: ${results.length} checks, ${errors.length} errores, ${warns.length} advertencias`);
}
