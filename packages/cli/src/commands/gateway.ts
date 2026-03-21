import { loadConfig, startGateway, logger, expandConfigPath, expandPath, getHiveDir, initializeDatabase, getDb } from "@johpaz/hiveAgents-core";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync } from "node:fs";
import * as path from "node:path";
import { spawn, ChildProcess } from "child_process";


const children: ChildProcess[] = [];

function cleanup() {
  if (children.length === 0) return;
  console.log("\n🧹 Limpiando procesos hijos...");
  for (const child of children) {
    if (child.pid) {
      try {
        // En Linux, matar el grupo de procesos si fue iniciado como detached
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
}

// Listen for termination signals
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

// Ensure cleanup on normal exit
process.on("exit", () => {
  cleanup();
});

function getDefaultPidFile(): string {
  return path.join(getHiveDir(), "gateway.pid");
}

function getLogFile(): string {
  return path.join(getHiveDir(), "logs", "gateway.log");
}

async function getPidFile(): Promise<string> {
  try {
    const config = await loadConfig();
    return expandConfigPath(config.gateway?.pidFile) ?? getDefaultPidFile();
  } catch {
    return getDefaultPidFile();
  }
}

function ensureLogDir(): void {
  const logDir = path.dirname(getLogFile());
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;

  // Build the shell command for the platform
  let shellCmd: string;
  if (platform === "win32") {
    shellCmd = `start "" "${url}"`;
  } else if (platform === "darwin") {
    shellCmd = `open "${url}"`;
  } else {
    // Linux: try gio open first (GNOME/Wayland native, no DISPLAY needed),
    // then xdg-open, then common browser names. '|| true' ensures exit 0.
    shellCmd = `gio open "${url}" 2>/dev/null || xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || x-www-browser "${url}" 2>/dev/null || true`;
  }

  console.log(`🌐 Abriendo navegador en ${url}`);

  try {
    const shell = platform === "win32" ? "cmd" : "/bin/sh";
    const shellArg = platform === "win32" ? "/c" : "-c";
    // Bun.spawn is the native Bun API — more reliable than child_process.spawn in Bun
    const proc = Bun.spawn([shell, shellArg, shellCmd], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref(); // Don't keep event loop alive waiting for the browser process
  } catch {
    console.log(`\n🌐 Abre Hive aquí: ${url}\n`);
  }
}

async function isSetupMode(): Promise<boolean> {
  const hiveDir = getHiveDir();
  const dbPath = path.join(hiveDir, "data", "hive.db");
  return !existsSync(dbPath);
}

async function isRunning(): Promise<boolean> {
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

async function waitForPort(port: number, timeout: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        // Distinguish "gateway fully initialized" from "still starting up"
        const body = (await response.json().catch(() => ({}))) as { status?: string };
        if (body?.status === "ok") return true;
        // status === "starting" → keep waiting
      }
    } catch {
      // Port not ready yet
    }
    await Bun.sleep(500);
  }
  return false;
}

async function waitForVite(port: number, timeout: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      // Usar 127.0.0.1 en lugar de localhost para evitar demoras de resolución DNS (IPv6 vs IPv4)
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(200) // Timeout más agresivo para una conexión local
      });
      if (response.ok || response.status === 200) {
        return true;
      }
    } catch {
      // Puerto aún no disponible
    }
    await Bun.sleep(200); // Poll más frecuente
  }
  return false;
}

export async function start(flags: string[]): Promise<void> {
  const daemon = flags.includes("--daemon");
  const skipCheck = flags.includes("--skip-check");
  const devInternal = flags.includes("--dev-internal");

  const isDev = process.env.HIVE_DEV === "true" || process.env.NODE_ENV === "development";
  const hiveDir = getHiveDir();
  const dbPath = path.join(hiveDir, "data", "hive.db")

  // Skip onboarding check if running as child process in dev mode
  const isGatewayChild = process.env.HIVE_GATEWAY_CHILD === "1";

  // Gateway starts unconditionally — first-run setup is handled by:
  //   - Web UI: /setup page (production, Docker, binaries)
  //   - CLI:    `hive onboard` command (manual)
  //   - Dev:    `hive dev` command (auto-runs wizard on first start)

  if (!skipCheck && await isRunning()) {
    console.log("⚠️  Hive Gateway ya está corriendo");
    return;
  }

  const config = await loadConfig();

  if (config.logging?.level) {
    logger.setLevel(config.logging.level);
  }

  // Only show banner if not running as child process (parent already shows status)
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
 ║   Personal Swarm AI Gateway — v0.0.1       ║
 ╚════════════════════════════════════════════╝
`);
  }

  if (daemon) {
    ensureLogDir();
    const logFile = getLogFile();
    const child = spawn(process.execPath, [process.argv[1] || "", "start", "--skip-check"], {
      detached: true,
      stdio: ["ignore", openSync(logFile, "a"), openSync(logFile, "a")],
    });
    child.unref();
    writeFileSync(await getPidFile(), child.pid?.toString() || "");
    console.log(`✅ Hive Gateway iniciado en modo daemon (PID: ${child.pid})`);
    console.log(`   Logs: ${logFile}`);
    return;
  }

  // In dev mode, start Vite and Gateway concurrently for faster startup
  if (isDev) {
    // ── CHILD PROCESS: Only run Gateway server ───────────────────────────────
    if (isGatewayChild) {
      // Child process: skip Vite and Code Bridge, just start Gateway
      logger.info("Starting Gateway server (child process)...");
      await startGateway(config);
      return;
    }

    // ── PARENT PROCESS: Start Vite, Code Bridge, and spawn child Gateway ─────
    const hiveUiPath = path.join(process.cwd(), "packages/hive-ui");
    const hasVite = existsSync(path.join(hiveUiPath, "package.json"));

    // Start Vite in background (don't wait)
    if (hasVite) {
      console.log("🎨 Iniciando Vite (UI)...\n");

      const viteProcess = spawn("bun", ["run", "dev"], {
        cwd: hiveUiPath,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      // Pipe logs to stdout/stderr with a prefix
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

    // Start Code Bridge sidecar (parent process only)
    try {
      await import("@johpaz/hiveAgents-code-bridge");
    } catch (error) {
      console.warn(`⚠️  No se pudo iniciar el Code Bridge: ${(error as Error).message}`);
    }

    // Start Gateway in a separate process (non-blocking)
    const gatewayProcess = spawn(process.execPath, [process.argv[1] || "", "start", "--skip-check", "--dev-internal"], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HIVE_DEV: "true", HIVE_GATEWAY_CHILD: "1" },
    });

    gatewayProcess.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.log(`[Gateway] ${line}`);
      }
    });
    gatewayProcess.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) console.error(`[Gateway] ${line}`);
      }
    });

    gatewayProcess.on("error", (error) => {
      console.error(`❌ Error iniciando Gateway: ${error.message}`);
    });

    if (!daemon) {
      children.push(gatewayProcess);
    } else {
      gatewayProcess.unref();
    }

    // Wait for both Vite and Gateway to be ready
    console.log("⏳ Esperando servicios...");
    const [viteReady, gatewayReady] = await Promise.all([
      hasVite ? waitForVite(5173, 30000) : Promise.resolve(true),
      waitForPort(18790, 30000),
    ]);

    if (!viteReady && hasVite) {
      console.error("⚠️  Vite no respondió a tiempo");
    }
    if (!gatewayReady) {
      console.error("⚠️  Gateway no respondió a tiempo");
      return;
    }

    console.log("✅ Servicios listos\n");

    // Determine if we should open /setup or /ui
    const setupMode = await isSetupMode();
    const url = setupMode
      ? "http://localhost:5173/setup"
      : "http://localhost:5173";

    console.log(`
╔════════════════════════════════════════╗
║  🐝  Hive — Modo Desarrollo            ║
╠════════════════════════════════════════╣
║  UI:        ${url.padEnd(24)}║
║  API:       http://127.0.0.1:18790     ║
║  WebSocket: ws://127.0.0.1:18790/ws    ║
║  Canvas:    ws://127.0.0.1:18790/canvas║
╠════════════════════════════════════════╣
║  ${setupMode ? "🎉 Primer arranque — abriendo setup..." : "Administra tu Hive aquí                "}║
╚════════════════════════════════════════╝
`);

    openBrowser(url);

    // Keep the process alive
    if (!daemon) {
      await new Promise(() => { }); // Infinite wait
    }

    return;
  }

  // Production mode — start Code Bridge sidecar before Gateway
  try {
    await import("@johpaz/hiveAgents-code-bridge");
    console.log("🌉 Code Bridge iniciado en puerto 18791");
  } catch (error) {
    console.warn(`⚠️  No se pudo iniciar el Code Bridge: ${(error as Error).message}`);
  }

  // Open browser when gateway is ready
  if (!daemon && !isGatewayChild) {
    const port = (config.gateway as any)?.port || 18790;
    waitForPort(port, 30000).then(() => {
      const needsSetup = !existsSync(dbPath);
      const url = needsSetup
        ? `http://localhost:${port}/setup`
        : `http://localhost:${port}`;
      console.log(`\n🌐 Abre Hive en: ${url}\n`);
      openBrowser(url);
    });
  }

  await startGateway(config);
}

export async function stop(): Promise<void> {
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

export async function status(flags: string[]): Promise<void> {
  const running = await isRunning();
  const hiveDir = getHiveDir();

  console.log("🐝 Hive Gateway Status\n");

  const config = await loadConfig();
  const pidFile = await getPidFile();

  console.log(`Estado:      ${running ? "✅ Corriendo" : "⏹️  Detenido"}`);
  if (running) {
    const pid = readFileSync(pidFile, "utf-8").trim();
    console.log(`PID:         ${pid}`);
  }
  console.log(`Puerto:      ${config.gateway?.port || 18790}`);
  console.log(`Host:        ${config.gateway?.host || "127.0.0.1"}`);
  const provider = config.models?.defaultProvider || "no configurado";
  const model = (config.models as any)?.defaults?.[provider] || (config.models as any)?.defaults?.default || "no configurado";
  console.log(`Modelo:      ${provider} / ${model}`);
  console.log(`Home:        ${hiveDir}`);
  console.log(`Logs:        ${getLogFile()}`);

  if (flags.includes("--json")) {
    console.log("\n" + JSON.stringify({ running, pid: running ? readFileSync(pidFile, "utf-8").trim() : null, config }, null, 2));
  }
}

export async function reload(): Promise<void> {
  if (!(await isRunning())) {
    console.log("⚠️  Hive Gateway no está corriendo");
    return;
  }

  const pid = parseInt(readFileSync(await getPidFile(), "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGHUP");
    console.log("✅ Configuración recargada");
  } catch (e) {
    console.error("❌ Error recargando configuración:", e);
  }
}
