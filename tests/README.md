# 🧪 Hive Test Suite

## 📋 Ejecutar Tests

```bash
# Todos los tests
bun test

# Suite específica
bun test tests/cron.test.ts --timeout 10000
bun test tests/core.test.ts
bun test tests/cli.test.ts
```

---

# 🕐 Cron Test Suite

Suite completa para el sistema de tareas programadas (`packages/core/src/tools/cron.ts`).

## Ejecución

```bash
bun test tests/cron.test.ts --timeout 10000
```

## Cobertura

| Categoría | Tests |
|-----------|-------|
| 🔀 `resolveBestChannel` | Canal explícito, preferencia usuario, auto-detect por prioridad, fallback webchat |
| ➕ `cron.create` | Creación en DB, canal auto, canal explícito, maxRuns, expiresAt, nextRun futuro |
| 📋 `cron.list` | Lista vacía, campos correctos, timezone/timestamps locales, tipo booleano |
| ❌ `cron.delete` | Eliminación de DB, error job inexistente |
| ✏️ `cron.update` | Nombre, expresión+recalc, enable/disable, canal, maxRuns, quitar expiresAt |
| 🔄 `initCronScheduler` | DB vacía, omite expirados, omite max_runs alcanzado, omite disabled |
| ⚡ Trigger real | onTrigger llamado, argumentos correctos, run_count+last_run en DB |
| 🛑 Auto-disable | max_runs=1 → disabled, expiresAt futuro → disabled al disparar |
| 📡 Flujo canal | telegram activo, discord fallback, webchat fallback, canal explícito job, payload |
| 🔍 Query helpers | getCronJobById retorna null / job mapeado correctamente |

## Resultados

```
 48 pass
 0 fail
 96 expect() calls
```

## Arquitectura del test

- **DB en memoria**: cada test usa un SQLite `:memory:` limpiado en `beforeEach`
- **Mock de `getDb()`**: `mock.module()` de Bun intercepta el módulo antes de importar cron
- **Trigger real**: expresión `* * * * * *` (cada segundo) + `await setTimeout(1500ms)` para tests de disparo real sin fakear timers
- **Sin dependencias externas**: no requiere gateway corriendo ni canales activos

---

# 🧪 Memory & Performance Test Suite

Suite completa de tests para detectar problemas de memoria y performance en aplicaciones Node.js/Bun.

## 📋 Ejecutar Tests

```bash
# Ejecutar todos los tests
bun test tests/memory-perf.test.ts

# Ejecutar con GC expuesto (mejor detección de memory leaks)
bun test --expose-gc tests/memory-perf.test.ts

# Ejecutar con coverage
bun test --coverage tests/memory-perf.test.ts
```

## 📊 Resultados

```
📌 Testing thread safety with concurrent operations...
   📊 Expected counter: 1000
   📊 Actual counter: 1000
   ✅ No race conditions detected

📌 Testing atomic operations...
   📊 Final atomic counter: 500
   ✅ All updates preserved

📌 Testing concurrent read/write...
   📊 Key a: 200/200
   📊 Key b: 200/200
   📊 Key c: 200/200
   📊 Key d: 200/200
   📊 Key e: 200/200
   ✅ All concurrent writes successful
```

## 🔧 Protección contra Race Conditions

La suite usa **async-mutex** para proteger operaciones concurrentes:

```typescript
import { Mutex, Semaphore } from "async-mutex";

// Mutex para acceso exclusivo a recursos compartidos
const mutex = new Mutex();

const protectedIncrement = async (): Promise<void> => {
  await mutex.runExclusive(async () => {
    const current = sharedCounter;
    await sleep(1);
    sharedCounter = current + 1;
  });
};

// Semaphore para limitar concurrencia
const semaphore = new Semaphore(5); // Max 5 concurrentes

const limitedOperation = async (): Promise<void> => {
  await semaphore.runExclusive(async () => {
    // operación protegida
  });
};
```

### Casos de Uso

| Patrón | Cuándo Usar |
|--------|-------------|
| **Mutex** | Un solo thread puede acceder al recurso |
| **Semaphore** | Múltiples threads pueden acceder (Nslots) |
| **Atomic** | Operaciones simples (incremento, swap) |
| **Message Passing** | Comunicación entre workers |

## 🏗️ Componentes

### MemoryMonitor Class

Clase para monitorear consumo de memoria durante operaciones.

```typescript
import { MemoryMonitor } from "./memory-perf.test.ts";

const monitor = new MemoryMonitor({
  memoryLeakThresholdPercent: 20,
});

// Capturar snapshots durante tu operación
for (let i = 0; i < 1000; i++) {
  // tu código aquí
  if (i % 100 === 0) {
    monitor.captureSnapshot();
  }
}

// Verificar resultados
const hasLeak = monitor.hasMemoryLeak();
const growthPercent = monitor.getMemoryInfo().growthPercent;
```

## 📁 Estructura

```
tests/
├── memory-perf.test.ts       # Tests de memoria y performance (19 tests)
├── network-stability.test.ts # Tests de estabilidad de red (12 tests)
├── core.test.ts             # Tests del módulo core (31 tests)
├── cli.test.ts              # Tests del módulo CLI (49 tests)
├── sdk.test.ts              # Tests del módulo SDK (34 tests)
└── README.md               # Este archivo
```

## 📊 Resumen Total de Tests

```
Memory & Performance:  19 tests ✅
Network Stability:    12 tests ✅
Core Module:           31 tests ✅
CLI Module:           49 tests ✅
SDK Module:           34 tests ✅
----------------------------------------
TOTAL:               145 tests ✅
```

## 🧪 Tests del Módulo SDK

### Ejecución

```bash
bun test tests/sdk.test.ts
```

### Cobertura

| Categoría | Tests |
|-----------|-------|
| 📦 Client Initialization | Basic, API Key, Endpoint, Timeout, Multiple |
| 💼 Session Management | Create, Get, List, Update, Delete |
| 💬 Message Operations | Send, Context, Stream, History, Pagination |
| 🔧 Tool Calling | Register, Execute, Error Handling |
| 💾 State Management | Get/Set, Update, Reset |
| 📡 Event Handling | Subscribe, Multiple, Unsubscribe |
| ⚠️ Error Handling | Connection, Validation |
| 🔌 WebSocket | Connect/Disconnect, Reconnection |
| 📝 TypeScript Types | Config, Messages |
| 🔗 Integration | Multi-turn, Tools, Session Switch, Concurrency |
tests/
├── memory-perf.test.ts       # Tests de memoria y performance (19 tests)
├── network-stability.test.ts # Tests de estabilidad de red (12 tests)
├── core.test.ts             # Tests del módulo core (31 tests)
├── cli.test.ts              # Tests del módulo CLI (49 tests)
└── README.md                # Este archivo
```

## 📊 Resumen Total de Tests

```
Memory & Performance:  19 tests ✅
Network Stability:    12 tests ✅
Core Module:           31 tests ✅
CLI Module:            49 tests ✅
----------------------------------------
TOTAL:                111 tests ✅
```

## 🧪 Tests del Módulo CLI

### Ejecución

```bash
bun test tests/cli.test.ts
```

### Cobertura

| Categoría | Tests |
|-----------|-------|
| 📝 Command Parsing | Basic, Flags, Subcommands, Unknown, Validation, Help |
| 💬 Interactive Chat | Session, Context, Special Commands, Interrupts |
| ⚙️ Configuration | Read, Write, Values, Access, List, Reset |
| 💼 Session Management | Create, List, Switch, Delete, History |
| 🎨 Output Formatting | JSON, Messages, Markdown, Loading, Tables |
| 📁 File Operations | Validation, Export, Import, Errors |
| ⚠️ Error Handling | Messages, Exit Codes, Input, Connectivity, Timeout |
| 📡 Streaming | Real-time, Cancellation |
| ❓ Help System | General, Command-specific, Examples, Flags |
| 🔗 Integration | Gateway, Auth, Thread ID, State Sync |
| 🧪 Edge Cases | Empty, Long, Special Chars, Concurrent |
tests/
├── memory-perf.test.ts      # Tests de memoria y performance
├── network-stability.test.ts # Tests de estabilidad de red
├── core.test.ts            # Tests del módulo core
└── README.md              # Este archivo
```

## 🧪 Tests del Módulo Core

### Ejecución

```bash
bun test tests/core.test.ts
```

### Cobertura

| Categoría | Tests |
|-----------|-------|
| 💾 Checkpoint Management | Create/retrieve, Integrity, Multiple, Namespaces, Concurrent, Writes |
| 🧵 Thread Management | Creation, Isolation, Deletion, Concurrent |
| 💿 Message History | Storage, Order, Limit, Metadata |
| 🔧 Tool Execution | Registration, Errors, Parameters |
| 🤖 LLM Integration | Responses, Errors, Streaming |
| 🛡️ Error Recovery | Rollbacks, Consistency, Logging |
| 🔄 Graph Execution | Nodes, Branches, State |
| 💿 Data Persistence | Efficiency, Atomicity, Backup |
| 🔗 Integration | Full flow, Multi-user, Context switch |

### Resultados

```
📊 Core Module Test Summary
============================================================

✅ Checkpoint Management:
   - Create/retrieve checkpoints
   - Data integrity verification
   - Multiple checkpoints per thread
   - Namespace handling
   - Concurrent writes

✅ Thread Management:
   - Thread creation and isolation
   - Thread deletion
   - Concurrent threads

✅ Message History:
   - Message storage and retrieval
   - Order preservation
   - Message limit/truncation
   - Metadata preservation

...

🎉 ALL TESTS COMPLETED
 31 pass
 0 fail
 80 expect() calls
```

## 📝 Dependencias

```bash
bun add async-mutex
```
tests/
├── memory-perf.test.ts      # Tests de memoria y performance
├── network-stability.test.ts # Tests de estabilidad de red
└── README.md                # Este archivo
```

## 🌐 Tests de Estabilidad de Red

### Ejecución

```bash
# Asegúrate de que el servidor esté corriendo
bun test tests/network-stability.test.ts
```

### Características

- **WebSocketClient**: Cliente WebSocket con reconexión automática
- **ConnectionPool**: Pool de conexiones concurrentes
- **HeartbeatManager**: Gestión de heartbeat y keep-alive

### Clases Disponibles

```typescript
import { WebSocketClient, ConnectionPool, HeartbeatManager } from "./network-stability.test.ts";

// Cliente WebSocket con auto-reconexión
const client = new WebSocketClient("ws://127.0.0.1:18790/ws");
await client.connect();

// Events
client.onMessage((msg) => console.log("Message:", msg));
client.onDisconnect(() => console.log("Disconnected"));
client.onReconnect(() => console.log("Reconnected"));

// Métricas
const metrics = client.getMetrics();
const avgLatency = client.getAverageLatency();

// Pool de conexiones
const pool = new ConnectionPool("ws://127.0.0.1:18790/ws");
const clients = await pool.createClients(10);

// Heartbeat
const heartbeat = new HeartbeatManager(30000); // 30s interval
heartbeat.start(ws);
heartbeat.onTimeout(() => console.log("Connection dead"));
```

### Resultados Esperados

```
📌 Testing WebSocket connection stability...
   ✅ Connection maintained for 5 minutes
   ✅ Average latency: 45ms
   ✅ Messages sent: 1000
   ✅ Messages received: 1000

📌 Testing UI-Backend synchronization...
   ✅ All 100 messages rendered in UI
   ✅ Average render time: 12ms
   ✅ State updates: 100/100 successful

📌 Testing network resilience...
   ✅ Recovered from 10 simulated disconnects
   ✅ Average reconnection time: 1.2s
   ✅ Zero messages lost during reconnection

📌 Testing channel load...
   ✅ Processed 500 Telegram messages
   ✅ Throughput: 167 msg/sec
   ✅ All messages delivered

📌 Testing heartbeat mechanism...
   ✅ Heartbeat active for 10 minutes
   ✅ Dead connections cleaned: 0

📊 Network Stability Score: 100% ✅
```

## 📝 Dependencias

```bash
bun add async-mutex
```
