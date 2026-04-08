import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { loadConfig, getHiveDir } from "@johpaz/hive-agents-core/config/loader";
import {
  detectAdapter,
  detectAllAdapters,
  INSTALLATION_TYPE_NAMES,
  type InstallationAdapter,
} from "../adapters";

const getHiveDirConst = () => getHiveDir();
const getPidFile = () => {
  const config = loadConfig();
  return config.gateway?.pidFile ?? path.join(getHiveDirConst(), "gateway.pid");
};
const getDbFile = () => path.join(getHiveDirConst(), "data", "hive.db");

function checkBun(): { ok: boolean; version: string } {
  try {
    const version = execSync("bun --version", { encoding: "utf-8" }).trim();
    return { ok: true, version };
  } catch {
    return { ok: false, version: "no instalado" };
  }
}

function checkNode(): { ok: boolean; version: string } {
  try {
    const version = execSync("node --version", { encoding: "utf-8" }).trim();
    return { ok: true, version };
  } catch {
    return { ok: false, version: "no instalado" };
  }
}

function isGatewayRunning(): boolean {
  if (!fs.existsSync(getPidFile())) return false;
  const pid = parseInt(fs.readFileSync(getPidFile(), "utf-8").trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function doctor(): Promise<void> {
  console.log("\n🐝 Hive Doctor — Diagnóstico del sistema\n");

  const checks: Array<{ category: string; name: string; status: "ok" | "warn" | "error"; message: string; hint?: string }> = [];

  // Installation Adapter Detection
  let detectedAdapter: InstallationAdapter | null = null;
  let adapterValidation: { errors: string[]; warnings: string[]; info: string[] } | null = null;
  
  try {
    detectedAdapter = await detectAdapter({ verbose: false });
    const validation = await detectedAdapter.validate();
    adapterValidation = validation;
    
    checks.push({
      category: "Installation",
      name: "Tipo detectado",
      status: "ok",
      message: `${detectedAdapter.name} (${detectedAdapter.type})`,
    });

    // Add adapter-specific info
    for (const infoMsg of validation.info) {
      checks.push({
        category: "Installation",
        name: "Info",
        status: "ok",
        message: infoMsg,
      });
    }

    // Add adapter warnings
    for (const warnMsg of validation.warnings) {
      checks.push({
        category: "Installation",
        name: "Warning",
        status: "warn",
        message: warnMsg,
      });
    }

    // Add adapter errors
    for (const errMsg of validation.errors) {
      checks.push({
        category: "Installation",
        name: "Error",
        status: "error",
        message: errMsg,
        hint: "Verifica la instalación o ejecuta hive update",
      });
    }
  } catch (error) {
    checks.push({
      category: "Installation",
      name: "Detección",
      status: "warn",
      message: `No se pudo detectar el adapter: ${(error as Error).message}`,
    });
  }

  // Check for multiple installations
  try {
    const allAdapters = await detectAllAdapters();
    if (allAdapters.length > 1) {
      const installationNames = allAdapters.map((a) => a.name).join(", ");
      checks.push({
        category: "Installation",
        name: "Múltiples instalaciones",
        status: "warn",
        message: `${allAdapters.length} métodos detectados: ${installationNames}`,
        hint: "Esto puede causar conflictos. Considera usar solo uno.",
      });
    }
  } catch {
    // Ignore multiple detection errors
  }

  // Runtime
  const bun = checkBun();
  checks.push({ category: "Runtime", name: "Bun", status: bun.ok ? "ok" : "error", message: `v${bun.version}` });

  const node = checkNode();
  checks.push({ category: "Runtime", name: "Node.js", status: node.ok ? "ok" : "warn", message: `${node.version} (para MCP servers)` });

  // Directorio Base
  if (fs.existsSync(getHiveDirConst())) {
    checks.push({ category: "Sistema", name: "Directorio Hive", status: "ok", message: getHiveDirConst() });
  } else {
    checks.push({ category: "Sistema", name: "Directorio Hive", status: "error", message: "no existe", hint: "Ejecuta 'hive onboard'" });
  }

  // Base de Datos
  if (fs.existsSync(getDbFile())) {
    checks.push({ category: "Sistema", name: "Base de Datos", status: "ok", message: "hive.db presente" });
  } else {
    checks.push({ category: "Sistema", name: "Base de Datos", status: "warn", message: "hive.db no existe" });
  }

  // Configuración (In-memory/Env)
  try {
    const config = loadConfig();
    const gateway = config.gateway;
    if (gateway) {
      checks.push({ category: "Configuración", name: "Gateway Config", status: "ok", message: "cargada" });
    } else {
      checks.push({ category: "Configuración", name: "Gateway Config", status: "warn", message: "usando valores por defecto" });
    }

    const models = config.models;
    const provider = models?.defaultProvider;
    if (provider) {
      checks.push({ category: "Configuración", name: "Proveedor LLM", status: "ok", message: provider });
    } else {
      checks.push({ category: "Configuración", name: "Proveedor LLM", status: "warn", message: "no configurado" });
    }
  } catch (e) {
    checks.push({ category: "Configuración", name: "Carga", status: "error", message: `Error: ${(e as Error).message}` });
  }

  // Workspace — leer desde agents.workspace en la BD
  let workspacePath: string | null = null;
  try {
    const { initializeDatabase, dbService } = await import("@johpaz/hive-agents-core/storage/sqlite");
    initializeDatabase();
    workspacePath = dbService.getActiveAgentWorkspace();
  } catch { /* BD no disponible aún */ }

  if (!workspacePath) {
    checks.push({ category: "Workspace", name: "Directorio", status: "warn", message: "no configurado (BD no disponible o sin agente activo)" });
  } else if (!fs.existsSync(workspacePath)) {
    checks.push({ category: "Workspace", name: "Directorio", status: "warn", message: `${workspacePath} — no existe en disco` });
  } else {
    checks.push({ category: "Workspace", name: "Directorio", status: "ok", message: workspacePath });
  }

  // Seed Data — verificar que los datos del seed estén actualizados
  try {
    const { initializeDatabase, getDb } = await import("@johpaz/hive-agents-core/storage/sqlite");
    initializeDatabase();
    const db = getDb();
    const { SEED_DATA } = await import("@johpaz/hive-agents-core/storage/seed");

    // Tools: comparar count en BD vs seed
    const toolsInDb = (db.query("SELECT COUNT(*) as n FROM tools").get() as { n: number })?.n ?? 0;
    const toolsInSeed = SEED_DATA.tools.length;
    if (toolsInDb < toolsInSeed) {
      checks.push({
        category: "Seed Data",
        name: "Tools",
        status: "warn",
        message: `${toolsInDb}/${toolsInSeed} tools — faltan ${toolsInSeed - toolsInDb}`,
        hint: "Ejecuta 'hive update' o 'hive migrate' para actualizar",
      });
    } else {
      checks.push({
        category: "Seed Data",
        name: "Tools",
        status: "ok",
        message: `${toolsInDb} tools sincronizadas`,
      });
    }

    // Models: comparar count en BD vs seed
    const modelsInDb = (db.query("SELECT COUNT(*) as n FROM models").get() as { n: number })?.n ?? 0;
    const modelsInSeed = SEED_DATA.models.length;
    if (modelsInDb < modelsInSeed) {
      checks.push({
        category: "Seed Data",
        name: "Models",
        status: "warn",
        message: `${modelsInDb}/${modelsInSeed} models — faltan ${modelsInSeed - modelsInDb}`,
        hint: "Ejecuta 'hive update' o 'hive migrate' para actualizar",
      });
    } else {
      checks.push({
        category: "Seed Data",
        name: "Models",
        status: "ok",
        message: `${modelsInDb} models sincronizados`,
      });
    }

    // Providers: comparar count en BD vs seed
    const providersInDb = (db.query("SELECT COUNT(*) as n FROM providers").get() as { n: number })?.n ?? 0;
    const providersInSeed = SEED_DATA.providers.length;
    if (providersInDb < providersInSeed) {
      checks.push({
        category: "Seed Data",
        name: "Providers",
        status: "warn",
        message: `${providersInDb}/${providersInSeed} providers — faltan ${providersInSeed - providersInDb}`,
        hint: "Ejecuta 'hive update' o 'hive migrate' para actualizar",
      });
    } else {
      checks.push({
        category: "Seed Data",
        name: "Providers",
        status: "ok",
        message: `${providersInSeed} providers sincronizados`,
      });
    }

    // Skills: comparar count en BD
    const skillsInDb = (db.query("SELECT COUNT(*) as n FROM skills").get() as { n: number })?.n ?? 0;
    if (skillsInDb === 0) {
      checks.push({
        category: "Seed Data",
        name: "Skills",
        status: "warn",
        message: "0 skills en BD",
        hint: "Ejecuta 'hive update' o 'hive migrate' para cargar skills",
      });
    } else {
      checks.push({
        category: "Seed Data",
        name: "Skills",
        status: "ok",
        message: `${skillsInDb} skills en BD`,
      });
    }
  } catch {
    checks.push({
      category: "Seed Data",
      name: "Verificación",
      status: "warn",
      message: "No se pudo verificar (BD no disponible)",
    });
  }

  // Gateway
  const running = isGatewayRunning();
  checks.push({ category: "Gateway", name: "Estado", status: running ? "ok" : "warn", message: running ? "corriendo" : "detenido" });

  // HiveLearn — verificar tablas y Ollama
  try {
    const { getDb } = await import("@johpaz/hive-agents-core/storage/sqlite");
    const db = getDb();

    // Verificar si el schema de HiveLearn está aplicado
    const hlTables = ["hl_topics", "hl_sessions", "hl_student_profiles"];
    const missingTables: string[] = [];
    for (const table of hlTables) {
      const exists = db.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(table);
      if (!exists) missingTables.push(table);
    }

    if (missingTables.length === 0) {
      // Contar temas cargados
      const topicsRow = db.query("SELECT COUNT(*) as n FROM hl_topics").get() as { n: number } | null;
      const nTopics = topicsRow?.n ?? 0;
      checks.push({
        category: "HiveLearn",
        name: "Schema",
        status: "ok",
        message: `tablas presentes, ${nTopics} temas en catálogo`,
      });
    } else {
      checks.push({
        category: "HiveLearn",
        name: "Schema",
        status: "warn",
        message: `tablas faltantes: ${missingTables.join(", ")}`,
        hint: "El schema se aplica al arrancar el gateway. Ejecuta 'hive start' una vez.",
      });
    }
  } catch {
    checks.push({
      category: "HiveLearn",
      name: "Schema",
      status: "warn",
      message: "No se pudo verificar (BD no disponible)",
    });
  }

  // HiveLearn — verificar Ollama
  const ollamaUrl = process.env.HIVELEARN_OLLAMA_URL ?? "http://localhost:11434";
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = (await res.json()) as { models?: { name: string }[] };
      const modelTarget = (process.env.HIVELEARN_MODEL ?? "gemma4:2b").split(":")[0];
      const found = (data.models ?? []).some((m) => m.name.startsWith(modelTarget));
      if (found) {
        checks.push({
          category: "HiveLearn",
          name: "Ollama",
          status: "ok",
          message: `disponible en ${ollamaUrl} — modelo ${process.env.HIVELEARN_MODEL ?? "gemma4:2b"} encontrado`,
        });
      } else {
        checks.push({
          category: "HiveLearn",
          name: "Ollama",
          status: "warn",
          message: `Ollama disponible pero modelo no encontrado`,
          hint: `Ejecuta: ollama pull ${process.env.HIVELEARN_MODEL ?? "gemma4:2b"}`,
        });
      }
    } else {
      checks.push({
        category: "HiveLearn",
        name: "Ollama",
        status: "warn",
        message: `Ollama no responde correctamente en ${ollamaUrl}`,
        hint: "HiveLearn estará desactivado. Instala Ollama y configura HIVELEARN_OLLAMA_URL",
      });
    }
  } catch {
    checks.push({
      category: "HiveLearn",
      name: "Ollama",
      status: "warn",
      message: `Ollama no disponible en ${ollamaUrl}`,
      hint: "HiveLearn estará desactivado. Instala Ollama o configura HIVELEARN_OLLAMA_URL",
    });
  }

  // Mostrar resultados
  const categories = [...new Set(checks.map((c) => c.category))];

  for (const category of categories) {
    console.log(`${category}`);
    const categoryChecks = checks.filter((c) => c.category === category);
    for (const check of categoryChecks) {
      const icon = check.status === "ok" ? "✅" : check.status === "warn" ? "⚠️ " : "❌";
      console.log(`  ${icon} ${check.name}: ${check.message}`);
      if (check.hint) {
        console.log(`     💡 ${check.hint}`);
      }
    }
    console.log();
  }

  // Resumen
  const errors = checks.filter((c) => c.status === "error");
  const warns = checks.filter((c) => c.status === "warn");

  if (errors.length > 0) {
    console.log(`❌ ${errors.length} error(es) encontrado(s)`);

    const fix = await p.confirm({
      message: "¿Deseas ejecutar el onboarding para reparar?",
      initialValue: false,
    });

    if (fix) {
      const { onboard } = await import("./onboard");
      await onboard();
    }
  } else if (warns.length > 0) {
    console.log(`⚠️  ${warns.length} advertencia(s)`);
  } else {
    console.log("✅ Todo en orden");
  }
}
