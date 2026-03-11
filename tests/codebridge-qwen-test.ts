/**
 * Test End-to-End: Delegación de Tareas de Código vía Code Bridge con Qwen CLI
 * 
 * Este test verifica el flujo completo:
 * 1. Verificar Code Bridge disponible
 * 2. Verificar Qwen CLI disponible
 * 3. Inicializar BD
 * 4. Crear proyecto de código
 * 5. Delegar tarea a Qwen CLI
 * 6. Monitorear progreso
 * 7. Verificar resultado
 * 8. Finalizar proyecto
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { resolveUserId, resolveAgentId } from "../packages/core/src/storage/onboarding";
import { agentBus } from "../packages/core/src/events/agent-bus";

const CODE_BRIDGE_URL = "ws://localhost:18791/ws";

interface TestResult {
  success: boolean;
  message: string;
  projectId?: string;
  taskId?: number;
  output?: string;
  error?: string;
  hint?: string;
}

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

async function checkQwenCliAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "qwen"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function createTestProject(): Promise<{ projectId: string; taskId: number }> {
  const db = getDb();
  
  // Obtener user_id y agent_id existentes
  const user = db.query("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
  const agent = db.query("SELECT id FROM agents WHERE role='coordinator' LIMIT 1").get() as { id: string } | undefined;
  
  if (!user || !agent) {
    throw new Error("No hay usuario o agente coordinador en la BD. Ejecuta onboarding primero.");
  }

  const userId = user.id;
  const agentId = agent.id;

  const projectId = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  // Crear proyecto
  db.query(`
    INSERT INTO projects (id, user_id, agent_id, name, description, type, task, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
  `).run(
    projectId,
    userId,
    agentId,
    "Test Code Refactor - Qwen CLI",
    "Test de delegación de tarea de código a Qwen CLI vía Code Bridge",
    "code",
    "Refactorizar módulo de autenticación"
  );

  // Crear tarea
  const result = db.query(`
    INSERT INTO tasks (project_id, agent_id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', unixepoch(), unixepoch())
    RETURNING id
  `).run(projectId, agentId, "Refactorizar auth.ts", "Implementar JWT con refresh tokens");

  const taskId = (result as any).id as number;

  console.log(`✅ Proyecto creado: ${projectId}`);
  console.log(`✅ Tarea creada: ${taskId}`);

  return { projectId, taskId };
}

async function delegateCodeTask(
  taskId: number,
  projectId: string
): Promise<TestResult> {
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let output = "";
    let connected = false;
    let exitCode: number | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;

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
          
          const msg = {
            cmd: "launch",
            taskId: codeBridgeTaskId,
            config: {
              role: "development" as const,
              cli: "qwen",
              args: [],
              cwd: process.cwd(),
              timeoutSeconds: 120,
            },
            prompt: `// auth.ts - Refactor with JWT
export function authenticate(username: string, password: string): boolean {
  return username === "admin" && password === "password";
}
// TODO: Implement JWT access + refresh tokens`,
          };
          
          ws!.send(JSON.stringify(msg));
          console.log(`🚀 Launch enviado a Qwen CLI`);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

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
                taskId,
                output: output.substring(0, 5000),
              });
            }

            if (data.type === "agent:error") {
              console.log(`❌ Error: ${data.message}`);
              cleanup();
              resolve({
                success: false,
                message: "Error del subagente",
                error: data.message,
              });
            }
          } catch (e) {
            // Ignorar errores de parseo
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
              });
            }
          }
        };

        // Timeout de 120 segundos
        timeoutHandle = setTimeout(() => {
          console.log(`⏱️ Timeout alcanzado (120s)`);
          cleanup();
          resolve({
            success: false,
            message: "Timeout alcanzado",
            error: "Task timeout after 120s",
          });
        }, 120000);

      } catch (error) {
        cleanup();
        resolve({
          success: false,
          message: "Error de conexión",
          error: (error as Error).message,
        });
      }
    };

    // Iniciar conexión
    connect();
  });
}

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

async function cleanupTestProject(projectId: string): Promise<void> {
  const db = getDb();
  
  // Marcar proyecto como completado para cleanup
  db.query(`
    UPDATE projects SET status = 'done', updated_at = unixepoch()
    WHERE id = ?
  `).run(projectId);

  console.log(`🧹 Proyecto de test marcado como completado`);
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function runTest(): Promise<TestResult> {
  console.log("=".repeat(60));
  console.log("🧪 TEST: Delegación de Tareas de Código vía Code Bridge + Qwen CLI");
  console.log("=".repeat(60));

  // Step 0: Inicializar BD (usa HIVE_HOME si está configurado)
  console.log("\n0️⃣ Inicializando/conectando base de datos...");
  try {
    initializeDatabase();
    const db = getDb();
    // Verificar que hay datos
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

  // Step 1: Verificar Code Bridge
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

  // Step 2: Verificar Qwen CLI
  console.log("\n2️⃣ Verificando Qwen CLI...");
  const qwenAvailable = await checkQwenCliAvailable();
  if (!qwenAvailable) {
    return {
      success: false,
      message: "Qwen CLI no está disponible",
      error: "Qwen CLI debe estar instalado y en PATH",
      hint: "Instala Qwen CLI o usa otra herramienta (claude, opencode, gemini)"
    };
  }
  console.log("✅ Qwen CLI disponible");

  // Step 3: Suscribirse a Agent Bus events
  console.log("\n3️⃣ Suscribiendo a Agent Bus events...");
  const unsubscribe = agentBus.subscribe("worker:task_completed", (data) => {
    console.log(`📨 Agent Bus: task_completed - ${data.workerName}`);
  });
  agentBus.subscribe("worker:task_failed", (data) => {
    console.log(`📨 Agent Bus: task_failed - ${data.workerName}: ${data.error}`);
  });

  // Step 4: Crear proyecto de test
  console.log("\n4️⃣ Creando proyecto de test...");
  const { projectId, taskId } = await createTestProject();

  // Step 5: Delegar tarea a Qwen CLI
  console.log("\n5️⃣ Delegando tarea a Qwen CLI...");
  const result = await delegateCodeTask(taskId, projectId);

  // Step 6: Verificar resultado
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
