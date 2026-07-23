# Documentación Explicativa: Arquitectura Completa de Hive

**Fecha**: 2026-05-18  
**Propósito**: Documentar todos los componentes del sistema Hive — desde el core de agentes hasta infraestructura de comunicaciones, seguridad, UI y más.

> ⚠️ **Nota de vigencia (todo el documento)**: escrito en la era SQLite. Hive migró su storage
> a HiveDB (`@johpaz/hive-db`: redb + tantivy + hnsw) — `storage/schema.ts` y `storage/sqlite.ts`
> ya no existen (ver `storage/hivedb.ts`, `storage/hive.ts`, `storage/collections.ts`). Las
> "tablas" citadas abajo son hoy colecciones de documentos HiveDB; FTS5 (extensión de SQLite)
> fue reemplazado por tantivy con ranking BM25 — no es "FTS5 dentro de HiveDB", es un motor de
> búsqueda distinto. Nombres y propósito de cada componente siguen siendo una referencia
> razonable; SQL literal, nombres de archivo y líneas citadas no están verificados contra el
> código actual — confirmar contra `storage/collections.ts` antes de confiar en un detalle puntual.

---

## Índice

### Parte I: Core de Inteligencia
1. [Agent Loop](#1-agent-loop)
   - [Tool Runtime con Bun Workers](#tool-runtime-con-bun-workers)
2. [Context Compiler](#2-context-compiler)
3. [FTS5 (Full-Text Search 5)](#3-fts5-full-text-search-5)
4. [ACE (Adaptive Context Engine)](#4-ace-adaptive-context-engine)
5. [Playbook](#5-playbook)
6. [DAG Scheduler](#6-dag-scheduler)
7. [LLM Providers](#7-llm-providers)

### Parte II: Infraestructura de Comunicaciones
8. [Gateway](#8-gateway)
9. [Channels](#9-channels)
10. [Event Bus](#10-event-bus)
11. [MCP Integration](#11-mcp-integration)

### Parte III: Seguridad y Resiliencia
12. [Authentication](#12-authentication)
13. [Security](#13-security)
14. [Resilience (Circuit Breaker)](#14-resilience-circuit-breaker)

### Parte IV: Sistemas de Experiencia
15. [Voice (STT/TTS)](#15-voice-stttts)
16. [Canvas / A2UI](#16-canvas--a2ui)
17. [Multimodal (Vision/OCR)](#17-multimodal-visionocr)

### Parte V: Plataforma
18. [Storage Layer](#18-storage-layer)
19. [State Management](#19-state-management)
20. [Heartbeat](#20-heartbeat)
21. [Plugins](#21-plugins)
22. [Skills](#22-skills)
23. [CLI](#23-cli)
24. [Hive-UI (Dashboard)](#24-hive-ui-dashboard)

### Parte VI: Integración
25. [Cómo Interactúan Todos los Componentes](#25-cómo-interactúan-todos-los-componentes)

---

## 1. Agent Loop

### ¿Qué es?

El **Agent Loop** es el corazón ejecutor de Hive. Es un ciclo iterativo que procesa mensajes del usuario, consulta al LLM, ejecuta herramientas y produce respuestas. Se encuentra en `packages/core/src/agent/agent-loop.ts`.

### ¿Cómo funciona?

```
Mensaje del usuario
       ↓
┌─────────────────────────────────────────┐
│  compileContext()                       │
│  → Carga agente, scratchpad, MCP,       │
│    skills, historial, ética, usuario    │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  callLLM(messages, tools)               │
│  → Envía prompt al modelo (Gemini,     │
│    OpenAI, etc.)                        │
└──────────────┬──────────────────────────┘
               ↓
     ¿Hay tool_calls?
       /          \
     SÍ            NO
     ↓              ↓
┌─────────┐   ┌──────────┐
│Ejecutar │   │  Emitir  │
│tools    │   │ respuesta│
└────┬────┘   └──────────┘
     │
     ↓
  ¿search_knowledge?
     /          \
   SÍ            NO
   ↓              ↓
 Inyectar    Volver a
 tools       callLLM
 descubiertos
```

### Características clave

| Aspecto | Detalle |
|---------|---------|
| **Tipo** | Generator asíncrono (`AsyncGenerator<StreamChunk>`) |
| **Iteraciones máximas** | Configurables por agente (default: 10) |
| **Herramientas mínimas** | 4 siempre disponibles: `save_note`, `notify`, `report_progress`, `search_knowledge` |
| **Herramientas totales** | 70+ nativas + MCP tools (descubrimiento dinámico) |
| **Streaming** | Emite chunks en tiempo real vía `emitCanvas()` |
| **Persistencia** | Guarda trazas y mensajes en HiveDB |

### Tipos de agente

- **Coordinator**: Contexto completo (proyectos, skills descubiertas, panorama general)
- **Worker**: Contexto mínimo (solo task_description, 3 skills mínimas, 4 tools básicas)

### Archivos relacionados

| Archivo | Función |
|---------|---------|
| `agent-loop.ts` | Loop principal |
| `context-compiler.ts` | Compilación de contexto |
| `llm-client.ts` | Comunicación con LLMs |
| `conversation-store.ts` | Persistencia de mensajes |
| `tracer.ts` | Registro de trazas |
| `stuck-loop.ts` | Detección de bucles infinitos |
| `hooks.ts` | Hooks de ciclo de vida del agente |
| `context-guard.ts` | Guardias de seguridad del contexto |

### Tool Runtime con Bun Workers

El **Tool Runtime** es el subsistema encargado de ejecutar las herramientas que el modelo solicita durante un turno. Vive en `packages/core/src/tool-runtime/` y se integra directamente con el Agent Loop mediante `executeToolBatch(...)`.

Su objetivo es reducir latencia cuando el LLM devuelve varias `tool_calls` en la misma respuesta. En vez de ejecutar cada herramienta una por una, Hive agenda el lote completo y lo ejecuta en paralelo cuando es posible.

```
LLM devuelve varias tool_calls
        ↓
Agent Loop emite tool_call steps
        ↓
executeToolBatch(...)
        ↓
┌────────────────────────────────────────────┐
│        Tool Runtime Scheduler              │
│                                            │
│  ┌────────────┐  ┌────────────┐            │
│  │ Worker #1  │  │ Worker #2  │   ...      │
│  └─────┬──────┘  └─────┬──────┘            │
│        │               │                   │
│  tool nativa      tool nativa              │
│  reconstruible    reconstruible            │
│                                            │
│  Si la tool depende de estado vivo:        │
│  Worker → RPC interno → proceso principal  │
└────────────────────────────────────────────┘
        ↓
Resultados ordenados por response.tool_calls
        ↓
Siguiente callLLM()
```

#### Responsabilidades

| Responsabilidad | Detalle |
|-----------------|---------|
| **Scheduling por lote** | Recibe todas las `tool_calls` del turno y las agenda juntas |
| **Pool persistente** | Mantiene Bun Workers reutilizables, evitando crear procesos por cada tool |
| **Paralelismo controlado** | Usa `maxWorkers` para limitar concurrencia |
| **Orden estable** | Devuelve resultados en el orden original, aunque terminen desordenados |
| **Timeout por tool** | Cancela lógicamente tools que superan `toolTimeoutMs` |
| **Errores aislados** | Una tool fallida no cancela automáticamente a sus herramientas hermanas |
| **AbortSignal** | Marca trabajos pendientes/en ejecución como abortados cuando se detiene la generación |
| **RPC al main thread** | Ejecuta en el proceso principal herramientas con dependencias vivas |

#### Herramientas reconstruibles vs herramientas con estado vivo

No todas las herramientas pueden ejecutarse completamente dentro de un Worker. Algunas dependen de objetos que no se pueden transferir por `postMessage`, como conexiones MCP, WebSockets, estado del navegador o canvas interactivo.

| Tipo | Ejecución | Ejemplos |
|------|-----------|----------|
| **Reconstruible** | El Worker reconstruye `createAllTools(config)` y ejecuta localmente | filesystem, web simple, office cuando no depende de estado vivo |
| **Estado vivo** | El Worker agenda la tool, pero llama al proceso principal por RPC | MCP, Browser, Canvas/A2UI, Cron, notificaciones, voz, delegación |

Regla central:

> Toda tool call pasa por el scheduler. Si no es seguro reconstruirla en Worker, se ejecuta vía RPC controlado en el proceso principal.

#### Configuración

La configuración vive en `tools.workerPool`:

```ts
tools: {
  workerPool: {
    enabled: true,
    maxWorkers: Math.min(4, availableParallelism()),
    toolTimeoutMs: 300000,
    parallelToolCalls: true,
  }
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `enabled` | `true` | Activa el runtime de Workers |
| `maxWorkers` | `min(4, CPUs)` | Máximo de Workers persistentes |
| `toolTimeoutMs` | `300000` | Timeout por herramienta |
| `parallelToolCalls` | `true` | Ejecuta en paralelo herramientas del mismo turno |

#### Archivos relacionados

| Archivo | Función |
|---------|---------|
| `packages/core/src/tool-runtime/index.ts` | Scheduler, Worker pool, timeout, abort y RPC main-thread |
| `packages/core/src/tool-runtime/tool-worker.ts` | Código que corre dentro de cada Bun Worker |
| `packages/core/src/agent/agent-loop.ts` | Integra `executeToolBatch(...)` con streaming, TOON, traces e historial |
| `packages/core/src/config/loader.ts` | Define defaults de `tools.workerPool` |
| `tests/tool-runtime.test.ts` | Tests de paralelismo, orden, error isolation, timeout, abort y RPC |

---

## 2. Context Compiler

### ¿Qué es?

El **Context Compiler** es el ensamblador del prompt del agente. Se encuentra en `packages/core/src/agent/context-compiler.ts` y es responsable de construir el system prompt completo con toda la información relevante para cada turno de conversación.

### Estrategias de Context Engineering

El Context Compiler implementa 5 estrategias:

| Estrategia | Componente | Descripción |
|------------|-----------|-------------|
| **ESCRIBIR** | Scratchpad | Notas persistentes fuera de la ventana de contexto |
| **SELECCIONAR** | Tool/Skill/Playbook Loadout | Solo herramientas y reglas relevantes |
| **COMPRIMIR** | Compaction | Resume mensajes viejos cuando tokens > 6000 |
| **AISLAR** | Worker Context | Agents worker reciben contexto mínimo |
| **APRENDER** | Playbook | Aprende de patrones de ejecución (vía ACE) |

### Fases de compilación

```
[STEP-1]  Load Agent Config (DB: agents)
[STEP-2]  Load Scratchpad (DB: scratchpad)
[STEP-3c] Load MCP Tools (MCP Manager + DB: mcp_servers)
[STEP-4]  Build Minimal Tool Set (4 tools básicas)
[STEP-8b] Skill Loadout (FTS5: skills_fts)
[STEP-9]  Load Conversation History (últimos 40 mensajes)
[STEP-9b] Load Summary (si tokens > 6000)
[STEP-10] Build System Prompt (ethics + agent + user)
[STEP-10b] Inject Date/Time + Timezone
[STEP-10c] Inject Projects (coordinator only)
[STEP-10d] Inject Tool/Skill Catalog Instructions
```

### Jerarquía del System Prompt

```
1. ÉTICA (reglas constitucionales, siempre completas)
2. IDENTIDAD DEL AGENTE (nombre, rol, system_prompt, workspace)
3. HIVE CAPABILITIES MANIFEST
4. PERFIL DEL USUARIO (nombre, timezone, ocupación)
5. REGLAS DEL PLAYBOOK (FTS5, máx 5 por turno)
6. NOTAS DEL SCRATCHPAD (filtradas por thread_id)
7. ENTORNO (agent_id, thread_id, fecha/hora)
8. SKILLS ACTIVAS (mínimas + descubiertas)
9. PROYECTOS ACTIVOS (solo coordinator)
```

### Compresión inteligente

| Umbral | Acción |
|--------|--------|
| `KEEP_LAST_N_MESSAGES = 40` | Últimos 40 mensajes siempre cargados |
| `TOKEN_COMPACT_THRESHOLD = 6000` | Si supera, usa resumen + últimos 40 |

### Dynamic Tool Injection

Durante la ejecución, si el agente usa `search_knowledge`, el Agent Loop:

1. Intercepta el resultado
2. Extrae herramientas descubiertas
3. Las inyecta en `ctx.tools` (ahora son callable)
4. Inyecta skills asociadas en el system prompt

---

## 3. FTS5 (Full-Text Search 5)

### ¿Qué es?

**BM25** es el algoritmo de ranking del índice de búsqueda de texto completo que HiveDB implementa vía **tantivy** (reemplaza a FTS5 de SQLite, que ya no se usa). Hive lo utiliza para búsqueda semántica, permitiendo seleccionar dinámicamente herramientas, skills y reglas del playbook relevantes al contexto del usuario.

### Tablas FTS5 en Hive

```sql
CREATE VIRTUAL TABLE tools_fts USING fts5(tool_name, name, description, category);
CREATE VIRTUAL TABLE skills_fts USING fts5(id, name, description, category, tools, triggers, body);
CREATE VIRTUAL TABLE playbook_fts USING fts5(rule, category, applicable_to);
CREATE VIRTUAL TABLE mcp_tools_fts USING fts5(server_name, tool_name, description, category);
```

### Cómo funciona BM25

BM25 asigna **puntajes negativos** a los resultados:
- **Más cercano a 0** = más relevante
- **Más negativo** = menos relevante

```sql
SELECT *, bm25(tools_fts) as score
FROM tools_fts
WHERE tools_fts MATCH 'web search'
ORDER BY score ASC
LIMIT 12
```

### Selectores que usan FTS5

| Selector | Archivo | Umbral | Máximo |
|----------|---------|--------|--------|
| **Tool Selector** | `tool-selector.ts` | -30 | 12 tools |
| **Skill Selector** | `skill-selector.ts` | -15 | 4 skills |
| **Playbook Selector** | `playbook-selector.ts` | -10 | 5 rules |

### Proceso de búsqueda

```
Mensaje del usuario: "Busca noticias sobre IA"
         ↓
1. Filtrar stopwords → ["busca", "noticias", "IA"]
         ↓
2. Construir query FTS5 → "busca* OR noticias* OR IA*"
         ↓
3. Ejecutar SELECT con bm25() → resultados ordenados por score
         ↓
4. Filtrar por umbral → solo resultados relevantes
         ↓
5. Retornar top N → inyectar en contexto
```

### Prefix matching

FTS5 soporta búsqueda por prefijo con `*`:
- `"gener*"` coincide con "generar", "generación", "generado"
- Esto permite matching flexible sin necesidad de stemming

---

## 4. ACE (Adaptive Context Engine)

### ¿Qué es?

El **ACE** es el sistema de **auto-aprendizaje** de Hive. Observa la ejecución del agente, detecta patrones y genera reglas de comportamiento automáticamente. No requiere llamadas al LLM — todo es procesamiento local en HiveDB.

### Las 3 etapas del ACE

```
┌─────────────────────────────────────────────────────────────┐
│                    CICLO ACE                                 │
│                                                              │
│  ┌──────────┐     ┌───────────┐     ┌──────────┐            │
│  │ TRACER   │────→│ REFLECTOR │────→│ CURATOR  │            │
│  │          │     │           │     │          │            │
│  │ Registra │     │ Analiza   │     │ Convierte│            │
│  │ ejecuc.  │     │ patrones  │     │ en reglas│            │
│  └──────────┘     └───────────┘     └──────────┘            │
│       ↓                  ↓                  ↓                │
│   Tabla:             Tabla:            Tabla:               │
│   traces             reflections       playbook             │
└─────────────────────────────────────────────────────────────┘
```

### Etapa 1: Tracer

**Archivo**: `packages/core/src/agent/tracer.ts`

Registra cada ejecución del agente como una traza:

```typescript
interface TraceInput {
  threadId: string
  agentId: string
  toolUsed?: string
  inputSummary: string
  outputSummary: string
  success: boolean
  errorMessage?: string
  durationMs?: number
  tokensUsed?: number
}
```

**Trigger automático**: Cada 20 trazas nuevas → invoca al Reflector.

### Etapa 2: Reflector

**Archivo**: `packages/core/src/agent/reflector.ts`

Analiza trazas con **heurística local** (sin LLM):

| Patrón | Detección |
|--------|-----------|
| `failure_pattern` | Herramienta falla 3+ veces |
| `optimization` (tiempo) | Herramienta tarda >5000ms (3+ veces) |
| `optimization` (tokens) | Múltiples llamadas >4000 tokens |
| `success_pattern` | Herramienta 90%+ éxito en 5+ llamadas |
| `ethics_violation` | Reservado para violaciones éticas |

### Etapa 3: Curator

**Archivo**: `packages/core/src/agent/curator.ts`

Convierte reflexiones en reglas del Playbook:

| Acción | Condición |
|--------|-----------|
| **Crear regla** | Nuevo insight → `helpful_count = 1` |
| **Reforzar** | Patrón similar ya existe → `helpful_count++` |
| **Penalizar** | Regla contradicha → `harmful_count++` |
| **Podar** | `harmful_count > helpful_count` Y `harmful_count >= 3` → `active = 0` |
| **Archivar workers** | Inactivo 14+ días → regla explicativa |

### Mapeo de insights a categorías

```typescript
const map = {
  success_pattern: "tool_selection",
  failure_pattern: "error_avoidance",
  optimization: "optimization",
  ethics_violation: "error_avoidance",
}
```

### Constantes del ACE

| Constante | Valor | Descripción |
|-----------|-------|-------------|
| `REFLECTOR_TRACE_THRESHOLD` | 20 | Trazas para activar Reflector |
| `CURATOR_MIN_TRACES` | 10 | Mínimo trazas por ciclo |
| `CURATOR_MAX_TRACES` | 30 | Máximo trazas por ciclo |
| `FAILURE_THRESHOLD` | 3 | Fallos para detectar patrón |
| `SLOW_THRESHOLD_MS` | 5000 | ms para detectar lentitud |
| `SUCCESS_RATE_THRESHOLD` | 0.9 | Tasa de éxito mínima |
| `PRUNE_HARMFUL_MIN` | 3 | harmful_count mínimo para poda |
| `ARCHIVE_INACTIVE_DAYS` | 14 | Días para archivar workers |

---

## 5. Playbook

### ¿Qué es?

El **Playbook** es una colección HiveDB (`playbook`) que contiene **reglas de comportamiento** aprendidas automáticamente por el ACE. Es el producto final del ciclo de auto-aprendizaje.

### ¿Por qué se usa?

1. **Memoria entre sesiones**: El agente "aprende de la experiencia"
2. **Gestión de tokens**: Solo 5 reglas relevantes por turno (FTS5)
3. **Auto-corrección**: Reglas malas se desactivan automáticamente
4. **Transferencia a Workers**: Workers reciben las mismas reglas relevantes
5. **Consistencia**: 5 categorías cubren los puntos de decisión más importantes

### Schema

```sql
CREATE TABLE playbook (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    rule                  TEXT NOT NULL,
    category              TEXT NOT NULL CHECK(category IN
      ('tool_selection','response_quality','error_avoidance','optimization','agent_creation')),
    applicable_to         TEXT,       -- JSON array de contextos
    helpful_count         INTEGER NOT NULL DEFAULT 0,
    harmful_count         INTEGER NOT NULL DEFAULT 0,
    source_reflection_id  INTEGER REFERENCES reflections(id),
    active                INTEGER NOT NULL DEFAULT 1,
    created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### 5 Categorías de reglas

| Categoría | Descripción | Ejemplo |
|-----------|-------------|---------|
| `tool_selection` | Qué herramienta usar | "Para buscar noticias, usa `web_search` con filtros" |
| `response_quality` | Cómo mejorar respuestas | "Incluye ejemplos concretos al explicar conceptos" |
| `error_avoidance` | Qué errores evitar | "Confirma antes de ejecutar comandos destructivos" |
| `optimization` | Cómo optimizar | "Divide tareas grandes en pasos independientes" |
| `agent_creation` | Cómo delegar a workers | "Proporciona descripciones claras con resultados esperados" |

### Ciclo de vida de una regla

```
[1] Detección → Reflector analiza trazas
     ↓
[2] Creación → Curator crea regla (helpful_count = 1)
     ↓
[3] Selección → Context Compiler selecciona vía FTS5
     ↓
[4] Inyección → Regla en system prompt (máx 5/turno)
     ↓
[5] Validación → Patrón se repite → helpful_count++
     ↓
[6] Poda o Refuerzo → harmful_count >= 3 → active = 0
```

### Reglas iniciales (Seed)

En el primer inicio, se siembran 8 reglas:

| # | Regla | Categoría |
|---|-------|-----------|
| 1 | Para buscar noticias, usa `web_search` con filtros de fecha | `tool_selection` |
| 2 | Confirma antes de ejecutar comandos shell destructivos | `error_avoidance` |
| 3 | Para consultas de código, usa shell + file_manager | `optimization` |
| 4 | Divide tareas en pasos atómicos independientes | `agent_creation` |
| 5 | Guarda preferencias en scratchpad con `save_note` | `optimization` |
| 6 | Si una herramienta falla, reintenta una vez | `error_avoidance` |
| 7 | Usa formato TOON para análisis de datos | `optimization` |
| 8 | Al delegar, proporciona descripciones claras | `agent_creation` |

### Playbook vs Skills vs Scratchpad

| Aspecto | Playbook | Skills | Scratchpad |
|---------|----------|--------|------------|
| **Origen** | Auto-generado (ACE) | Manual (usuario) | Agente (runtime) |
| **Contenido** | Reglas de comportamiento | Instrucciones de tareas | Notas clave-valor |
| **Selección** | FTS5 automática | FTS5 vía search_knowledge | Filtrado por thread_id |
| **Actualización** | Automática | Manual | Runtime |
| **Propósito** | Mejorar comportamiento | Guiar tareas específicas | Persistir datos |

---

## 6. DAG Scheduler

### ¿Qué es?

El **DAG Scheduler** es el orquestador de **tareas en paralelo**. Ejecuta grafos acíclicos dirigidos (DAG) de tareas, lanzando nodos concurrentemente según sus dependencias. Se encuentra en `packages/core/src/scheduler/dag/DAGScheduler.ts`.

### ¿Para qué sirve?

Permite crear **swarms** (enjambres) de agentes workers que ejecutan tareas en paralelo, respetando dependencias entre ellas. Ejemplo:

```
Investigar tema X
    ├── Worker 1: Buscar fuentes web
    ├── Worker 2: Consultar base de datos
    └── Worker 3: Analizar documentos
            ↓
    Worker 4: Sintetizar resultados (depende de 1, 2, 3)
```

### Componentes

| Componente | Archivo | Función |
|------------|---------|---------|
| **DAGScheduler** | `DAGScheduler.ts` | Orquestador principal |
| **TaskGraph** | `TaskGraph.ts` | Representación del grafo de tareas |
| **TaskNode** | `TaskNode.ts` | Nodo individual con estado |
| **AgentExecutor** | `AgentExecutor.ts` | Ejecuta nodos vía `runAgentIsolated` |
| **EventBridge** | `EventBridge.ts` | Emite eventos de progreso |
| **ParallelStrategy** | `ParallelStrategy.ts` | Estrategia de ejecución paralela |
| **PriorityStrategy** | `PriorityStrategy.ts` | Estrategia basada en prioridad |
| **ResearchPreset** | `ResearchPreset.ts` | Preset para investigación |

### Modelo de paralelismo

```
Promise.race() sobre Set de promesas activas
+ FIFO/priority queue de nodos READY esperando slot
+ maxConcurrentWorkers limita ejecución simultánea
```

**No usa Bun Worker threads** — los workers son llamadas async al agente (`runAgentIsolated`) corriendo concurrentemente en el mismo proceso.

### Flujo de ejecución

```
1. Identificar nodos sin dependencias → READY
       ↓
2. Lanzar concurrentemente (respetando maxConcurrentWorkers)
       ↓
3. Cuando un nodo completa:
   a. Marcar COMPLETED
   b. Encontrar nodos desbloqueados
   c. Lanzar nuevos nodos READY
       ↓
4. Si un nodo falla:
   a. ¿Puede reintentar? → retry
   b. No → FAILED + propagar a dependientes
       ↓
5. Esperar hasta que el grafo esté completo
```

### Estados de un nodo

| Estado | Descripción |
|--------|-------------|
| `PENDING` | Esperando dependencias |
| `READY` | Dependencias satisfechas, esperando slot |
| `RUNNING` | En ejecución |
| `COMPLETED` | Ejecución exitosa |
| `FAILED` | Fallo permanente (agotó reintentos) |

### Configuración

```typescript
interface DAGSchedulerOptions {
  strategy?: ExecutionStrategy        // Estrategia de ejecución
  maxConcurrentWorkers?: number       // Límite de workers simultáneos (default: 2)
  projectId?: string                  // ID para eventos
  coordinatorId?: string              // ID del coordinador
  silent?: boolean                    // Desactivar logs ASCII
  executor?: IAgentExecutor           // Executor custom (default: AgentExecutor)
}
```

### Resultado de ejecución

```typescript
interface DAGResult {
  swarmId: string
  totalDurationMs: number
  completed: NodeSummary[]
  failed: NodeSummary[]
  success: boolean
}

interface NodeSummary {
  id: string
  name: string
  status: "COMPLETED" | "FAILED"
  durationMs: number
  result?: string
  error?: string
  retries: number
}
```

### Manejo de fallos

| Situación | Comportamiento |
|-----------|----------------|
| Nodo falla (puede retry) | `retryCount++`, vuelve a READY |
| Nodo falla (agotó retries) | `FAILED`, propaga a dependientes |
| Dependiente de nodo FAILED | Se marca `FAILED` automáticamente |
| Deadlock guard | Si no hay running ni ready pero grafo no completo → break |
| Abort | `scheduler.abort()` detiene ejecución |

---

## 7. LLM Providers

### ¿Qué es?

El sistema de **LLM Providers** es la capa de abstracción que permite a Hive comunicarse con múltiples proveedores de modelos de lenguaje. Se encuentra en `packages/core/src/agent/llm-providers/`.

### Proveedores soportados

| Proveedor | Archivo | Tipo |
|-----------|---------|------|
| **OpenAI** | `openai.ts` | Cloud |
| **Anthropic (Claude)** | `anthropic.ts` | Cloud |
| **Google Gemini** | `gemini.ts` | Cloud |
| **Groq** | `groq.ts` | Cloud (ultra-fast) |
| **Ollama** | `ollama.ts` | Local |
| **Mistral** | `mistral.ts` | Cloud |
| **DeepSeek** | `deepseek.ts` | Cloud |
| **Qwen/DashScope** | `qwen.ts` | Cloud |
| **Kimi K2** | `kimi.ts` | Cloud |
| **NVIDIA** | `nvidia.ts` | Cloud |
| **OpenRouter** | `openrouter.ts` | Cloud (aggregator) |

### Arquitectura

```
┌─────────────────────────────────────────────┐
│              Agent Loop                      │
│                ↓                             │
│         llm-client.ts                        │
│                ↓                             │
│  ┌──────────────────────────────────────┐   │
│  │       Provider Interface             │   │
│  │  (IProvider: chat, stream, vision)   │   │
│  └──────────────┬───────────────────────┘   │
│                 ↓                            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │OpenAI│ │Gemini│ │Claude│ │Ollama│ ...   │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
└─────────────────────────────────────────────┘
```

### Características

- **Interface común**: Todos los proveedores implementan `IProvider`
- **OpenAI-compatible base**: Clase base para proveedores compatibles con OpenAI
- **Vision support**: Múltiples proveedores soportan procesamiento de imágenes
- **Failover**: Configuración de respaldo entre proveedores
- **Rate limiting**: Límites configurables por proveedor
- **Retry**: Reintentos automáticos con backoff

---

## 8. Gateway

### ¿Qué es?

El **Gateway** es el servidor HTTP/WebSocket principal de Hive. Es el punto de entrada para todas las comunicaciones: API REST, WebSocket en tiempo real, canales de mensajería, voz y multimodal. Se encuentra en `packages/core/src/gateway/server.ts`.

### Tecnología

- **Runtime**: `Bun.serve()` (servidor HTTP nativo de Bun)
- **Protocolos**: HTTP/1.1, WebSocket
- **CORS**: Configuración configurable por dominio

### Rutas API (22+ endpoints)

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/api/auth/login` | POST | Login con JWT |
| `/api/auth/recover` | POST | Recuperación de credenciales |
| `/api/agents` | GET/POST/PUT/DELETE | CRUD de agentes |
| `/api/channels` | GET/POST/PUT | Gestión de canales |
| `/api/chat` | GET | Historial de chat y notas |
| `/api/config` | GET/PUT | Configuración del sistema |
| `/api/cron` | GET/POST/PUT/DELETE | CRUD de jobs cron |
| `/api/ethics` | GET/PUT | Gestión de ética |
| `/api/mcp` | GET/POST/PUT/DELETE | Gestión de servidores MCP |
| `/api/meeting` | GET/POST | Gestión de reuniones |
| `/api/models` | GET/PUT | Gestión de modelos |
| `/api/multimodal` | POST | Endpoints de visión/OCR |
| `/api/providers` | GET/PUT | Gestión de proveedores |
| `/api/setup` | POST | Wizard de configuración |
| `/api/skills` | GET/POST/PUT/DELETE | Gestión de skills |
| `/api/system` | GET | Stats, versión, update |
| `/api/tasks` | GET/POST/PUT | Gestión de tareas |
| `/api/tools` | GET/PUT | Gestión de herramientas |
| `/api/tts-local` | POST | TTS local (Piper) |
| `/api/users` | GET/PUT | Gestión de usuarios |
| `/api/voice` | GET/PUT | Proveedores de voz |
| `/api/workspace` | GET/PUT | Gestión de workspace |

### Funcionalidades del Gateway

| Función | Descripción |
|---------|-------------|
| **Routing** | Despacho de requests a handlers |
| **Auth** | Validación de tokens JWT |
| **WebSocket** | Conexiones en tiempo real para chat y canvas |
| **CORS** | Manejo de cross-origin requests |
| **Static files** | Servir UI estática |
| **Channel messages** | Recibir mensajes de canales externos |
| **Voice pipeline** | Procesamiento de audio STT/TTS |
| **Multimodal pipeline** | Procesamiento de imágenes/vision |
| **Slash commands** | Ejecución de comandos `/` |
| **Session management** | Gestión de sesiones de usuario |
| **Lane queue** | Cola de requests para rate limiting |

### Inicialización modular

```
1. verifyDatabaseUsers()     → Validar que existe usuario
2. writePidFile()            → Escribir PID del proceso
3. loadAgentConfigFromDB()   → Cargar config desde HiveDB
4. syncTools/Skills/PlaybookToFTS() → Sincronizar índices FTS5
5. createAgentService()      → Crear servicio de agentes
6. initializeAgentLoop()     → Inicializar agent loop
7. initializeLLMRunner()     → Configurar proveedor LLM
8. initializeChannelManager() → Inicializar canales
9. Initialize CronScheduler  → Inicializar scheduler de cron
10. Initialize DAGScheduler  → Inicializar scheduler DAG
```

### Componentes auxiliares

| Archivo | Función |
|---------|---------|
| `initializer.ts` | Inicialización modular del gateway |
| `router.ts` | Enrutamiento de requests |
| `resolver.ts` | Resolución de contexto |
| `session.ts` | Gestión de sesiones |
| `lane-queue.ts` | Cola de requests |
| `slash-commands.ts` | Comandos slash |
| `channel-notify.ts` | Notificaciones a canales |
| `helpers/cors.ts` | CORS helpers |
| `helpers/narration.ts` | Textos de narración de tools |
| `helpers/path.ts` | Expansión de paths |
| `helpers/redact.ts` | Redacción de config sensible |
| `tts/` | Servidor TTS local (Piper) |

---

## 9. Channels

### ¿Qué es?

El sistema de **Channels** permite a Hive comunicarse con usuarios a través de múltiples plataformas de mensajería. Se encuentra en `packages/core/src/channels/`.

### Canales soportados

| Canal | Archivo | Características |
|-------|---------|-----------------|
| **Webchat** | `webchat.ts` | WebSocket nativo, integrado en UI |
| **Telegram** | `telegram.ts` | Bot API, soporte audio, typing indicators |
| **Discord** | `discord.ts` | Bot API, embeds, reactions |
| **WhatsApp** | `whatsapp.ts` | Baileys library, QR auth |
| **Slack** | `slack.ts` | Bolt API, blocks, threads |

### Arquitectura

```
┌─────────────────────────────────────────────┐
│              ChannelManager                  │
│                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │Telegram│ │Discord │ │WhatsApp│ ...      │
│  └───┬────┘ └───┬────┘ └───┬────┘          │
│      │          │          │                │
│      └──────────┴──────────┘                │
│                 ↓                           │
│         BaseChannel (IChannel)              │
│                 ↓                           │
│           Agent Loop                        │
└─────────────────────────────────────────────┘
```

### Características por canal

| Feature | Webchat | Telegram | Discord | WhatsApp | Slack |
|---------|---------|----------|---------|----------|-------|
| **DMs** | Sí | Sí | Sí | Sí | Sí |
| **Audio** | Sí | Sí | No | Sí | No |
| **Typing** | Sí | Sí | Sí | Sí | Sí |
| **Mark as read** | Sí | Sí | Sí | Sí | Sí |
| **Multi-account** | N/A | Sí | Sí | Sí | Sí |

### Políticas de DM

| Política | Descripción |
|----------|-------------|
| **Open** | Cualquier usuario puede iniciar conversación |
| **Pairing** | Requiere código de emparejamiento |
| **Allowlist** | Solo usuarios autorizados |

### ChannelManager

**Archivo**: `manager.ts`

- Inicialización desde DB con config encriptada
- Soporte multi-cuenta por plataforma
- Lifecycle management (start/stop/reconnect)
- Routing de mensajes entrantes al Agent Loop

---

## 10. Event Bus

### ¿Qué es?

El sistema de **Event Bus** de Hive usa una **arquitectura dual**: un bus para eventos del sistema y otro para comunicación inter-agentes. Se encuentra en `packages/core/src/events/`.

### TypedEventBus

**Archivo**: `event-bus.ts`

Bus tipado con **25+ tipos de eventos**:

| Categoría | Eventos |
|-----------|---------|
| **Mensajes** | `message:received`, `message:sent` |
| **Agente** | `agent:thinking`, `agent:response` |
| **Tools** | `tool:executing`, `tool:completed`, `tool:error` |
| **Sesiones** | `session:started`, `session:ended` |
| **MCP** | `mcp:connected`, `mcp:disconnected`, `mcp:error` |
| **Canales** | `channel:started`, `channel:stopped` |
| **Gateway** | `gateway:started`, `gateway:stopped` |
| **Pairing** | `pairing:*` (varios eventos) |
| **Errores** | `error` |

### AgentBus

**Archivo**: `agent-bus.ts`

Pub/sub para **comunicación worker-to-worker** con persistencia en DB:

| Evento | Descripción |
|--------|-------------|
| `worker:task_started` | Worker inició tarea |
| `worker:task_completed` | Worker completó tarea |
| `worker:task_failed` | Worker falló |
| `worker:help_request` | Worker pide ayuda |
| `worker:help_response` | Respuesta a ayuda |
| `worker:blocked` | Worker bloqueado |
| `worker:unblocked` | Worker desbloqueado |
| `project:started` | Proyecto iniciado |
| `project:completed` | Proyecto completado |
| `message:custom` | Mensaje personalizado |

### Características

- **Persistencia**: AgentBus guarda eventos en HiveDB
- **Tipado fuerte**: Cada evento tiene payload definido
- **Subscribers**: Múltiples listeners por evento
- **Fan-out**: Un evento puede disparar múltiples handlers

---

## 11. MCP Integration

### ¿Qué es?

**MCP (Model Context Protocol)** permite integrar herramientas externas de forma estandarizada. Hive tiene implementación tanto en el core como en un paquete standalone.

### Componentes

| Componente | Ubicación | Función |
|------------|-----------|---------|
| **MCPClientManager** | `packages/mcp/src/manager.ts` | Conexión, descubrimiento de tools/recursos/prompts, callTool, reconnect |
| **Singleton** | `packages/core/src/mcp/singleton.ts` | Instancia global del manager |
| **Hot Reload** | `packages/core/src/mcp/hot-reload.ts` | Recarga en caliente de servidores MCP |
| **Tool Sync** | `packages/core/src/mcp/tool-sync.ts` | Sync de tools MCP a DB y FTS5 |

### Transportes soportados

| Transporte | Archivo | Descripción |
|------------|---------|-------------|
| **stdio** | `transports/index.ts` | Comunicación por stdin/stdout |
| **SSE** | `transports/sse.ts` | Server-Sent Events |
| **WebSocket** | `transports/websocket.ts` | Conexión WebSocket |

### Flujo de integración

```
1. Configurar servidor MCP en DB (mcp_servers)
       ↓
2. MCPClientManager conecta vía transporte (stdio/SSE/WS)
       ↓
3. Descubre tools, recursos y prompts
       ↓
4. syncMCPToolsToDB() → Guarda tools en mcp_tools
       ↓
5. syncMCPToolsToFTS() → Indexa en mcp_tools_fts
       ↓
6. Agente descubre vía search_knowledge(type="mcp")
```

### Hot Reload

Los servidores MCP se recargan automáticamente cuando:
- Cambia la configuración
- Se detecta desconexión
- Se solicita manualmente

---

## 12. Authentication

### ¿Qué es?

El sistema de **Authentication** usa **JWT con rotación de refresh tokens** para proteger el acceso a Hive. Se encuentra en `packages/core/src/auth/`.

### Arquitectura

```
┌─────────────────────────────────────────────┐
│                 Auth System                   │
│                                              │
│  Login → Access Token (15 min)               │
│       → Refresh Token (7 días)               │
│                                              │
│  Refresh Token Rotation:                     │
│  - Nuevo refresh token en cada uso           │
│  - Hash-based storage para revocación        │
│  - Revocación individual o masiva            │
└─────────────────────────────────────────────┘
```

### Tokens

| Token | Duración | Propósito |
|-------|----------|-----------|
| **Access Token** | 15 minutos | Autenticar requests API |
| **Refresh Token** | 7 días | Renovar access token |

### Características

- **Bearer token auth**: Header `Authorization: Bearer <token>`
- **Refresh token rotation**: Nuevo refresh token en cada renovación
- **Hash-based storage**: Refresh tokens almacenados como hash (no plaintext)
- **Token revocation**: Revocación individual o masiva
- **Endpoints**: `/api/auth/login`, `/api/auth/recover`, `/api/auth/credentials`

---

## 13. Security

### ¿Qué es?

La capa de **Security** proporciona rate limiting, validación de input, emparejamiento de canales e integración con Signal. Se encuentra en `packages/core/src/security/`.

### Componentes

| Componente | Archivo | Función |
|------------|---------|---------|
| **RateLimiter** | `rate-limit.ts` | Limitación de requests con cleanup automático |
| **InputValidator** | `index.ts` | Validación y sanitización de input del usuario |
| **AuthManager** | `index.ts` | Gestión de autenticación a nivel de seguridad |
| **Pairing** | `pairing.ts` | Sistema de emparejamiento por código |
| **Signal** | `signal.ts` | Integración con Signal Messenger |
| **Google Chat** | `google-chat.ts` | Seguridad para Google Chat |

### Rate Limiter

- **Ventana deslizante**: Configurable por tiempo
- **Cleanup automático**: Limpia entries expirados
- **Por usuario/IP**: Limitación granular

### Pairing

- **Código de emparejamiento**: Auth por código para canales nuevos
- **Flujo**: Usuario envía código → Canal verifica → Acceso concedido

---

## 14. Resilience (Circuit Breaker)

### ¿Qué es?

El sistema de **Resilience** implementa el patrón **Circuit Breaker** para tolerancia a fallos. Se encuentra en `packages/core/src/resilience/`.

### Estados del Circuit Breaker

```
┌──────────┐   fallos ≥ threshold   ┌──────────┐
│  CLOSED  │ ──────────────────────→ │   OPEN   │
│ (normal) │                         │(bloqued) │
└──────────┘                         └────┬─────┘
     ↑                                    │
     │   éxitos ≥ threshold    reset timeout
     │                          ↓
     │                    ┌──────────────┐
     └─────────────────── │  HALF-OPEN   │
       test exitoso       │ (probando)   │
                          └──────────────┘
```

### Características

| Feature | Descripción |
|---------|-------------|
| **Failure threshold** | Fallos consecutivos para abrir circuito |
| **Success threshold** | Éxitos consecutivos para cerrar circuito |
| **Reset timeout** | Tiempo antes de intentar Half-Open |
| **Half-Open testing** | Prueba controlada antes de reabrir |
| **Stats tracking** | Métricas de fallos/éxitos |
| **Force open/reset** | Control manual del estado |
| **Registry** | CircuitBreakerRegistry para gestionar múltiples circuitos |

---

## 15. Voice (STT/TTS)

### ¿Qué es?

El sistema de **Voice** proporciona capacidades de **Speech-to-Text (STT)** y **Text-to-Speech (TTS)** multi-proveedor. Se encuentra en `packages/core/src/voice/`.

### Proveedores STT

| Proveedor | Modelo | Ubicación |
|-----------|--------|-----------|
| **Groq Whisper** | whisper-large-v3-turbo | Cloud (ultra-fast) |
| **OpenAI Whisper** | whisper-1 | Cloud |

### Proveedores TTS

| Proveedor | Modelos | Tipo |
|-----------|---------|------|
| **ElevenLabs** | Eleven Flash v2.5 | Cloud (premium) |
| **OpenAI TTS** | tts-1, tts-1-hd | Cloud |
| **Gemini** | Gemini TTS | Cloud |
| **Qwen/DashScope** | Qwen TTS | Cloud |
| **Piper** | Modelos locales | **Local** (offline) |

### Características

- **Normalización de audio**: Por canal (formato, sample rate)
- **Limpieza de texto TTS**: Remueve markdown y emojis
- **Catálogos de voz**: Múltiples voces por proveedor
- **TTS local**: Piper para funcionamiento offline
- **Configurable por canal**: STT/TTS providers por canal

---

## 16. Canvas / A2UI

### ¿Qué es?

El sistema de **Canvas** permite renderizar **UI interactiva en tiempo real** usando el protocolo **A2UI (Agent-to-UI)**. Los agentes pueden enviar componentes UI directamente al frontend. Se encuentra en `packages/core/src/canvas/`.

### Componentes del Canvas

| Componente | Archivo | Función |
|------------|---------|---------|
| **CanvasManager** | `canvas-manager.ts` | Gestión de sesiones, rendering, interacciones, heartbeat, cache/replay |
| **CanvasTools** | `canvas-tools.ts` | Definiciones de herramientas canvas |
| **A2UITools** | `a2ui-tools.ts` | Herramientas específicas de A2UI |
| **Emitter** | `emitter.ts` | Emisión de eventos canvas |

### Tipos de componentes A2UI

| Componente | Descripción |
|------------|-------------|
| `button` | Botones interactivos |
| `form` | Formularios con campos |
| `chart` | Gráficos (barras, líneas, pastel) |
| `table` | Tablas de datos |
| `markdown` | Texto formateado |
| `text` | Texto simple |
| `image` | Imágenes |
| `card` | Tarjetas de contenido |
| `progress` | Barras de progreso |
| `list` | Listas de items |
| `confirm` | Diálogos de confirmación |
| `accordion` | Secciones colapsables |
| `tabs` | Pestañas |
| `alert-dialog` | Diálogos de alerta |

### Flujo A2UI

```
Agente → canvas_render(component, data)
         ↓
   CanvasManager procesa
         ↓
   WebSocket emite al frontend
         ↓
   A2UIRenderer.tsx renderiza componente
         ↓
   Usuario interactúa → evento vuelve al agente
```

### Características

- **WebSocket en tiempo real**: Componentes se envían instantáneamente
- **Cache/replay**: Sesiones canvas se pueden recuperar
- **Data binding**: Engine de binding de datos en el frontend
- **ComponentRenderer**: Renderizado dinámico según tipo de componente

---

## 17. Multimodal (Vision/OCR)

### ¿Qué es?

El sistema **Multimodal** proporciona procesamiento de **imágenes y documentos** con capacidades de visión y OCR. Se encuentra en `packages/core/src/multimodal/`.

### Capacidades

| Feature | Descripción |
|---------|-------------|
| **Image processing** | Procesamiento de imágenes para LLMs con visión |
| **OCR** | Reconocimiento de texto en imágenes |
| **Vision detection** | Detección automática de capacidades de visión del modelo |
| **Document processing** | Procesamiento de documentos |

### Proveedores de OCR/Vision

| Proveedor | Capacidad |
|-----------|-----------|
| **OpenAI** | Vision (gpt-4o, etc.) |
| **Gemini** | Vision + OCR |
| **Anthropic** | Vision (Claude) |

### Tipos

```typescript
interface ImageInput {
  url?: string
  base64?: string
  mimeType: string
}

interface DocumentInput {
  content: string
  mimeType: string
}

interface VisionConfig {
  provider: string
  model: string
  maxTokens: number
}
```

---

## 18. Storage Layer

### ¿Qué es?

La capa de **Storage** es la base de persistencia de Hive, usando **HiveDB como única fuente de verdad**. Incluye encriptación y tipos de documentos completos (`storage/collections.ts`).

### Componentes

| Archivo | Función |
|---------|---------|
| `hivedb.ts` | Inicialización de HiveDB (accesor singleton) |
| `schema.ts` | Schema completo (30+ tablas) |
| `crypto.ts` | Encriptación AES-256-CBC para datos sensibles |
| `seed.ts` | Seed de datos iniciales |
| `migrate.ts` | Sistema de migraciones |
| `onboarding.ts` | Helpers de resolución de identidad |
| `usage.ts` | Tracking de uso (tokens, costos, métricas TOON) |

### Tablas principales

| Tabla | Propósito |
|-------|-----------|
| `users` | Usuario único |
| `agents` | Agentes (coordinator + workers) |
| `providers` | Proveedores LLM/STT/TTS |
| `models` | Modelos de IA |
| `channels` | Canales de comunicación |
| `conversations` | Historial de mensajes |
| `traces` | Trazas de ejecución |
| `playbook` | Reglas evolutivas (ACE) |
| `reflections` | Insights del Reflector |
| `scratchpad` | Notas persistentes |
| `skills` | Skills (instrucciones) |
| `tools` | Catálogo de herramientas |
| `ethics` | Reglas constitucionales |
| `mcp_servers` | Servidores MCP |
| `mcp_tools` | Tools MCP descubiertas |
| `projects` | Proyectos multi-paso |
| `tasks` | Tareas atómicas |
| `summaries` | Resúmenes de conversación |
| `cron_jobs` | Tareas programadas |
| `tool_cache` | Cache de herramientas |
| `meetings` | Transcripciones de reuniones |
| `agent_bus` | Eventos del AgentBus |

### Encriptación

- **AES-256-CBC** para API keys y configs sensibles
- **IV almacenado separadamente** del ciphertext
- **Clave maestra** derivada de `HIVE_MASTER_KEY`

---

## 19. State Management

### ¿Qué es?

El **State Management** es un store en memoria con historial de snapshots para sesiones, agentes, canales y métricas. Se encuentra en `packages/core/src/state/`.

### Tipos de estado

| Tipo | Descripción |
|------|-------------|
| **SessionState** | Estado de sesiones activas |
| **AgentState** | Estado de agentes (idle, running, etc.) |
| **ChannelState** | Estado de canales (connected, disconnected) |
| **MetricsState** | Métricas del sistema |
| **HiveState** | Estado global consolidado |
| **StateSnapshot** | Snapshots históricos |

### Características

- **Snapshots**: Historial de estados para debugging
- **Correlation IDs**: Trazabilidad de requests
- **Subscriber pattern**: Notificaciones de cambios de estado
- **In-memory**: Alta velocidad, complementa HiveDB

---

## 20. Heartbeat

### ¿Qué es?

El sistema de **Heartbeat** proporciona health checks y monitoreo de salud del sistema. Se encuentra en `packages/core/src/heartbeat/`.

### Características

| Feature | Descripción |
|---------|-------------|
| **Health checks** | Verificaciones configurables |
| **Memory monitoring** | Monitoreo de uso de memoria |
| **Status tracking** | healthy / degraded / unhealthy |
| **Interval polling** | Verificaciones periódicas |

---

## 21. Plugins

### ¿Qué es?

El sistema de **Plugins** permite extender Hive con integraciones externas locales mediante una API de carga y registro. Se encuentra en `packages/core/src/plugins/`.

### Componentes

| Archivo | Función |
|---------|---------|
| `api.ts` | API de plugins |
| `loader.ts` | Cargador de plugins |

---

## 22. Skills

### ¿Qué es?

El sistema de **Skills** proporciona instrucciones especializadas para tareas complejas. Las skills son archivos Markdown con frontmatter YAML. Se encuentra en `packages/skills/`.

### Categorías bundled (11)

| Categoría | Descripción |
|-----------|-------------|
| `agents/` | Creación y gestión de agentes |
| `canvas/` | Renderizado de UI con Canvas |
| `cli/` | Operaciones de línea de comandos |
| `cron_manager/` | Gestión de tareas programadas |
| `cron_reminder/` | Recordatorios programados |
| `filesystem/` | Operaciones de archivos |
| `meeting/` | Transcripción de reuniones |
| `office/` | Documentos Office (docx, xlsx, pptx) |
| `search_knowledge/` | Búsqueda de conocimiento |
| `voice/` | Operaciones de voz |
| `web/` | Búsqueda y navegación web |

### Formato de Skill

```yaml
---
name: web_search
description: Buscar información en internet
version: 1.0.0
author: Hive
category: web
tools: [web_search, http_client]
triggers: [buscar, buscar en internet, google]
---

# Instrucciones de la skill
...
```

### Loader

**Archivo**: `loader.ts`

- Carga skills **bundled**, **managed** y **workspace**
- Parsea frontmatter YAML
- Indexa en FTS5 para búsqueda semántica

---

## 23. CLI

### ¿Qué es?

La **CLI** es la interfaz de línea de comandos para gestionar Hive. Se encuentra en `packages/cli/`.

### Comandos (18)

| Comando | Descripción |
|---------|-------------|
| `gateway` | Start/stop/reload/status del gateway |
| `dev` | Modo desarrollo con hot-reload |
| `onboard` | Wizard de configuración inicial (8 pasos) |
| `chat` | Chat interactivo en terminal |
| `agents` | List/create/remove/hibernate/wake/terminate/tree |
| `agent-run` | Ejecutar agente con mensaje |
| `mcp` | Gestión de servidores MCP |
| `skills` | List/search/install/remove/update |
| `config` | Get/set/show configuración |
| `logs` | Visualización de logs |
| `sessions` | List/view/prune sesiones |
| `cron` | Gestión de jobs cron |
| `doctor` | Diagnóstico del sistema |
| `security` | Auditoría de seguridad |
| `service` | Instalación como servicio systemd |
| `update` | Auto-actualización |
| `message` | Enviar mensaje vía canal |
| `migrate` | Migración de base de datos |

### Adapters (7)

| Adapter | Descripción |
|---------|-------------|
| `binary` | Ejecución desde binario |
| `bun-global` | Bun global installation |
| `docker` | Docker container |
| `factory` | Factory pattern |
| `config` | Gestión de configuración |

---

## 24. Hive-UI (Dashboard)

### ¿Qué es?

**Hive-UI** es el dashboard web de Hive, construido con **React + Vite + TypeScript + shadcn/ui**. Se encuentra en `packages/hive-ui/`.

### Páginas (16)

| Página | Descripción |
|--------|-------------|
| `LoginPage` | Login con JWT |
| `SetupPage` | Wizard de configuración |
| `RecoverPage` | Recuperación de contraseña |
| `DashboardPage` | Dashboard principal |
| `AgentsPage` | Lista de agentes |
| `AgentDetailPage` | Detalle de agente |
| `AgentNewPage` | Crear nuevo agente |
| `ChannelsPage` | Gestión de canales |
| `ProvidersPage` | Gestión de proveedores |
| `SettingsPage` | Configuración del sistema |
| `WebChatPage` | Chat web interactivo |
| `CanvasPage` | Página de Canvas/A2UI |
| `MeetingPage` | Gestión de reuniones |
| `LogsPage` | Visor de logs |

### Módulos (8)

| Módulo | Componentes clave |
|--------|-------------------|
| `agent-config/` | Ethics editor, MCP config, skills tab, tools manager, voice providers |
| `agents/` | AgentCard, AgentList, HoneycombGrid, ModelSelector |
| `canvas/` | A2UIRenderer, CanvasButton, CanvasChart, CanvasTable, ComponentRenderer |
| `channels/` | AvailableChannelsGrid, ChannelSetupWizard, ChannelTestConnection |
| `chat/` | ChatHistory, ChatInput, ChatMessage, ThinkingIndicator |
| `layout/` | AppLayout, Header, HiveSidebar, ConnectionStatus, ThemeToggle |
| `meeting/` | MeetingPanel |
| `providers/` | ProviderCard, ProviderConfigForm, FailoverConfig |

### Stores Zustand (19)

| Store | Propósito |
|-------|-----------|
| `agentStore` | Estado de agentes |
| `agentConfigStore` | Configuración de agentes |
| `canvasStore` | Estado de canvas |
| `channelStore` | Estado de canales |
| `chatStore` | Estado de chat |
| `ethicsStore` | Estado de ética |
| `mcpStore` | Estado de servidores MCP |
| `meetingStore` | Estado de reuniones |
| `modelStore` | Estado de modelos |
| `providerStore` | Estado de proveedores |
| `skillStore` | Estado de skills |
| `toolStore` | Estado de herramientas |
| `useGlobalConfigStore` | Configuración global |
| `userStore` | Estado de usuario |
| `userConfigStore` | Configuración de usuario |
| `useWebSocketStore` | Conexión WebSocket |
| `useLoaderStore` | Estado de carga |
| `useNotesAndCronsStore` | Notas y cron jobs |
| `useWelcomeStore` | Diálogo de bienvenida |

### Hooks (13)

| Hook | Propósito |
|------|-----------|
| `useWebSocket` | Conexión WebSocket |
| `useChatStreaming` | Streaming de chat |
| `useCanvas` | Interacción con canvas |
| `useAgents` | Gestión de agentes |
| `useChannels` | Gestión de canales |
| `useProviders` | Gestión de proveedores |
| `useEthics` | Gestión de ética |
| `useNarration` | Narración de tools |
| `useTheme` | Toggle de tema |
| `useAgentConfig` | Config de agente |
| `useUserConfig` | Config de usuario |
| `use-mobile` | Detección de móvil |
| `use-toast` | Notificaciones toast |

### Componentes UI (50+)

50+ componentes shadcn/ui: button, dialog, form, table, chart, card, badge, tabs, accordion, alert, etc.

### Canvas A2UI en el frontend

| Archivo | Función |
|---------|---------|
| `A2UIRenderer.tsx` | Renderer del protocolo A2UI |
| `dataBinding.ts` | Engine de binding de datos |
| `functions.ts` | Funciones A2UI |
| `components/` | Mapeo de componentes A2UI a React |

---

## 25. Cómo Interactúan Todos los Componentes

### Arquitectura completa

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HIVE ARCHITECTURE                                  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        UI LAYER                                       │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │  Hive-UI    │  │   Webchat   │  │   Canvas    │  │   CLI      │  │   │
│  │  │  (React)    │  │   (WS)      │  │   (A2UI)    │  │  (Terminal)│  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘  │   │
│  └─────────┼────────────────┼────────────────┼────────────────┼─────────┘   │
│            │                │                │                │             │
│  ┌─────────┴────────────────┴────────────────┴────────────────┴─────────┐   │
│  │                        GATEWAY (Bun.serve)                            │   │
│  │                                                                       │   │
│  │  HTTP/REST API (22+ routes)  │  WebSocket  │  Channel Webhooks       │   │
│  │                                                                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │   │
│  │  │   Auth   │ │ Routing  │ │ Sessions │ │  Queue   │ │Slash Cmds  │  │   │
│  │  │  (JWT)   │ │          │ │          │ │ (Lanes)  │ │            │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘  │   │
│  └──────────────────────────┬────────────────────────────────────────────┘   │
│                             │                                                │
│  ┌──────────────────────────┴────────────────────────────────────────────┐   │
│  │                      COMMUNICATION LAYER                               │   │
│  │                                                                       │   │
│  │  ┌─────────────────────────────────┐  ┌────────────────────────────┐  │   │
│  │  │          CHANNELS                │  │        EVENT BUS            │  │   │
│  │  │                                  │  │                             │  │   │
│  │  │  Telegram │ Discord │ WhatsApp   │  │  TypedEventBus (25+ events) │  │   │
│  │  │  Slack    │ Webchat │ ...        │  │  AgentBus (worker pub/sub)  │  │   │
│  │  └─────────────────────────────────┘  └────────────────────────────┘  │   │
│  └──────────────────────────┬────────────────────────────────────────────┘   │
│                             │                                                │
│  ┌──────────────────────────┴────────────────────────────────────────────┐   │
│  │                      INTELLIGENCE LAYER                                │   │
│  │                                                                       │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │   │
│  │  │                        AGENT LOOP                                │  │   │
│  │  │                                                                  │  │   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │  │   │
│  │  │  │ Context Compiler │→ │   LLM Providers  │→ │ Tool Runtime   │ │  │   │
│  │  │  │                  │  │  (14 providers)  │  │ Bun Workers    │ │  │   │
│  │  │  │ - Agent Config   │  │                  │  │                │ │  │   │
│  │  │  │ - Scratchpad     │  │ OpenAI │ Gemini  │  │ search_knowledge│ │  │   │
│  │  │  │ - MCP Tools      │  │ Claude │ Groq    │  │ create_swarm   │ │  │   │
│  │  │  │ - Skills (FTS5)  │  │ Ollama │ Mistral │  │ save_note      │ │  │   │
│  │  │  │ - Playbook (FTS5)│  │ ...    │ ...     │  │ RPC main thread│ │  │   │
│  │  │  │ - History        │  └──────────────────┘  └────────────────┘ │  │   │
│  │  │  │ - Ethics         │                          │                │  │   │
│  │  │  │ - User Profile   │                          ↓                │  │   │
│  │  │  │ - Projects       │                    ┌──────────┐           │  │   │
│  │  │  └──────────────────┘                    │  TRACER  │           │  │   │
│  │  │                                          │(traces)  │           │  │   │
│  │  └─────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                       │   │
│  └──────────────────────────┬────────────────────────────────────────────┘   │
│                             │ (cada 20 trazas)                               │
│  ┌──────────────────────────┴────────────────────────────────────────────┐   │
│  │                        ACE (Auto-Learning)                             │   │
│  │                                                                       │   │
│  │  ┌──────────┐     ┌───────────┐     ┌──────────┐                     │   │
│  │  │ TRACER   │────→│ REFLECTOR │────→│ CURATOR  │                     │   │
│  │  │(traces)  │     │(patrones) │     │(reglas)  │                     │   │
│  │  └──────────┘     └───────────┘     └─────┬────┘                     │   │
│  │                                            ↓                          │   │
│  │                                    ┌──────────────┐                   │   │
│  │                                    │   PLAYBOOK   │──→ FTS5 indexing  │   │
│  │                                    │  (reglas)    │                   │   │
│  │                                    └──────────────┘                   │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      SCHEDULING LAYER                                 │   │
│  │                                                                       │   │
│  │  ┌─────────────────────┐  ┌──────────────────────────────────────┐   │   │
│  │  │  CronScheduler      │  │         DAG Scheduler                 │   │   │
│  │  │  (Croner-based)     │  │                                       │   │   │
│  │  │  - Recurring jobs   │  │  TaskGraph → TaskNodes → Workers     │   │   │
│  │  │  - One-shot jobs    │  │  Parallel execution (Promise.race)   │   │   │
│  │  │  - Cleanup          │  │  Failure propagation + retries       │   │   │
│  │  └─────────────────────┘  └──────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    SUPPORT SYSTEMS                                    │   │
│  │                                                                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │   │
│  │  │  Voice   │ │Multimodal│ │ Security │ │Resilience│ │  Plugins   │  │   │
│  │  │ STT/TTS  │ │Vision/OCR│ │Rate Limit│ │Circuit   │ │  Loader    │  │   │
│  │  │ 5 prov.  │ │ 3 prov.  │ │Pairing   │ │Breaker   │ │            │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      DATA LAYER                                       │   │
│  │                                                                       │   │
│  │  ┌──────────────────────┐  ┌──────────────────┐  ┌────────────────┐  │   │
│  │  │  HiveDB (30+ colls)  │  │  State Store     │  │  BM25 Indexes  │  │   │
│  │  │   + Crypto (AES)     │  │  (in-memory)     │  │  (4 tables)    │  │   │
│  │  └──────────────────────┘  └──────────────────┘  └────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Flujo completo: de mensaje a respuesta

```
1. USUARIO envía mensaje (Webchat, Telegram, Discord, etc.)
       ↓
2. CHANNEL recibe → ChannelManager → Gateway WebSocket/HTTP
       ↓
3. GATEWAY valida auth (JWT) → encola en lane-queue
       ↓
4. EVENT BUS emite message:received
       ↓
5. AGENT LOOP inicia compileContext():
   ├─ Carga agente desde HiveDB
   ├─ Carga scratchpad (notas persistentes)
   ├─ Carga MCP tools habilitados
   ├─ FTS5 selecciona skills relevantes (máx 4)
   ├─ FTS5 selecciona reglas del Playbook (máx 5)
   ├─ Carga últimos 40 mensajes + resumen si > 6000 tokens
   ├─ Inyecta ética, perfil de usuario, entorno
   └─ Si coordinator: inyecta proyectos activos
       ↓
6. LLM CALL → Proveedor seleccionado (OpenAI, Gemini, etc.)
       ↓
7. TOOL RUNTIME:
   ├─ Agent Loop agrupa todas las tool_calls del turno
   ├─ executeToolBatch() agenda el lote en Bun Workers
   ├─ Tools reconstruibles corren dentro del Worker
   ├─ MCP/Browser/Canvas/Cron/voz/notificaciones usan RPC al proceso principal
   ├─ Resultados se ordenan por response.tool_calls
   └─ search_knowledge puede inyectar nuevas tools/skills para la siguiente vuelta
       ↓
8. TRACER registra cada tool call en HiveDB
       ↓
9. ACE CYCLE (cada 20 trazas):
   ├─ Reflector analiza patrones (fallos, éxitos, optimizaciones)
   ├─ Curator genera/refuerza/poda reglas del Playbook
   └─ Playbook actualizado → FTS5 re-indexa
       ↓
10. RESPUESTA emitida al usuario vía canal original
    ├─ Webchat → WebSocket
    ├─ Telegram → Telegram Bot API
    ├─ Discord → Discord Bot API
    └─ Canvas → WebSocket + A2UI renderer
```

### Resumen de todos los componentes

| # | Componente | Responsabilidad | Ubicación |
|---|------------|-----------------|-----------|
| 1 | **Agent Loop** | Ciclo mensaje → LLM → tools → respuesta | `core/agent/` |
| 1.1 | **Tool Runtime** | Ejecutar lotes de tools en paralelo con Bun Workers y RPC main-thread | `core/tool-runtime/` |
| 2 | **Context Compiler** | Ensamblar prompt con contexto relevante | `core/agent/` |
| 3 | **FTS5** | Búsqueda semántica BM25 para selección dinámica | `core/storage/` |
| 4 | **ACE** | Auto-aprendizaje: observar, analizar, generar reglas | `core/agent/` |
| 5 | **Playbook** | Reglas de comportamiento aprendidas | `core/storage/` |
| 6 | **DAG Scheduler** | Tareas en paralelo con dependencias | `core/scheduler/dag/` |
| 7 | **LLM Providers** | 14 proveedores de modelos de lenguaje | `core/agent/llm-providers/` |
| 8 | **Gateway** | Servidor HTTP/WS, 22+ rutas API | `core/gateway/` |
| 9 | **Channels** | 5 plataformas de mensajería | `core/channels/` |
| 10 | **Event Bus** | Dual bus: system events + agent pub/sub | `core/events/` |
| 11 | **MCP** | Model Context Protocol para tools externas | `packages/mcp/` + `core/mcp/` |
| 12 | **Auth** | JWT + refresh token rotation | `core/auth/` |
| 13 | **Security** | Rate limiting, input validation, pairing | `core/security/` |
| 14 | **Resilience** | Circuit breaker para tolerancia a fallos | `core/resilience/` |
| 15 | **Voice** | STT/TTS multi-provider (5 proveedores) | `core/voice/` |
| 16 | **Canvas/A2UI** | UI interactiva en tiempo real | `core/canvas/` + `hive-ui/` |
| 17 | **Multimodal** | Vision/OCR (3 proveedores) | `core/multimodal/` |
| 18 | **Storage** | HiveDB + crypto | `core/storage/` |
| 19 | **State** | In-memory store con snapshots | `core/state/` |
| 20 | **Heartbeat** | Health checks y monitoreo | `core/heartbeat/` |
| 21 | **Plugins** | Plugin loader and API | `core/plugins/` |
| 22 | **Skills** | 11 categorías de instrucciones | `packages/skills/` |
| 23 | **CLI** | 18 comandos de gestión | `packages/cli/` |
| 24 | **Hive-UI** | Dashboard React (16 páginas, 19 stores) | `packages/hive-ui/` |

---

## Glosario

| Término | Definición |
|---------|------------|
| **Agent Loop** | Ciclo iterativo que procesa mensajes y ejecuta herramientas |
| **Tool Runtime** | Scheduler de herramientas que ejecuta lotes de `tool_calls` con Bun Workers |
| **Bun Worker** | Hilo de ejecución aislado de Bun usado para correr herramientas en paralelo |
| **Worker Pool** | Conjunto persistente de Workers reutilizables para evitar overhead por llamada |
| **RPC main-thread** | Mecanismo interno para ejecutar en el proceso principal tools que dependen de estado vivo |
| **Context Compiler** | Ensamblador del system prompt del agente |
| **BM25** | Algoritmo de ranking del índice de búsqueda de texto completo (tantivy, vía HiveDB) — reemplaza a FTS5 de SQLite |
| **BM25** | Algoritmo de ranking para búsqueda de texto completo |
| **ACE** | Adaptive Context Engine — sistema de auto-aprendizaje |
| **Tracer** | Componente que registra trazas de ejecución |
| **Reflector** | Componente que analiza trazas y detecta patrones |
| **Curator** | Componente que convierte reflexiones en reglas |
| **Playbook** | Tabla de reglas de comportamiento aprendidas automáticamente |
| **DAG** | Directed Acyclic Graph — grafo acíclico dirigido |
| **DAG Scheduler** | Orquestador de tareas en paralelo |
| **Swarm** | Enjambre de agentes workers ejecutando tareas |
| **Scratchpad** | Notas persistentes asociadas a un thread |
| **Skills** | Instrucciones de tareas complejas (creadas por usuario) |
| **Coordinator** | Agente principal con visión completa del sistema |
| **Worker** | Agente especializado con contexto mínimo |
| **TOON** | Formato de encoding para comprimir datos estructurados |
| **MCP** | Model Context Protocol — protocolo para herramientas externas |
| **A2UI** | Agent-to-UI — protocolo para enviar UI del agente al frontend |
| **JWT** | JSON Web Token — estándar de autenticación |
| **STT** | Speech-to-Text — conversión de voz a texto |
| **TTS** | Text-to-Speech — conversión de texto a voz |
| **OCR** | Optical Character Recognition — reconocimiento de texto en imágenes |
| **Circuit Breaker** | Patrón de tolerancia a fallos (closed/open/half-open) |
| **Gateway** | Servidor HTTP/WebSocket principal de Hive |
| **Channel** | Plataforma de mensajería (Telegram, Discord, WhatsApp, etc.) |
| **Event Bus** | Sistema de publicación/suscripción de eventos |
| **Hive-UI** | Dashboard web de Hive (React + shadcn/ui) |

---

**Fin del documento**.
