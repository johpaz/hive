# Inventario generado de Hive

> No edites este archivo manualmente. Ejecuta `bun run docs:generate`.

Generado desde el código fuente para Hive **1.0.2**.

## Versiones

| Paquete | Versión |
|---|---:|
| `@johpaz/hive-agents` | `1.0.2` |
| `@johpaz/hive-cli` | `1.0.2` |
| `@johpaz/hive-agents-core` | `1.0.2` |
| `@johpaz/hive-agents-ui` | `1.0.2` |
| `@johpaz/hive-agents-mcp` | `1.0.2` |
| `@johpaz/hive-agents-skills` | `1.0.2` |

## Herramientas (58)

| Herramienta | Categoría | Descripción |
|---|---|---|
| `a2ui_create_surface` | a2ui | Create an A2UI v0.9 surface in the user's interactive panel |
| `a2ui_delete_surface` | a2ui | Delete an A2UI v0.9 surface from the user's interactive panel |
| `a2ui_update_components` | a2ui | Send A2UI v0.9 components to an existing surface. Components are a FLAT list with ID references (adjacency list).  CHILDREN (spec oficial A2UI v0.9):   Static: "children": ["id1", "id2"]  ← array crudo, formato oficial   Template: "children": {"path": "/items", "componentId": "item_tmpl"}  ← formato oficial   Single child (Card/Modal): "child": "child_id"  COMPONENT PROPS (nombres oficiales del spec):   Text: text (string\|{path}), variant ("h1"\|"h2"\|"h3"\|"h4"\|"h5"\|"body"\|"caption"\|"code")   Button: child (id del texto), variant ("default"\|"primary"\|"borderless"), action (required)   TextField: label, value: {path:"/..."}, variant ("shortText"\|"longText"\|"number"\|"obscured"), validationRegexp, action     - action fires on blur or Enter key   ChoicePicker: options [{label, value}], value: {path:"/..."}, variant ("mutuallyExclusive"\|"multipleSelection"), displayStyle ("checkbox"\|"chips"), filterable, action     - value es DynamicStringList; two-way binding con value; action fires inmediatamente   Slider: label, value: {path:"/..."}, min, max, step, action (fires on release)   CheckBox: label, value: {path:"/..."} (DynamicBoolean, two-way binding)   DateTimeInput: value: {path:"/..."}, enableDate, enableTime, min, max, label   Tabs: tabs: [{title: "string plano", child: "id"}]  ← title es string, NO {literalString:...}   Modal: trigger (id del botón), content (id del dialog)   Card: child (único hijo), weight   Row: children, justify ("start"\|"center"\|"end"\|"spaceBetween"\|"spaceAround"\|"spaceEvenly"), align ("start"\|"center"\|"end"\|"stretch"), weight   Column: children, justify, align, weight   List: children (con template path), direction ("vertical"\|"horizontal"), align, weight   Image: url, description, fit ("contain"\|"cover"\|"fill"\|"none"\|"scaleDown"), variant ("icon"\|"avatar"\|"smallFeature"\|"mediumFeature"\|"largeFeature"\|"header")   Divider: axis ("horizontal"\|"vertical")  ACTION FORMAT (oficial: con wrapper event):   {event: {name: "action_name", context: {key: {path: "/data/key"}}}}  DATA BINDING: "prop": "literal" \| {path: "/json/pointer"} \| {call: "fn", args: {...}}  Root component: usar id="root" explícito. |
| `a2ui_update_data_model` | a2ui | Update the data model for an A2UI v0.9 surface. The data model provides dynamic values that components can bind to via paths (e.g. '/user/name'). |
| `agent_archive` | agents | Archive or terminate a worker you created. Catalog agents cannot be archived — only the user can disable those from the UI. Spanish: archivar agente, terminar worker |
| `agent_create` | agents | Crear un nuevo agente worker especializado. Requiere consultar get_available_models; para un especialista MCP confirmado por el usuario, acepta mcp_server_id. Sinónimos: crear agente, nuevo worker, nuevo trabajador |
| `agent_find` | agents | Discover available worker agents. Includes global system catalog agents plus private workers owned by the current user. This tool does not report task execution; use task_list/task_status for that. Spanish: buscar agente, encontrar worker, localizar agente |
| `api_request` | api | Make an HTTP request to a REST API endpoint. Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS with custom headers, body, and query parameters. Spanish: llamar api, petición http, curl, post a api, put api, delete api, consumir servicio rest |
| `artifact_inspect` | web | Inspect managed artifact metadata, integrity, MIME type and dimensions without returning or modifying its binary content. |
| `browser_click` | web | Click on a web page element. Spanish: hacer clic, botón, enlace, interactuar |
| `browser_extract` | web | Extract text, links, or structured data from page using CSS selectors or XPath. For general page overview without specific selectors, returns compact accessibility snapshot. Spanish: extraer datos, obtener información, scraping, selectores |
| `browser_navigate` | web | Navigate browser to URL, get rendered page content (supports JS). Returns compact accessibility tree with element refs (@e1, @e2) for interaction. Spanish: navegar a url, abrir página, sitio web |
| `browser_screenshot` | web | Take screenshot of current browser page. Returns JPEG by default for smaller size. Spanish: captura de pantalla, screenshot, imagen de página |
| `browser_script` | web | Execute arbitrary JavaScript in the browser page context and get the result. Spanish: ejecutar javascript, script, código, función, evaluar |
| `browser_type` | web | Type text into a form field in the browser. Spanish: escribir formulario, tipear, campo de texto, input |
| `browser_wait` | web | Wait for an element to appear or condition to be met on the page. Spanish: esperar, wait, condición, elemento, selector |
| `bus_publish` | agents | Publish a message to the Agent Bus for worker-to-worker communication. Spanish: publicar mensaje, comunicar workers, enviar bus |
| `bus_read` | agents | Read unread messages from the Agent Bus. Spanish: leer mensajes bus, recibir mensajes, verificar bus |
| `cli_exec` | cli | Execute shell/bash commands in the agent workspace. NOTE: do NOT use for scheduling tasks, use cron.create instead. Spanish: ejecutar comando, terminal, bash, script, consola |
| `cron.create` | cron | Create a Hive scheduled automation: a recurring cron job or one-shot future execution. Spanish: crear automatización programada, programar tarea recurrente, ejecutar después, programar reporte |
| `cron.delete` | cron | Delete a cron job permanently. Spanish: eliminar tarea programada, cancelar recordatorio |
| `cron.history` | cron | Get execution history for a cron job. Spanish: historial de ejecuciones, logs de tarea |
| `cron.list` | cron | List all cron jobs with their next execution times and status. Spanish: ver tareas programadas, listar cronograma |
| `cron.pause` | cron | Pause a cron job temporarily without deleting it. Spanish: pausar tarea programada, detener temporalmente |
| `cron.resume` | cron | Resume a paused cron job. Spanish: reanudar tarea programada, continuar |
| `cron.trigger` | cron | Manually trigger a cron job execution immediately. Spanish: ejecutar tarea ahora, forzar ejecución |
| `cron.update` | cron | Update an existing cron job: change expression, task instruction, channel, time window, etc. Spanish: actualizar tarea programada, modificar cron, editar recordatorio |
| `fs_delete` | filesystem | Delete file or directory from workspace. Spanish: eliminar archivo, borrar archivo, borrar carpeta |
| `fs_edit` | filesystem | Edit specific lines or sections of a file. Spanish: editar archivo, modificar líneas, actualizar contenido |
| `fs_exists` | filesystem | Check if a file or directory exists. Spanish: verificar archivo, comprobar, existe archivo |
| `fs_glob` | filesystem | Find files matching wildcard patterns. Spanish: buscar archivos, patrón, encontrar archivos |
| `fs_list` | filesystem | List files and directories in workspace. Spanish: listar archivos, ver carpeta, explorar directorio |
| `fs_read` | filesystem | Read file content from agent workspace. Spanish: leer archivo, ver contenido, abrir archivo |
| `fs_write` | filesystem | Create or overwrite file in agent workspace. Spanish: crear archivo, guardar archivo, escribir archivo |
| `get_available_models` | agents | Obtener el catálogo completo de modelos de los providers configurados (con credenciales activas) para elegir el más adecuado según capacidad, contexto o costo — no solo el modelo por defecto del usuario. Sinónimos: ver modelos, listar providers, modelos disponibles, consultar modelos, provider activo, qué modelos tengo, modelos para código, modelos para chat |
| `memory_delete` | agents | Delete a specific memory entry. Spanish: borrar memoria, eliminar recuerdo, quitar dato |
| `memory_list` | agents | List all saved memory entries. Spanish: listar memorias, ver memorias, todas las memorias |
| `memory_read` | agents | Retrieve a memory entry by identifier. Spanish: leer memoria, recuperar dato, obtener memoria |
| `memory_search` | agents | Search memories by keyword. Spanish: buscar memoria, encontrar recuerdo, buscar dato guardado |
| `memory_write` | agents | Store information in persistent long-term memory. Spanish: guardar memoria, recordar, guardar dato, memoria persistente |
| `notify` | core | Send a notification or progress update to the user's active channel. Use this to keep the user informed while working on long tasks. |
| `office_escribir_docx` | office | Generar un archivo Word (.docx) con párrafos, títulos y tablas. Spanish: crear word, generar docx, escribir documento word, exportar a docx |
| `office_escribir_pdf` | office | Generar un archivo PDF desde texto con configuración de márgenes y tamaño de página. Spanish: crear pdf, generar pdf, escribir pdf, exportar a pdf |
| `office_escribir_pptx` | office | Generar un archivo PowerPoint (.pptx) desde un array de diapositivas con título y contenido. Spanish: crear powerpoint, generar pptx, escribir presentacion, exportar a pptx |
| `office_escribir_xlsx` | office | Generar un archivo Excel (.xlsx) desde un objeto JSON con hojas, filas y columnas. Spanish: crear excel, generar xlsx, escribir excel, exportar a xlsx |
| `office_leer_docx` | office | Leer un archivo Word (.docx) y retornar el contenido de texto preservando párrafos y tablas. Spanish: leer word, abrir docx, extraer texto de word, contenido word |
| `office_leer_pdf` | office | Leer contenido de un archivo PDF y retornar texto plano con metadata. Spanish: leer pdf, abrir pdf, extraer texto de pdf, pdf a texto |
| `office_leer_pptx` | office | Leer un archivo PowerPoint (.pptx) y retornar el texto de cada diapositiva como array estructurado. Spanish: leer powerpoint, abrir pptx, extraer texto de presentacion, contenido slides |
| `office_leer_xlsx` | office | Leer un archivo Excel (.xlsx) y retornar las hojas con sus datos como objetos JSON. Spanish: leer excel, abrir xlsx, extraer datos de excel, hojas excel |
| `report_progress` | core | Report progress of an ongoing task to the user. Sends a real-time update to the active channel. Use frequently during long operations so the user knows what's happening. |
| `save_note` | core | Save a note to the scratchpad (survives context compression). |
| `search_knowledge` | core | Busca en TODO el conocimiento de Hive: tools nativas, MCP, skills, agentes de catálogo y playbook. |
| `task_delegate` | agents | Delegate a bounded task to an existing worker_id (any `agents` row: catalog-seeded or agent_create-made). The delivery goes through deterministic acceptance checks (no LLM); you judge anything they don't cover in your closing turn, and use task_revise to send it back with feedback if it doesn't meet its criteria. mode=sync blocks the conversation until done; mode=async enqueues and frees the conversation immediately — the user is notified automatically in this same chat when the worker finishes. Prefer async unless you expect the result in a few seconds. |
| `task_list` | agents | List real delegated task executions for the current user. TaskDoc and JobDoc are the source of truth. Use this instead of agent_find to determine whether work is pending, running, completed, failed, or blocked. |
| `task_revise` | agents | Send a completed or blocked delegated task back to its worker with concrete feedback, instead of reporting it as done. The worker resumes on the SAME thread — it keeps its prior context, so the feedback only needs to describe what's missing. Use this when a delivery doesn't meet its acceptance criteria and you can't fix it yourself. |
| `task_status` | agents | Get execution status of one or more delegated tasks. Accepts string or numeric IDs. Spanish: estado tarea delegada, verificar progreso, consultar tarea |
| `web_fetch` | web | Fetch plain content from a URL (lightweight, no JS). Spanish: obtener página, descargar contenido, extraer texto de url |
| `web_search` | web | Search the web for current information and research. Spanish: buscar en internet, búsqueda web, noticias, información |

## Skills incluidas (23)

| Skill | Categoría | Versión | Herramientas | Agentes preferidos |
|---|---|---:|---|---|
| `a2ui_dashboard` | a2ui | 1.0.0 | `a2ui_create_surface`, `a2ui_update_components`, `a2ui_update_data_model`, `a2ui_delete_surface` | — |
| `a2ui_form` | a2ui | 1.0.0 | `a2ui_create_surface`, `a2ui_update_components`, `a2ui_update_data_model`, `a2ui_delete_surface` | — |
| `a2ui_interactive` | a2ui | 1.0.0 | `a2ui_create_surface`, `a2ui_update_components`, `a2ui_update_data_model`, `a2ui_delete_surface` | — |
| `agent_spawner` | agents | 1.1.0 | `get_available_models`, `agent_find`, `agent_create`, `agent_archive` | — |
| `api_client` | api | 1.0.0 | `api_request` | — |
| `browser_automate` | web | 1.0.0 | `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot` | — |
| `browser_scrape` | web | 1.0.0 | `browser_navigate`, `browser_screenshot`, `web_fetch` | — |
| `capability_discovery` | core | 1.2.0 | `search_knowledge` | — |
| `cli_pipeline` | cli | 1.0.0 | `cli_exec`, `fs_write` | — |
| `cli_safe_exec` | cli | 1.0.0 | `cli_exec` | — |
| `cron_manager` | cron | 2.0.0 | `cron.create`, `cron.list`, `cron.update`, `cron.delete`, `cron.pause`, `cron.resume`, `cron.trigger`, `cron.history` | — |
| `cron_reminder` | cron | 2.0.0 | `cron.create`, `notify` | — |
| `file_manager` | filesystem | 1.0.0 | `fs_list`, `fs_glob`, `fs_exists` | — |
| `file_read_and_summarize` | filesystem | 1.0.0 | `fs_read`, `fs_exists` | — |
| `file_writer` | filesystem | 1.0.0 | `fs_read`, `fs_write`, `fs_edit`, `fs_exists` | — |
| `memory_manager` | agents | 1.0.0 | `memory_write`, `memory_read`, `memory_list`, `memory_search`, `memory_delete` | — |
| `office_document_manager` | office | 1.0.0 | `office_leer_pdf`, `office_escribir_pdf`, `office_leer_docx`, `office_escribir_docx`, `office_leer_xlsx`, `office_escribir_xlsx`, `office_leer_pptx`, `office_escribir_pptx` | — |
| `research_and_remember` | agents | 1.0.0 | `web_search`, `web_fetch`, `memory_write` | — |
| `software_engineering` | cli | 1.0.0 | `fs_read`, `fs_write`, `fs_edit`, `fs_list`, `fs_glob`, `fs_exists`, `cli_exec` | `software_engineer` |
| `task_orchestrator` | agents | 1.2.0 | `get_available_models`, `task_delegate`, `task_list`, `task_status`, `agent_find`, `agent_create`, `bus_publish`, `bus_read` | — |
| `web_monitor` | web | 1.0.0 | `web_search`, `web_fetch`, `memory_write`, `memory_read` | — |
| `web_research` | web | 1.0.0 | `web_search`, `web_fetch` | — |
| `workspace_file_operator` | filesystem | 1.0.0 | `fs_read`, `fs_write`, `fs_edit`, `fs_delete`, `fs_list`, `fs_glob`, `fs_exists` | `workspace_file_operator` |

## Agentes de catálogo (8)

| ID | Nombre | Propósito | Herramientas autorizadas | Skills |
|---|---|---|---|---|
| `web_researcher` | Investigador web | Investiga preguntas actuales en fuentes web y entrega conclusiones verificables con referencias. | `web_search`, `web_fetch` | `web_research` |
| `browser_operator` | Operador de navegador | Navega sitios, completa formularios y verifica visualmente el estado final de una operación web. | `browser_*`, `web_fetch` | `browser_automate`, `browser_scrape` |
| `workspace_file_operator` | Operador de archivos | Crea, lee, edita, organiza y elimina archivos o carpetas dentro del workspace autorizado. | `fs_*` | `workspace_file_operator`, `file_manager` |
| `software_engineer` | Ingeniero de software | Implementa, depura y prueba software dentro de un repositorio o workspace existente. | `fs_*`, `cli_exec` | `software_engineering`, `cli_safe_exec`, `cli_pipeline` |
| `office_document_agent` | Operador de Office | Lee y genera documentos PDF, Word, Excel y PowerPoint dentro del workspace. | `office_*`, `fs_exists` | `office_document_manager` |
| `a2ui_builder` | Constructor A2UI | Construye formularios, dashboards y flujos interactivos compatibles con A2UI v0.9. | `a2ui_*` | `a2ui_form`, `a2ui_dashboard`, `a2ui_interactive` |
| `schedule_automation_agent` | Operador de cron | Crea y administra jobs programados de Hive: automatizaciones recurrentes o ejecuciones únicas mediante cron.*. | `cron.*` | `cron_manager`, `cron_reminder` |
| `api_operator` | Operador de APIs | Ejecuta y verifica operaciones contra APIs REST expresamente autorizadas. | `api_request` | `api_client` |

## Exports públicos

| Paquete | Subpath | Destino |
|---|---|---|
| `@johpaz/hive-agents` | `.` | `./packages/core/src/index.ts` |
| `@johpaz/hive-agents` | `./core` | `./packages/core/src/index.ts` |
| `@johpaz/hive-agents` | `./agent/service` | `./packages/core/src/agent/service.ts` |
| `@johpaz/hive-agents` | `./agent/agent-loop` | `./packages/core/src/agent/agent-loop.ts` |
| `@johpaz/hive-agents` | `./agent/context-compiler` | `./packages/core/src/agent/context-compiler.ts` |
| `@johpaz/hive-agents` | `./agent/prompt-builder` | `./packages/core/src/agent/prompt-builder.ts` |
| `@johpaz/hive-agents` | `./agent/conversation-store` | `./packages/core/src/agent/conversation-store.ts` |
| `@johpaz/hive-agents` | `./agent/tool-selector` | `./packages/core/src/agent/tool-selector.ts` |
| `@johpaz/hive-agents` | `./agent/skill-selector` | `./packages/core/src/agent/skill-selector.ts` |
| `@johpaz/hive-agents` | `./agent/playbook-selector` | `./packages/core/src/agent/playbook-selector.ts` |
| `@johpaz/hive-agents` | `./agent/llm-client` | `./packages/core/src/agent/llm-client.ts` |
| `@johpaz/hive-agents` | `./agent/native-tools` | `./packages/core/src/agent/native-tools.ts` |
| `@johpaz/hive-agents` | `./channels/manager` | `./packages/core/src/channels/manager.ts` |
| `@johpaz/hive-agents` | `./channels/base` | `./packages/core/src/channels/base.ts` |
| `@johpaz/hive-agents` | `./channels/telegram` | `./packages/core/src/channels/telegram.ts` |
| `@johpaz/hive-agents` | `./channels/discord` | `./packages/core/src/channels/discord.ts` |
| `@johpaz/hive-agents` | `./channels/whatsapp` | `./packages/core/src/channels/whatsapp.ts` |
| `@johpaz/hive-agents` | `./channels/slack` | `./packages/core/src/channels/slack.ts` |
| `@johpaz/hive-agents` | `./channels/webchat` | `./packages/core/src/channels/webchat.ts` |
| `@johpaz/hive-agents` | `./storage/hive` | `./packages/core/src/storage/hive.ts` |
| `@johpaz/hive-agents` | `./storage/hivedb` | `./packages/core/src/storage/hivedb.ts` |
| `@johpaz/hive-agents` | `./storage/bootstrap` | `./packages/core/src/storage/bootstrap.ts` |
| `@johpaz/hive-agents` | `./storage/collections` | `./packages/core/src/storage/collections.ts` |
| `@johpaz/hive-agents` | `./storage/seed` | `./packages/core/src/storage/seed.ts` |
| `@johpaz/hive-agents` | `./storage/crypto` | `./packages/core/src/storage/crypto.ts` |
| `@johpaz/hive-agents` | `./storage/onboarding` | `./packages/core/src/storage/onboarding.ts` |
| `@johpaz/hive-agents` | `./tools/index` | `./packages/core/src/tools/index.ts` |
| `@johpaz/hive-agents` | `./tools/types` | `./packages/core/src/tools/types.ts` |
| `@johpaz/hive-agents` | `./tool-runtime` | `./packages/core/src/tool-runtime/index.ts` |
| `@johpaz/hive-agents` | `./tools/agents/index` | `./packages/core/src/tools/agents/index.ts` |
| `@johpaz/hive-agents` | `./tools/filesystem/index` | `./packages/core/src/tools/filesystem/index.ts` |
| `@johpaz/hive-agents` | `./tools/web/index` | `./packages/core/src/tools/web/index.ts` |
| `@johpaz/hive-agents` | `./tools/cron/index` | `./packages/core/src/tools/cron/index.ts` |
| `@johpaz/hive-agents` | `./tools/cli/index` | `./packages/core/src/tools/cli/index.ts` |
| `@johpaz/hive-agents` | `./tools/a2ui/index` | `./packages/core/src/tools/a2ui/index.ts` |
| `@johpaz/hive-agents` | `./tools/core/index` | `./packages/core/src/tools/core/index.ts` |
| `@johpaz/hive-agents` | `./config/index` | `./packages/core/src/config/index.ts` |
| `@johpaz/hive-agents` | `./utils/logger` | `./packages/core/src/utils/logger.ts` |
| `@johpaz/hive-agents` | `./utils/crypto` | `./packages/core/src/utils/crypto.ts` |
| `@johpaz/hive-agents` | `./utils/retry` | `./packages/core/src/utils/retry.ts` |
| `@johpaz/hive-agents` | `./gateway/index` | `./packages/core/src/gateway/index.ts` |
| `@johpaz/hive-agents` | `./gateway/server` | `./packages/core/src/gateway/server.ts` |
| `@johpaz/hive-agents` | `./mcp` | `./packages/mcp/src/index.ts` |
| `@johpaz/hive-agents` | `./mcp/manager` | `./packages/mcp/src/manager.ts` |
| `@johpaz/hive-agents` | `./mcp/config` | `./packages/mcp/src/config.ts` |
| `@johpaz/hive-agents` | `./mcp/logger` | `./packages/mcp/src/logger.ts` |
| `@johpaz/hive-agents` | `./mcp/transports` | `./packages/mcp/src/transports/index.ts` |
| `@johpaz/hive-agents` | `./skills` | `./packages/skills/src/index.ts` |
| `@johpaz/hive-agents` | `./skills/loader` | `./packages/skills/src/loader.ts` |
| `@johpaz/hive-agents` | `./cli` | `./packages/cli/src/index.ts` |
| `@johpaz/hive-agents-core` | `.` | `./src/index.ts` |
| `@johpaz/hive-agents-core` | `./gateway` | `./src/gateway/index.ts` |
| `@johpaz/hive-agents-core` | `./agent` | `./src/agent/index.ts` |
| `@johpaz/hive-agents-core` | `./agent/service` | `./src/agent/service.ts` |
| `@johpaz/hive-agents-core` | `./agent/agent-loop` | `./src/agent/agent-loop.ts` |
| `@johpaz/hive-agents-core` | `./agent/context-compiler` | `./src/agent/context-compiler.ts` |
| `@johpaz/hive-agents-core` | `./agent/prompt-builder` | `./src/agent/prompt-builder.ts` |
| `@johpaz/hive-agents-core` | `./agent/conversation-store` | `./src/agent/conversation-store.ts` |
| `@johpaz/hive-agents-core` | `./agent/tool-selector` | `./src/agent/tool-selector.ts` |
| `@johpaz/hive-agents-core` | `./agent/skill-selector` | `./src/agent/skill-selector.ts` |
| `@johpaz/hive-agents-core` | `./agent/playbook-selector` | `./src/agent/playbook-selector.ts` |
| `@johpaz/hive-agents-core` | `./agent/llm-client` | `./src/agent/llm-client.ts` |
| `@johpaz/hive-agents-core` | `./channels` | `./src/channels/index.ts` |
| `@johpaz/hive-agents-core` | `./channels/base` | `./src/channels/base.ts` |
| `@johpaz/hive-agents-core` | `./channels/manager` | `./src/channels/manager.ts` |
| `@johpaz/hive-agents-core` | `./channels/telegram` | `./src/channels/telegram.ts` |
| `@johpaz/hive-agents-core` | `./channels/discord` | `./src/channels/discord.ts` |
| `@johpaz/hive-agents-core` | `./channels/whatsapp` | `./src/channels/whatsapp.ts` |
| `@johpaz/hive-agents-core` | `./channels/slack` | `./src/channels/slack.ts` |
| `@johpaz/hive-agents-core` | `./channels/webchat` | `./src/channels/webchat.ts` |
| `@johpaz/hive-agents-core` | `./config` | `./src/config/loader.ts` |
| `@johpaz/hive-agents-core` | `./config/loader` | `./src/config/loader.ts` |
| `@johpaz/hive-agents-core` | `./utils` | `./src/utils/logger.ts` |
| `@johpaz/hive-agents-core` | `./utils/logger` | `./src/utils/logger.ts` |
| `@johpaz/hive-agents-core` | `./storage/hive` | `./src/storage/hive.ts` |
| `@johpaz/hive-agents-core` | `./storage/hivedb` | `./src/storage/hivedb.ts` |
| `@johpaz/hive-agents-core` | `./storage/causal-events` | `./src/storage/causal-events.ts` |
| `@johpaz/hive-agents-core` | `./storage/bootstrap` | `./src/storage/bootstrap.ts` |
| `@johpaz/hive-agents-core` | `./storage/collections` | `./src/storage/collections.ts` |
| `@johpaz/hive-agents-core` | `./storage/onboarding` | `./src/storage/onboarding.ts` |
| `@johpaz/hive-agents-core` | `./storage/crypto` | `./src/storage/crypto.ts` |
| `@johpaz/hive-agents-core` | `./storage/seed` | `./src/storage/seed.ts` |
| `@johpaz/hive-agents-core` | `./tools` | `./src/tools/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/agents` | `./src/tools/agents/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/a2ui` | `./src/tools/a2ui/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/cli` | `./src/tools/cli/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/core` | `./src/tools/core/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/cron` | `./src/tools/cron/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/filesystem` | `./src/tools/filesystem/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/office` | `./src/tools/office/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/web` | `./src/tools/web/index.ts` |
| `@johpaz/hive-agents-core` | `./tools/web/browser-backend` | `./src/tools/web/browser-backend.ts` |
| `@johpaz/hive-agents-core` | `./tool-runtime` | `./src/tool-runtime/index.ts` |
| `@johpaz/hive-agents-core` | `./voice` | `./src/voice/index.ts` |
| `@johpaz/hive-agents-mcp` | `.` | `./src/index.ts` |
| `@johpaz/hive-agents-mcp` | `./manager` | `./src/manager.ts` |
| `@johpaz/hive-agents-mcp` | `./config` | `./src/config.ts` |
| `@johpaz/hive-agents-mcp` | `./logger` | `./src/logger.ts` |
| `@johpaz/hive-agents-mcp` | `./transports` | `./src/transports/index.ts` |
| `@johpaz/hive-agents-skills` | `.` | `./src/index.ts` |
| `@johpaz/hive-agents-skills` | `./loader` | `./src/loader.ts` |

