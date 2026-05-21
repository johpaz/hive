# CHANGELOG v0.0.37 — Hive

## Resumen

Esta versión elimina el sistema de Projects/Tasks nativo en favor de un enfoque más simple basado en delegación directa a workers, simplifica el discovery de herramientas con búsqueda por palabra clave, mejora la gestión de contexto del agente, y corrige problemas de estabilidad en MCP y CLI.

---

## Cambios Importantes (Breaking)

### Eliminación del sistema de Projects/Tasks

Se removió completamente el subsistema de gestión de proyectos y tareas. La delegación ahora es directa vía `task_delegate` sin tracking en base de datos.

**Archivos eliminados:**
- `packages/core/src/tools/projects/` (completo: 8 archivos)
  - `project-create.ts`, `project-list.ts`, `project-update.ts`
  - `project-done.ts`, `project-fail.ts`
  - `task-create.ts`, `task-update.ts`, `task-evaluate.ts`
  - `index.ts`
- `packages/core/src/gateway/routes/projects.ts`
- `packages/hive-ui/src/pages/ProjectsPage.tsx`
- `packages/hive-ui/src/stores/projectsStore.ts`
- `packages/skills/src/bundled/projects/` (completo: 3 skills)
  - `project_closer/SKILL.md`
  - `project_planner/SKILL.md`
  - `project_tracker/SKILL.md`
- `docs/HIVELEARN-MANUAL-USUARIO.md`
- `docs/PROYECTOS_Y_DELEGACION.md`
- `docs/PUBLISHING_SDK.md`

**Herramientas eliminadas del catálogo:**
- `project_create`, `project_list`, `project_update`, `project_done`, `project_fail`
- `task_create`, `task_update`, `task_evaluate`
- `project_updates`

**Impacto en `task_delegate`:**
- Ya no acepta `task_id` ni `project_id`
- Ya no actualiza estado en base de datos ni emite eventos canvas
- Notificaciones via Agent Bus simplificadas (sin IDs de task/proyecto)

**API Gateway eliminadas:**
- `GET /api/projects`, `GET /api/projects/active`, `GET /api/projects/history`
- `GET /api/projects/:id`, `PATCH /api/projects/:id`
- `GET /api/projects/:id/tasks`, `POST /api/projects`

---

## Mejoras del Core

### Tool Runtime con Bun Workers (nuevo)

- **Ejecución paralela de herramientas**: cuando el modelo devuelve varias `tool_calls` en el mismo turno, Hive ahora las agenda como lote y las ejecuta en paralelo cuando es posible
- **Worker pool persistente**: nuevo subsistema `tool-runtime` con pool de Bun Workers reutilizable para reducir latencia entre llamadas
- **Configuración nueva**: añadido `tools.workerPool` con:
  - `enabled` default `true`
  - `maxWorkers` default `min(4, CPUs)`
  - `toolTimeoutMs` default `300000`
  - `parallelToolCalls` default `true`
- **Orden compatible con LLMs**: los resultados se entregan y persisten en el mismo orden de `response.tool_calls`, aunque las herramientas terminen desordenadas
- **Errores aislados por herramienta**: si una herramienta falla, devuelve un resultado de error propio sin cancelar automáticamente las demás
- **Timeout por herramienta**: cada tool call tiene límite de ejecución configurable y el Worker afectado se reinicia al expirar
- **Cancelación con `AbortSignal`**: los trabajos pendientes y en ejecución se marcan como abortados cuando se detiene la generación
- **RPC al proceso principal**: herramientas que dependen de estado vivo, como MCP, Browser, Canvas, Cron, voz, notificaciones y delegación, pasan por el scheduler pero se resuelven vía RPC controlado al hilo principal
- **Export público**: el runtime queda disponible como `@johpaz/hive/tool-runtime` y `@johpaz/hive-agents-core/tool-runtime`

### Agent Loop (`agent-loop.ts`)

- **Reemplazada ejecución secuencial** de tools por `executeToolBatch(...)`
- **Streaming preservado**: se siguen emitiendo pasos `tool_call` al iniciar y `tool_result` al finalizar
- **Compatibilidad preservada** con trace, TOON formatting, persistencia de historial, inyección dinámica de `search_knowledge` y detección de loops
- **Métricas por herramienta**: los traces conservan duración por tool usando el resultado del runtime paralelo

### Context Compiler (`context-compiler.ts`)

- **Ventana de contexto** aumentada de 128K a 250K tokens por defecto
- **KEEP_LAST_N_MESSAGES** reducido de 40 a 15 (más agresivo en compactación)
- **COMPACT_RATIO** ajustado de 0.70 a 0.80 (compacta solo al 80% del límite)
- **Skills mínimas**: se inyecta el cuerpo completo de las skills siempre activas (no solo nombre), incluyendo `task_orchestrator` como nueva skill mínima
- **Skills descubiertas**: se listan solo nombre y descripción (el cuerpo llega via agent-loop)
- **Eliminada** inyección de estado de proyectos en el system prompt
- **Simplificada** documentación de Canvas A2UI en el prompt (eliminado el bloque extenso de ~150 líneas)
- **Simplificadas** instrucciones de herramientas nativas (eliminado catálogo extenso con reglas de uso)

### Tool Selector (`tool-selector.ts`)

- **Eliminados** del catálogo core: tools de projects (12 entries) y categoría `projects`
- **Eliminado** `project_updates` del catálogo de agents
- **Simplificada** función `mcpToolFullName`: ahora solo sanitiza el nombre de la herramienta (sin prefix de servidor), reduciendo conflictos de nombres

### Search Knowledge (`search_knowledge`)

- **Búsqueda simplificada**: ahora usa OR + wildcard siempre (máximo recall)
- **Descripción actualizada**: "una palabra clave encuentra todo" en vez de búsqueda por tipo obligatorio
- **Body truncado** aumentado de 400 a 1500 caracteres para skills (más contexto en resultados)

### Gateway Server (`server.ts`)

- **MCP Headers**: migración de headers encriptados legacy a keychain moderno (`loadMcpHeaders`)
- **MCP Status reporting**: ahora captura y reporta errores detallados de conexión MCP (no solo "connected")
- **Eliminadas** todas las rutas de API de proyectos

### Tools Registry (`tools/index.ts`)

- **Eliminada** categoría `projects` y su import
- **Eliminados** exports de herramientas de proyectos
- Tool count reducido de ~70 a ~62

### Agents Tools (`tools/agents/index.ts`)

- **`task_delegate`**: simplificado — sin `task_id`, `project_id`, ni actualizaciones DB
- **`project_updates`**: eliminado completamente
- **Eliminada** dependencia de `emitCanvas` en agents

---

## Mejoras de UI (hive-ui)

### Chat History

- **Auto-scroll refactorizado**: lógica más robusta con detección de reemplazo de historial vs nuevos mensajes
- **Eliminada** dependencia de `useEffect` innecesaria (solo `useLayoutEffect`)
- **Referencia de scroll** movida al viewport correcto (mejor comportamiento con listas largas)

### Canvas A2UI Components

- **Column/Row**: fix de type safety en `justify`/`distribution` (conversión a string antes de lookup)
- **Slider**: fix de type safety en `min`/`max` (validación con `typeof`), soporte explícito de `step`
- **Tabs**: fix de type safety en `tabItems` (validación con `Array.isArray`)

### Tool Manager / Permissions

- **Eliminada** categoría "Proyectos" de labels e íconos
- **Eliminados** íconos de permisos de proyecto (`project_read`, `project_write`, `project_list`)

### Sidebar

- **Eliminado** item "Proyectos" de la navegación lateral

### App Routes

- **Eliminada** ruta `/projects` y su lazy import

### Stores / Types

- **canvasStore**: añadido `sessionId` y `setSessionId` para gestión de sesiones canvas
- **useGlobalConfigStore**: tipado mejorado con `StoreTool` type explícito
- **tool.ts**: añadido campo `core?: boolean`
- **notes-crons.ts**: añadido campo `description?: string | null` a `ScheduledTask`
- **bridge.ts**: nuevo archivo de tipos (nuevo)

---

## Mejoras de MCP

### Logger (`logger.ts`)

- **Parent delegation**: los child loggers ahora delegan al handler del padre si no tienen handler propio (comportamiento dinámico en vez de copia estática)

### Manager (`manager.ts`)

- **Mejor logging de errores**: `catch` ahora captura y loggea el mensaje de error en vez de silenciarlo con `debug`

### SSE Transport (`transports/sse.ts`)

- **Streamable HTTP**: el session ID ahora se envía como header `mcp-session-id` en vez de query parameter (cumplimiento spec)
- **Fallback mejorado**: ahora también detecta HTTP 400 (no solo 405) para fallback a Streamable HTTP
- **Eliminada** construcción de URL con query params para session ID

---

## Mejoras de CLI

### Adapters (binary, bun-global, docker)

- **Type safety**: añadido tipo `SpawnedProcess` explícito para evitar errores de tipo en `child.on()`
- Casting correcto de `child` process en todos los adapters

### Commands

- **cron.ts**: tipado correcto de respuesta JSON (`as { error?: string }`)
- **gateway.ts**: fix de ArrayBuffer en responses de archivos estáticos (evita corrupción de datos con `buffer.slice`)

---

## Skills

### busqueda_fts5 (actualizada)

- **Versión** 1.2.0
- **Documentación simplificada**: de búsqueda por tipo a "una palabra clave busca todo"
- **Ejemplos actualizados**: búsqueda simple sin type
- **Regla de prioridad**: nativas sobre MCP destacada

### file_manager (actualizada)

- **Tools renombradas**: `project_list` → `fs_list`, `project_glob` → `fs_glob`, `project_exists` → `fs_exists`

### Projects skills (eliminadas)

- `project_closer`, `project_planner`, `project_tracker` — removidas completamente

---

## Scripts

### reload-tools.ts

- **Fix de lógica**: `active` default a 1 solo si la propiedad no existe explícitamente (antes sobrescribía `active: false`)

---

## Documentación nueva

- `docs/DOCUMENTO-EXPLICATIVO-COMPONENTES.md` — Documentación explicativa de componentes
- `docs/BUN-WORKER-TOOLS-MANUAL-USUARIO.md` — Manual de usuario para la ejecución paralela de herramientas con Bun Workers
- `packages/hive-ui/src/modules/chat/ChatHistory.test.tsx` — Tests de ChatHistory
- `packages/hive-ui/src/types/bridge.ts` — Tipos de bridge

---

## Tests nuevos

- `tests/tool-runtime.test.ts` — Cobertura del nuevo runtime de herramientas:
  - ejecución paralela de múltiples herramientas
  - preservación del orden original
  - aislamiento de errores por herramienta
  - RPC al proceso principal para herramientas no reconstruibles
  - timeout por herramienta
  - cancelación con `AbortSignal`

---

## Estadísticas

- **62 archivos** modificados/añadidos
- **Nuevo subsistema** `packages/core/src/tool-runtime/`
- **Nuevo manual** `docs/BUN-WORKER-TOOLS-MANUAL-USUARIO.md`
- **Nuevo test suite** `tests/tool-runtime.test.ts`
- **Neto principal de la versión**: simplificación significativa por eliminación de Projects/Tasks, más mejora de rendimiento en ejecución de herramientas
