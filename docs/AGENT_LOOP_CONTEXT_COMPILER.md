# Documentación: Agent Loop Context & Compiler

**Fecha**: 2026-04-29  
**Propósito**: Documentar qué se carga en el contexto del agent loop y cómo se maneja el compiler, sin modificar código, solo informar.

---

## 📍 Ubicación de Archivos Principales

| Componente | Archivo | Líneas |
|------------|---------|--------|
| **Agent Loop Principal** | `packages/core/src/agent/agent-loop.ts` | 696 |
| **Context Compiler** | `packages/core/src/agent/context-compiler.ts` | 572 |
| **Database Schema** | `packages/core/src/storage/schema.ts` | 689 |
| **Prompt Builder** | `packages/core/src/agent/prompt-builder.ts` | ~180 |
| **Skill Selector** | `packages/core/src/agent/skill-selector.ts` | 479 |
| **Tool Selector** | `packages/core/src/agent/tool-selector.ts` | 578 |
| **Conversation Store** | `packages/core/src/agent/conversation-store.ts` | 238 |
| **Gateway Initializer** | `packages/core/src/gateway/initializer.ts` | 356 |

---

## 🔄 Flujo de Carga del Contexto (Agent Loop)

### Secuencia de Ejecución

```
User Message (webchat/API)
    ↓
Gateway Server (packages/core/src/gateway/server.ts)
    ↓
AgentService.runAgent() (packages/core/src/agent/service.ts)
    ↓
AgentLoop.stream() → runAgent() (packages/core/src/agent/agent-loop.ts)
    ↓
compileContext() (packages/core/src/agent/context-compiler.ts)
    ↓
[STEP-1] Load Agent Config (DB: agents table)
[STEP-2] Load Scratchpad (DB: scratchpad table)
[STEP-3c] Load MCP Tools (MCP Manager + DB: mcp_servers)
[STEP-4] Build Minimal Tool Set (createAllTools)
[STEP-8b] Skill Loadout (FTS5: skills_fts)
[STEP-9] Load Conversation History (DB: conversations)
[STEP-9b] Load Summary (DB: summaries)
[STEP-10] Build System Prompt (prompt-builder.ts)
[STEP-10b] Inject Date/Time + Timezone
    ↓
LLM Call (packages/core/src/agent/llm-client.ts)
    ↓
Tool Execution Loop (max_iterations)
    ↓
Response → emitCanvas() → Gateway → User
```

---

## 📦 Qué Se Carga en el Contexto

### [STEP-1] Configuración del Agente
**Origen**: Tabla `agents` (SQLite)  
**Archivo**: `context-compiler.ts` líneas 116-133

```sql
SELECT * FROM agents WHERE id = ?
```

**Datos cargados**:
- `id`, `name`, `description`
- `system_prompt` (personalidad del agente)
- `role` (coordinator | worker)
- `provider_id`, `model_id`
- `max_iterations` (límite del loop)
- `workspace` (path para filesystem tools)
- `tone`, `enabled`, `status`

**Determina**: Si el agente es worker (`role === 'worker'` o `isolated === true`) → recibe contexto mínimo

---

### [STEP-2] Scratchpad (Notas Persistentes)
**Origen**: Tabla `scratchpad` (SQLite)  
**Archivo**: `context-compiler.ts` líneas 136-147  
**Función**: `getScratchpad(threadId)` de `conversation-store.ts`

```sql
SELECT * FROM scratchpad WHERE thread_id = ?
```

**Propósito**: Notas clave-valor que sobreviven la compresión del contexto. Escritas por agentes vía `save_note` tool.

**Formato en contexto**: TOON-encoded (ahorro de tokens)
```
# SCRATCHPAD (Persistent Notes)
key1: value1
key2: value2
```

---

### [STEP-3c] Herramientas MCP
**Origen**: MCP Manager singleton + tabla `mcp_servers`  
**Archivo**: `context-compiler.ts` líneas 150-208

**Proceso**:
1. Query: `SELECT id, name, status FROM mcp_servers WHERE enabled = 1`
2. Para cada server: `mcpManager.getServerTools(server.id)`
3. Crea executors con nombre sanitizado: `{serverName}__{toolName}`
4. Sync a DB: `syncMCPToolsToDB()` → tabla `mcp_tools`
5. Sync a FTS5: `syncMCPToolsToFTS()` → `mcp_tools_fts`

**Importante**: Las herramientas MCP **NO** se inyectan en el contexto LLM por defecto. Se descubren dinámicamente vía `search_knowledge(type="mcp")`.

---

### [STEP-4] Set Mínimo de Herramientas Nativas
**Origen**: `createAllTools()` de `packages/core/src/tools/index.ts`  
**Archivo**: `context-compiler.ts` líneas 211-248

**Herramientas SIEMPRE disponibles** (`MINIMAL_TOOLS`):
```typescript
const MINIMAL_TOOLS = new Set([
  "save_note",        // Guardar notas persistentes
  "notify",           // Notificar a usuarios/agents
  "report_progress",  // Reportar progreso (Canvas A2UI)
  "search_knowledge", // Descubrir tools, skills, playbook, MCP
])
```

**Total herramientas nativas disponibles**: 70+ herramientas categorizadas:
- `cron.*` (8): Gestión de tareas programadas
- `project_*`, `task_*` (8): Gestión de proyectos
- `fs_*` (7): Operaciones de filesystem
- `web_*` (9): Búsqueda y fetch web
- `canvas_*` (7): Renderizado UI A2UI
- `agent_*` (14): Creación/gestión de agentes
- `cli_exec`, `code_bridge_*`: Ejecución de código
- `voice_*`, `meeting_*`, `office_*`: Multimedia

**Inyectadas en contexto LLM**: Solo las 4 mínimas. El resto se descubre vía `search_knowledge`.

---

### [STEP-8b] Skill Loadout (Instrucciones de Tareas)
**Origen**: Tabla `skills` + FTS5 (`skills_fts`)  
**Archivo**: `context-compiler.ts` líneas 267-309  
**Módulo**: `skill-selector.ts`

**Skills MÍNIMAS (SIEMPRE activas)**:
```typescript
const MINIMAL_SKILL_NAMES = [
  "busqueda_fts5",    // Core: cómo encontrar tools/skills/MCP/playbook
  "canvas_report",    // Display resultados con charts, tables, cards
  "memory_manager",   // Notas persistentes que sobreviven compresión
]
```

**Skills DESCUBIERTAS (coordinator only)**:
- Función: `selectSkills(userMessage)` de `skill-selector.ts`
- Usa FTS5 bm25() scoring en `skills_fts`
- Máximo: `MAX_SKILLS_PER_TURN = 4` skills
- Threshold: `MIN_RELEVANCE_THRESHOLD = -15` (bm25 score)

**Proceso FTS5**:
1. Filtra stopwords del mensaje del usuario
2. Construye query con prefix matching: `"gener*" AND "códig*"`
3. Ejecuta: `SELECT *, bm25(skills_fts) as score FROM skills_fts MATCH ? ORDER BY score LIMIT 4`
4. Retorna skills con score > -15 (más cercano a 0 = más relevante)

**Inyección en contexto**:
```
# SKILLS ACTIVAS
- **memory_manager** [SIEMPRE] — Maneja notas persistentes
- **canvas_report** [SIEMPRE] — Reportes visuales
- **web_search_skill** [DISCOVERED] — Búsqueda en internet
```

---

### [STEP-9] Historial de Conversación
**Origen**: Tabla `conversations` (SQLite)  
**Archivo**: `context-compiler.ts` líneas 312-352  
**Función**: `getRecentMessages(threadId, KEEP_LAST_N_MESSAGES)`

**Configuración**:
```typescript
const KEEP_LAST_N_MESSAGES = 40  // Últimos mensajes siempre cargados
const TOKEN_COMPACT_THRESHOLD = 6000  // Threshold para compactación
```

**Proceso**:
1. Query: `SELECT * FROM conversations WHERE thread_id = ? ORDER BY id DESC LIMIT 40`
2. Filtra mensajes huérfanos de tool results (sin assistant message previo)
3. Calcula tokens: `estimateTokens(content)` de `utils/toon.ts`
4. Si `totalTokens > 6000` → usa resumen (STEP-9b)

**Formato**: Convierte a `LLMMessage[]` vía `toAPIMessages()`

---

### [STEP-9b] Resumen de Conversación (Compresión)
**Origen**: Tabla `summaries` (SQLite)  
**Archivo**: `context-compiler.ts` líneas 334-351  
**Función**: `getSummary(threadId)`

```sql
SELECT summary, messages_covered, last_message_id 
FROM summaries 
WHERE thread_id = ?
```

**Condición de uso**:
- Si `summary EXISTS` Y `totalTokens > 6000`:
  ```
  messages = [
    { role: "system", content: "[Conversation Summary]: {summary}" },
    ...recentMessages (últimos 40)
  ]
  ```

**Propósito**: Estrategia COMPRESS — comprime mensajes viejos manteniendo información esencial.

---

### [STEP-10] System Prompt
**Origen**: Tablas `ethics`, `agents`, `users`  
**Archivo**: `context-compiler.ts` líneas 355-372  
**Módulo**: `prompt-builder.ts`

**Función**: `buildSystemPromptWithProjects({ agentId, userId })`

**Jerarquía del System Prompt**:

#### 1. ÉTICA (Capa Constitucional)
**Origen**: Tabla `ethics`
```sql
SELECT name, content, description 
FROM ethics 
WHERE enabled = 1 AND active = 1 
ORDER BY is_default DESC
```

**Formato**:
```
# ÉTICA Y REGLAS CONSTITUCIONALES

## Ethics Rule Name
Content de la regla ética...
```

#### 2. IDENTIDAD DEL AGENTE
**Origen**: Tabla `agents` (ya cargada en STEP-1)

**Formato**:
```
# IDENTIDAD DEL AGENTE

**Nombre**: {agent.name}
**Rol**: {agent.role}
**Descripción**: {agent.description}
**Tono**: {agent.tone}
**Iteraciones máximas**: {agent.max_iterations}

## System Prompt
{agent.system_prompt}
```

**Workspace (si existe)**:
```
# WORKSPACE — ESPACIO DE TRABAJO EXCLUSIVO

**Tu directorio de trabajo es**: `/path/to/workspace`

## REGLAS OBLIGATORIAS (no negociables)
1. TODAS tus operaciones ocurren DENTRO de `/path/to/workspace`
2. Nunca uses rutas absolutas fuera del workspace
...
```

#### 3. IDENTIDAD DEL USUARIO
**Origen**: Tabla `users`
```sql
SELECT id, name, language, timezone, occupation, notes 
FROM users 
WHERE id = ?
```

**Formato**: TOON-encoded (ahorro de tokens)
```
# IDENTIDAD DEL USUARIO

Nombre: {user.name}
Idioma: {user.language}
Zona Horaria: {user.timezone}
Ocupación: {user.occupation}
```

---

### [STEP-10b] Entorno Actual (Fecha/Hora)
**Origen**: Tabla `users` (timezone) + `new Date()`  
**Archivo**: `context-compiler.ts` líneas 375-385

```sql
SELECT timezone FROM users WHERE id = ?
```

**Inyección**:
```
# ENTORNO ACTUAL
**Fecha**: 2026-04-29
**Hora**: 14:30:00
**Zona horaria**: America/Bogota
**Workspace**: /path/to/workspace (si existe)
```

---

### [STEP-10c] Estado de Proyectos (Coordinator Only)
**Origen**: Tablas `projects`, `tasks`  
**Archivo**: `context-compiler.ts` líneas 396-431

**Query**:
```sql
SELECT p.id, p.name, p.status, p.progress, p.description,
       COUNT(t.id) as total_tasks,
       SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as done_tasks
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
WHERE p.status IN ('active', 'pending', 'paused')
GROUP BY p.id
ORDER BY p.updated_at DESC
LIMIT 10
```

**Inyección**:
```
# ESTADO DE PROYECTOS

## Proyecto Alpha [ACTIVE] (3/5 tareas, 60%)
> Descripción del proyecto
  - [completed] Tarea 1 → Resultado parcial...
  - [in_progress] Tarea 2
  - [pending] Tarea 3
```

**Solo coordinator**: Los workers (`isWorker === true`) NO reciben esta sección.

---

### [STEP-10d] Catálogo de Herramientas y Skills
**Archivo**: `context-compiler.ts` líneas 434-480

**Inyección de instrucciones**:
```
# HERRAMIENTAS NATIVAS BÁSICAS (SIEMPRE DISPONIBLES)

- **save_note**: Guardar notas persistentes
- **notify**: Notificar usuarios
- **report_progress**: Reportar progreso
- **search_knowledge**: Descubrir conocimiento

## REGLAS DE USO:
1. Si necesitas una herramienta → USA search_knowledge
2. NUNCA uses MCP si existe nativa equivalente
3. Las herramientas MCP se activan dinámicamente vía search_knowledge
```

**Skills activas** (minimal + discovered):
```
# SKILLS ACTIVAS
- **memory_manager** [SIEMPRE]
- **canvas_report** [SIEMPRE]
- **web_search_skill** [DISCOVERED]
```

**Canvas A2UI Documentation** (líneas 482-572):
- Componentes disponibles para `canvas_render`
- Tipos: chart, table, progress, markdown, card, accordion, tabs, form, button, alert-dialog
- Ejemplos de uso

---

## 🧠 Estrategias de Context Engineering

El Context Compiler implementa 4 estrategias:

### 1. ESCRIBIR (Write)
- **Scratchpad**: Notas persistentes en `scratchpad` table
- **Traces**: Registro de ejecución en `traces` table

### 2. SELECCIONAR (Select)
- **Tool Loadout**: Máx 4 tools mínimas + descubrimiento dinámico
- **Playbook Filtering**: Reglas ACE aplicables vía FTS5
- **Historial Selectivo**: Últimos 40 mensajes + resumen

### 3. COMPRIMIR (Compress)
- **Compaction**: Resumen de mensajes viejos cuando `tokens > 6000`
- **Tool Result Clearing**: Reemplazar resultados antiguos por resúmenes

### 4. AISLAR (Isolate)
- **Worker Context**: Agents con `role='worker'` reciben contexto mínimo
- **Coordinator**: Ve panorama completo (proyectos, skills descubiertas)

---

## 🔍 Selectores FTS5 (Búsqueda Semántica)

### Tool Selector (`tool-selector.ts`)
**Función**: `selectTools(userMessage)`

**Configuración**:
```typescript
const MAX_TOOLS_PER_TURN = 12
const MIN_RELEVANCE_THRESHOLD = -30  // bm25 score
```

**Proceso**:
1. Filtra stopwords del mensaje
2. Construye query FTS5 con prefix matching
3. Ejecuta: `SELECT *, bm25(tools_fts) FROM tools_fts MATCH ? ORDER BY score`
4. Retorna tools con score > -30

**Tablas FTS5**:
- `tools_fts`: tool_name, name, description, category

### Skill Selector (`skill-selector.ts`)
**Función**: `selectSkills(userMessage)`

**Configuración**:
```typescript
const MAX_SKILLS_PER_TURN = 4
const MIN_RELEVANCE_THRESHOLD = -15
```

**Tablas FTS5**:
- `skills_fts`: id, name, description, category, tools, triggers, body

### Playbook Selector (`playbook-selector.ts`)
**Función**: `selectPlaybookRules(userMessage)`

**Tablas FTS5**:
- `playbook_fts`: rule, category, applicable_to

---

## 🗄️ Tablas de Base de Datos (Contexto)

### Tablas Principales

| Tabla | Propósito | Columnas Clave |
|-------|-----------|----------------|
| `agents` | Configuración de agentes | id, name, role, system_prompt, max_iterations, workspace |
| `users` | Identidad del usuario | id, name, language, timezone, occupation |
| `conversations` | Historial de mensajes | thread_id, role, content, tool_calls_json, token_count |
| `summaries` | Resúmenes de conversación | thread_id, summary, messages_covered |
| `scratchpad` | Notas persistentes | thread_id, key, value |
| `skills` | Skills (instrucciones) | name, description, tools, triggers, body |
| `tools` | Catálogo de herramientas | name, description, category |
| `playbook` | Reglas evolutivas (ACE) | rule, category, applicable_to, helpful_count |
| `ethics` | Reglas constitucionales | name, content, is_default |
| `mcp_servers` | Servidores MCP | name, transport, command, status |
| `mcp_tools` | Herramientas MCP descubiertas | server_id, tool_name, description |
| `projects` | Proyectos multi-paso | name, status, progress, task |
| `tasks` | Tareas atómicas | project_id, name, status, result |

### Índices FTS5

```sql
CREATE VIRTUAL TABLE tools_fts USING fts5(tool_name, name, description, category);
CREATE VIRTUAL TABLE skills_fts USING fts5(id, name, description, category, tools, triggers, body);
CREATE VIRTUAL TABLE playbook_fts USING fts5(rule, category, applicable_to);
CREATE VIRTUAL TABLE mcp_tools_fts USING fts5(server_name, tool_name, description, category);
```

---

## 🔄 Dynamic Tool Injection (Durante Tool Execution)

**Archivo**: `agent-loop.ts` líneas 378-470

Cuando el agente ejecuta `search_knowledge`, el agent loop:

1. **Intercepta el resultado** de `search_knowledge`
2. **Extrae herramientas encontradas**: `result.tools[]` y `result.toolsmcp[]`
3. **Inyecta en ctx.tools** (loadout dinámico):
   ```typescript
   ctx.tools.push({
     type: "function",
     function: {
       name: discoveredTool.name,
       description: discoveredTool.description,
       parameters: discoveredTool.parameters,
     },
   })
   ```
4. **Inyecta skills asociadas**: Busca skills que usan las herramientas inyectadas
5. **Enriquece system prompt**: Agrega `## Skill: {name}\n{body}`

**Ejemplo**:
```
User: "Busca información sobre React"
  ↓
Agente: search_knowledge(type="tools", query="web search")
  ↓
Result: { tools: [{name: "web_search"}], skills: [{name: "web_search_skill", body: "..."}] }
  ↓
Agent Loop inyecta:
  - web_search en ctx.tools (ahora callable)
  - web_search_skill en system prompt (instrucciones)
```

---

## 📊 Configuración y Constantes

### Context Compiler (`context-compiler.ts`)
```typescript
const KEEP_LAST_N_MESSAGES = 40
const TOKEN_COMPACT_THRESHOLD = 6000

const MINIMAL_TOOLS = ["save_note", "notify", "report_progress", "search_knowledge"]

const MINIMAL_SKILL_NAMES = ["busqueda_fts5", "canvas_report", "memory_manager"]
```

### Tool Selector (`tool-selector.ts`)
```typescript
const MAX_TOOLS_PER_TURN = 12
const MIN_RELEVANCE_THRESHOLD = -30
```

### Skill Selector (`skill-selector.ts`)
```typescript
const MAX_SKILLS_PER_TURN = 4
const MIN_RELEVANCE_THRESHOLD = -15
```

### Agent Loop (`agent-loop.ts`)
```typescript
const maxIterations = agent.max_iterations || 10
```

---

## 🏗️ Arquitectura del Compiler

### Fases del Context Compiler

```
┌─────────────────────────────────────────────────────────────┐
│  [STEP-1]  Load Agent Config (DB: agents)                   │
│  [STEP-2]  Load Scratchpad (DB: scratchpad)                 │
│  [STEP-3c] Load MCP Tools (MCP Manager + DB: mcp_servers)   │
│  [STEP-4]  Build Minimal Tool Set (createAllTools)          │
│  [STEP-8b] Skill Loadout (FTS5: skills_fts)                 │
│  [STEP-9]  Load Conversation History (DB: conversations)    │
│  [STEP-9b] Load Summary (DB: summaries)                     │
│  [STEP-10] Build System Prompt (ethics + agent + user)      │
│  [STEP-10b] Inject Date/Time + Timezone                     │
│  [STEP-10c] Inject Projects (coordinator only)              │
│  [STEP-10d] Inject Tool/Skill Catalog Instructions          │
└─────────────────────────────────────────────────────────────┘
                          ↓
            CompiledContext {
              systemPrompt: string
              messages: LLMMessage[]
              tools: LLMToolDef[] (mínimas: 4)
              allTools: ContextTool[] (70+ nativas + MCP)
              skills: SkillDescriptor[] (4-8 skills)
            }
```

### Fases del Agent Loop

```
┌─────────────────────────────────────────────────────────────┐
│  1. compileContext()                                        │
│  2. Build messages: [system, ...history, user]              │
│  3. WHILE iterations < maxIterations:                       │
│     a. callLLM(messages, tools)                             │
│     b. IF tool_calls:                                       │
│        - Execute each tool                                  │
│        - IF search_knowledge: inject discovered tools       │
│        - Add tool result to messages                        │
│     c. ELSE: break (final response)                         │
│  4. IF no final content: synthesis call                     │
│  5. Save trace, record usage                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 📝 Resumen: Qué Está en el Contexto

### Para Coordinator Agent:
1. **System Prompt** (~2000-4000 tokens):
   - Ética (reglas constitucionales)
   - Identidad del agente (nombre, rol, system_prompt, workspace)
   - Identidad del usuario (nombre, timezone, occupation)
   - Entorno actual (fecha, hora, timezone)
   - Estado de proyectos activos (últimos 10)
   - Instrucciones de herramientas básicas (4 tools)
   - Skills activas (4-8 skills)
   - Documentación Canvas A2UI

2. **Historial** (~2000-6000 tokens):
   - Resumen de conversación (si > 6000 tokens)
   - Últimos 40 mensajes

3. **Herramientas en contexto LLM** (4 tools):
   - save_note, notify, report_progress, search_knowledge

4. **Herramientas disponibles (ejecutores)** (70+):
   - Todas las nativas + MCP tools
   - Se activan vía search_knowledge

5. **Skills** (4-8):
   - 3 mínimas (busqueda_fts5, canvas_report, memory_manager)
   - 1-5 descubiertas vía FTS5

### Para Worker Agent:
1. **System Prompt** (reducido):
   - Ética
   - Identidad del agente
   - Entorno actual
   - NO recibe proyectos
   - NO recibe skills descubiertas

2. **Historial**: Solo el task_description

3. **Herramientas**: 4 mínimas + descubrimiento dinámico

4. **Skills**: Solo 3 mínimas

---

## 🔗 Dependencias entre Módulos

```
context-compiler.ts
  ├─ prompt-builder.ts (buildSystemPrompt)
  ├─ conversation-store.ts (getScratchpad, getRecentMessages, getSummary)
  ├─ skill-selector.ts (getMinimalSkills, selectSkills)
  ├─ tool-selector.ts (syncToolCatalogToFTS - reference only)
  ├─ playbook-selector.ts (syncPlaybookToFTS - reference only)
  ├─ tools/index.ts (createAllTools)
  ├─ mcp/singleton.ts (getMCPManager)
  ├─ mcp/tool-sync.ts (syncMCPToolsToDB, syncMCPToolsToFTS)
  ├─ storage/sqlite.ts (getDb)
  ├─ storage/onboarding.ts (resolveUserId)
  ├─ utils/toon.ts (formatContext, estimateTokens)
  ├─ utils/date.ts (getUserDate, getUserTime)
  └─ utils/logger.ts

agent-loop.ts
  ├─ context-compiler.ts (compileContext)
  ├─ llm-client.ts (callLLM, resolveProviderConfig)
  ├─ conversation-store.ts (addMessage, maybeCompact)
  ├─ compaction.ts (clearOldToolResults)
  ├─ tracer.ts (saveTrace, recordLLMUsage)
  ├─ canvas/emitter.ts (emitCanvas)
  ├─ storage/sqlite.ts (getDb)
  ├─ storage/onboarding.ts (resolveUserId, resolveAgentId)
  ├─ storage/usage.ts (getAverageTokenCost)
  ├─ tools/index.ts (executeTool helper)
  └─ utils/toon.ts (formatToolResult)
```

---

## 📌 Puntos Clave

1. **Contexto Dinámico**: No todo está pre-cargado. Herramientas y skills se descubren vía `search_knowledge` durante la ejecución.

2. **FTS5 para Selección**: Usa SQLite FTS5 bm25() scoring para selección semántica de tools/skills/playbook.

3. **Compresión Inteligente**: Cuando el historial > 6000 tokens, usa resumen + últimos 40 mensajes.

4. **Isolation Pattern**: Workers reciben contexto mínimo; coordinador ve el panorama completo.

5. **TOON Encoding**: Usa formato TOON para comprimir datos estructurados (scratchpad, user identity).

6. **Dynamic Tool Injection**: Durante tool execution, si `search_knowledge` encuentra tools, se inyectan en `ctx.tools` inmediatamente.

7. **MCP Tools**: No se inyectan en contexto LLM por defecto. Se descubren vía `search_knowledge(type="mcp")`.

---

**Fin del documento**.
