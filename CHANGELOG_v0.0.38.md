# CHANGELOG v0.0.38 — Hive

## Resumen

Esta versión unifica el historial conversacional entre canales (webchat, telegram, etc.), optimiza radicalmente la memoria del agente eliminando tool results del historial cargado, mejora la visualización de progreso en la UI, y ajusta el naming de herramientas MCP.

---

## Cambios Importantes (Breaking)

### Eliminación del sistema de Projects/Tasks (completado)

- **Seed data**: eliminados del catálogo inicial todas las herramientas de proyectos (`project_create`, `project_list`, `project_update`, `project_done`, `project_fail`, `task_create`, `task_update`, `task_evaluate`, `project_updates`)
- **Playbook actualizado**: regla "Al crear proyectos..." reescrita a "Al delegar trabajo complejo a workers..."
- **Export eliminado**: `./tools/projects` removido de `packages/core/package.json`
- **Categoría eliminada**: `projects` del catálogo de herramientas

---

## Mejoras del Core

### Contexto del Agente (memoria conversacional)

- **`KEEP_LAST_N_MESSAGES` aumentado de 15 a 30** (`context-compiler.ts`)
  - Ventana de historial cargado en el contexto del LLM duplicada
  - Con la eliminación de tool results del historial, 30 mensajes = ~15 intercambios de conversación real (antes eran ~3-4 intercambios + tool results gigantes)

- **Eliminada persistencia de tool results en la tabla `conversations`** (`agent-loop.ts`)
  - Los resultados de herramientas (`search_knowledge`, `memory_list`, etc.) ya no se guardan como mensajes `tool` en la base de datos
  - Los tool results **solo existen en el array `messages` en memoria** durante la iteración actual del loop
  - Siguen disponibles para: siguiente llamada al LLM, emisión al stream de la UI, y guardado en la tabla `traces` para auditoría

- **Eliminada persistencia de assistant messages intermedios** (`agent-loop.ts`)
  - Los assistant messages con `tool_calls` (pero sin texto al usuario) ya no se persisten en la base de datos
  - Solo se guarda la **respuesta final de texto** al usuario
  - El placeholder `[Llamé a herramientas: X, Y]` se eliminó completamente del historial persistido

- **Filtrado de tool messages al cargar historial** (`conversation-store.ts`)
  - `getRecentMessages` ahora excluye `role != 'tool'` desde la base de datos
  - `toAPIMessages` ya no reconstruye `tool_calls` ni `tool_call_id` al cargar mensajes históricos
  - El historial cargado contiene **solo texto de conversación** (user + assistant)

### Gateway Unificado (un solo hilo de conversación entre canales)

- **`resolveContext` ahora devuelve `threadId`** (`gateway/resolver.ts`)
  - El `threadId` canónico es el `userId` del onboarding
  - **Todos los canales comparten el mismo hilo de conversación**: webchat, telegram, discord, whatsapp, slack
  - El agente recuerda lo que se habló en Telegram cuando el usuario cambia a WebChat

- **Gateway server** (`gateway/server.ts`)
  - Unificado `unifiedSessionId` → usa `conversationThreadId` (userId) para el historial
  - `routingSessionId` → mantiene `sessionId` del canal para enviar respuestas al canal correcto
  - Separación clara entre **contexto de conversación** (compartido) y **ruteo de respuestas** (por canal)

- **API Chat** (`gateway/routes/chat.ts`)
  - `thread_id` canónico: usa `userId` como thread por defecto (no genera uno nuevo por request)
  - Eliminado el prepend manual de historial (AgentLoop + compileContext ya manejan eso)
  - `DEFAULT_CHAT_HISTORY_LIMIT = 40` para el endpoint de historial
  - Soporte explícito para `agentId` en las requests

### MCP Tool Naming (`tool-selector.ts`)

- **Restaurado prefix de servidor** en `mcpToolFullName`
  - Vuelve al formato: `{safeServer}__{safeTool}` (doble underscore como separador)
  - Antes: solo sanitizaba el nombre de la herramienta
  - Ahora: incluye el nombre del servidor para evitar colisiones entre herramientas de diferentes servidores MCP

### Tool Runtime (`tool-runtime/index.ts`)

- **Expandida lista de tools singleton-backed** que se ejecutan vía RPC en el hilo principal:
  - `search_knowledge`, `save_note`
  - `memory_write`, `memory_read`, `memory_list`, `memory_search`, `memory_delete`
  - `agent_create`, `agent_find`, `agent_archive`, `task_status`, `bus_publish`, `bus_read`
  - `get_available_models`
  - `meeting_start`, `meeting_add_segment`, `meeting_stop`, `meeting_report`
  - Estas herramientas dependen de estado local del proceso (SQLite, servicios en memoria) y no pueden reconstruirse en workers

### Seed Data (`storage/seed.ts`)

- **Playbook seed mejorado**
  - Actualiza reglas existentes en vez de reemplazarlas ciegamente (`UPDATE` vs `INSERT OR REPLACE`)
  - Elimina regla obsoleta de proyectos antes de re-seed
  - Sincroniza solo reglas `active = 1` al FTS5
  - Evita duplicados y preserva contadores `helpful_count`/`harmful_count`

### Agent Runner (`providers/index.ts`)

- **Soporte explícito para `agentId`** en `ModelOptions`
  - El `agentId` se puede pasar directamente en las opciones del runner
  - Si no se proporciona, cae back a la resolución desde la base de datos

---

## Mejoras de UI (hive-ui)

### Visualización de Progreso en Chat

- **ChatMessage** (`ChatMessage.tsx`)
  - Nuevo soporte para mostrar `currentSteps` (pasos de ejecución de herramientas) dentro del mensaje de streaming
  - Steps visuales con icono de rayo (`Zap`) y estados activo/inactivo
  - Indicador de typing animado (3 puntos rebotando) cuando el agente está pensando sin contenido
  - Solo muestra el contenido Markdown cuando hay texto real; oculta el placeholder de actividad

- **useChatStreaming** (`useChatStreaming.ts`)
  - Mejor manejo de `streamingMessageId` para chunks progresivos
  - Los mensajes de progreso (`progress`) ahora crean un mensaje de agente automáticamente si no existe
  - Soporte para steps acumulativos en el mensaje de streaming

- **ChatHistory** (`ChatHistory.tsx`)
  - Pasa `currentSteps` al componente `ChatMessage` para mensajes en streaming

### Historial de Chat

- **WebChatPage** (`WebChatPage.tsx`)
  - `WEBCHAT_HISTORY_LIMIT = 40` (antes 15)
  - Carga hasta 40 mensajes del historial al iniciar la sesión

- **chatStore** (`chatStore.ts`)
  - `CHAT_HISTORY_LIMIT = 40` para persistencia local (localStorage)
  - Guarda hasta 40 mensajes en el store de Zustand

---

## Tests

- **tool-runtime.test.ts**: nuevo test "routes singleton-backed native tools through main-thread RPC"
  - Verifica que herramientas como `search_knowledge`, `save_note`, `memory_write`, `meeting_start` se ejecuten correctamente vía RPC en el hilo principal cuando el worker pool está activo

---

## Documentación

- **AGENT_LOOP_CONTEXT_COMPILER.md**: actualizado de 40 a 15 mensajes (reflejando el estado antes de esta versión, ya que este changelog documenta el cambio a 30)

---

## Estadísticas

- **16 archivos** modificados
- **Neto principal de la versión**:
  - Memoria conversacional del agente: ~3-4 intercambios → ~15 intercambios (~4x mejora)
  - Historial unificado entre todos los canales (webchat, telegram, discord, whatsapp, slack)
  - Reducción de warnings Gemini "stripped orphaned functionResponse"
