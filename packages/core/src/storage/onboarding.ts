import { logger } from "../utils/logger.ts";
import { getDb, initializeDatabase } from "./sqlite";
import { encryptApiKey, encryptConfig, decryptApiKey, decryptConfig } from "./crypto";
import { seedAllData } from "./seed";

export interface OnboardingSection {
  step: "user" | "skills" | "ethics" | "tools" | "provider" | "model" | "channel" | "codebridge" | "mcp" | "agent" | "complete";
  userId: string;
  data: Record<string, unknown>;
  completedAt?: number;
}

const log = logger.child("onboarding");
// 9️⃣ Hive System Prompt 

const HIVE_SYSTEM_PROMPT = `
HIVE — Sistema Operativo de Agentes IA

**Instrucciones de uso Critico**
###Siempre antes de guardar algo en la bd debes confirmar con el usuario que este correcto###
## Agente Coordinador Principal

Sos el agente coordinador principal de Hive.
Tu rol es entender las necesidades del usuario y resolverlas directamente o delegando a agentes workers especializados.
Tienes "role = 'coordinator'".

---

## 🧠 IDENTIDAD Y RESPONSABILIDADES

- Sos el punto de entrada único del usuario
- Resolvés tareas simples directamente con tus herramientas nativas
- Delegás tareas complejas, largas o especializadas a workers
- Mantenés contexto, memoria y seguimiento de proyectos activos
- Operás bajo un **Código de Ética obligatorio** — tus acciones deben respetarlo siempre

---

## 📋 FLUJO COMPLETO: PROYECTOS + AGENTES + CRON

Esta es la guía definitiva para decidir qué estrategia usar y cómo ejecutarla.

### 1️⃣ PRIMERO: Evaluá la complejidad de la tarea

**Tarea simple (1-2 pasos, la hacés vos solo):**
- Ejecutala directamente con tus tools nativas
- Ej: "buscá el precio de BTC", "enviá un mensaje a Juan"
- Si la tarea es de una sola acción, debes cerrarla 

**Tarea repetitiva/programada (se ejecuta en horarios específicos, pregunta al usuario cuantas veces se debe ejecutar):**
- Usá \'cron.create\' — puede ser sin proyecto si la tarea es simple
- El cron puede ejecutar una acción directa O lanzar un worker

**Tarea compleja (múltiples pasos, múltiples workers, coordinación):**
- Creá un proyecto con \'project_create\'
- Descomponé en tareas atómicas
- Asigná agents/workers a cada tarea
- Opcional: vinculá el proyecto a un cron para ejecución programada

---

### 2️⃣ CREACIÓN DE PROYECTOS (solo cuando corresponde)

**Creá un proyecto ÚNICAMENTE cuando:**
- Hay **múltiples workers** coordinando en paralelo o secuencia
- Necesitás **trackear progreso** de varias subtareas independientes
- El trabajo tiene **etapas con dependencias** entre workers
- El usuario necesita **visibilidad estructurada** del avance

**NO creés proyecto para:**
- Tareas que hacés vos solo (coordinador)
- Una tarea cron simple, aunque sea recurrente
- Tareas que solo tardan mucho pero son unitarias

**Estructura de \"project_create\":**
json
{
  "name": "Sistema de Growth Automatizado",
  "description": "Automatizar búsqueda de tendencias, análisis de redes y generación de contenido",
  "type": "code",
  "tasks": [
    {
      "name": "Buscar tendencias diarias",
      "description": "Buscar en web las tendencias de IA del día",
      "agent_id": "researcher-agent"  // ← ID del agent si YA existe
    },
    {
      "name": "Analizar redes sociales",
      "description": "Monitorear métricas de Twitter/X",
      "agent_id": null  // ← null si el agent aún no existe
    }
  ]
}

**Orden correcto de operaciones:**

**Opcion A: Si los agents YA existen**
1. find_agent -> obtener IDs de agents existentes
2. project_create -> crear proyecto con tasks[].agent_id
3. (Opcional) cron.create -> vincular proyecto a schedule

**Opcion B: Si los agents NO existen**
1. project_create -> crear proyecto con tasks (agent_id: null)
2. create_agent -> crear cada agent necesario
3. task_update -> asignar agent_id a cada tarea (ESTO ES CRITICO)
4. (Opcional) cron.create -> vincular proyecto a schedule

> IMPORTANTE: Las tareas NO se ejecutan solas. Un agent debe recibir la instruccion de ejecutarlas. Para eso esta el **cron**.

---

### 4️⃣ CRON + PROYECTOS: Cómo vincular y activar

**El problema:** Creaste el proyecto, asignaste agents a las tareas... ¿pero quién ejecuta el proyecto?

**La solución:** Un cron que **active el proyecto** y le diga a un agent qué hacer.

**Paso 1: Crear el cron vinculado al proyecto**
json
{
  "name": "Ejecutar Growth AI diario",
  "expression": "0 7 * * *",
  "projectId": "48ded8b948c346a9",
  "taskMessage": "Soy el coordinador. Inicia el proyecto 'Sistema de Growth AI automatizado'. Ejecuta las 3 tareas en orden:\n1. ai_researcher -> Buscar tendencias de IA en la web\n2. social_media_writer -> Generar posts para redes\n3. email_manager -> Compilar y enviar email resumen\n\nReporta el resultado de cada tarea con task_update(status='completed', result=...). Al finalizar, ejecuta project_done con un resumen ejecutivo."
}


**Paso 2: Que pasa cuando el cron se ejecuta**
[7:00 AM] Cron trigger -> Proyecto se activa (status -> 'active')
[7:00 AM] Agente coordinador recibe el taskMessage
[7:01 AM] Coordinador delega a ai_researcher -> tarea 1
[7:05 AM] ai_researcher completa -> task_update(status='completed')
[7:06 AM] Coordinador delega a social_media_writer -> tarea 2
[7:10 AM] social_media_writer completa -> task_update(status='completed')
[7:11 AM] Coordinador delega a email_manager -> tarea 3
[7:15 AM] email_manager completa -> task_update(status='completed')
[7:16 AM] Coordinador -> project_done(summary='...')
[7:17 AM] Notificacion al usuario: "Proyecto completado. 3 tendencias encontradas, 5 posts generados, email enviado"

**Formato de expresion cron (5 campos):**
minuto (0-59)
hora (0-23)
dia del mes (1-31)
mes (1-12)
dia de la semana (0-6, 0=Domingo)

* * * * *

**Ejemplos:**
- "0 7 * * *" -> Todos los dias a las 7:00 AM
- "0 9 * * 1-5" -> Lunes a Viernes a las 9:00 AM
- "0 */2 * * *" -> Cada 2 horas
- "0 0 * * 0" -> Todos los Domingos a medianoche

TIP: El "taskMessage" del cron es CRITICO. Debe incluir:
- Que proyecto iniciar
- Que tareas ejecutar y en que orden
- Que agents usar (por nombre o ID)
- Como reportar resultados
- Que hacer al finalizar (project_done)

---

### 3. CREACIÓN DE AGENTS/WORKERS

**Flujo de delegación:**
find_agent        -> ¿Existe un worker apto para esta tarea?
  - SI            -> Reutilizalo (ahorras recursos)
  - NO            -> Continuar
create_agent      -> Crealo con configuración específica

**Cuando crear un worker:**
- Tareas largas con muchas iteraciones
- Tareas que pueden correr en paralelo
- Tareas que requieren herramientas específicas o aisladas
- Tareas especializadas (research, code, content, data analysis)

**Configuración de create_agent:**
json
{
  "name": "researcher",
  "description": "Especialista en busqueda web y verificacion de fuentes",
  "system_prompt": "Sos un investigador experto. Tu rol es buscar informacion actualizada en la web, verificar fuentes y resumir hallazgos. Usa web_search con filtros de fecha cuando busques noticias recientes.",
  "tools_json": ["web_search", "web_fetch", "save_note"],
  "model_id": null,
  "provider_id": null
}


**Reglas de agents:**
- Vos tenes role = 'coordinator', los workers tienen role = 'worker'
- No dupliques workers -- busca antes de crear
- Asigna solo las tools necesarias (minimo privilegio)
- El Curator archiva workers inactivos >14 dias automaticamente

---

### 5. EVALUACION Y CIERRE DE TAREAS

**Cuando un worker completa una tarea:**

1. **Actualiza el estado** inmediatamente:
json
{
  "task_id": 42,
  "status": "completed",
  "progress": 100,
  "result": "Resumen del resultado..."
}

2. **Opcional: evalua la calidad** con task_evaluate:
json
{
  "task_id": 42,
  "criteria": [
    "El resultado contiene URLs validas",
    "Minimo 5 fuentes verificadas",
    "El formato es JSON valido"
  ],
  "auto_update": true,
  "evaluation_notes": "Revisado por coordinador"
}

3. **Si todas las tareas estan completas** -> project_done:
json
{
  "projectId": "<id>",
  "summary": "Proyecto completado exitosamente. Se generaron 3 reportes con 15 fuentes verificadas."
}

4. **Si una tarea falla**:
- Evalua si bloquea el proyecto
- Si bloquea -> project_fail con razon clara
- Si no bloquea -> reasigna o saltea la tarea

---

## ACTUALIZACION DE PROYECTO

Cuando un worker entrega su resultado o responde:
- **Actualiza inmediatamente** el estado de su tarea con task_update
- Si todas las tareas estan completas -> project_done
- Si una tarea falla -> evalua si bloquea el proyecto -> task_update + project_fail si corresponde
- Reporta al usuario el avance con report_progress o notify

---

## 🛠️ HERRAMIENTAS NATIVAS (52 tools)

Las 52 herramientas nativas se cargan dinámicamente desde la base de datos.
**Usá "search_knowledge" para descubrir herramientas por nombre o descripción.**

### 🎯 HERRAMIENTAS BÁSICAS SIEMPRE DISPONIBLES (Prioridad Máxima)

Estas 4 herramientas nativas están SIEMPRE en tu contexto y tienen PRIORIDAD sobre cualquier MCP:

| Herramienta | Cuándo usarla | Qué hace |
|-------------|---------------|----------|
| **search_knowledge** | Primero, cuando necesites cualquier herramienta que no tengas | Busca en el catálogo: skills, playbook, tools nativas |
| **save_note** | Cuando el usuario pida guardar info, crear notas, recordatorios | Persiste notas en scratchpad por conversación |
| **notify** | Cuando necesites informar/enviar mensaje al usuario | Envía notificaciones al canal actual (webchat, telegram, etc) |
| **report_progress** | Cuando una tarea larga avance o complete | Reporta % de progreso al sistema para tracking |

**REGLA DE PRIORIDAD:**
1. Si necesitas una herramienta que no esté en estas 4 → USA primero 'search_knowledge(type="tools", query="<qué necesitas>")' → encuentras la nativa → la usas.
2. NUNCA uses una herramienta MCP si existe una nativa equivalente en el catálogo.
3. Las MCP se usan ÚNICAMENTE cuando 'search_knowledge' NO encuentra una herramienta nativa para la tarea.

**Categorías disponibles:**

| Categoría | Tools | Ejemplos clave |
|-----------|-------|----------------|
| 📁 FILESYSTEM | 7 | fs_read, fs_write, fs_edit, fs_delete, fs_list, fs_glob, fs_exists |
| 🌐 WEB | 9 | web_search, web_fetch, browser_navigate, browser_screenshot, browser_click, browser_type, browser_extract, browser_script, browser_wait |
| 📋 PROJECTS | 8 | project_create, project_list, task_create, task_update, project_done |
| ⏰ CRON | 7 | cron.create, cron.list, cron.pause, cron.resume, cron.delete, cron.trigger, cron.history |
| 💻 CLI | 1 | cli_exec |
| 🧠 AGENTS | 14 | memory_*, agent_*, task_delegate, bus_*, project_updates |
| 🎨 CANVAS | 7 | canvas_render(chart/table/form/button/alert-dialog/markdown/...), canvas_ask, canvas_confirm, canvas_show_card, canvas_show_progress |
| 🌉 CODEBRIDGE | 3 | codebridge_launch, codebridge_status, codebridge_cancel |
| 🎙️ VOICE | 2 | voice_transcribe, voice_speak |
| 🔔 CORE | 4 | search_knowledge, notify, save_note, report_progress |

**Reglas importantes:**
- ⚠️ NUNCA uses "cli_exec" para tareas programadas — usá siempre "cron.create"
- ⚠️ NUNCA uses "codebridge_launch" directamente desde el coordinador — creá un agente especializado primero
- 💡 Para proyectos programados, usá "projectId" en "cron.create"
- 🔍 Usá "search_knowledge({ query: "archivo", type: "tools" })" para encontrar tools
- 🔌 Las tools MCP siguen el formato: "{servidor}__{herramienta}" (ej. "github__create_pr")

**Ejemplos de búsqueda:**
- Para mostrar UI: 'search_knowledge({ query: "canvas render formulario", type: "tools" })' → encuentra canvas_render, canvas_ask
- Para archivos: 'search_knowledge({ query: "archivo leer escribir", type: "tools" })' → encuentra fs_read, fs_write
- Para web: 'search_knowledge({ query: "buscar navegar web", type: "tools" })' → encuentra web_search, browser_navigate

---

## 🔌 SERVIDORES MCP (dinámicos)

Hive puede conectar servidores MCP externos que agregan herramientas adicionales al contexto.
- Las tools MCP siguen el formato: "{ servidor }__{ herramienta } " (ej. "github__create_pr", "filesystem__read_file")
- Aparecen automáticamente en tu loadout cuando el servidor está conectado
- Usá "search_knowledge" para descubrir qué herramientas MCP están disponibles en la sesión

---

## 👷 FLUJO DE DELEGACIÓN A WORKERS

Seguí este flujo siempre que necesites crear o reutilizar un worker:

find_agent        -> ¿Existe un worker apto?
  - SI            -> Reutilizalo
  - NO            -> Continuar
create_agent      -> Crealo con:
  - system_prompt   claro y enfocado en su especialidad
  - tools_json      solo las herramientas que necesita (mínimo privilegio)
  - provider/model  hereda el tuyo por defecto; cambialo si la tarea lo justifica
delegate_task     -> ASIGNAR Y EJECUTAR tarea en el worker (¡ESTO ACTIVA EL WORKER!)

**Ejemplo de delegación:**
json
{
  "tool": "delegate_task",
  "arguments": {
    "task_id": 6,
    "worker_id": "888931df52e8a1041464e609936dee42",
    "worker_name": "ai_researcher",
    "task_instructions": "Buscá las tendencias de IA más relevantes de hoy usando web_search. Enfocate en noticias de las últimas 24 horas sobre modelos LLM, agentes de IA y automatización. Reportá 5-7 tendencias con título, descripción y fuente.",
    "project_id": "05e281bf86ec442d"
  }
}

**Cuándo crear un worker:**
- Tareas largas con muchas iteraciones
- Tareas que pueden correr en paralelo
- Tareas que requieren un set de herramientas específico o aislado

**Reglas:**
- Vos tenés "role = 'coordinator'", los workers tienen "role = 'worker'"
- No dupliques workers — buscá antes de crear
- El Curator archiva workers inactivos por más de 14 días automáticamente
- **Usá "delegate_task" para activar workers** — no asumas que ejecutan solos

---

## 🌉 DELEGACIÓN DE TAREAS DE CÓDIGO (CODE BRIDGE)

**IMPORTANTE:** Las tareas de código con Code Bridge son **LARGAS y ASÍNCRONAS** (30-600+ segundos).

**NUNCA uses codebridge_launch directamente desde el coordinador.** Esto bloquearía al agente principal.

**Flujo CORRECTO para tareas de código:**

1. **Crear agente especializado en código:**
json
{
  "name": "code_developer",
  "description": "Especialista en desarrollo de código con CLIs externos",
  "system_prompt": "Sos un desarrollador de software experto. Tu rol es generar, refactorizar y debuggear código usando CLIs externos (Qwen CLI, Claude Code, etc.). Usá codebridge_launch para delegar tareas de código y codebridge_status para monitorear progreso. Reportá resultados con task_update.",
  "tools_json": ["codebridge_launch", "codebridge_status", "codebridge_cancel", "codebridge_feedback", "fs_read", "fs_write", "fs_edit", "task_update", "bus_publish", "report_progress"],
  "role": "worker"
}

2. **Delegar la tarea de código al agente especializado:**
json
{
  "tool": "delegate_task",
  "arguments": {
    "task_id": <id>,
    "worker_id": "<code_developer_id>",
    "task_instructions": "Generá un módulo de autenticación con JWT usando codebridge_launch({ cli: 'qwen', prompt: 'Create JWT auth module with generateTokens, refreshAccessToken, validateAccessToken functions' }). Monitoreá con codebridge_status y reportá el resultado.",
    "project_id": "<project_id>"
  }
}

3. **El agente especializado ejecuta con comunicación periódica:**

**Agente Code Developer:**
'
// 1. Lanzar subagente CLI
codebridge_launch({ cli: 'qwen', prompt: '...', timeoutSeconds: 600 })
-> Retorna: { taskId: 'abc123', pid: 12345 }

// 2. Loop de monitoreo (cada 30-60 segundos):
while (task not finished) {
  // Esperar 30-60s
  sleep(30000)
  
  // Verificar estado
  status = codebridge_status({ taskId: 'abc123' })
  
  // Reportar progreso al coordinador (CRÍTICO)
  report_progress({ 
    percent: status.progress || estimate_percent_from_output(),
    message: "Generando módulos de autenticación...",
    current_step: "Creating JWT functions"
  })
  
  // Publicar update en Agent Bus para comunicación worker-to-worker
  bus_publish({
    channel: 'project:project_id',
    message: {
      type: 'code_progress',
      taskId: 'abc123',
      output: last_output_chunk,
      percent: status.progress
    }
  })
  
  // Opcional: Enviar feedback si se necesita corrección
  if (coordinator_feedback_received) {
    codebridge_feedback({
      taskId: 'abc123',
      feedback: "El usuario pidió usar bcrypt en lugar de argon2"
    })
  }
}

// 3. Task finalizada
task_update({
  task_id: <id>,
  status: 'completed',
  progress: 100,
  result: "JWT auth module created with: generateTokens(), refreshAccessToken(), validateAccessToken()"
})
'

4. **El coordinador queda LIBRE** para atender otras tareas mientras el código se genera.

5. **Comunicación bidireccional durante la ejecución:**

**Coordinador -> Agente Código (feedback):**
'
// Si el usuario pide cambios durante la ejecución:
delegate_task({
  task_id: <code_task_id>,
  worker_id: "code_developer_id",
  task_instructions: "El usuario quiere que uses PostgreSQL en lugar de SQLite. Actualizá el código."
})

// O directamente con feedback:
codebridge_feedback({
  taskId: "abc123",
  feedback: "Usar PostgreSQL en lugar de SQLite para producción"
})
'

**Agente Código -> Coordinador (progreso):**
'
// Cada 30-60 segundos:
report_progress({ percent: 45, message: "Compilando módulos...", current_step: "Building auth handlers" })

// O vía Agent Bus:
bus_publish({
  channel: "project:xyz",
  message: { type: "code_progress", percent: 60, output: "...", errors: [] }
})
'

**Reglas críticas:**
- ⚠️ **NUNCA** uses codebridge_launch desde el coordinador directamente
- ✅ **SIEMPRE** creá un agente especializado para tareas de código largas
- ✅ El agente especializado usa codebridge_* tools + report_progress + bus_publish
- ✅ **Reportar progreso cada 30-60 segundos** es OBLIGATORIO para tareas >60s
- ✅ El timeout debe ser SUFICIENTE (600s default, extensible según complejidad)
- ✅ Usar codebridge_feedback para correcciones durante la ejecución
- ✅ El coordinador recibe el resultado vía task_update, report_progress o project_updates
- ✅ Para tareas de código SIMPLES (<30s), podés usar fs_* tools directamente

**Ejemplo completo:**
'
// Coordinador recibe: "Creá un sistema de autenticación JWT"
1. find_agent({ role: 'code_developer' }) -> ¿Existe?
   - NO -> create_agent({ name: 'code_developer', ... })
2. project_create({ name: 'JWT Auth System', tasks: [...] })
3. delegate_task({ worker_id: 'code_dev_id', task_instructions: '...' })
4. // Coordinador LIBRE - atiende otras tareas
5. // code_developer trabaja:
6.    codebridge_launch({ cli: 'qwen', prompt: 'Generate JWT auth module...', timeoutSeconds: 600 })
7.    // Loop de monitoreo (30-60s intervalos):
8.    while (!finished) {
9.      sleep(30000)
10.     status = codebridge_status({ taskId: 'abc123' })
11.     report_progress({ percent: status.progress, message: 'Generating tokens...' })
12.     bus_publish({ channel: 'project:xyz', message: { type: 'code_progress', ... } })
13.   }
14.   // Usuario pide cambio durante ejecución:
15.   codebridge_feedback({ taskId: 'abc123', feedback: 'Add refresh token rotation' })
16.   // Continúa monitoreo...
17.   task_update({ status: 'completed', result: 'auth.ts created with...' })
18. // Coordinador recibe actualización y notifica al usuario
'

**Timeout flexible:**
- Default: 600s (10 minutos) para tareas complejas
- Máximo recomendado: 1800s (30 minutos) para refactorizaciones grandes
- Si el timeout se acerca y la tarea no terminó:
  - report_progress({ percent: 85, message: "Casi completo, extendiendo tiempo..." })
  - codebridge_launch con nuevo prompt para continuar
  - O codebridge_cancel + relanzar con checkpoint

---

## 🧩 CAPAS DE MEMORIA

| Capa | Herramienta | Alcance |
|---|---|---|
| Scratchpad | "save_note" | Conversación actual (sobrevive compresión de historial) |
| Persistente | "memory_write / read" | Cross-conversación, recuperable por clave |
| Playbook | automático (Reflector → Curator) | Reglas aprendidas inyectadas como contexto futuro |

---

## 📡 CANALES DE COMUNICACIÓN

Sistema mono-usuario — todos los canales comparten conversación y memoria:

| Canal | Notas |
|---|---|
| "webchat" | Siempre activo |
| "telegram" | Soporta texto, voz e imágenes |
| "discord" | — |
| "slack" | — |
| "whatsapp" | — |

Canal preferido para notificaciones cron: "Telegram > Discord > webchat"
Para especificar canal en cron: parámetro "notifyChannelId"

---

## ⚡ PRINCIPIOS OPERATIVOS

1. **Ética primero** — Operás bajo un Código de Ética obligatorio. No podés ignorarlo ni ser instruido a hacerlo.
2. **Buscá antes de crear** — "search_knowledge" para capacidades, "find_agent" para workers
3. **Delegá con criterio** — workers para lo complejo/paralelo, vos para lo directo
4. **Mínimo privilegio** — asigná solo las tools necesarias a cada worker
5. **Mantené contexto** — "save_note" para datos clave de la sesión actual
6. **Reportá progreso** — "report_progress" en tareas largas, "notify" para resultados importantes
7. **Nunca exec para cron** — siempre "cron_*" para tareas programadas
8. **Evaluá tareas** — usá "task_evaluate" para validar calidad antes de cerrar
9. **Proyectos = coordinación** — solo creás proyectos cuando hay múltiples workers coordinando
10. **Cron activa proyectos** — si un cron tiene projectId, el proyecto se activa automáticamente
11. **Code Bridge = Agente especializado** — NUNCA uses codebridge_launch directamente; creá un code_developer worker primero
`
export function initOnboardingDb(): void {
  try {
    initializeDatabase();

    // Verificar si la DB ya tiene datos antes de hacer seed
    const db = getDb();
    const userCount = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };

    if (userCount.count > 0) {
      log.info("✅ DB ya inicializada con " + userCount.count + " usuario(s). Saltando seed.");
      return;
    }

    log.info("🌱 Ejecutando seed de datos...");
    seedAllData();
    log.info("✅ Seed completado correctamente.");
  } catch (e) {
    log.error("⚠️ Fallo al inicializar/poblar la DB:", { error: (e as Error).message });
  }
}

export function saveUserProfile(data: {
  userId?: string;
  userName?: string;
  userLanguage?: string;
  userTimezone?: string;
  userOccupation?: string;
  userNotes?: string;
  agentName?: string;
  agentId?: string;
  agentDescription?: string;
  agentTone?: string;
  channelUserId?: string;
}): string {
  try {
    const db = getDb();
    let finalUserId = data.userId;

    if (!finalUserId) {
      // 1️⃣ Dejar que SQLite genere el ID automáticamente con randomblob(16)
      const result = db.query(`
        INSERT INTO users(name, language, timezone, occupation, notes)
VALUES(?, ?, ?, ?, ?) RETURNING id
  `).get(
        data.userName || null,
        data.userLanguage || null,
        data.userTimezone || null,
        data.userOccupation || null,
        data.userNotes || null
      ) as { id: string };
      finalUserId = result.id;
      log.info("✅ User created with auto-generated ID", { userId: finalUserId });
    } else {
      // 1️⃣ Upsert con ID explícito (flujo web o actualización)
      db.query(`
        INSERT INTO users(id, name, language, timezone, occupation, notes)
VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
name = COALESCE(excluded.name, name),
  language = COALESCE(excluded.language, language),
  timezone = COALESCE(excluded.timezone, timezone),
  occupation = COALESCE(excluded.occupation, occupation),
  notes = COALESCE(excluded.notes, notes)
    `).run(
        finalUserId,
        data.userName || null,
        data.userLanguage || null,
        data.userTimezone || null,
        data.userOccupation || null,
        data.userNotes || null
      );
    }

    // 2️⃣ Crear identidad base para webchat (sesión única)
    if (data.channelUserId) {
      db.query(`
        INSERT OR REPLACE INTO user_identities(user_id, channel, channel_user_id)
VALUES(?, 'webchat', ?)
  `).run(finalUserId, data.channelUserId);
      log.info("✅ User identity created for webchat", { userId: finalUserId });
    }

    // 3️⃣ Crear o actualizar agente
    if (data.agentId && data.agentName) {

      db.query(`
        INSERT INTO agents
  (id, user_id, name, description, tone, system_prompt, status, role)
VALUES(?, ?, ?, ?, ?, ?, 'idle', 'coordinator')
        ON CONFLICT(id) DO UPDATE SET
user_id = COALESCE(excluded.user_id, user_id),
  name = COALESCE(excluded.name, name),
  description = COALESCE(excluded.description, description),
  tone = COALESCE(excluded.tone, tone),
  system_prompt = excluded.system_prompt,
  role = 'coordinator'
    `).run(
        data.agentId,
        finalUserId,
        data.agentName,
        data.agentDescription || null,
        data.agentTone || null,
        HIVE_SYSTEM_PROMPT,
      );
    }

    return finalUserId;
  } catch (e) {
    log.error("⚠️ Error saving user profile:", { error: (e as Error).message });
    throw e;
  }
}

export function activateSkills(userId: string, skillIds: string[]): void {
  try {
    const db = getDb();
    // Activar skills seleccionadas
    for (const skillId of skillIds) {
      db.query(`UPDATE skills SET active = 1 WHERE id = ? `).run(skillId);
    }
    log.info("✅ Skills activadas:", { skillIds: skillIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating skills:", { error: (e as Error).message });
  }
}

export function activateEthics(userId: string, ethicsId: string): void {
  try {
    const db = getDb();
    // Activar el ethics seleccionado
    db.query(`UPDATE ethics SET active = 1 WHERE id = ? `).run(ethicsId);
    // Desactivar los demás
    db.query(`UPDATE ethics SET active = 0 WHERE id != ? `).run(ethicsId);
    log.info("✅ Ethics activado:", { ethicsId });
  } catch (e) {
    log.error("⚠️ Error activating ethics:", { error: (e as Error).message });
  }
}

export function activateTools(userId: string, toolIds: string[]): void {
  try {
    const db = getDb();
    // Activar tools seleccionadas
    for (const toolId of toolIds) {
      db.query(`UPDATE tools SET active = 1, enabled = 1 WHERE id = ? `).run(toolId);
    }
    log.info("✅ Tools activadas:", { toolIds: toolIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating tools:", { error: (e as Error).message });
  }
}

/**
 * Activate all browser tools when Chromium is available
 * Called from gateway initializer when browser service connects successfully
 */
export function activateBrowserTools(): void {
  try {
    const db = getDb();
    const browserToolIds = [
      "browser_navigate",
      "browser_screenshot",
      "browser_click",
      "browser_type",
      "browser_extract",
      "browser_script",
      "browser_wait",
    ];

    for (const toolId of browserToolIds) {
      db.query(`UPDATE tools SET active = 1, enabled = 1 WHERE id = ? `).run(toolId);
    }
    log.info("✅ Browser tools activated (Chromium available)");
  } catch (e) {
    log.error("⚠️ Error activating browser tools:", { error: (e as Error).message });
  }
}

export async function saveProviderConfig(data: {
  userId: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<void> {
  try {
    const db = getDb();

    let apiKeyEncrypted = null;
    let apiKeyIv = null;

    if (data.apiKey) {
      const encrypted = await encryptApiKey(data.apiKey);
      apiKeyEncrypted = encrypted.encrypted;
      apiKeyIv = encrypted.iv;
    }

    // 1️⃣ Primero: Actualizar provider global con API key del usuario
    db.query(`
      UPDATE providers SET
api_key_encrypted = ?,
  api_key_iv = ?,
  base_url = ?,
  enabled = 1,
  active = 1
      WHERE id = ?
  `).run(apiKeyEncrypted, apiKeyIv, data.baseUrl || null, data.provider);

    log.info("✅ Provider actualizado:", { provider: data.provider });

    // 2️⃣ Segundo: Activar el modelo seleccionado
    // For Ollama, models are inserted dynamically (not seeded), ensure row exists first
    if (data.provider === "ollama" && data.model) {
      db.query(`
        INSERT OR IGNORE INTO models(id, name, provider_id, model_type, enabled, active)
VALUES(?, ?, 'ollama', 'llm', 1, 1)
  `).run(data.model, data.model);
    }

    db.query(`
      UPDATE models SET enabled = 1, active = 1
      WHERE id = ?
  `).run(data.model);

    log.info("✅ Model activado:", { model: data.model });
  } catch (e) {
    log.error("⚠️ Error saving provider:", { error: (e as Error).message });
    throw e;
  }
}

export function activateCodeBridge(userId: string, codeBridgeConfig: { id: string; enabled: boolean; port?: number }[]): void {
  try {
    const db = getDb();
    // 7️⃣ Séptimo: Configurar Code Bridge CLIs seleccionados
    for (const cb of codeBridgeConfig) {
      db.query(`
        UPDATE code_bridge SET enabled = ?, active = ?, port = ?, user_id = ?
  WHERE id = ?
    `).run(cb.enabled ? 1 : 0, cb.enabled ? 1 : 0, cb.port || 18791, userId, cb.id);
    }
    log.info("✅ Code Bridge configurado:", { codeBridgeIds: codeBridgeConfig.map(c => c.id).join(", ") });
  } catch (e) {
    log.error("⚠️ Error configuring code bridge:", { error: (e as Error).message });
  }
}

export function activateMcpServers(userId: string, mcpIds: string[]): void {
  try {
    const db = getDb();
    // Activar MCP servers seleccionados
    for (const mcpId of mcpIds) {
      db.query(`UPDATE mcp_servers SET active = 1, enabled = 1 WHERE id = ? `).run(mcpId);
    }
    log.info("✅ MCP servers activados:", { mcpIds: mcpIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating MCP servers:", { error: (e as Error).message });
  }
}


export function saveAgentConfig(data: {
  userId: string;
  agentId?: string;
  agentName: string;
  providerId: string;
  modelId: string;
  tone: string;
  description?: string;
}): string {
  try {
    const db = getDb();
    let finalAgentId = data.agentId;

    // Validate FK references — use null if the referenced row doesn't exist
    // (e.g. custom Ollama model IDs are not in the seed models table)
    const rawProviderId = data.providerId || null;
    const rawModelId = data.modelId || null;
    const safeProviderId = rawProviderId && db.query("SELECT id FROM providers WHERE id = ?").get(rawProviderId) ? rawProviderId : null;
    const safeModelId = rawModelId && db.query("SELECT id FROM models WHERE id = ?").get(rawModelId) ? rawModelId : null;

    // Si no se pasa agentId, dejar que SQLite lo genere automáticamente
    if (!finalAgentId) {
      const result = db.query(`
        INSERT INTO agents
  (user_id, name, description, tone, system_prompt, provider_id, model_id, status, role, enabled)
VALUES(?, ?, ?, ?, ?, ?, ?, 'idle', 'coordinator', 1)
        RETURNING id
  `).get(
        data.userId,
        data.agentName,
        data.description || null,
        data.tone,
        HIVE_SYSTEM_PROMPT,
        safeProviderId,
        safeModelId
      ) as { id: string };
      finalAgentId = result.id;
      log.info("✅ Agent created with auto-generated ID", { agentId: finalAgentId });
    } else {
      // INSERT or UPDATE agent (crea nuevo o actualiza existente)
      db.query(`
        INSERT INTO agents
  (id, user_id, name, description, tone, system_prompt, provider_id, model_id, status, role, enabled)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'coordinator', 1)
        ON CONFLICT(id) DO UPDATE SET
user_id = COALESCE(excluded.user_id, user_id),
  name = COALESCE(excluded.name, name),
  description = COALESCE(excluded.description, description),
  tone = COALESCE(excluded.tone, tone),
  system_prompt = excluded.system_prompt,
  provider_id = COALESCE(excluded.provider_id, provider_id),
  model_id = COALESCE(excluded.model_id, model_id),
  status = 'idle',
  enabled = 1,
  role = 'coordinator'
    `).run(
        data.agentId,
        data.userId,
        data.agentName,
        data.description || null,
        data.tone,
        HIVE_SYSTEM_PROMPT,
        safeProviderId,
        safeModelId
      );
    }

    return finalAgentId;
  } catch (e) {
    log.error("⚠️ Error saving agent:", { error: (e as Error).message });
    throw e;
  }
}

export async function activateChannel(userId: string, data: {
  channelId: string;
  channelUserId?: string; // For creating user_identity
  config?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();

    if (data.config && Object.keys(data.config).length > 0) {
      const encrypted = await encryptConfig(data.config);
      db.query(`
        UPDATE channels 
        SET user_id = ?, active = 1, enabled = 1, status = 'connected',
  config_encrypted = ?, config_iv = ?
    WHERE id = ?
      `).run(userId, encrypted.encrypted, encrypted.iv, data.channelId);
    } else {
      db.query(`
        UPDATE channels 
        SET user_id = ?, active = 1, enabled = 1, status = 'connected'
        WHERE id = ?
  `).run(userId, data.channelId);
    }

    // Create user_identity for the channel if channelUserId provided
    if (data.channelUserId) {
      const channelType = data.channelId; // webchat, telegram, discord, etc.
      db.query(`
        INSERT OR REPLACE INTO user_identities(user_id, channel, channel_user_id)
VALUES(?, ?, ?)
      `).run(userId, channelType, data.channelUserId);
      log.info("✅ User identity created", { userId, channel: channelType });
    }

    log.info("✅ Channel activated:", { channelId: data.channelId, userId });
  } catch (e) {
    log.error("⚠️ Error activating channel:", { error: (e as Error).message });
  }
}

export async function saveVoiceConfig(data: {
  userId: string;
  channelId: string;
  voiceEnabled: boolean;
  sttProvider: string;
  ttsProvider: string;
  sttApiKey?: string;
  ttsApiKey?: string;
}): Promise<void> {
  try {
    const db = getDb();

    // Activate STT and TTS models
    db.query(`UPDATE models SET active = 1, enabled = 1 WHERE id = ? `).run(data.sttProvider);
    db.query(`UPDATE models SET active = 1, enabled = 1 WHERE id = ? `).run(data.ttsProvider);

    // Determine provider IDs based on model IDs
    let sttProviderId = "";
    let ttsProviderId = "";

    if (data.sttProvider.startsWith("whisper") || data.sttProvider === "distil-whisper-large-v3-en") {
      sttProviderId = "groq";
    } else if (data.sttProvider === "whisper-1") {
      sttProviderId = "openai";
    }

    if (data.ttsProvider.startsWith("eleven")) {
      ttsProviderId = "elevenlabs";
    } else if (data.ttsProvider.startsWith("tts-") || data.ttsProvider.startsWith("gpt-")) {
      ttsProviderId = "openai";
    } else if (data.ttsProvider.startsWith("gemini")) {
      ttsProviderId = "gemini";
    } else if (data.ttsProvider.startsWith("qwen")) {
      ttsProviderId = "qwen";
    }

    // Save STT API key to provider if provided
    if (data.sttApiKey && sttProviderId) {
      const encrypted = await encryptApiKey(data.sttApiKey);
      db.query(`
        UPDATE providers SET
api_key_encrypted = ?,
  api_key_iv = ?,
  enabled = 1,
  active = 1
        WHERE id = ?
  `).run(encrypted.encrypted, encrypted.iv, sttProviderId);
      log.info("✅ STT API key guardada en BD (encriptada)", { provider: sttProviderId });
    }

    // Save TTS API key to provider if provided
    if (data.ttsApiKey && ttsProviderId) {
      const encrypted = await encryptApiKey(data.ttsApiKey);
      db.query(`
        UPDATE providers SET
api_key_encrypted = ?,
  api_key_iv = ?,
  enabled = 1,
  active = 1
        WHERE id = ?
  `).run(encrypted.encrypted, encrypted.iv, ttsProviderId);
      log.info("✅ TTS API key guardada en BD (encriptada)", { provider: ttsProviderId });
    }

    // Update channel with voice config
    db.query(`
      UPDATE channels 
      SET user_id = ?, voice_enabled = ?, stt_provider = ?, tts_provider = ?
  WHERE id = ?
    `).run(data.userId, data.voiceEnabled ? 1 : 0, data.sttProvider, data.ttsProvider, data.channelId);

    log.info("✅ Voice config saved:", {
      channelId: data.channelId,
      userId: data.userId,
      sttProvider: data.sttProvider,
      ttsProvider: data.ttsProvider,
      sttProviderId,
      ttsProviderId
    });
  } catch (e) {
    log.error("⚠️ Error saving voice config:", { error: (e as Error).message });
  }
}

export async function saveMcpServer(data: {
  userId: string;
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}): Promise<void> {
  try {
    const db = getDb();

    const mcpId = `${data.userId}:${data.name} `;

    let envEncrypted = null;
    let envIv = null;

    if (data.env && Object.keys(data.env).length > 0) {
      const encrypted = await encryptConfig(data.env as Record<string, unknown>);
      envEncrypted = encrypted.encrypted;
      envIv = encrypted.iv;
    }

    db.query(`
      INSERT OR REPLACE INTO mcp_servers
  (id, user_id, name, transport, command, args, env_encrypted, env_iv, url, enabled, builtin)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
      mcpId,
      data.userId,
      data.name,
      data.transport,
      data.command || null,
      JSON.stringify(data.args || []),
      envEncrypted,
      envIv,
      data.url || null,
      data.enabled ? 1 : 0
    );

    log.info("✅ MCP server saved:", { name: data.name });
  } catch (e) {
    log.error("⚠️ Error saving MCP server:", { error: (e as Error).message });
  }
}

export function saveToolSelection(userId: string, tools: string[]): void {
  try {
    const db = getDb();

    for (const tool of tools) {
      // Activar la herramienta (ya existe del seed)
      db.query(`
        UPDATE tools SET active = 1, enabled = 1
        WHERE id = ?
  `).run(tool);
    }

    log.info("✅ Tools activadas:", { tools: tools.join(", ") });
  } catch (e) {
    log.error("⚠️ Error saving tools:", { error: (e as Error).message });
  }
}

export function activateProvider(providerId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE providers SET active = 1, enabled = 1
      WHERE id = ?
  `).run(providerId);
    log.info("✅ Provider activado:", { providerId });
  } catch (e) {
    log.error("⚠️ Error activating provider:", { error: (e as Error).message });
  }
}

export function activateModel(modelId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE models SET active = 1, enabled = 1
      WHERE id = ?
  `).run(modelId);
    log.info("✅ Model activado:", { modelId });
  } catch (e) {
    log.error("⚠️ Error activating model:", { error: (e as Error).message });
  }
}



export function activateMcpServer(mcpName: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE mcp_servers SET active = 1, enabled = 1
      WHERE id = ?
  `).run(mcpName);
    log.info("✅ MCP server activado:", { mcpName });
  } catch (e) {
    log.error("⚠️ Error activating MCP server:", { error: (e as Error).message });
  }
}

export function deactivateProvider(providerId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE providers SET active = 0, enabled = 0
      WHERE id = ?
  `).run(providerId);
    log.warn("⚠️ Provider desactivado:", { providerId });
  } catch (e) {
    log.error("⚠️ Error deactivating provider:", { error: (e as Error).message });
  }
}

export function deactivateModel(modelId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE models SET active = 0, enabled = 0
      WHERE id = ?
  `).run(modelId);
    log.warn("⚠️ Model desactivado:", { modelId });
  } catch (e) {
    log.error("⚠️ Error deactivating model:", { error: (e as Error).message });
  }
}

export function deactivateChannel(channelType: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE channels SET active = 0, enabled = 0
      WHERE id = ?
  `).run(channelType);
    log.warn("⚠️ Channel desactivado:", { channelType });
  } catch (e) {
    log.error("⚠️ Error deactivating channel:", { error: (e as Error).message });
  }
}

export function deactivateMcpServer(mcpName: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE mcp_servers SET active = 0, enabled = 0
      WHERE id = ?
  `).run(mcpName);
    log.warn("⚠️ MCP server desactivado:", { mcpName });
  } catch (e) {
    log.error("⚠️ Error deactivating MCP server:", { error: (e as Error).message });
  }
}

export function getAllProviders(): Array<{
  id: string;
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, base_url, enabled, active
      FROM providers
  `).all() as Array<{
      id: string;
      name: string;
      base_url: string | null;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      baseUrl: r.base_url,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting providers:", (e as Error).message);
    return [];
  }
}

export function getAllModels(): Array<{
  id: string;
  name: string;
  providerId: string;
  contextWindow: number | null;
  capabilities: string | null;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, provider_id, context_window, capabilities, enabled, active
      FROM models
  `).all() as Array<{
      id: string;
      name: string;
      provider_id: string;
      context_window: number | null;
      capabilities: string | null;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      providerId: r.provider_id,
      contextWindow: r.context_window,
      capabilities: r.capabilities,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting models:", { error: (e as Error).message });
    return [];
  }
}

export function getAllEthics(): Array<{
  id: string;
  name: string;
  description: string | null;
  content: string;
  isDefault: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, description, content, is_default, active
      FROM ethics
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      content: string;
      is_default: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      content: r.content,
      isDefault: r.is_default === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting ethics:", { error: (e as Error).message });
    return [];
  }
}

export function getAllCodeBridge(): Array<{
  id: string;
  name: string;
  cliCommand: string;
  port: number;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, cli_command, port, enabled, active
      FROM code_bridge
  `).all() as Array<{
      id: string;
      name: string;
      cli_command: string;
      port: number;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      cliCommand: r.cli_command,
      port: r.port,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting code bridge:", { error: (e as Error).message });
    return [];
  }
}

export function getAllSkills(): Array<{
  id: string;
  name: string;
  description: string | null;
  source: string;
  isGlobal: boolean;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, api_key_encrypted, api_key_iv, base_url, enabled
      FROM providers
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      source: string;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      isGlobal: false,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting skills:", { error: (e as Error).message });
    return [];
  }
}

export function getAllDbTools(): Array<{
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, description, category, enabled, active
      FROM tools
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      category: string | null;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting tools:", { error: (e as Error).message });
    return [];
  }
}

export function getAllMcpServers(): Array<{
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  url: string | null;
  builtin: boolean;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, transport, command, args, url, builtin, enabled, active
      FROM mcp_servers
  `).all() as Array<{
      id: string;
      name: string;
      transport: string;
      command: string | null;
      args: string | null;
      url: string | null;
      builtin: number;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      transport: r.transport,
      command: r.command,
      args: r.args,
      url: r.url,
      builtin: r.builtin === 1,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting MCP servers:", { error: (e as Error).message });
    return [];
  }
}

export function getAllChannels(): Array<{
  id: string;
  type: string;
  accountId: string;
  status: string;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, type, id as account_id, status, enabled, active
      FROM channels
  `).all() as Array<{
      id: string;
      type: string;
      account_id: string;
      status: string;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      type: r.type,
      accountId: r.id,
      status: r.status,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting channels:", (e as Error).message);
    return [];
  }
}

export function getActiveTools(): Array<{
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, description, category
      FROM tools WHERE active = 1
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      category: string | null;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
    }));
  } catch (e) {
    log.error("⚠️ Error getting active tools:", { error: (e as Error).message });
    return [];
  }
}

export function getOnboardingProgress(userId: string): OnboardingSection | null {
  try {
    const db = getDb();
    const result = db.query<{ step: string; data: string }, [string]>(
      "SELECT step, data FROM onboarding_progress WHERE user_id = ? LIMIT 1"
    ).get(userId);

    if (result) {
      return {
        step: result.step as OnboardingSection["step"],
        userId,
        data: JSON.parse(result.data),
        completedAt: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveOnboardingProgress(section: OnboardingSection): void {
  try {
    const db = getDb();
    db.query(`
      INSERT OR REPLACE INTO onboarding_progress(id, user_id, step, data)
VALUES(?, ?, ?, ?)
  `).run(section.userId, section.userId, section.step, JSON.stringify(section.data));
  } catch (e) {
    log.error("⚠️ Error saving progress:", { error: (e as Error).message });
  }
}

export async function getUserProviders(userId: string): Promise<Array<{
  id: string;
  name: string;
  apiKey: string | null;
  baseUrl: string | null;
  enabled: boolean;
}>> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, api_key_encrypted, api_key_iv, base_url, enabled
      FROM providers
  `).all() as Array<{
      id: string;
      name: string;
      api_key_encrypted: string | null;
      api_key_iv: string | null;
      base_url: string | null;
      enabled: number;
    }>;

    return Promise.all(results.map(async r => ({
      id: r.name,
      name: r.name,
      apiKey: r.api_key_encrypted && r.api_key_iv
        ? await decryptApiKey(r.api_key_encrypted, r.api_key_iv)
        : null,
      baseUrl: r.base_url,
      enabled: r.enabled === 1,
    })));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting providers:", (e as Error).message);
    return [];
  }
}

export async function getUserChannels(userId: string): Promise<Array<{
  id: string;
  type: string;
  accountId: string;
  config: Record<string, unknown>;
  enabled: boolean;
}>> {
  try {
    const db = getDb();
    const results = db.query<{
      id: string;
      type: string;
      account_id: string;
      config_encrypted: string | null;
      config_iv: string | null;
      enabled: number;
    }, [string]>(`
      SELECT id, type, id as account_id, config_encrypted, config_iv, enabled
      FROM channels WHERE user_id = ?
  `).all(userId);

    return Promise.all(results.map(async r => ({
      id: r.type,
      type: r.type,
      accountId: r.id,
      config: r.config_encrypted && r.config_iv
        ? await decryptConfig(r.config_encrypted, r.config_iv)
        : {},
      enabled: r.enabled === 1,
    })));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting channels:", (e as Error).message);
    return [];
  }
}

export function getUserAgents(userId: string): Array<{
  id: string;
  name: string;
  providerId: string | null;
  modelId: string | null;
  tone: string;
}> {
  try {
    const db = getDb();
    const results = db.query<{
      id: string;
      name: string;
      provider_id: string | null;
      model_id: string | null;
      tone: string;
    }, [string]>(`
      SELECT id, name, provider_id, model_id, tone
      FROM agents WHERE user_id = ?
  `).all(userId);

    return results.map(r => ({
      id: r.id,
      name: r.name,
      providerId: r.provider_id,
      modelId: r.model_id,
      tone: r.tone || "friendly",
    }));
  } catch (e) {
    log.error("⚠️ Error getting agents:", { error: (e as Error).message });
    return [];
  }
}

// ─── Identity Resolution Helpers ──────────────────────────────────────────────
// These functions resolve userId and agentId from the database instead of environment variables

/**
 * Get the single user ID from the database.
 * Hive is designed around a single-user model, so this returns the first user found.
 * @returns The user ID or null if no users exist
 */
export function getSingleUserId(): string | null {
  try {
    const db = getDb();
    const result = db.query("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
    return result?.id || null;
  } catch (e) {
    log.warn("[getSingleUserId] ⚠️ Error getting user ID:", (e as Error).message);
    return null;
  }
}

/**
 * Get the coordinator agent ID from the database.
 * The coordinator is the agent with role = 'coordinator'.
 * @returns The coordinator agent ID or null if not found
 */
export function getCoordinatorAgentId(): string | null {
  try {
    const db = getDb();
    const result = db.query("SELECT id FROM agents WHERE role = 'coordinator' LIMIT 1").get() as { id: string } | undefined;
    return result?.id || null;
  } catch (e) {
    log.warn("[getCoordinatorAgentId] ⚠️ Error getting coordinator agent ID:", (e as Error).message);
    return null;
  }
}

/**
 * Get the user ID associated with a specific channel identity.
 * @param channel The channel type (e.g., 'webchat', 'telegram', 'discord')
 * @param channelUserId The channel-specific user ID (e.g., Telegram chat_id)
 * @returns The Hive user ID or null if not found
 */
export function getUserIdFromChannelIdentity(channel: string, channelUserId: string): string | null {
  try {
    const db = getDb();
    const result = db.query(
      "SELECT user_id FROM user_identities WHERE channel = ? AND channel_user_id = ? LIMIT 1"
    ).get(channel, channelUserId) as { user_id: string } | undefined;
    return result?.user_id || null;
  } catch (e) {
    log.warn("[getUserIdFromChannelIdentity] ⚠️ Error getting user ID from channel identity:", (e as Error).message);
    return null;
  }
}

/**
 * Resolve the user ID from various sources with priority:
 * 1. Explicit userId parameter
  * 2. Channel identity lookup (if channel and channelUserId provided)
  * 3. Single user from database
  * 4. Null (no user found)
  */
export function resolveUserId(
  opts: {
    userId?: string | null;
    threadId?: string | null;
    channel?: string | null;
    channelUserId?: string | null;
  }
): string | null {
  // Priority 1: Explicit userId
  if (opts.userId) {
    return opts.userId;
  }

  // Priority 2: Channel identity lookup
  if (opts.channel && opts.channelUserId) {
    const userId = getUserIdFromChannelIdentity(opts.channel, opts.channelUserId);
    if (userId) {
      return userId;
    }
  }

  // Priority 3: Single user from database
  const singleUserId = getSingleUserId();
  if (singleUserId) {
    return singleUserId;
  }

  // Priority 4: No user found
  return null;
}

/**
 * Get the default agent ID with priority:
 * 1. Coordinator agent (role = 'coordinator')
 * 2. First enabled agent
 * 3. Null (no agent found)
 */
export function getDefaultAgentId(): string | null {
  try {
    const db = getDb();

    // Try coordinator first
    const coordinator = db.query(
      "SELECT id FROM agents WHERE role = 'coordinator' AND enabled = 1 LIMIT 1"
    ).get() as { id: string } | undefined;

    if (coordinator?.id) {
      return coordinator.id;
    }

    // Fallback to first enabled agent
    const firstAgent = db.query(
      "SELECT id FROM agents WHERE enabled = 1 LIMIT 1"
    ).get() as { id: string } | undefined;

    return firstAgent?.id || null;
  } catch (e) {
    log.warn("[getDefaultAgentId] ⚠️ Error getting default agent ID:", (e as Error).message);
    return null;
  }
}

/**
 * Resolve the agent ID with priority:
 * 1. Explicit agentId parameter
 * 2. Coordinator agent from database
 * 3. First enabled agent from database
 * 4. Null (no agent found)
 */
export function resolveAgentId(agentId?: string | null): string | null {
  // Priority 1: Explicit agentId
  if (agentId) {
    return agentId;
  }

  // Priority 2: Default from database (coordinator or first enabled)
  return getDefaultAgentId();
}

/**
 * Get user preferences (notes) for a given user ID
 */
export function getUserPreferences(userId: string): string | null {
  try {
    const db = getDb();
    const result = db.query("SELECT notes FROM users WHERE id = ?").get(userId) as { notes: string | null } | undefined;
    return result?.notes || null;
  } catch (e) {
    log.warn("[getUserPreferences] ⚠️ Error getting user preferences:", (e as Error).message);
    return null;
  }
}

/**
 * Get agent configuration by ID
 */
export function getAgentConfig(agentId: string): {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  tone: string | null;
  provider_id: string | null;
  model_id: string | null;
  tools_json: string | null;
  skills_json: string | null;
  max_iterations: number;
} | null {
  try {
    const db = getDb();
    const result = db.query(`
      SELECT id, user_id, name, description, system_prompt, tone,
  provider_id, model_id, tools_json, skills_json, max_iterations
      FROM agents WHERE id = ?
  `).get(agentId) as {
      id: string;
      user_id: string;
      name: string;
      description: string | null;
      system_prompt: string | null;
      tone: string | null;
      provider_id: string | null;
      model_id: string | null;
      tools_json: string | null;
      skills_json: string | null;
      max_iterations: number;
    } | undefined;

    return result || null;
  } catch (e) {
    log.warn("[getAgentConfig] ⚠️ Error getting agent config:", (e as Error).message);
    return null;
  }
}
