/**
 * Gateway Command - Refactored with Installation Adapters
 * 
 * Manages the Hive Gateway lifecycle using the installation adapter system.
 * Each installation method (Docker, Bun Global, Binary, etc.) is handled
 * by its specific adapter, providing clean separation of concerns.
 */

import { loadConfig, startGateway, logger, getHiveDir, initializeDatabase } from "@johpaz/hive-agents-core";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync } from "node:fs";
import * as path from "node:path";
import { spawn, ChildProcess } from "child_process";
import { embeddedUI } from "../ui-bundle.generated";

// Import adapter system
import {
  detectAdapter,
  DockerAdapter,
  BunGlobalAdapter,
  BinaryAdapter,
  type InstallationAdapter,
  type GatewayConfig,
  DEFAULT_GATEWAY_CONFIG,
  PORTS,
  getHiveDir as getAdapterHiveDir,
  findFreePort,
  waitForHttpPort,
  isDevMode,
  isChildProcess,
  getDistDir,
} from "../adapters";

const children: ChildProcess[] = [];

/**
 * Get the active installation adapter
 * Cached to avoid repeated detection
 */
let _adapter: InstallationAdapter | null = null;

async function getAdapter(): Promise<InstallationAdapter> {
  if (!_adapter) {
    _adapter = await detectAdapter({ verbose: false });
  }
  return _adapter;
}

/**
 * Reset the cached adapter (for testing or forced re-detection)
 */
export function resetAdapter(): void {
  _adapter = null;
}

/**
 * Start UI server with embedded or filesystem assets
 */
function startUIServer(
  uiDir: string | null,
  gatewayPort: number,
  uiPort: number
): void {
  const configScript = `<script>window.__HIVE_CONFIG__={"apiUrl":"http://localhost:${gatewayPort}","wsUrl":"ws://localhost:${gatewayPort}"}</script>`;
  const useEmbedded = embeddedUI.size > 0;

  Bun.serve({
    hostname: "0.0.0.0",
    port: uiPort,
    async fetch(req) {
      const url = new URL(req.url);
      let subPath = url.pathname === "/" ? "/index.html" : url.pathname;
      // SPA fallback: rutas sin extensión → index.html
      if (!path.extname(subPath)) subPath = "/index.html";

      if (useEmbedded) {
        const isIndex = subPath === "/index.html" || !embeddedUI.has(subPath);
        const entry = embeddedUI.get(subPath) ?? embeddedUI.get("/index.html")!;
        if (isIndex) {
          const html = entry.data.toString("utf8").replace("</head>", `${configScript}</head>`);
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        // Convert Buffer to Uint8Array for Response
        return new Response(entry.data as unknown as Uint8Array, { headers: { "Content-Type": entry.mime } });
      }

      // Filesystem path (npm / Docker)
      const filePath = path.join(uiDir!, subPath);
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        const index = Bun.file(path.join(uiDir!, "index.html"));
        if (await index.exists()) {
          const html = (await index.text()).replace("</head>", `${configScript}</head>`);
          return new Response(html, { headers: { "Content-Type": "text/html" } });
        }
        return new Response("Not found", { status: 404 });
      }
      if (subPath === "/index.html") {
        const html = (await file.text()).replace("</head>", `${configScript}</head>`);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }
      return new Response(file);
    },
  });
}

/**
 * Cleanup child processes on exit
 */
function cleanup() {
  if (children.length === 0) return;
  console.log("\n🧹 Limpiando procesos hijos...");
  for (const child of children) {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
}

// Signal handlers
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

process.on("exit", () => {
  cleanup();
});

/**
 * Get default PID file path
 */
function getDefaultPidFile(): string {
  return path.join(getHiveDir(), "gateway.pid");
}

/**
 * Get log file path
 */
function getLogFile(): string {
  return path.join(getHiveDir(), "logs", "gateway.log");
}

/**
 * Get PID file path from config or default
 */
async function getPidFile(): Promise<string> {
  try {
    const config = await loadConfig();
    return config.gateway?.pidFile || getDefaultPidFile();
  } catch {
    return getDefaultPidFile();
  }
}

/**
 * Ensure log directory exists
 */
function ensureLogDir(): void {
  const logDir = path.dirname(getLogFile());
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Open browser based on platform
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  let shellCmd: string;

  if (platform === "win32") {
    shellCmd = `start "" "${url}"`;
  } else if (platform === "darwin") {
    shellCmd = `open "${url}"`;
  } else {
    shellCmd = `gio open "${url}" 2>/dev/null || xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || x-www-browser "${url}" 2>/dev/null || true`;
  }

  console.log(`🌐 Abriendo navegador en ${url}`);

  try {
    const shell = platform === "win32" ? "cmd" : "/bin/sh";
    const shellArg = platform === "win32" ? "/c" : "-c";
    const proc = Bun.spawn([shell, shellArg, shellCmd], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref();
  } catch {
    console.log(`\n🌐 Abre Hive aquí: ${url}\n`);
  }
}

/**
 * Check if setup mode is needed
 */
async function isSetupMode(): Promise<boolean> {
  const hiveDir = getHiveDir();
  const dbPath = path.join(hiveDir, "data", "hive.db");
  return !existsSync(dbPath);
}

/**
 * Check if gateway is running using the adapter
 */
async function isRunning(): Promise<boolean> {
  try {
    // Try adapter first
    const adapter = await getAdapter();
    const adapterRunning = await adapter.isRunning();
    if (adapterRunning) {
      return true;
    }
  } catch {
    // Adapter check failed, fall through to PID check
  }

  // Fallback to PID file check
  const pidFile = await getPidFile();
  if (!existsSync(pidFile)) return false;

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  if (isNaN(pid)) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    try {
      unlinkSync(pidFile);
    } catch { }
    return false;
  }
}

/**
 * Wait for gateway port to be ready
 */
async function waitForPort(port: number, timeout: number = 30000): Promise<boolean> {
  return waitForHttpPort(port, "/health", timeout);
}

/**
 * Wait for Vite dev server
 */
async function waitForVite(port: number, timeout: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(200),
      });
      if (response.ok || response.status === 200) {
        return true;
      }
    } catch {
      // Port not ready yet
    }
    await Bun.sleep(200);
  }
  return false;
}

/**
 * Start command - main entry point
 */
export async function start(flags: string[]): Promise<void> {
  const daemon = flags.includes("--daemon");
  const skipCheck = flags.includes("--skip-check");
  const devInternal = flags.includes("--dev-internal");

  const isDev = isDevMode();
  const isChild = isChildProcess();

  // Detect and set adapter
  const adapter = await getAdapter();
  const config = await adapter.getConfig();

  // Skip onboarding check if running as child process
  const isGatewayChild = process.env.HIVE_GATEWAY_CHILD === "1";

  if (!skipCheck && await isRunning()) {
    console.log("⚠️  Hive Gateway ya está corriendo");
    return;
  }

  // Load core config for logger settings
  try {
    const coreConfig = await loadConfig();
    if (coreConfig.logging?.level) {
      logger.setLevel(coreConfig.logging.level);
    }
  } catch {
    // Use default logger settings
  }

  // Show banner only if not running as child process
  if (!isGatewayChild) {
    console.log(`
 ╔═══════════════════════════════════════════╗
 ║                                            ║
 ║   ██╗  ██╗██╗██╗   ██╗███████╗             ║
 ║   ██║  ██║██║██║   ██║██╔════╝             ║
 ║   ███████║██║██║   ██║█████╗               ║
 ║   ██╔══██║██║╚██╗ ██╔╝██╔══╝               ║
 ║   ██║  ██║██║ ╚████╔╝ ███████╗             ║
 ║   ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝             ║
 ║                                            ║
 ║   Personal Swarm AI Gateway — v0.0.19       ║
 ╚════════════════════════════════════════════╝

📦 Installation: ${adapter.name}
`);
  }

  // Handle daemon mode
  if (daemon) {
    ensureLogDir();
    const logFile = getLogFile();
    const child = spawn(process.execPath, [process.argv[1] || "", "start", "--skip-check"], {
      detached: true,
      stdio: ["ignore", openSync(logFile, "a"), openSync(logFile, "a")],
      env: { ...process.env, HIVE_GATEWAY_CHILD: "1" },
    });
    child.unref();
    writeFileSync(await getPidFile(), child.pid?.toString() || "");
    console.log(`✅ Hive Gateway iniciado en modo daemon (PID: ${child.pid})`);
    console.log(`   Logs: ${logFile}`);
    return;
  }

  // Development mode
  if (isDev) {
    await handleDevMode(adapter, config.gateway, daemon);
    return;
  }

  // Production mode
  await handleProductionMode(adapter, config.gateway, daemon);
}

/**
 * Handle development mode startup
 */
async function handleDevMode(
  adapter: InstallationAdapter,
  gatewayConfig: GatewayConfig,
  daemon: boolean
): Promise<void> {
  if (isChildProcess()) {
    // Child process: just start gateway
    logger.info("Starting Gateway server (child process)...");
    const coreConfig = await loadConfig();
    await startGateway(coreConfig);
    return;
  }

  // Parent process: start Vite, Code Bridge, and Gateway
  const hiveUiPath = path.join(process.cwd(), "packages/hive-ui");
  const hasVite = existsSync(path.join(hiveUiPath, "package.json"));

  if (hasVite) {
    console.log("🎨 Iniciando Vite (UI)...\n");
    const viteProcess = spawn("bun", ["run", "dev"], {
      cwd: hiveUiPath,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    viteProcess.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.log(`[Vite] ${line}`);
      }
    });

    viteProcess.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.error(`[Vite] ${line}`);
      }
    });

    viteProcess.on("error", (error) => {
      console.error(`❌ Error iniciando Vite: ${error.message}`);
    });

    if (!daemon) {
      children.push(viteProcess);
    } else {
      viteProcess.unref();
    }
  }

  // Start Code Bridge
  console.log("[Gateway] 🌉 Iniciando Code Bridge...");
  try {
    await import("@johpaz/hive-agents-code-bridge");
    console.log("🌉 Code Bridge iniciado en puerto 18791");
    
    // Wait for Code Bridge to be ready (max 5 seconds)
    const CODE_BRIDGE_PORT = 18791;
    let codeBridgeReady = false;
    console.log(`[Gateway] 🌉 Esperando Code Bridge en puerto ${CODE_BRIDGE_PORT}...`);
    for (let i = 0; i < 50; i++) {
      try {
        const response = await fetch(`http://localhost:${CODE_BRIDGE_PORT}/health`, {
          signal: AbortSignal.timeout(200),
        });
        if (response.ok) {
          codeBridgeReady = true;
          console.log(`[Gateway] 🌉 ✅ Code Bridge disponible después de ${((i + 1) * 100)}ms`);
          break;
        }
      } catch (fetchError) {
        // Not ready yet, wait 100ms before retry
        if (i % 10 === 0) {
          console.log(`[Gateway] 🌉 ⏳ Esperando Code Bridge... intento ${i + 1}/50`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    if (!codeBridgeReady) {
      console.warn("[Gateway] 🌉 ⚠️  Code Bridge no respondió a tiempo - las herramientas codebridge pueden fallar");
    } else {
      console.log("[Gateway] 🌉 ✅ Code Bridge listo para aceptar conexiones");
    }
  } catch (error) {
    console.warn(`[Gateway] 🌉 ❌ No se pudo iniciar el Code Bridge: ${(error as Error).message}`);
  }

  // Spawn Gateway child process
  const spawnGateway = (): ReturnType<typeof spawn> => {
    const gw = spawn(process.execPath, [process.argv[1] || "", "start", "--skip-check", "--dev-internal"], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HIVE_DEV: "true", HIVE_GATEWAY_CHILD: "1" },
    });

    gw.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.log(`[Gateway] ${line}`);
      }
    });

    gw.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.error(`[Gateway] ${line}`);
      }
    });

    gw.on("error", (error) => {
      console.error(`❌ Error iniciando Gateway: ${error.message}`);
    });

    gw.on("exit", (code) => {
      if (code === 0) {
        console.log("[Gateway] Reiniciando tras setup...");
        const newGw = spawnGateway();
        const idx = children.indexOf(gw);
        if (idx !== -1) children.splice(idx, 1, newGw);
      }
    });

    if (!daemon) {
      children.push(gw);
    } else {
      gw.unref();
    }

    return gw;
  };

  const gatewayProcess = spawnGateway();

  // Wait for services
  console.log("⏳ Esperando servicios...");
  const [viteReady, gatewayReady] = await Promise.all([
    hasVite ? waitForVite(5173, 30000) : Promise.resolve(true),
    waitForHttpPort(18790, "/health", 30000),
  ]);

  if (!viteReady && hasVite) {
    console.error("⚠️  Vite no respondió a tiempo");
  }
  if (!gatewayReady) {
    console.error("⚠️  Gateway no respondió a tiempo");
    return;
  }

  // Additional wait: ensure Gateway is fully initialized and serving UI
  // In dev mode, Gateway needs a moment to set up HMR proxy
  await Bun.sleep(500);

  console.log("✅ Servicios listos\n");

  // Open browser - en desarrollo, Gateway sirve la UI igual que en producción
  const setupMode = await isSetupMode();
  const browserPort = gatewayConfig.port; // 18790, igual que producción
  const url = setupMode ? `http://localhost:${browserPort}/setup` : `http://localhost:${browserPort}`;

  console.log(`
╔════════════════════════════════════════╗
║  🐝  Hive — Modo Desarrollo            ║
╠════════════════════════════════════════╣
║  UI:        ${url.padEnd(24)}║
║  API:       http://127.0.0.1:18790     ║
║  WebSocket: ws://127.0.0.1:18790/ws    ║
║  Canvas:    ws://127.0.0.1:18790/canvas║
║  Vite HMR:  http://localhost:5173      ║
╠════════════════════════════════════════╣
║  ${setupMode ? "🎉 Primer arranque — abriendo setup..." : "Administra tu Hive aquí                "}║
╚════════════════════════════════════════╝
`);

  openBrowser(url);

  if (!daemon) {
    await new Promise(() => { }); // Infinite wait
  }
}

/**
 * Handle production mode startup
 */
async function handleProductionMode(
  adapter: InstallationAdapter,
  gatewayConfig: GatewayConfig,
  daemon: boolean
): Promise<void> {
  if (isChildProcess()) {
    const coreConfig = await loadConfig();
    await startGateway(coreConfig);
    return;
  }

  // Start Code Bridge
  console.log("[Gateway] 🌉 Iniciando Code Bridge...");
  try {
    await import("@johpaz/hive-agents-code-bridge");
    console.log("🌉 Code Bridge iniciado en puerto 18791");
    
    // Wait for Code Bridge to be ready (max 5 seconds)
    const CODE_BRIDGE_PORT = 18791;
    let codeBridgeReady = false;
    console.log(`[Gateway] 🌉 Esperando Code Bridge en puerto ${CODE_BRIDGE_PORT}...`);
    for (let i = 0; i < 50; i++) {
      try {
        const response = await fetch(`http://localhost:${CODE_BRIDGE_PORT}/health`, {
          signal: AbortSignal.timeout(200),
        });
        if (response.ok) {
          codeBridgeReady = true;
          console.log(`[Gateway] 🌉 ✅ Code Bridge disponible después de ${((i + 1) * 100)}ms`);
          break;
        }
      } catch (fetchError) {
        // Not ready yet, wait 100ms before retry
        if (i % 10 === 0) {
          console.log(`[Gateway] 🌉 ⏳ Esperando Code Bridge... intento ${i + 1}/50`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    if (!codeBridgeReady) {
      console.warn("[Gateway] 🌉 ⚠️  Code Bridge no respondió a tiempo - las herramientas codebridge pueden fallar");
    } else {
      console.log("[Gateway] 🌉 ✅ Code Bridge listo para aceptar conexiones");
    }
  } catch (error) {
    console.warn(`[Gateway] 🌉 ❌ No se pudo iniciar el Code Bridge: ${(error as Error).message}`);
  }

  // Get UI directory from adapter config
  const adapterConfig = await adapter.getConfig();
  // Detect Docker environment: either DockerAdapter or BinaryAdapter in Docker container
  const isDocker = adapterConfig.type === "docker"
    || (adapterConfig.type === "binary" && process.env.HIVE_UI_DIR === "/app/ui");

  // The gateway child process serves both the API and the UI on the same port.
  // No separate UI server needed — always open the browser on the gateway port.
  const uiPort = gatewayConfig.port;

  // Spawn Gateway child process
  const spawnGatewayProd = (): ReturnType<typeof spawn> => {
    // Determine the correct command to spawn the gateway child process.
    // Three cases:
    //   1. Docker container (/app/hive-server)
    //   2. Bundled JS or TS source → bun <script> start --skip-check
    //   3. Compiled Bun binary (no .js/.ts extension) → re-exec process itself
    const scriptPath = process.argv[1] || "";
    const isDockerContainer = process.env.HIVE_UI_DIR === "/app/ui";
    const isBunScript = scriptPath.endsWith(".js") || scriptPath.endsWith(".ts");

    let command: string;
    let args: string[];

    if (isDockerContainer) {
      // Running inside Docker container
      command = "/app/hive-server";
      args = ["start", "--skip-check"];
    } else if (isBunScript) {
      // Bundled JS (npm package) or TypeScript source: use Bun runtime
      command = process.execPath;
      args = [scriptPath, "start", "--skip-check"];
    } else {
      // Compiled Bun binary: process.execPath IS the binary
      command = process.execPath;
      args = ["start", "--skip-check"];
    }

    const gw = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HIVE_GATEWAY_CHILD: "1", NO_BROWSER: "1", ...(getDistDir() ? { HIVE_DIST_DIR: getDistDir()! } : {}) },
    });

    gw.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.log(`[Gateway] ${line}`);
      }
    });

    gw.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.error(`[Gateway] ${line}`);
      }
    });

    gw.on("error", (error) => {
      console.error(`❌ Error iniciando Gateway: ${error.message}`);
    });

    gw.on("exit", (code) => {
      if (code === 0) {
        console.log("[Gateway] Reiniciando tras setup...");
        const newGw = spawnGatewayProd();
        const idx = children.indexOf(gw);
        if (idx !== -1) children.splice(idx, 1, newGw);
      }
    });

    children.push(gw);
    return gw;
  };

  spawnGatewayProd();

  // Open browser when gateway is ready
  waitForPort(gatewayConfig.port, 30000).then(async () => {
    let needsSetup = false;
    try {
      const res = await fetch(`http://127.0.0.1:${gatewayConfig.port}/api/setup/status`, {
        signal: AbortSignal.timeout(3000),
      });
      const body = await res.json() as { setupMode?: boolean };
      needsSetup = body.setupMode === true;
    } catch {
      const hiveDir = getHiveDir();
      const dbPath = path.join(hiveDir, "data", "hive.db");
      needsSetup = !existsSync(dbPath);
    }

    const url = needsSetup ? `http://localhost:${uiPort}/setup` : `http://localhost:${uiPort}`;

    if (needsSetup) {
      console.log(`
╔════════════════════════════════════════╗
║  🎉  ¡Bienvenido a Hive!               ║
╠════════════════════════════════════════╣
║  Abriendo configuración en tu browser  ║
║  ${url.padEnd(38)}║
╚════════════════════════════════════════╝
`);
    } else {
      console.log(`\n🌐 Hive listo en: ${url}\n`);
    }

    openBrowser(url);
  });

  await new Promise(() => { }); // Keep parent alive
}

/**
 * Stop command
 */
export async function stop(): Promise<void> {
  const adapter = await getAdapter();

  // Try adapter stop first
  try {
    if (await adapter.isRunning()) {
      await adapter.stop();
      console.log("✅ Hive Gateway detenido");
      return;
    }
  } catch {
    // Adapter stop failed, fall through to manual stop
  }

  // Fallback to manual PID-based stop
  if (!(await isRunning())) {
    console.log("⚠️  Hive Gateway no está corriendo");
    return;
  }

  const pidFile = await getPidFile();
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);

  try {
    process.kill(pid, "SIGTERM");
    unlinkSync(pidFile);
    console.log("✅ Hive Gateway detenido");
  } catch (e) {
    console.error("❌ Error deteniendo el Gateway:", e);
  }
}

/**
 * Status command
 */
export async function status(flags: string[]): Promise<void> {
  const adapter = await getAdapter();
  const adapterConfig = await adapter.getConfig();
  const running = await adapter.isRunning();
  const hiveDir = getHiveDir();

  console.log("🐝 Hive Gateway Status\n");

  const coreConfig = await loadConfig();
  const pid = await adapter.getPid();

  console.log(`Estado:        ${running ? "✅ Corriendo" : "⏹️  Detenido"}`);
  if (running && pid) {
    console.log(`PID:           ${pid}`);
  }
  console.log(`Installation:  ${adapter.name} (${adapterConfig.type})`);
  console.log(`Puerto:        ${adapterConfig.gateway.port}`);
  console.log(`Host:          ${adapterConfig.gateway.host}`);

  const provider = coreConfig.models?.defaultProvider || "no configurado";
  const model = (coreConfig.models as any)?.defaults?.[provider] || (coreConfig.models as any)?.defaults?.default || "no configurado";
  console.log(`Modelo:        ${provider} / ${model}`);
  console.log(`Home:          ${hiveDir}`);
  console.log(`Logs:          ${getLogFile()}`);

  if (flags.includes("--json")) {
    console.log("\n" + JSON.stringify({
      running,
      pid,
      type: adapterConfig.type,
      config: adapterConfig,
    }, null, 2));
  }
}

/**
 * Reload command
 */
export async function reload(): Promise<void> {
  if (!(await isRunning())) {
    console.log("⚠️  Hive Gateway no está corriendo");
    return;
  }

  const pidFile = await getPidFile();
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);

  try {
    process.kill(pid, "SIGHUP");
    console.log("✅ Configuración recargada");
  } catch (e) {
    console.error("❌ Error recargando configuración:", e);
  }
}
