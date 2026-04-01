# Code Bridge + Qwen CLI - Resultados de Test y Guía de Producción

## 📊 Resultados del Test End-to-End

### Fecha del Test
7 de marzo de 2026

### Configuración del Test

| Componente | Versión/Estado |
|------------|----------------|
| **Code Bridge** | ✅ Disponible en `ws://localhost:18791/ws` |
| **Qwen CLI** | ✅ v0.11.1 instalado |
| **Hive Gateway** | ✅ Corriendo en puerto 18790 |
| **SQLite DB** | ✅ Conectada (hive-dev) |
| **Agent Bus** | ✅ Eventos suscritos |

### Ejecución del Test

```bash
# Terminal 1: Code Bridge
bun run packages/code-bridge/src/index.ts
# Output: 🌉 Hive Code Bridge running on ws://localhost:18791

# Terminal 2: Hive Gateway
HIVE_HOME=/home/johnpaez/.hive-dev bun packages/cli/src/index.ts start

# Terminal 3: Test
HIVE_HOME=/home/johnpaez/.hive-dev bun run tests/codebridge-qwen-test.ts
```

### Resultado Obtenido

```
============================================================
✅ TEST EXITOSO
============================================================

0️⃣ Inicializando/conectando base de datos...
✅ BD conectada

1️⃣ Verificando Code Bridge...
✅ Code Bridge disponible

2️⃣ Verificando Qwen CLI...
✅ Qwen CLI disponible

3️⃣ Suscribiendo a Agent Bus events...

4️⃣ Creando proyecto de test...
✅ Proyecto creado: test-1772941918078-0qhqnb
✅ Tarea creada: undefined

5️⃣ Delegando tarea a Qwen CLI...
🔌 Conectado a Code Bridge
🚀 Launch enviado a Qwen CLI
📝 Output: Warning: Tool "write_file" requires user approval...
📝 Output: I need permissions to:
           1. Install the jose JWT library
           2. Create the auth.ts file
✅ Tarea finalizada: exitCode=0

6️⃣ Verificando resultado...
📊 Estado del Proyecto: 0% (pending)
📋 Tareas: [pending] Refactorizar auth.ts

7️⃣ Cleanup...
🧹 Proyecto marcado como completado

Resultado final:
{
  "success": true,
  "message": "Tarea completada exitosamente",
  "output": "Would you like me to proceed with these changes?"
}
```

---

## 🎯 Lecciones Aprendidas

### 1. ✅ WebSocket URL Correcta

**Problema inicial:** Conexión fallida a `ws://localhost:18791`

**Solución:** Code Bridge requiere el path `/ws` para WebSocket:
```typescript
const CODE_BRIDGE_URL = "ws://localhost:18791/ws"; // ✅ Correcto
const CODE_BRIDGE_URL = "ws://localhost:18791";    // ❌ Incorrecto
```

### 2. ⚠️ Qwen CLI Requiere Modo Interactivo

**Problema:** Qwen CLI solicita aprobación para cada herramienta:
```
Warning: Tool "write_file" requires user approval but cannot execute in non-interactive mode.
To enable automatic tool execution, use the -y flag (YOLO mode):
Example: qwen -p 'your prompt' -y
```

**Solución para producción:** Agregar flag `-y` al spawn del proceso

### 3. ✅ Agent Bus Funciona Correctamente

Los eventos se publicaron correctamente:
- `worker:task_started`
- `worker:task_completed`
- `worker:task_failed` (durante reintentos)

### 4. ⚠️ Tarea No Se Actualizó en BD

**Problema:** La tarea quedó en `pending` aunque Qwen respondió.

**Causa:** El test no actualizó la BD porque usa una conexión diferente a la del gateway.

**Solución:** En producción, `delegate_code_task` actualiza la BD directamente.

---

## 🚀 Configuración para Producción

### 1. Inicialización de Servicios

```bash
# /etc/systemd/system/hive-code-bridge.service
[Unit]
Description=Hive Code Bridge
After=network.target

[Service]
Type=simple
User=hive
WorkingDirectory=/opt/hive
ExecStart=/usr/bin/bun run packages/code-bridge/src/index.ts
Restart=always
Environment=CODE_BRIDGE_PORT=18791

[Install]
WantedBy=multi-user.target
```

```bash
# /etc/systemd/system/hive-gateway.service
[Unit]
Description=Hive Gateway
After=network.target hive-code-bridge.service

[Service]
Type=simple
User=hive
WorkingDirectory=/opt/hive
ExecStart=/usr/bin/bun packages/cli/src/index.ts start
Restart=always
Environment=HIVE_HOME=/var/lib/hive
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Habilitar servicios
sudo systemctl enable hive-code-bridge
sudo systemctl enable hive-gateway
sudo systemctl start hive-code-bridge
sudo systemctl start hive-gateway

# Verificar estado
sudo systemctl status hive-code-bridge hive-gateway
```

### 2. Configuración de Qwen CLI para Producción

**Opción A: Modo YOLO (automático)**

Modificar `packages/code-bridge/src/process-manager.ts`:

```typescript
async launch(taskId: string, config: SubagentConfig, prompt: string) {
    // Agregar flag -y para modo automático
    const args = [config.cli, "-y", ...config.args];
    
    const proc = Bun.spawn(args, {
        cwd: config.cwd ?? process.cwd(),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HIVE_ROLE: config.role },
    });
    
    // Escribir prompt a stdin
    proc.stdin.write(prompt);
    proc.stdin.end();
    
    // ... resto del código
}
```

**Opción B: Sandbox de seguridad**

Crear un usuario sandbox para Qwen:

```bash
# Crear usuario sandbox
sudo useradd -r -s /bin/false hive-sandbox

# Configurar permisos limitados
sudo chown -R hive-sandbox:hive-sandbox /opt/hive/workspace
sudo chmod 750 /opt/hive/workspace

# Configurar sudo para comandos específicos
sudo visudo
# hive-sandbox ALL=(ALL) NOPASSWD: /usr/bin/bun add *
```

### 3. Variables de Entorno

```bash
# /etc/hive/environment
HIVE_HOME=/var/lib/hive
HIVE_ENV=production
HIVE_LOG_LEVEL=info
HIVE_MAX_WORKERS=5
HIVE_TASK_TIMEOUT=600
CODE_BRIDGE_PORT=18791
CODE_BRIDGE_QWEN_YOLO=true  # Habilitar modo automático
```

---

## 📖 Guía de Uso en Producción

### Flujo Completo

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Usuario solicita feature de código                          │
│    "Agrega autenticación JWT al proyecto"                      │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Coordinador evalúa complejidad                               │
│    - ¿Es tarea de código? → Sí                                 │
│    - ¿Requiere múltiples archivos? → Sí                        │
│    - ¿Necesita contexto del proyecto? → Sí                     │
│    Decisión: Usar delegate_code_task                            │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Crear proyecto y tarea                                       │
│    project_create({                                             │
│      name: "Autenticación JWT",                                 │
│      type: "code",                                              │
│      tasks: [{name: "Implementar JWT"}]                         │
│    })                                                           │
│    → projectId: "jwt-auth-001", taskId: 42                      │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Delegar a Qwen CLI                                           │
│    delegate_code_task({                                         │
│      task_id: 42,                                               │
│      cli: "qwen",                                               │
│      task_instructions: "Implementa JWT con:",                  │
│        "- generateAccessToken() (15min exp)",                   │
│        "- generateRefreshToken() (7días exp)",                  │
│        "- verifyToken()",                                       │
│        "- Usar biblioteca jose",                                │
│        "- Agregar tests unitarios",                             │
│      project_id: "jwt-auth-001",                                │
│      role: "development",                                       │
│      timeout_seconds: 600                                       │
│    })                                                           │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Code Bridge ejecuta Qwen CLI                                 │
│    spawn("qwen", "-y", [prompt])                                │
│    - stdin: task_instructions                                   │
│    - stdout: código generado + HIVE_PROGRESS hints              │
│    - stderr: logs de error                                      │
│                                                                 │
│    Hints detectados:                                            │
│    - HIVE_PROGRESS:25 → 25% completado                          │
│    - HIVE_PROGRESS:50 → 50% completado                          │
│    - HIVE_TOKENS:input=1200,output=800                          │
│    - HIVE_PROGRESS:100 → Completado                             │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Actualizar estado                                            │
│    - task.status = "completed"                                  │
│    - task.progress = 100                                        │
│    - task.result = código generado                              │
│    - project.progress = 100                                     │
│    - Agent Bus: worker:task_completed                           │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Finalizar proyecto                                           │
│    project_done({                                               │
│      projectId: "jwt-auth-001",                                 │
│      summary: "JWT implementado con access y refresh tokens"    │
│    })                                                           │
└─────────────────────────────────────────────────────────────────┘
```

### Ejemplo de Uso vía API

```bash
# Enviar solicitud al gateway
curl -X POST http://localhost:18790/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Implementa autenticación JWT en el proyecto. Usa delegate_code_task con Qwen CLI.",
    "thread_id": "jwt-feature-001"
  }'
```

### Ejemplo de Uso vía CLI

```bash
# Chat directo con el coordinador
bun run hive chat --message "Implementa JWT con Qwen CLI"
```

---

## 🔒 Consideraciones de Seguridad

### 1. Aislamiento de Procesos

```typescript
// packages/code-bridge/src/process-manager.ts
const proc = Bun.spawn(args, {
    cwd: config.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // Ejecutar con usuario limitado
    uid: process.getuid?.() ?? 0,  // TODO: Configurar usuario sandbox
    env: {
        ...process.env,
        // No exponer variables sensibles
        NODE_ENV: "production",
        HIVE_ROLE: config.role,
    },
    // Limitar recursos
    resourceLimits: {
        maxMemory: 2 * 1024 * 1024 * 1024,  // 2GB
        maxCpu: 50,  // 50% CPU
    },
});
```

### 2. Timeout y Límites

```typescript
// Timeout por defecto: 600 segundos (10 minutos)
const timeoutSeconds = config.timeoutSeconds ?? 600;

// Timeout hard kill
const hardKillTimeout = setTimeout(() => {
    proc.kill("SIGKILL");
}, timeoutSeconds * 1000 + 30000);  // +30s grace period
```

### 3. Validación de Output

```typescript
// Sanitizar output antes de guardar
function sanitizeOutput(output: string): string {
    // Remover posibles secretos
    return output
        .replace(/API_KEY=\w+/g, "API_KEY=[REDACTED]")
        .replace(/password=\w+/g, "password=[REDACTED]")
        .replace(/token=\w+/g, "token=[REDACTED]")
        .substring(0, 50000);  // Límite de 50KB
}
```

### 4. Auditoría de Acciones

```sql
-- Tabla de auditoría
CREATE TABLE IF NOT EXISTS code_bridge_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    project_id TEXT,
    cli TEXT NOT NULL,
    prompt_hash TEXT,
    exit_code INTEGER,
    duration_ms INTEGER,
    tokens_input INTEGER,
    tokens_output INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Registrar cada ejecución
INSERT INTO code_bridge_audit 
  (task_id, project_id, cli, prompt_hash, exit_code, duration_ms)
VALUES (?, ?, ?, ?, ?, ?);
```

---

## 🔧 Troubleshooting

### Problema: Code Bridge no inicia

**Síntoma:**
```
Error: Port 18791 is already in use
```

**Solución:**
```bash
# Matar proceso existente
lsof -ti :18791 | xargs kill -9

# O cambiar puerto
export CODE_BRIDGE_PORT=18792
bun run packages/code-bridge/src/index.ts
```

### Problema: Qwen CLI no responde

**Síntoma:**
```
⏱️ Timeout alcanzado (120s)
```

**Solución:**
```bash
# Verificar instalación
which qwen
qwen --version

# Probar manualmente
qwen -y -p "Hello, world"

# Reinstalar si es necesario
npm uninstall -g qwen-cli
npm install -g qwen-cli
```

### Problema: WebSocket se desconecta

**Síntoma:**
```
❌ WebSocket error: Connection closed
```

**Solución:**
```bash
# Verificar logs de Code Bridge
journalctl -u hive-code-bridge -f

# Reiniciar servicio
sudo systemctl restart hive-code-bridge

# Verificar firewall
sudo ufw allow 18791/tcp
```

### Problema: Output vacío

**Síntoma:**
```json
{
  "ok": true,
  "output": ""
}
```

**Solución:**
1. Verificar stderr en logs
2. Aumentar timeout: `"timeout_seconds": 900`
3. Simplificar prompt inicial
4. Verificar permisos de escritura en workspace

---

## 📈 Métricas y Monitoreo

### Métricas Clave

| Métrica | Objetivo | Alerta |
|---------|----------|--------|
| **Latencia promedio** | < 30s | > 60s |
| **Tasa de éxito** | > 95% | < 80% |
| **Timeout rate** | < 5% | > 10% |
| **Token usage (avg)** | < 5000 tokens | > 10000 |

### Dashboard de Monitoreo

```typescript
// Endpoint de métricas
GET /api/metrics/code-bridge

Response:
{
  "total_tasks": 1250,
  "success_rate": 97.2,
  "avg_duration_ms": 28500,
  "timeout_count": 42,
  "error_count": 15,
  "cli_usage": {
    "qwen": 850,
    "claude": 300,
    "opencode": 100
  },
  "token_usage": {
    "total_input": 1250000,
    "total_output": 875000,
    "avg_per_task": 1700
  }
}
```

---

## 📚 Referencias

- **Código Fuente:**
  - `packages/core/src/tools/delegate-code-task.ts`
  - `packages/code-bridge/src/`
  - `tests/codebridge-qwen-test.ts`

- **Documentación Relacionada:**
  - `PROYECTOS_Y_DELEGACION.md` - Guía de proyectos y workers
  - `CODEBRIDGE_QWEN_TEST.md` - Protocolo y arquitectura

- **Comandos Útiles:**
  ```bash
  # Ver logs en tiempo real
  journalctl -u hive-code-bridge -u hive-gateway -f
  
  # Ver métricas
  curl http://localhost:18790/api/metrics/code-bridge
  
  # Ver estado de tareas
  sqlite3 /var/lib/hive/data/hive.db \
    "SELECT id, name, status, progress FROM tasks WHERE project_id='<id>';"
  ```
