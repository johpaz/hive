# Referencia Completa de Herramientas (Tools) en Hive

Documentación completa de **TODAS** las herramientas disponibles en el ecosistema Hive, incluyendo herramientas nativas del core y herramientas MCP externas.

> **Nota**: HiveLearn (herramientas educativas: canvas de lecciones, generación de contenido, evaluaciones) se separó a su propio proyecto y ya no forma parte de este repo. Esta referencia documenta solo las herramientas de `@johpaz/hive-agents-core`.

---

## Tabla de Contenidos

1. [Resumen General](#resumen-general)
2. [Herramientas Core del Sistema](#herramientas-core-del-sistema)
   - [Core Tools (4)](#core-tools-4)
   - [Filesystem Tools (7)](#filesystem-tools-7)
   - [Web Tools (10)](#web-tools-10)
   - [Browser Tools (6)](#browser-tools-6)
   - [Projects Tools (8)](#projects-tools-8)
   - [Cron Tools (7)](#cron-tools-7)
   - [CLI Tools (1)](#cli-tools-1)
   - [Agents Tools (15)](#agents-tools-15)
   - [Canvas Tools (7)](#canvas-tools-7)
   - [CodeBridge Tools (4)](#codebridge-tools-4)
   - [Voice Tools (2)](#voice-tools-2)
   - [Office Tools (8)](#office-tools-8)
3. [Herramientas MCP (Dinámicas)](#herramientas-mcp-dinámicas)
4. [Relación Skills-Tools](#relación-skills-tools)
5. [Índice Alfabético de Todas las Herramientas](#índice-alfabético-de-todas-las-herramientas)

---

## Resumen General

| Categoría | Cantidad | Paquete | Descripción |
|-----------|----------|---------|-------------|
| **Core Tools** | 4 | `@johpaz/hive-agents-core` | Herramientas esenciales del sistema |
| **Filesystem** | 7 | `@johpaz/hive-agents-core` | Operaciones de archivos y directorios |
| **Web** | 10 | `@johpaz/hive-agents-core` | Búsqueda web y automatización de navegador |
| **Projects** | 8 | `@johpaz/hive-agents-core` | Gestión de proyectos y tareas |
| **Cron** | 7 | `@johpaz/hive-agents-core` | Tareas programadas |
| **CLI** | 1 | `@johpaz/hive-agents-core` | Ejecución de comandos shell |
| **Agents** | 15 | `@johpaz/hive-agents-core` | Memoria, agentes y delegación |
| **Canvas** | 7 | `@johpaz/hive-agents-core` | UI interactiva y visualización |
| **CodeBridge** | 4 | `@johpaz/hive-agents-core` | Sub-agentes de código externos |
| **Voice** | 2 | `@johpaz/hive-agents-core` | Transcripción y síntesis de voz |
| **Office** | 8 | `@johpaz/hive-agents-core` | Documentos PDF, Word, Excel, PowerPoint |
| **MCP** | Variables | `@johpaz/hive-agents-mcp` | Herramientas externas descubiertas en runtime |

**Total de herramientas definidas**: ~73 (sin contar herramientas MCP dinámicas)

> ⚠️ Este resumen y las tablas de abajo (Projects, CodeBridge en particular) no están re-verificados contra el código actual tras el refactor "migrate to agent-based orchestration" — algunas de estas tools puntuales pueden haber cambiado de nombre o desaparecido. Ver hallazgo aparte.

---

## Herramientas Core del Sistema

### Core Tools (4)

Herramientas esenciales para gestión de conocimiento, notificaciones y progreso.

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `search_knowledge` | Buscar herramientas nativas, skills o reglas del playbook en la base de conocimientos usando BM25 (tantivy, vía HiveDB). Las herramientas MCP están disponibles directamente - no necesitas buscarlas. | `query` (string), `type` (all/tools/skills/playbook, opcional), `limit` (opcional, default: 10) | `core/index.ts` |
| `notify` | Enviar notificación o actualización de progreso al canal activo del usuario. | `message` (string) | `core/index.ts` |
| `save_note` | Guardar nota en el scratchpad (sobrevive la compresión de contexto). | `key` (string), `value` (string), `thread_id` (opcional) | `core/index.ts` |
| `report_progress` | Reportar progreso de tarea en curso al usuario con actualizaciones en tiempo real (0-100%). | `progress` (number), `message` (string), `task_id` (opcional) | `core/index.ts` |

---

### Filesystem Tools (7)

Operaciones de archivos y directorios en el espacio de trabajo del agente.

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `fs_read` | Leer contenido de archivo del espacio de trabajo. | `path` (string), `offset` (number, opcional, default: 1), `limit` (number, opcional, default: 2000) | `fs-read.ts` |
| `fs_write` | Crear o sobrescribir archivo en el espacio de trabajo. | `path` (string), `content` (string) | `fs-write.ts` |
| `fs_edit` | Editar líneas específicas o secciones de un archivo (buscar y reemplazar). | `path` (string), `oldString` (string), `newString` (string), `replaceAll` (boolean, opcional, default: false) | `fs-edit.ts` |
| `fs_delete` | Eliminar archivo o directorio del espacio de trabajo. | `path` (string), `recursive` (boolean, opcional, default: false) | `fs-delete.ts` |
| `fs_list` | Listar archivos y directorios en el espacio de trabajo. | `path` (string, opcional), `recursive` (boolean, opcional, default: false), `maxDepth` (number, opcional, default: 3) | `fs-list.ts` |
| `fs_glob` | Buscar archivos que coincidan con patrones wildcard (glob). | `pattern` (string), `basePath` (string, opcional) | `fs-glob.ts` |
| `fs_exists` | Verificar si existe un archivo o directorio. | `path` (string) | `fs-exists.ts` |

---

### Web Tools (10)

Búsqueda web, automatización de navegador y resolución de CAPTCHAs.

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `web_search` | Buscar en la web información actual y noticias (DuckDuckGo). | `query` (string), `numResults` (number, opcional, default: 5, max: 10) | `web-search.ts` |
| `web_fetch` | Obtener contenido de texto de una URL (ligero, sin JS). | `url` (string) | `web-fetch.ts` |
| `browser_navigate` | Navegar a URL y obtener contenido renderizado (soporta JS). Incluye detección de CAPTCHA. | `url` (string), `waitFor` (string, opcional), `timeout` (number, opcional, default: 30000) | `browser-navigate.ts` |
| `browser_screenshot` | Tomar captura de pantalla de la página actual del navegador. | `url` (string, opcional), `fullPage` (boolean, opcional, default: false), `selector` (string, opcional) | `browser-screenshot.ts` |
| `browser_click` | Hacer clic en un elemento de la página web. | `selector` (string), `url` (string, opcional), `timeout` (number, opcional, default: 30000) | `browser-click.ts` |
| `browser_type` | Escribir texto en un campo de formulario en el navegador. | `selector` (string), `text` (string), `url` (string, opcional), `timeout` (number, opcional, default: 30000), `clear` (boolean, opcional, default: true) | `browser-type.ts` |
| `browser_extract` | Extraer texto, enlaces o datos estructurados usando selectores CSS o XPath. | `selector` (string), `url` (string, opcional), `attribute` (string, opcional, default: text), `all` (boolean, opcional, default: true), `timeout` (number, opcional, default: 30000) | `browser-extract.ts` |
| `browser_script` | Ejecutar JavaScript arbitrario en el contexto de la página del navegador. | `script` (string), `url` (string, opcional), `timeout` (number, opcional, default: 30000), `awaitPromise` (boolean, opcional, default: true) | `browser-script.ts` |
| `browser_wait` | Esperar a que aparezca un elemento o se cumpla una condición en la página. | `selector` (string, opcional), `condition` (string, opcional), `url` (string, opcional), `timeout` (number, opcional, default: 30000), `state` (string, opcional, default: visible) | `browser-wait.ts` |
| `captcha_solve` | Resolver CAPTCHA en la página actual usando visión IA. | `type` (string, opcional, default: auto), `force` (boolean, opcional, default: false) | `captcha-solve.ts` |

---

### Projects Tools (8)

Gestión de proyectos y tareas en la base de datos.

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `project_create` | Crear un nuevo proyecto con tareas en la base de datos. | `name` (string), `type` (enum: general/code/research/content/data), `description` (string, opcional), `tasks` (array, opcional) | `project-create.ts` |
| `project_list` | Listar todos los proyectos con su estado. | `status` (string, opcional), `limit` (number, opcional, default: 20) | `project-list.ts` |
| `project_update` | Actualizar progreso o metadatos del proyecto. | `projectId` (string), `progress` (number), `stepDescription` (string) | `project-update.ts` |
| `project_done` | Marcar proyecto como completado y archivarlo. | `projectId` (string), `summary` (string, opcional) | `project-done.ts` |
| `project_fail` | Marcar proyecto como fallido y registrar razón. | `projectId` (string), `reason` (string) | `project-fail.ts` |
| `task_create` | Agregar tarea o subtarea a un proyecto existente. | `project_id` (string), `name` (string), `description` (string, opcional), `agent_id` (string, opcional) | `task-create.ts` |
| `task_update` | Actualizar estado de tarea (pendiente, en_progreso, done). | `task_id` (number), `status` (string, opcional), `progress` (number, opcional), `result` (string, opcional) | `task-update.ts` |
| `task_evaluate` | Evaluar resultado de tarea contra criterios de aceptación. | `task_id` (number), `criteria` (array de strings), `auto_update` (boolean, opcional, default: false) | `task-evaluate.ts` |

> ⚠️ Esta tabla no está verificada contra `packages/core/src/tools/projects/index.ts` actual — el commit "refactor: remove project management tools and migrate to agent-based orchestration" reescribió este archivo con un set de tools distinto (`project_create`, `task_create`, `task_complete`, `project_status`). Confirmar antes de usar como referencia.

---

### Cron Tools (7)

Tareas programadas basadas en Croner (≠ tareas de proyecto).

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `cron.create` | Crear tarea programada: recurrente (expresión cron) o única (fire_at). | `name` (string), `task_type` (enum: recurring/one_shot), `cron_expression` (string, opcional), `fire_at` (string, opcional), `payload` (object, opcional), `agent_id` (string, opcional), `tool_name` (string, opcional), `max_runs` (number, opcional), `channel` (string, opcional) | `cron/index.ts` |
| `cron.list` | Listar todas las tareas programadas con próximos horarios de ejecución. | `status` (string, opcional), `task_type` (string, opcional) | `cron/index.ts` |
| `cron.update` | Actualizar nombre, expresión u otros campos de una tarea programada. | `task_id` (string), campos a actualizar | `cron/index.ts` |
| `cron.pause` | Pausar temporalmente una tarea programada sin eliminarla. | `task_id` (string) | `cron/index.ts` |
| `cron.resume` | Reanudar una tarea programada previamente pausada. | `task_id` (string) | `cron/index.ts` |
| `cron.delete` | Eliminar tarea programada permanentemente. | `task_id` (string) | `cron/index.ts` |
| `cron.trigger` | Ejecutar manualmente una tarea programada de forma inmediata. | `task_id` (string) | `cron/index.ts` |

> Nota: la tabla original omitía `cron.update`; el conteo correcto verificado contra el código es 8 tools (`cron.create/list/update/pause/resume/delete/trigger/history`), no 7. `cron.history` se agregó de vuelta abajo.

| `cron.history` | Obtener historial de ejecuciones y logs de una tarea programada. | `task_id` (string), `limit` (number, opcional, default: 10) | `cron/index.ts` |

---

### CLI Tools (1)

Ejecución de comandos de terminal.

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `cli_exec` | Ejecutar comandos shell/bash en el entorno del agente. NOTA: NO usar para tareas programadas (usar cron.create). Tiene bloqueos para patrones peligrosos (rm -rf, mkfs, fork bomb, etc.). | `command` (string), `timeout` (number, opcional, default: 30, max: 300), `cwd` (string, opcional) | `cli/index.ts` |

---

### Agents Tools (15)

Memoria persistente, gestión de agentes workers, delegación de tareas y comunicación inter-agentes.

#### Gestión de Memoria

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `memory_write` | Guardar información en memoria persistente a largo plazo. | `title` (string), `content` (string) | `agents/index.ts` |
| `memory_read` | Recuperar entrada de memoria por identificador. | `title` (string) | `agents/index.ts` |
| `memory_list` | Listar todas las entradas de memoria guardadas. | *(ninguno)* | `agents/index.ts` |
| `memory_search` | Buscar memorias por palabra clave. | `query` (string) | `agents/index.ts` |
| `memory_delete` | Eliminar entrada de memoria específica. | `title` (string) | `agents/index.ts` |

#### Gestión de Agentes

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `get_available_models` | Obtener lista de providers y modelos activos de la BD. | `providerId` (string, opcional), `modelType` (string, opcional), `capabilities` (string, opcional) | `get-available-models.ts` |
| `agent_create` | Crear nuevo agente worker especializado. | `name` (string), `providerId` (string), `modelId` (string), `description` (string, opcional), `system_prompt` (string, opcional), `tools_json` (array de strings, opcional), `tone` (string, opcional), `max_iterations` (number, opcional, default: 10) | `agents/index.ts` |
| `agent_find` | Buscar agentes workers existentes en ejecución o inactivos. | `search` (string, opcional), `status` (string, opcional) | `agents/index.ts` |
| `agent_archive` | Archivar o terminar agente worker. | `agentId` (string) | `agents/index.ts` |

#### Delegación de Tareas

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `task_delegate` | Delegar tarea a agente worker y ejecutar inmediatamente (blocking). | `worker_id` (string), `task_description` (string), `task_id` (number, opcional), `project_id` (string, opcional) | `agents/index.ts` |
| `task_delegate_code` | Delegar tarea de código a subagente CLI vía Code Bridge. | `cli` (enum: qwen/claude/opencode/gemini), `task_instructions` (string) | `agents/index.ts` |
| `task_status` | Obtener estado de ejecución de tareas delegadas. | `task_ids` (array de numbers) | `agents/index.ts` |

#### Agent Bus (Comunicación)

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `bus_publish` | Publicar mensaje en el Agent Bus para comunicación worker-to-worker. | `event_type` (string), `content` (string), `to_worker_id` (string, opcional) | `agents/index.ts` |
| `bus_read` | Leer mensajes no leídos del Agent Bus. | `worker_id` (string, opcional), `limit` (number, opcional, default: 10) | `agents/index.ts` |
| `project_updates` | Obtener actualizaciones recientes de workers en el mismo proyecto. | `project_id` (string), `limit` (number, opcional, default: 10) | `agents/index.ts` |

---

### Canvas Tools (7)

UI interactiva y visualización de datos en el canvas.

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `canvas_render` | Renderizar componente o visualización en el canvas. Soporta: chart, table, markdown, form, button, alert-dialog, progress, accordion, tabs, card, etc. | `component` (string), `data` (object) | `canvas/index.ts` |
| `canvas_ask` | Mostrar formulario interactivo y esperar input del usuario. | `questions` (array de objetos con question/type/options) | `canvas/index.ts` |
| `canvas_confirm` | Mostrar diálogo de confirmación antes de ejecutar acción. | `message` (string), `action` (string) | `canvas/index.ts` |
| `canvas_show_card` | Mostrar información estructurada en formato de tarjeta. | `title` (string), `content` (string, opcional), `items` (array, opcional) | `canvas/index.ts` |
| `canvas_show_progress` | Mostrar barra de progreso o indicador de estado. | `bars` (array de {label, value}) | `canvas/index.ts` |
| `canvas_show_list` | Mostrar información en lista clave-valor. | `title` (string), `items` (object) | `canvas/index.ts` |
| `canvas_clear` | Limpiar contenido actual del canvas. | *(ninguno)* | `canvas/index.ts` |

---

### CodeBridge Tools (4)

Lanzar y gestionar sub-agentes CLI de código externos (Claude Code, Qwen CLI, Gemini CLI, OpenCode CLI).

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `codebridge_launch` | Lanzar subagente externo de código para ejecutar tarea de programación. | `prompt` (string), `cli` (string, opcional), `agent` (string, opcional), `role` (string, opcional), `timeoutSeconds` (number, opcional, default: 600) | `codebridge/index.ts` |
| `codebridge_status` | Verificar estado y salida de subagente CodeBridge en ejecución. | `taskId` (string) | `codebridge/index.ts` |
| `codebridge_cancel` | Cancelar y terminar subagente CodeBridge en ejecución. | `taskId` (string) | `codebridge/index.ts` |
| `codebridge_feedback` | Enviar feedback o instrucciones adicionales a subagente CodeBridge en ejecución. | `taskId` (string), `feedback` (string) | `codebridge/index.ts` |

> ⚠️ No verificado contra el código actual — `task_delegate_code` (visto en Agents Tools arriba) parece ser el reemplazo actual de este mecanismo. Confirmar si `codebridge/index.ts` sigue existiendo antes de usar esta tabla.

---

### Voice Tools (2)

Transcripción y síntesis de voz (requieren configuración de provider STT/TTS).

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `voice_transcribe` | Transcribir entrada de audio a texto (placeholder - requiere config de provider STT). | `audio` (string), `language` (string, opcional) | `voice/index.ts` |
| `voice_speak` | Convertir texto a voz sintetizada (placeholder - requiere config de provider TTS). | `text` (string), `voice_id` (string, opcional), `language` (string, opcional) | `voice/index.ts` |

---

### Office Tools (8)

Lectura y generación de documentos de oficina (PDF, Word, Excel, PowerPoint).

#### PDF

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `office_leer_pdf` | Leer archivo PDF y retornar texto plano con metadata. | `ruta` (string), `pagina_inicio` (number, opcional, default: 1), `pagina_fin` (number, opcional) | `office-leer-pdf.ts` |
| `office_escribir_pdf` | Generar archivo PDF desde texto con configuración de márgenes y tamaño de página. | `ruta` (string), `contenido` (string), `titulo` (string, opcional), `tamaño_pagina` (string, opcional, default: A4), `margen` (number, opcional, default: 50), `tamaño_fuente` (number, opcional, default: 12) | `office-escribir-pdf.ts` |

#### Word (DOCX)

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `office_leer_docx` | Leer archivo Word (.docx) y retornar texto preservando párrafos y tablas. | `ruta` (string), `incluir_tablas` (boolean, opcional, default: true) | `office-leer-docx.ts` |
| `office_escribir_docx` | Generar archivo Word (.docx) con párrafos, títulos y tablas. | `ruta` (string), `titulo` (string, opcional), `parrafos` (array, opcional), `tablas` (array, opcional) | `office-escribir-docx.ts` |

#### Excel (XLSX)

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `office_leer_xlsx` | Leer archivo Excel (.xlsx) y retornar hojas como JSON. | `ruta` (string), `hoja` (string, opcional), `incluir_encabezados` (boolean, opcional, default: true), `rango` (string, opcional) | `office-leer-xlsx.ts` |
| `office_escribir_xlsx` | Generar archivo Excel (.xlsx) desde datos JSON con múltiples hojas. | `ruta` (string), `hojas` (array) | `office-escribir-xlsx.ts` |

#### PowerPoint (PPTX)

| Herramienta | Descripción | Parámetros Requeridos | Archivo |
|-------------|-------------|----------------------|---------|
| `office_leer_pptx` | Leer archivo PowerPoint (.pptx) y retornar texto por diapositiva. | `ruta` (string), `solo_diapositiva` (number, opcional) | `office-leer-pptx.ts` |
| `office_escribir_pptx` | Generar archivo PowerPoint (.pptx) desde array de diapositivas. | `ruta` (string), `titulo_presentacion` (string, opcional), `diapositivas` (array) | `office-escribir-pptx.ts` |

---

## Herramientas MCP (Dinámicas)

Las herramientas MCP **NO están definidas estáticamente** en el código. Se descubren **en tiempo de ejecución** desde servidores MCP externos conectados.

### Características

- **Descubrimiento automático**: Las herramientas se detectan al conectar un servidor MCP
- **Definición externa**: Cada servidor MCP define sus propias herramientas
- **Ejecución directa**: El agente llama a las herramientas MCP como funciones nativas
- **Registro dinámico**: Las herramientas se registran como `ContextTool` con `execute` que llama a `mcpManager.callTool()`

### Cómo Funciona

1. **Configuración del servidor**: Se define en DB o config (transporte, comando/URL, headers)
2. **Conexión**: `MCPClientManager.connectServer()` establece la conexión
3. **Descubrimiento**: `client.listTools()` obtiene la lista de herramientas del servidor
4. **Registro**: Cada herramienta se registra como `ContextTool` en el Context Compiler
5. **Ejecución**: Cuando el LLM llama a la herramienta, se ejecuta `effectiveMcpManager.callTool(server.id, tool.name, params)`

### Ejemplo de Herramientas MCP Típicas

Los servidores MCP comunes proporcionan herramientas como:

| Servidor MCP | Herramientas Típicas |
|--------------|---------------------|
| **Filesystem MCP** | `read_file`, `write_file`, `list_directory`, `delete_file` |
| **Database MCP** | `query`, `insert`, `update`, `delete` |
| **Web Search MCP** | `search`, `fetch_url`, `extract_data` |
| **Git MCP** | `git_status`, `git_commit`, `git_push`, `git_branch` |
| **Custom MCP** | *Definidas por el desarrollador del servidor* |

### Gestión de Herramientas MCP

Para ver las herramientas MCP disponibles:

```bash
# Listar servidores MCP
hive mcp list

# Ver herramientas de un servidor
hive mcp tools nombre-servidor

# Probar conexión
hive mcp test nombre-servidor
```

---

## Relación Skills-Tools

Cada Skill puede asociarse con herramientas específicas. Aquí está la relación completa:

### Skills Core → Tools

| Skill | Herramientas Asociadas |
|-------|----------------------|
| `memory_manager` | `memory_write`, `memory_read`, `memory_list`, `memory_search`, `memory_delete` |
| `canvas_report` | `canvas_show_card`, `canvas_show_list`, `canvas_show_progress` |
| `task_orchestrator` | `get_available_models`, `task_delegate`, `task_status`, `agent_find`, `agent_create`, `bus_publish`, `bus_read` |
| `agent_spawner` | `get_available_models`, `agent_find`, `agent_create`, `agent_archive` |
| `research_and_remember` | `web_search`, `web_fetch`, `memory_write` |
| `cli_pipeline` | `cli_exec`, `terminal`, `project_write` |
| `cli_safe_exec` | `cli_exec`, `terminal` |
| `schedule_reminder` | `cron.create`, `notify` |
| `schedule_manager` | `cron.create`, `cron.list`, `cron.pause`, `cron.resume`, `cron.delete` |
| `project_closer` | `task_evaluate`, `project_done`, `project_fail` |
| `project_tracker` | `project_list`, `project_update`, `task_update` |
| `project_planner` | `project_create`, `task_create` |

### Skills de Código → Tools

| Skill | Herramientas Asociadas |
|-------|----------------------|
| `code_debug` | `codebridge_launch`, `codebridge_status`, `fs_read`, `fs_edit`, `cli_exec` |
| `code_review` | `codebridge_launch`, `codebridge_status`, `fs_read`, `canvas_show_card` |
| `code_refactor` | `codebridge_launch`, `codebridge_status`, `fs_read`, `fs_edit`, `fs_write` |
| `code_generate` | `codebridge_launch`, `codebridge_status`, `fs_write`, `fs_read` |

### Skills de Canvas → Tools

| Skill | Herramientas Asociadas |
|-------|----------------------|
| `canvas_dashboard` | `canvas_render`, `canvas_show_progress`, `canvas_clear` |
| `canvas_interact` | `canvas_ask`, `canvas_confirm` |

### Skills de Voz → Tools

| Skill | Herramientas Asociadas |
|-------|----------------------|
| `voice_assistant` | `voice_transcribe`, `voice_speak` |
| `voice_output` | `voice_speak` |
| `voice_input` | `voice_transcribe` |

---

## Índice Alfabético de Todas las Herramientas

### A-C

| Herramienta | Categoría | Paquete |
|-------------|-----------|---------|
| `agent_archive` | Agents | Core |
| `agent_create` | Agents | Core |
| `agent_find` | Agents | Core |
| `browser_click` | Web | Core |
| `browser_extract` | Web | Core |
| `browser_navigate` | Web | Core |
| `browser_script` | Web | Core |
| `browser_screenshot` | Web | Core |
| `browser_type` | Web | Core |
| `browser_wait` | Web | Core |
| `bus_publish` | Agents | Core |
| `bus_read` | Agents | Core |
| `canvas_ask` | Canvas | Core |
| `canvas_clear` | Canvas | Core |
| `canvas_confirm` | Canvas | Core |
| `canvas_render` | Canvas | Core |
| `canvas_show_card` | Canvas | Core |
| `canvas_show_list` | Canvas | Core |
| `canvas_show_progress` | Canvas | Core |
| `captcha_solve` | Web | Core |
| `cli_exec` | CLI | Core |
| `codebridge_cancel` | CodeBridge | Core |
| `codebridge_feedback` | CodeBridge | Core |
| `codebridge_launch` | CodeBridge | Core |
| `codebridge_status` | CodeBridge | Core |
| `cron.create` | Cron | Core |
| `cron.delete` | Cron | Core |
| `cron.history` | Cron | Core |
| `cron.list` | Cron | Core |
| `cron.pause` | Cron | Core |
| `cron.resume` | Cron | Core |
| `cron.trigger` | Cron | Core |
| `cron.update` | Cron | Core |

### D-G

| Herramienta | Categoría | Paquete |
|-------------|-----------|---------|
| `fs_delete` | Filesystem | Core |
| `fs_edit` | Filesystem | Core |
| `fs_exists` | Filesystem | Core |
| `fs_glob` | Filesystem | Core |
| `fs_list` | Filesystem | Core |
| `fs_read` | Filesystem | Core |
| `fs_write` | Filesystem | Core |
| `get_available_models` | Agents | Core |

### M-P

| Herramienta | Categoría | Paquete |
|-------------|-----------|---------|
| `memory_delete` | Agents | Core |
| `memory_list` | Agents | Core |
| `memory_read` | Agents | Core |
| `memory_search` | Agents | Core |
| `memory_write` | Agents | Core |
| `notify` | Core | Core |
| `office_escribir_docx` | Office | Core |
| `office_escribir_pdf` | Office | Core |
| `office_escribir_pptx` | Office | Core |
| `office_escribir_xlsx` | Office | Core |
| `office_leer_docx` | Office | Core |
| `office_leer_pdf` | Office | Core |
| `office_leer_pptx` | Office | Core |
| `office_leer_xlsx` | Office | Core |
| `project_create` | Projects | Core |
| `project_done` | Projects | Core |
| `project_fail` | Projects | Core |
| `project_list` | Projects | Core |
| `project_updates` | Agents | Core |
| `project_update` | Projects | Core |

### R-V

| Herramienta | Categoría | Paquete |
|-------------|-----------|---------|
| `report_progress` | Core | Core |
| `save_note` | Core | Core |
| `search_knowledge` | Core | Core |
| `task_create` | Projects | Core |
| `task_delegate` | Agents | Core |
| `task_delegate_code` | Agents | Core |
| `task_evaluate` | Projects | Core |
| `task_status` | Agents | Core |
| `task_update` | Projects | Core |
| `voice_speak` | Voice | Core |
| `voice_transcribe` | Voice | Core |

### W

| Herramienta | Categoría | Paquete |
|-------------|-----------|---------|
| `web_fetch` | Web | Core |
| `web_search` | Web | Core |

---

## Apéndice: Cómo se Registran las Herramientas

### Herramientas Core

1. **Definición**: Cada herramienta se define en un archivo TypeScript con interfaz `Tool`
2. **Agrupación**: Se agrupan por categoría en `createTools()` functions
3. **Registro principal**: `createAllTools(config)` en `packages/core/src/tools/index.ts` agrega todas
4. **Seed**: Se insertan en HiveDB en `packages/core/src/storage/seed.ts` (~73 herramientas)
5. **BM25**: Se indexan para búsqueda semántica (tantivy, vía HiveDB) — ver `capability-search.ts`

### Herramientas MCP

1. **Configuración**: Servidor MCP configurado en DB o config
2. **Conexión**: `MCPClientManager` conecta al servidor
3. **Descubrimiento**: `client.listTools()` obtiene herramientas
4. **Registro runtime**: Se registran como `ContextTool` con `execute` que llama a `mcpManager.callTool()`
5. **NO están en el seed**: Se descubren dinámicamente en runtime

---

**Última actualización**: Abril 2026 (contenido de HiveLearn removido — proyecto separado)
**Versión del Documento**: 1.1
**Versión de Hive**: Compatible con Hive v2.x
**Total de Herramientas Documentadas**: ~73 core + MCP dinámicas
