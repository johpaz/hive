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
const getDbFile = () => path.join(getHiveDirConst(), "data", "hivedb");

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

/** Tamaño total de un directorio, recursivo. */
function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
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
    checks.push({ category: "Sistema", name: "Directorio Hive", status: "error", message: "no existe", hint: "Ejecuta 'hive start' — abre el asistente de configuración si es la primera vez" });
  }

  // Base de Datos
  if (fs.existsSync(getDbFile())) {
    checks.push({ category: "Sistema", name: "Base de Datos", status: "ok", message: "hivedb presente" });
  } else {
    checks.push({ category: "Sistema", name: "Base de Datos", status: "warn", message: "hivedb no existe" });
  }

  // Integridad de la BD — HiveDB es un directorio con varios componentes que
  // tienen que estar los cuatro: el store de documentos, el índice de texto, el
  // vectorial y el meta. Que falte uno no impide abrir la base, pero deja
  // búsquedas mudas en vez de errores, que es peor.
  if (fs.existsSync(getDbFile())) {
    const componentes = ["collections.redb", "meta.json", "fts", "vec"];
    const faltantes = componentes.filter((c) => !fs.existsSync(path.join(getDbFile(), c)));

    if (faltantes.length > 0) {
      checks.push({
        category: "Integridad",
        name: "Componentes",
        status: "error",
        message: `faltan: ${faltantes.join(", ")}`,
        hint: "La base está incompleta. Restaurá una copia o reiniciá para re-sembrar.",
      });
    } else {
      const bytes = dirSize(getDbFile());
      checks.push({
        category: "Integridad",
        name: "Componentes",
        status: "ok",
        message: `${componentes.length}/4 presentes — ${(bytes / 1024 / 1024).toFixed(1)} MB`,
      });
    }

    // Lectura real: que los archivos existan no prueba que se puedan leer.
    try {
      const { ensureHiveDb } = await import("@johpaz/hive-agents-core/storage/bootstrap");
      const { col } = await import("@johpaz/hive-agents-core/storage/hive");
      await ensureHiveDb();

      let filas = 0;
      for (const nombre of ["agents", "models", "providers", "tools", "skills"]) {
        filas += await (await col(nombre)).count();
      }
      checks.push({
        category: "Integridad",
        name: "Lectura",
        status: "ok",
        message: `${filas} filas leídas de 5 colecciones`,
      });
    } catch (e) {
      const mensaje = (e as Error).message;
      // "Cannot acquire lock" significa que otro proceso la tiene abierta —el
      // gateway, o un `bun -e` que quedó colgado—, no que esté rota. Tratarlo
      // como corrupción manda a restaurar un backup sin motivo.
      const enUso = /already open|acquire lock|locked/i.test(mensaje);
      checks.push({
        category: "Integridad",
        name: "Lectura",
        status: enUso ? "warn" : "error",
        message: enUso ? "en uso por otro proceso — no se pudo verificar" : `la base no se pudo leer: ${mensaje}`,
        hint: enUso
          ? "Detené el gateway (hive stop) y volvé a correr el diagnóstico."
          : "Puede haber quedado corrupta. Si tenés una copia de <HIVE_HOME>/data, restaurala.",
      });
    }

    // No hay backup automático: hive-db 0.3.1 no expone snapshot ni checkpoint,
    // y copiar el directorio con el gateway corriendo puede dar una copia
    // desgarrada entre collections.redb y los índices. Mejor decirlo que
    // simularlo.
    checks.push({
      category: "Integridad",
      name: "Backup",
      status: "warn",
      message: "sin copia automática",
      hint: `Con el gateway detenido: cp -r "${getDbFile()}" "${getDbFile()}.bak"`,
    });
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
    const { ensureHiveDb } = await import("@johpaz/hive-agents-core/storage/bootstrap");
    const { col } = await import("@johpaz/hive-agents-core/storage/hive");
    await ensureHiveDb();
    const agentsCol = await col<{ role: string; workspace: string | null }>("agents");
    const coordinator = (await agentsCol.findBy("role", "coordinator"))[0];
    const ws = coordinator?.doc.workspace;
    workspacePath = ws && ws !== "null" ? ws : null;
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
    const { ensureHiveDb } = await import("@johpaz/hive-agents-core/storage/bootstrap");
    const { col } = await import("@johpaz/hive-agents-core/storage/hive");
    await ensureHiveDb();
    const { SEED_DATA } = await import("@johpaz/hive-agents-core/storage/seed");

    // Tools: comparar count en BD vs seed
    const toolsInDb = await (await col("tools")).count();
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
    const modelsInDb = await (await col("models")).count();
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
    const providersInDb = await (await col("providers")).count();
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
    const skillsInDb = await (await col("skills")).count();
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

  // Agentes — propuestas pendientes del curador ACE (agentProposals). El
  // curador nunca deshabilita un agente de catálogo por su cuenta: cuando
  // harmful_count supera a helpful_count, deja una propuesta "disable_agent"
  // para que una persona decida. Nada la resuelve automáticamente, así que
  // se acumulan hasta que alguien las revisa — doctor las saca a la luz.
  try {
    const { ensureHiveDb } = await import("@johpaz/hive-agents-core/storage/bootstrap");
    const { col } = await import("@johpaz/hive-agents-core/storage/hive");
    await ensureHiveDb();

    const proposalsCol = await col<{ status: string; type: string; agent_id: string }>("agentProposals");
    const pending = (await proposalsCol.scan({})).filter(
      (entry) => entry.doc.status === "proposed" && entry.doc.type === "disable_agent"
    );

    if (pending.length > 0) {
      const agentsCol = await col<{ name: string }>("agents");
      const names = await Promise.all(
        pending.map(async (entry) => (await agentsCol.get(entry.doc.agent_id))?.doc.name ?? entry.doc.agent_id)
      );
      checks.push({
        category: "Agentes",
        name: "Propuestas del curador",
        status: "warn",
        message: `${pending.length} agente(s) marcado(s) para revisión: ${names.join(", ")}`,
        hint: "Revisá el panel 'Salud del Enjambre' en el Dashboard — no hay todavía un comando para aprobar/descartar propuestas.",
      });
    } else {
      checks.push({
        category: "Agentes",
        name: "Propuestas del curador",
        status: "ok",
        message: "sin propuestas pendientes",
      });
    }
  } catch {
    checks.push({
      category: "Agentes",
      name: "Propuestas del curador",
      status: "warn",
      message: "No se pudo verificar (BD no disponible)",
    });
  }

  // Navegador — qué backend va a usar el agente y si el elegido es viable acá.
  try {
    const { resolveBackendKind, isWebViewSupported, findChrome } = await import(
      "@johpaz/hive-agents-core/tools/web/browser-backend"
    );
    const config = loadConfig();
    const kind = resolveBackendKind(config.tools?.browser?.backend);

    if (kind === "webview" && !isWebViewSupported()) {
      checks.push({
        category: "Navegador",
        name: "Backend",
        status: "error",
        message: "webview elegido pero no hay motor disponible",
        hint: "WebKit sólo existe en macOS. Instalá Chrome, definí BUN_CHROME_PATH, o usá el backend agent-browser.",
      });
    } else {
      const detalle = kind === "webview" ? `motor ${findChrome() ? "chrome" : "webkit"}, in-process` : "Chrome via CLI";
      checks.push({ category: "Navegador", name: "Backend", status: "ok", message: `${kind} (${detalle})` });
    }
  } catch (e) {
    checks.push({
      category: "Navegador",
      name: "Backend",
      status: "warn",
      message: `no se pudo determinar: ${(e as Error).message}`,
    });
  }

  // Gateway
  const running = isGatewayRunning();
  checks.push({ category: "Gateway", name: "Estado", status: running ? "ok" : "warn", message: running ? "corriendo" : "detenido" });

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
