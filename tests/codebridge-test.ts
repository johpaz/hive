/**
 * Test End-to-End: Delegación de Tareas de Código vía Code Bridge
 * 
 * Soporta múltiples CLIs: Qwen, Claude Code, Gemini, OpenCode
 * 
 * Este test verifica el flujo completo:
 * 1. Verificar Code Bridge disponible
 * 2. Verificar CLI seleccionado disponible
 * 3. Inicializar BD
 * 4. Crear proyecto de código
 * 5. Delegar tarea al CLI
 * 6. Monitorear progreso
 * 7. Verificar resultado
 * 8. Finalizar proyecto
 * 
 * @example
 * // Test con Qwen (default)
 * bun run tests/codebridge-test.ts
 * 
 * // Test con Claude
 * CLI_TOOL=claude bun run tests/codebridge-test.ts
 * 
 * // Test con Gemini
 * CLI_TOOL=gemini bun run tests/codebridge-test.ts
 * 
 * // Test con OpenCode
 * CLI_TOOL=opencode bun run tests/codebridge-test.ts
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { agentBus } from "../packages/core/src/events/agent-bus";

// ─── Configuration ───────────────────────────────────────────────────────────

const CODE_BRIDGE_URL = "ws://localhost:18791/ws";

/** CLI tools supported by Code Bridge */
type CliTool = "qwen" | "claude" | "gemini" | "opencode";

/** CLI configuration with timeout and availability check */
interface CliConfig {
  name: string;
  command: string;
  timeoutSeconds: number;
  requiresEnv?: string[];
  description: string;
}

const CLI_CONFIGS: Record<CliTool, CliConfig> = {
  qwen: {
    name: "Qwen CLI",
    command: "qwen",
    timeoutSeconds: 180,
    description: "Alibaba's Qwen - Fast code generation and debugging",
  },
  claude: {
    name: "Claude Code",
    command: "claude",
    timeoutSeconds: 300,
    requiresEnv: ["ANTHROPIC_API_KEY"],
    description: "Anthropic's Claude Code - Complex architecture and refactoring",
  },
  gemini: {
    name: "Gemini CLI",
    command: "gemini",
    timeoutSeconds: 240,
    requiresEnv: ["GOOGLE_API_KEY"],
    description: "Google's Gemini - Code + documentation",
  },
  opencode: {
    name: "OpenCode",
    command: "opencode",
    timeoutSeconds: 200,
    description: "OpenCode - Open source focused",
  },
};

/** Get CLI tool from environment or default to qwen */
const SELECTED_CLI: CliTool = (
  process.env.CLI_TOOL as CliTool || "qwen"
);

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  success: boolean;
  message: string;
  cliUsed?: CliTool;
  projectId?: string;
  taskId?: number;
  output?: string;
  error?: string;
  hint?: string;
  timing?: {
    startMs: number;
    endMs: number;
    durationMs: number;
  };
}

interface CodeBridgeMessage {
  type: string;
  ts?: number;
  taskId?: string;
  cmd?: string;
  config?: {
    role: string;
    cli: string;
    args?: string[];
    cwd?: string;
    timeoutSeconds?: number;
  };
  prompt?: string;
  pid?: number;
  exitCode?: number;
  percent?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  chunk?: string;
  stream?: "stdout" | "stderr";
  message?: string;
  agents?: Array<{
    taskId: string;
    role: string;
    cli: string;
    pid: number;
    state: string;
    progress: number;
  }>;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Check if Code Bridge service is available
 */
async function checkCodeBridgeAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const response = await fetch("http://localhost:18791/health", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a specific CLI tool is available in PATH
 */
async function checkCliAvailable(cli: CliTool): Promise<boolean> {
  try {
    const config = CLI_CONFIGS[cli];
    const proc = Bun.spawn(["which", config.command], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if required environment variables are set for a CLI
 */
function checkCliEnv(cli: CliTool): { valid: boolean; missing: string[] } {
  const config = CLI_CONFIGS[cli];
  if (!config.requiresEnv) {
    return { valid: true, missing: [] };
  }

  const missing: string[] = [];
  for (const envVar of config.requiresEnv) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Create a test project in the database
 */
async function createTestProject(cliName: string): Promise<{ projectId: string; taskId: number }> {
  const db = getDb();

  // Get existing user_id and agent_id
  const user = db.query("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
  const agent = db.query("SELECT id FROM agents WHERE role='coordinator' LIMIT 1").get() as { id: string } | undefined;

  if (!user || !agent) {
    throw new Error("No hay usuario o agente coordinador en la BD. Ejecuta onboarding primero.");
  }

  const userId = user.id;
  const agentId = agent.id;

  const projectId = `test-${cliName}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Create project
  db.query(`
    INSERT INTO projects (id, user_id, agent_id, name, description, type, task, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
  `).run(
    projectId,
    userId,
    agentId,
    `Test Code Task - ${cliName.toUpperCase()}`,
    `Test de delegación de tarea de código a ${cliName} vía Code Bridge`,
    "code",
    "Generate/Refactor code module"
  );

  // Create task
  const result = db.query(`
    INSERT INTO tasks (project_id, agent_id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', unixepoch(), unixepoch())
    RETURNING id
  `).run(projectId, agentId, "Code generation task", "Generate code with CLI subagent");

  const taskId = (result as any).id as number;

  console.log(`✅ Proyecto creado: ${projectId}`);
  console.log(`✅ Tarea creada: ${taskId}`);

  return { projectId, taskId };
}

/**
 * Delegate a code task to a CLI subagent via Code Bridge
 */
async function delegateCodeTask(
  taskId: number,
  projectId: string,
  cli: CliTool
): Promise<TestResult> {
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let output = "";
    let connected = false;
    let exitCode: number | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;
    const startTime = Date.now();

    const cliConfig = CLI_CONFIGS[cli];
    const timeoutMs = cliConfig.timeoutSeconds * 1000;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try { ws.close(); } catch {}
      }
    };

    const codeBridgeTaskId = `test-${taskId}-${Date.now()}`;

    const connect = () => {
      try {
        ws = new WebSocket(CODE_BRIDGE_URL);

        ws.onopen = () => {
          connected = true;
          console.log(`🔌 Conectado a Code Bridge`);

          // Build launch command with CLI-specific configuration
          const msg: CodeBridgeMessage = {
            cmd: "launch",
            taskId: codeBridgeTaskId,
            config: {
              role: "development",
              cli: cli,
              args: [], // CLI-specific args added by process-manager.ts
              cwd: process.cwd(),
              timeoutSeconds: cliConfig.timeoutSeconds,
            },
            prompt: getCodeGenerationPrompt(cli),
          };

          ws!.send(JSON.stringify(msg));
          console.log(`🚀 Launch enviado a ${cliConfig.name}`);
          console.log(`⏱️ Timeout: ${cliConfig.timeoutSeconds}s`);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as CodeBridgeMessage;

            if (data.type === "agent:output") {
              output += data.chunk || "";
              const preview = data.chunk?.substring(0, 80).replace(/\n/g, ' ');
              if (preview) {
                console.log(`📝 Output: ${preview}...`);
              }
            }

            if (data.type === "agent:progress") {
              console.log(`📊 Progreso: ${data.percent}%`);
            }

            if (data.type === "agent:token_usage") {
              console.log(`🎫 Tokens: input=${data.inputTokens}, output=${data.outputTokens}, model=${data.model}`);
            }

            if (data.type === "agent:finished") {
              console.log(`✅ Tarea finalizada: exitCode=${data.exitCode}`);
              exitCode = data.exitCode || 0;
              cleanup();
              resolve({
                success: data.exitCode === 0,
                message: data.exitCode === 0 ? "Tarea completada exitosamente" : "Tarea falló",
                cliUsed: cli,
                taskId,
                output: output.substring(0, 5000),
                timing: {
                  startMs: startTime,
                  endMs: Date.now(),
                  durationMs: Date.now() - startTime,
                },
              });
            }

            if (data.type === "agent:error") {
              console.log(`❌ Error: ${data.message}`);
              cleanup();
              resolve({
                success: false,
                message: "Error del subagente",
                error: data.message,
                cliUsed: cli,
              });
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        ws.onerror = (error) => {
          console.error(`❌ WebSocket error: ${error}`);
        };

        ws.onclose = () => {
          if (!connected) {
            cleanup();
            if (reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++;
              console.log(`🔄 Reintentando conexión (${reconnectAttempts}/${maxReconnectAttempts})...`);
              setTimeout(connect, 1000 * reconnectAttempts);
            } else {
              resolve({
                success: false,
                message: "No se pudo conectar a Code Bridge",
                error: "WebSocket connection failed after retries",
                cliUsed: cli,
              });
            }
          }
        };

        // Timeout based on CLI configuration
        timeoutHandle = setTimeout(() => {
          console.log(`⏱️ Timeout alcanzado (${cliConfig.timeoutSeconds}s)`);
          cleanup();
          resolve({
            success: false,
            message: "Timeout alcanzado",
            error: `Task timeout after ${cliConfig.timeoutSeconds}s`,
            cliUsed: cli,
          });
        }, timeoutMs);

      } catch (error) {
        cleanup();
        resolve({
          success: false,
          message: "Error de conexión",
          error: (error as Error).message,
          cliUsed: cli,
        });
      }
    };

    // Start connection
    connect();
  });
}

/**
 * Get code generation prompt based on CLI tool
 * Different CLIs may have different strengths
 */
function getCodeGenerationPrompt(cli: CliTool): string {
  const basePrompt = `// auth.ts - Implement JWT authentication
  
/**
 * Implement JWT access + refresh token authentication
 * 
 * Requirements:
 * - Generate access token (expires in 15min)
 * - Generate refresh token (expires in 7 days)
 * - Store refresh token hash in database
 * - Return both tokens to client
 * - Include token types in response
 */

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export async function generateTokens(userId: string): Promise<AuthTokens> {
  // TODO: Implement JWT token generation
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  // TODO: Implement refresh token logic
}

export async function validateAccessToken(token: string): Promise<{ userId: string } | null> {
  // TODO: Implement token validation
}`;

  // CLI-specific prompt enhancements
  switch (cli) {
    case "claude":
      return basePrompt + `\n\n// Please provide a complete, production-ready implementation\n// with proper error handling and security considerations.`;
    
    case "gemini":
      return basePrompt + `\n\n// Please include JSDoc comments and usage examples\n// for each function.`;
    
    case "qwen":
      return basePrompt + `\n\n// Implement concisely and efficiently.\n// Focus on core functionality.`;
    
    case "opencode":
      return basePrompt + `\n\n// Follow open source best practices.\n// Include error codes for programmatic handling.`;
    
    default:
      return basePrompt;
  }
}

/**
 * Verify project and task status after task completion
 */
async function verifyProjectStatus(projectId: string): Promise<void> {
  const db = getDb();

  const project = db.query<any, [string]>(
    "SELECT id, name, status, progress FROM projects WHERE id = ?"
  ).get(projectId);

  const tasks = db.query<any, [string]>(
    "SELECT id, name, status, progress, result FROM tasks WHERE project_id = ?"
  ).all(projectId);

  console.log("\n📊 Estado del Proyecto:");
  console.log(`   ID: ${project.id}`);
  console.log(`   Nombre: ${project.name}`);
  console.log(`   Status: ${project.status}`);
  console.log(`   Progreso: ${project.progress}%`);

  console.log("\n📋 Tareas:");
  for (const task of tasks) {
    console.log(`   [${task.status}] ${task.name} (${task.progress}%)`);
    if (task.result) {
      console.log(`       Result: ${task.result.substring(0, 100)}...`);
    }
  }
}

/**
 * Cleanup test project after test completion
 */
async function cleanupTestProject(projectId: string): Promise<void> {
  const db = getDb();

  // Mark project as completed for cleanup
  db.query(`
    UPDATE projects SET status = 'done', updated_at = unixepoch()
    WHERE id = ?
  `).run(projectId);

  console.log(`🧹 Proyecto de test marcado como completado`);
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function runTest(): Promise<TestResult> {
  const cliConfig = CLI_CONFIGS[SELECTED_CLI];
  
  console.log("=".repeat(60));
  console.log(`🧪 TEST: Delegación de Tareas de Código vía Code Bridge`);
  console.log(`🔧 CLI Tool: ${cliConfig.name} (${SELECTED_CLI.toUpperCase()})`);
  console.log(`📝 ${cliConfig.description}`);
  console.log("=".repeat(60));

  // Step 0: Initialize DB
  console.log("\n0️⃣ Inicializando/conectando base de datos...");
  try {
    initializeDatabase();
    const db = getDb();
    // Verify there is data
    const userCount = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };
    if (userCount.count === 0) {
      return {
        success: false,
        message: "BD vacía. Ejecuta onboarding primero.",
        hint: "Ejecuta: bun run hive onboard"
      };
    }
    console.log("✅ BD conectada");
  } catch (error) {
    return {
      success: false,
      message: "Error al conectar BD",
      error: (error as Error).message,
    };
  }

  // Step 1: Verify Code Bridge
  console.log("\n1️⃣ Verificando Code Bridge...");
  const codeBridgeAvailable = await checkCodeBridgeAvailable();
  if (!codeBridgeAvailable) {
    return {
      success: false,
      message: "Code Bridge no está disponible",
      error: "Code Bridge debe estar corriendo en ws://localhost:18791",
      hint: "Ejecuta: bun run packages/code-bridge/src/index.ts"
    };
  }
  console.log("✅ Code Bridge disponible");

  // Step 2: Verify CLI tool
  console.log(`\n2️⃣ Verificando ${cliConfig.name}...`);
  
  // Check environment variables first
  const envCheck = checkCliEnv(SELECTED_CLI);
  if (!envCheck.valid) {
    return {
      success: false,
      message: `${cliConfig.name} requiere variables de entorno`,
      error: `Missing: ${envCheck.missing.join(", ")}`,
      hint: `Set: ${envCheck.missing.map(v => `${v}=...`).join(", ")}`
    };
  }
  console.log("✅ Environment variables OK");
  
  // Check CLI in PATH
  const cliAvailable = await checkCliAvailable(SELECTED_CLI);
  if (!cliAvailable) {
    return {
      success: false,
      message: `${cliConfig.name} no está disponible`,
      error: `${cliConfig.name} debe estar instalado y en PATH`,
      hint: `Instala ${cliConfig.name} o usa otra herramienta (qwen, claude, gemini, opencode)`
    };
  }
  console.log(`✅ ${cliConfig.name} disponible en PATH`);

  // Step 3: Subscribe to Agent Bus events
  console.log("\n3️⃣ Suscribiendo a Agent Bus events...");
  const unsubscribe = agentBus.subscribe("worker:task_completed", (data) => {
    console.log(`📨 Agent Bus: task_completed - ${data.workerName}`);
  });
  agentBus.subscribe("worker:task_failed", (data) => {
    console.log(`📨 Agent Bus: task_failed - ${data.workerName}: ${data.error}`);
  });

  // Step 4: Create test project
  console.log("\n4️⃣ Creando proyecto de test...");
  const { projectId, taskId } = await createTestProject(SELECTED_CLI);

  // Step 5: Delegate task to CLI
  console.log(`\n5️⃣ Delegando tarea a ${cliConfig.name}...`);
  const result = await delegateCodeTask(taskId, projectId, SELECTED_CLI);

  // Step 6: Verify result
  console.log("\n6️⃣ Verificando resultado...");
  await verifyProjectStatus(projectId);

  // Step 7: Cleanup
  console.log("\n7️⃣ Cleanup...");
  await cleanupTestProject(projectId);
  unsubscribe();

  // Final result
  console.log("\n" + "=".repeat(60));
  if (result.success) {
    console.log("✅ TEST EXITOSO");
    if (result.timing) {
      console.log(`⏱️ Duración: ${(result.timing.durationMs / 1000).toFixed(2)}s`);
    }
  } else {
    console.log("❌ TEST FALLÓ");
  }
  console.log("=".repeat(60));

  return result;
}

// Run test
runTest().then((result) => {
  console.log("\nResultado final:");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}).catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
