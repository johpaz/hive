# Inventario generado de Hive

> No edites este archivo manualmente. Ejecuta `bun run docs:generate`.

Generado desde el código fuente para Hive **1.1.12**.

## Versiones

| Paquete | Versión |
|---|---:|
| `@johpaz/hive-agents` | `1.1.12` |
| `@johpaz/hive-cli` | `1.1.12` |
| `@johpaz/hive-agents-core` | `1.1.12` |
| `@johpaz/hive-agents-ui` | `1.1.12` |
| `@johpaz/hive-agents-mcp` | `1.1.12` |
| `@johpaz/hive-agents-skills` | `1.1.12` |
| `@johpaz/hive-desktop` | `1.1.12` |
| `apps/hive-desktop/src-tauri/tauri.conf.json` | `1.1.12` |

## Herramientas (132)

| Herramienta | Categoría | Descripción |
|---|---|---|
| `a2ui_create_surface` | a2ui | Create an A2UI v0.9 surface in the user's interactive panel |
| `a2ui_delete_surface` | a2ui | Delete an A2UI v0.9 surface from the user's interactive panel |
| `a2ui_update_components` | a2ui | Send A2UI v0.9 components to an existing surface. Components are a FLAT list with ID references (adjacency list).  ENVÍA TODO COMPLETO EN UNA SOLA LLAMADA: cada componente con sus propiedades (children, text, label, options, action…) según su tipo. Un componente con solo id y component se rechaza y no se publica nada; no mandes un esqueleto para rellenarlo después.  CHILDREN (spec oficial A2UI v0.9):   Static: "children": ["id1", "id2"]  ← array crudo, formato oficial   Template: "children": {"path": "/items", "componentId": "item_tmpl"}  ← formato oficial   Single child (Card/Modal): "child": "child_id"  COMPONENT PROPS (nombres oficiales del spec):   Text: text (string\|{path}), variant ("h1"\|"h2"\|"h3"\|"h4"\|"h5"\|"body"\|"caption"\|"code")   Button: child (id del texto), variant ("default"\|"primary"\|"borderless"), action (required)   TextField: label, value: {path:"/..."}, variant ("shortText"\|"longText"\|"number"\|"obscured"), validationRegexp, action     - action fires on blur or Enter key   ChoicePicker: options [{label, value}], value: {path:"/..."}, variant ("mutuallyExclusive"\|"multipleSelection"), displayStyle ("checkbox"\|"chips"), filterable, action     - value es DynamicStringList; two-way binding con value; action fires inmediatamente   Slider: label, value: {path:"/..."}, min, max, step, action (fires on release)   CheckBox: label, value: {path:"/..."} (DynamicBoolean, two-way binding)   DateTimeInput: value: {path:"/..."}, enableDate, enableTime, min, max, label   Tabs: tabs: [{title: "string plano", child: "id"}]  ← title es string, NO {literalString:...}   Modal: trigger (id del botón), content (id del dialog)   Card: child (único hijo), weight   Row: children, justify ("start"\|"center"\|"end"\|"spaceBetween"\|"spaceAround"\|"spaceEvenly"), align ("start"\|"center"\|"end"\|"stretch"), weight   Column: children, justify, align, weight   List: children (con template path), direction ("vertical"\|"horizontal"), align, weight   Image: url, description, fit ("contain"\|"cover"\|"fill"\|"none"\|"scaleDown"), variant ("icon"\|"avatar"\|"smallFeature"\|"mediumFeature"\|"largeFeature"\|"header")   Divider: axis ("horizontal"\|"vertical")  ACTION FORMAT (oficial: con wrapper event):   {event: {name: "action_name", context: {key: {path: "/data/key"}}}}  DATA BINDING: "prop": "literal" \| {path: "/json/pointer"} \| {call: "fn", args: {...}}  Root component: usar id="root" explícito. |
| `a2ui_update_data_model` | a2ui | Update the data model for an A2UI v0.9 surface. The data model provides dynamic values that components can bind to via paths (e.g. '/user/name'). |
| `agent_archive` | agents | Archive or terminate a worker you created. Catalog agents cannot be archived — only the user can disable those from the UI. Spanish: archivar agente, terminar worker |
| `agent_create` | agents | Crear un nuevo agente worker especializado. Requiere consultar get_available_models; para un especialista MCP confirmado por el usuario, acepta mcp_server_id. Sinónimos: crear agente, nuevo worker, nuevo trabajador |
| `agent_find` | agents | Discover available worker agents. Includes global system catalog agents plus private workers owned by the current user. This tool does not report task execution; use task_list/task_status for that. Spanish: buscar agente, encontrar worker, localizar agente |
| `api_request` | api | Make an HTTP request to a REST API endpoint. Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS with custom headers, body, and query parameters. Spanish: llamar api, petición http, curl, post a api, put api, delete api, consumir servicio rest |
| `artifact_inspect` | web | Inspect managed artifact metadata, integrity, MIME type and dimensions without returning or modifying its binary content. |
| `artifact_read` | web | Read the text content of a managed artifact in slices, or search inside it. Use this on any artifact_ref a tool returned instead of guessing from its preview. Spanish: leer artefacto, ver contenido del artefacto, abrir resultado grande, buscar dentro del artefacto |
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
| `code_agent_run` | externa | Delegate a coding task to an external coding-agent CLI (claude, codex, opencode, kimi). Runs in an isolated git worktree when possible and returns the summary, changed files and diff; it never merges into the workspace. Spanish: agente de código externo, delegar programación |
| `computer_use_task` | web | Opera el navegador de Hive mirando la pantalla: hace clic, escribe y navega guiado por lo que ve. Úsalo cuando la página no tenga selectores estables o cuando browser_click/browser_type no basten. Actúa sobre el navegador de Hive, NUNCA sobre la pantalla del usuario. Spanish: usar el navegador, hacer clic, operar una página, rellenar un formulario |
| `conversation_read` | core | Read earlier messages from the current conversation by message IDs or text query when selected context is insufficient. Searches by meaning across the whole history, including messages already compacted into the summary. |
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
| `gcal_create_event` | google | Create a Google Calendar event. If it has attendees, Google emails them invitations, so the first call returns needs_confirmation; repeat with confirmed=true after the user approves. Spanish: agendar reunión, crear evento, programar cita, invitar asistentes |
| `gcal_delete_event` | google | Delete a Google Calendar event (attendees are notified). IRREVERSIBLE: needs_confirmation first, then confirmed=true. Spanish: cancelar reunión, borrar evento |
| `gcal_freebusy` | google | Check busy intervals for one or more calendars in a time range to find free slots. Spanish: disponibilidad, horarios libres, cuándo estoy libre |
| `gcal_list_events` | google | List Google Calendar events in a time range (default: the next 7 days). Spanish: ver agenda, qué tengo hoy, próximos eventos, reuniones de la semana |
| `gcal_update_event` | google | Modify fields of an existing Google Calendar event (only the ones provided). Needs user confirmation (needs_confirmation, then confirmed=true). Spanish: mover reunión, cambiar evento, reprogramar cita |
| `gdrive_download` | google | Download a Drive file (or export a Google Doc as text, a Sheet as CSV, Slides as PDF) into a Hive artifact. Text content up to 20k chars is also returned inline. Spanish: descargar de drive, leer documento de google, abrir archivo de drive |
| `gdrive_search` | google | Search the user's Google Drive by text (name and content) or with a raw Drive query. Returns id, name, type, modified time and link. Spanish: buscar en drive, encontrar archivo, documentos de google |
| `gdrive_upload` | google | Upload a file to the user's Google Drive from text `content` or from a Hive artifact (artifact_id). Creates a new file; never overwrites. Spanish: subir a drive, guardar en drive, enviar archivo a drive |
| `get_available_models` | agents | Obtener el catálogo completo de modelos de los providers configurados (con credenciales activas) para elegir el más adecuado según capacidad, contexto o costo — no solo el modelo por defecto del usuario. Sinónimos: ver modelos, listar providers, modelos disponibles, consultar modelos, provider activo, qué modelos tengo, modelos para código, modelos para chat |
| `gmail_attachment_download` | google | Download an attachment of a received email into a Hive artifact (ids come from gmail_read: message id + attachment_id). Spanish: descargar adjunto, guardar adjunto del correo |
| `gmail_draft_delete` | google | Permanently delete a draft. Needs confirmation (needs_confirmation, then confirmed=true). Spanish: borrar borrador, eliminar borrador |
| `gmail_draft_list` | google | List the user's Gmail drafts (draft_id, message_id, recipients, subject). Use gmail_read with message_id for the body. Spanish: ver borradores, mis borradores |
| `gmail_draft_save` | google | Create a Gmail draft, or EDIT an existing one by passing draft_id (the whole draft is replaced: read it first with gmail_read and resend every field). Never sends anything. Spanish: crear borrador, editar borrador, guardar borrador |
| `gmail_draft_send` | google | Send an existing draft. IRREVERSIBLE: needs_confirmation first, then confirmed=true after user approval. Spanish: enviar borrador |
| `gmail_forward` | google | Forward an email to new recipients with an optional note, including the original text and (by default) its attachments. IRREVERSIBLE: needs_confirmation first, then confirmed=true after user approval. Spanish: reenviar correo, forward, pasar este correo a |
| `gmail_labels` | google | Manage Gmail labels: list them (no params), create (create=<name>), rename (label + new_name) or delete (delete=<label>, needs confirmation; mails keep existing but lose the label). System labels cannot be changed. Spanish: ver etiquetas, crear etiqueta, renombrar etiqueta, borrar etiqueta, carpetas de gmail |
| `gmail_modify` | google | Organize one or many messages (up to 50): mark read/unread, star/unstar, archive, move back to inbox, mark important, send to trash or restore, and add/remove labels. Reversible, no confirmation needed. Spanish: marcar como leído, marcar no leído, archivar correo, destacar, mover a la papelera, poner etiqueta |
| `gmail_read` | google | Read one Gmail message in full (headers, text body, attachment names) by id from gmail_search. Spanish: leer correo, abrir correo, contenido del correo |
| `gmail_reply` | google | Reply to an email in its thread (keeps subject, In-Reply-To and recipients). reply_all=true also includes the other recipients. IRREVERSIBLE unless save_as_draft=true: first call returns a preview and needs_confirmation; repeat with confirmed=true after the user approves. Spanish: responder correo, contestar email, responder a todos |
| `gmail_search` | google | Search the user's Gmail. Accepts Gmail query syntax (from:, to:, subject:, is:unread, after:2026/01/31, has:attachment, label:). Returns id, sender, subject, date and snippet. Spanish: buscar correos, correos sin leer, correos de, bandeja de entrada |
| `gmail_send` | google | Send a NEW email from the user's Gmail (to reply use gmail_reply). IRREVERSIBLE: first call returns a preview and needs_confirmation; repeat with confirmed=true only after the user approves. Spanish: enviar correo, mandar email, escribir un correo, enviar con adjunto |
| `gmail_thread` | google | Read a whole conversation thread (all messages in order, text bodies trimmed). Spanish: leer conversación, hilo de correos, historial del correo |
| `image_generate` | image | Create a NEW image from a text description (illustration, logo, photo-style picture, poster, concept art). The finished image is delivered to the user automatically in the chat or channel — do NOT paste a link or base64. Write the prompt in English or Spanish with subject, style, lighting and composition. It cannot edit or modify an existing image. Spanish: crear imagen, generar imagen, dibujar, hazme una imagen, ilustración, logo, póster, foto |
| `memory_delete` | agents | Delete a specific memory entry. Spanish: borrar memoria, eliminar recuerdo, quitar dato |
| `memory_list` | agents | List all saved memory entries. Spanish: listar memorias, ver memorias, todas las memorias |
| `memory_read` | agents | Retrieve a memory entry by identifier. Spanish: leer memoria, recuperar dato, obtener memoria |
| `memory_search` | agents | Search memories by keyword. Spanish: buscar memoria, encontrar recuerdo, buscar dato guardado |
| `memory_write` | agents | Store information in persistent long-term memory. Spanish: guardar memoria, recordar, guardar dato, memoria persistente |
| `notify` | core | Send a notification or progress update to the user's active channel. Use this to keep the user informed while working on long tasks. |
| `obscura_back` | web | Navigate back in the page history (browser back button). Requires an active session from obscura_navigate. Spanish keywords: atrás, volver, página anterior, regresar |
| `obscura_clear_cookies` | web | Wipe every cookie from the jar. Spanish keywords: borrar cookies, limpiar cookies, eliminar cookies |
| `obscura_click` | web | Click an element by ref (preferred, from obscura_snapshot/obscura_interactive_elements) or CSS selector. Spanish keywords: hacer clic, presionar botón, clickear, pulsar, click |
| `obscura_close` | web | Close the current browser page and reset the session state. Spanish keywords: cerrar navegador, cerrar página, terminar sesión |
| `obscura_console_messages` | web | List the console messages logged by the current page (logs, warnings, errors). Spanish keywords: ver consola, logs página, mensajes consola, errores javascript, console |
| `obscura_count` | web | Count how many elements on the page match a CSS selector. Cheap existence/pagination probe. Spanish keywords: contar elementos, cuántos, número de elementos, contar coincidencias |
| `obscura_detect_forms` | web | List every <form> on the page with its action URL, method and a description of each input/textarea/select. Understand a form before filling it. Spanish keywords: detectar formularios, ver formularios, campos formulario, estructura formulario |
| `obscura_evaluate` | web | Evaluate a JavaScript expression in the page context and return the result as JSON. Spanish keywords: ejecutar javascript, evaluar expresión, js en página, script navegador, eval |
| `obscura_extract` | web | Extract a structured object from the page given a map of {field_name: css_selector}. Use 'selector@attr' for attributes (e.g. 'a@href') and 'field[]' suffix for arrays. Spanish keywords: extraer datos, scraping, extraer estructura, datos página, seleccionar campos |
| `obscura_fill` | web | Set the value of an input element (replaces existing value). Pass ref (preferred) or selector. Spanish keywords: llenar campo, rellenar input, establecer valor, completar campo |
| `obscura_fill_form` | web | Fill multiple inputs in one call: fields is an array of {ref?, selector?, value, type?} where type is text (default), check, uncheck or select. Optional submit_ref/submit_selector clicks after filling. Spanish keywords: llenar formulario, completar formulario, rellenar form, enviar formulario |
| `obscura_forward` | web | Navigate forward in the page history. Requires an active session from obscura_navigate. Spanish keywords: adelante, página siguiente, avanzar |
| `obscura_get_attribute` | web | Read an attribute of an element (href, src, value, class, data-*). Returns the raw value or empty string. Spanish keywords: leer atributo, obtener atributo, href, valor elemento, atributo html |
| `obscura_get_cookies` | web | Return all cookies in the browser's cookie jar as one JSON object per line. Spanish keywords: ver cookies, obtener cookies, cookies sesión, leer cookies |
| `obscura_interactive_elements` | web | List every clickable/typeable element with a stable ref ID and a brief description. Use BEFORE clicking or filling to act by ref instead of guessing CSS selectors. Spanish keywords: elementos interactivos, botones, campos, inputs, refs, elementos clicables |
| `obscura_links` | web | List every anchor link on the current page as one JSON object per line {text, href}. Spanish keywords: listar enlaces, ver links, urls página, hipervínculos, enlaces |
| `obscura_markdown` | web | Extract the current page as Markdown (headings, paragraphs, lists, links, code blocks). Token-dense structured content instead of plain text. Spanish keywords: markdown, extraer markdown, contenido estructurado, página en markdown |
| `obscura_navigate` | web | Navigate to a URL and wait for the page to load, keeping a live browser session for subsequent obscura_* tools. Returns the final URL and title only: read the page next with obscura_snapshot or obscura_markdown. Spanish keywords: navegar, abrir página, ir a sitio web, cargar url, visitar |
| `obscura_network_requests` | web | List the network requests made by the current page (URLs, statuses, timings). Spanish keywords: ver peticiones red, requests, tráfico red, llamadas http página, network |
| `obscura_pdf` | web | Export the current rendered document as a paginated PDF (saved to ~/.hivecode/screenshots/). Spanish keywords: exportar pdf, guardar pdf, página a pdf, documento pdf |
| `obscura_press_key` | web | Dispatch a keyboard event (Enter, Tab, Escape…) on an element or the document. Spanish keywords: presionar tecla, pulsar enter, teclado, keydown |
| `obscura_reload` | web | Reload the current page. Requires an active session from obscura_navigate. Spanish keywords: recargar, refrescar página, actualizar página, f5 |
| `obscura_screenshot` | web | Capture the current rendered viewport as a PNG (saved to ~/.hivecode/screenshots/, returned with path + base64). Use for canvas/visual verification; prefer obscura_snapshot for text. Spanish keywords: captura de pantalla, screenshot, fotografiar página, imagen página, png |
| `obscura_scroll` | web | Scroll the page or an element: direction top/bottom/up/down/left/right, amount in pixels. Use 'bottom' to trigger infinite-scroll loaders. Spanish keywords: scroll, desplazar, bajar página, subir página, desplazamiento |
| `obscura_search` | web | Find substring matches in the visible page text with surrounding context. Spanish keywords: buscar en página, encontrar texto, buscar contenido, texto en página |
| `obscura_select_option` | web | Select an option from a <select> element by value or visible text. Spanish keywords: seleccionar opción, elegir opción, dropdown, lista desplegable, select |
| `obscura_set_cookie` | web | Add or replace a cookie in the jar — skip a login flow when you already have a session token. Spanish keywords: setear cookie, establecer cookie, inyectar cookie, cookie sesión |
| `obscura_set_storage_state` | web | Restore a session state previously returned by obscura_storage_state to bring an authenticated session back. Spanish keywords: restaurar sesión, importar sesión, cargar sesión guardada, login guardado |
| `obscura_snapshot` | web | Get the current page as text: URL, title, readable body text and interactive element refs. Preferred first read after navigating. Spanish keywords: snapshot página, contenido página, ver página, texto página, captura textual |
| `obscura_storage_state` | web | Export the full session state (cookies + localStorage + sessionStorage) as JSON — save it to skip a login on a later run. Spanish keywords: exportar sesión, estado sesión, guardar sesión, storage state |
| `obscura_tab_close` | web | Close a tab by ID (default: the active tab). Spanish keywords: cerrar pestaña, cerrar tab |
| `obscura_tab_list` | web | List all open tabs with their ID, URL, title and which one is active. Spanish keywords: listar pestañas, ver pestañas, tabs abiertos |
| `obscura_tab_new` | web | Open a new tab (isolated browser page); subsequent tool calls operate on the most recent tab. Spanish keywords: nueva pestaña, abrir pestaña, nuevo tab |
| `obscura_tab_switch` | web | Switch the active tab — all subsequent tool calls target this tab. Spanish keywords: cambiar pestaña, cambiar tab, activar pestaña |
| `obscura_type` | web | Type text into an input element (appends to existing value). Pass ref (preferred) or selector. Spanish keywords: escribir en campo, teclear texto, introducir texto, escribir input |
| `obscura_wait_for` | web | Wait for a CSS selector to appear in the DOM (default 30s). Spanish keywords: esperar elemento, aguardar selector, wait selector, esperar carga |
| `obscura_wait_for_text` | web | Wait until a substring appears anywhere in the rendered page text — for result messages and notifications. Spanish keywords: esperar texto, aguardar mensaje, esperar resultado, wait texto |
| `office_editar_docx` | office | Editar un Word (.docx) existente: reemplazar texto y/o añadir párrafos al final, conservando estilos, tablas e imágenes. Guarda una copia (no pisa el original) y devuelve su ruta para enviarla con send_file. Spanish: editar word, corregir word, reemplazar texto en docx, mejorar documento |
| `office_editar_pptx` | office | Editar un PowerPoint (.pptx) existente reemplazando texto en diapositivas (y notas si se pide), conservando diseño, imágenes y gráficos. Guarda una copia (no pisa el original) y devuelve su ruta para enviarla con send_file. No añade ni elimina diapositivas. Spanish: editar powerpoint, corregir presentación, reemplazar texto en diapositivas |
| `office_editar_xlsx` | office | Editar un Excel (.xlsx) existente cambiando solo las celdas indicadas, conservando el formato del resto. Guarda una copia (no pisa el original) y devuelve su ruta para enviarla con send_file. Spanish: editar excel, corregir excel, modificar celdas, mejorar hoja de cálculo |
| `office_escribir_docx` | office | Generar un archivo Word (.docx) con estilo: títulos, párrafos (con `tramos` de negrita/cursiva/subrayado/color/enlace), listas (viñetas o numeradas), tablas con encabezado en color y cebra, citas, código, reglas y saltos de página. `tema.preset` elige modern, classic, corporate o minimal. `encabezado`/`pie` ({texto, alineacion}) se repiten en cada página y aceptan {page}, {pages} y {title}. Spanish: crear word, generar docx, escribir documento word, exportar a docx, informe, carta, propuesta |
| `office_escribir_pdf` | office | Generar un PDF con estilo. Da `contenido` (texto; acepta # títulos, - viñetas, 1. listas, > citas, \| tablas \|, ---) o `bloques`: títulos (nivel 1-3), párrafos (con `tramos` de negrita/cursiva/subrayado/color/tamaño/enlace), listas (viñetas o numeradas, un nivel anidado), tablas (encabezado repetido entre páginas, cebra, alineación y pesos de columna), citas, código, reglas, espacios y saltos de página. `tema.preset` elige modern, classic, corporate o minimal y puede sobreescribir colores y fuentes (sans, serif, mono). `encabezado`/`pie` llevan izquierda/centro/derecha con {page}, {pages} y {title}. Spanish: crear pdf, generar pdf, escribir pdf, exportar a pdf, informe, reporte |
| `office_escribir_pptx` | office | Generar una presentación PowerPoint (.pptx) 16:9 con estilo: portada opcional con fondo propio, diapositivas con título, acento de color, texto libre o viñetas, número de diapositiva y notas del presentador. `tema.preset` elige modern, light, dark, corporate o warm y puede sobreescribir colores y fuentes. Spanish: crear powerpoint, generar pptx, escribir presentacion, exportar a pptx, diapositivas, slides |
| `office_escribir_xlsx` | office | Generar un archivo Excel (.xlsx) con estilo desde hojas de objetos o de arrays. La primera fila es el encabezado (se estiliza, se fija y recibe autofiltro por defecto). Por hoja, `columnas` fija formato (fecha, fecha_hora, hora, entero, decimal, miles, porcentaje, moneda, texto o un código de formato de Excel; los textos ISO como 2025-03-01 en una columna de fecha se guardan como fechas reales), ancho, negrita, color, relleno, alineacion y ajustar para una columna indicada por el texto de su encabezado o su índice. Colores #RRGGBB. Las celdas son siempre valores: un texto que empieza por = nunca es fórmula. Spanish: crear excel, generar xlsx, escribir excel, exportar a xlsx, hoja de cálculo, reporte |
| `office_leer_docx` | office | Leer un archivo Word (.docx) y retornar el contenido de texto preservando párrafos y tablas. Spanish: leer word, abrir docx, extraer texto de word, contenido word |
| `office_leer_imagenes` | image | Read the IMAGES inside a Word (.docx), PowerPoint (.pptx) or PDF file — screenshots, charts, diagrams, photos and SCANNED pages — which office_leer_docx / office_leer_pptx / office_leer_pdf cannot see because they only return text. Each image is described and its text transcribed with the vision model chosen in Providers → Imagen, and comes with where it was in the document (slide, page, nearby text). Use it when the document mentions figures, its text looks incomplete, or a PDF has no extractable text (scanned). In a PDF each page image is one model call. Returns up to max_imagenes per call; continue with desde_imagen. Vector drawings inside a PDF are not images and are not covered. Spanish: leer imágenes de un documento, ocr de pdf escaneado, ocr de word, ocr de powerpoint, capturas dentro de un documento, gráficos de una presentación |
| `office_leer_pdf` | office | Leer el texto de un PDF (capa de texto nativa, sin OCR ni modelos), conservando renglones y columnas, por páginas y con tope de tamaño. Un PDF escaneado devuelve aviso en vez de texto. Spanish: leer pdf, abrir pdf, extraer texto de pdf, pdf a texto |
| `office_leer_pptx` | office | Leer un PowerPoint (.pptx): texto de cada diapositiva en su orden real, con título y notas del orador, con tope de tamaño. Spanish: leer powerpoint, abrir pptx, extraer texto de presentacion, contenido slides |
| `office_leer_xlsx` | office | Leer un archivo Excel (.xlsx) y retornar las hojas con sus datos como objetos JSON. Spanish: leer excel, abrir xlsx, extraer datos de excel, hojas excel |
| `report_progress` | core | Report progress of an ongoing task to the user. Sends a real-time update to the active channel. Use frequently during long operations so the user knows what's happening. |
| `save_note` | core | Save a note to the scratchpad (survives context compression). |
| `search_knowledge` | core | Busca en TODO el conocimiento de Hive: tools nativas, MCP, skills, agentes de catálogo y playbook. |
| `send_file` | core | Send a file (Word, Excel, PDF, PowerPoint, image, text…) to the user in the chat they are writing from. Use it to hand back a document you created or corrected. Spanish: enviar archivo, enviar documento, devolver archivo corregido, mandar el excel/word/pdf al usuario |
| `task_delegate` | agents | Delegate a bounded task to an existing worker_id (any `agents` row: catalog-seeded or agent_create-made). The delivery goes through deterministic acceptance checks (no LLM); you judge anything they don't cover in your closing turn, and use task_revise to send it back with feedback if it doesn't meet its criteria. mode=sync blocks the conversation until done; mode=async enqueues and frees the conversation immediately — the user is notified automatically in this same chat when the worker finishes. Prefer async unless you expect the result in a few seconds. |
| `task_list` | agents | List real delegated task executions for the current user. TaskDoc and JobDoc are the source of truth. Use this instead of agent_find to determine whether work is pending, running, completed, failed, or blocked. |
| `task_revise` | agents | Send a completed or blocked delegated task back to its worker with concrete feedback, instead of reporting it as done. The worker resumes on the SAME thread — it keeps its prior context, so the feedback only needs to describe what's missing. Use this when a delivery doesn't meet its acceptance criteria and you can't fix it yourself. |
| `task_status` | agents | Get execution status of one or more delegated tasks. Accepts string or numeric IDs. Spanish: estado tarea delegada, verificar progreso, consultar tarea |
| `video_avatar_list` | externa | List the user's saved avatars (face + name + voice) from «Mis avatares» in the Video Studio. If the user already has an avatar for the person who appears in the video, create the project with that avatar_id instead of asking for the photo again. Spanish: mis avatares, avatares guardados, personajes guardados, usar mi avatar |
| `video_character_image` | externa | Generate the reference image of a project character with Nano Banana (Gemini). The image is saved in the workspace folder estudio-videos/imagenes and is reused as reference so the character looks the same in every clip. Costs about 0.04 USD per image. Regenerating it resets the clips of the scenes where the character appears. Spanish: imagen del personaje, nano banana, diseñar personaje |
| `video_project_create` | externa | Create a new video (reel) project in the Video Studio. Set title, brief, aspect ratio (9:16 vertical default for reels, or 16:9) and target duration in seconds. This costs nothing; it only prepares the project. Next: video_project_update with script, characters and scenes. Spanish: crear reel, nuevo proyecto de video, crear video, estudio de video |
| `video_project_produce` | externa | Start producing the video clips and the final reel in the background. SPENDS MONEY, so it only works if the USER already approved the estimated cost in the Video Studio tab; you cannot approve it. If it answers not_approved, tell the user the estimated cost and ask them to approve it in the Video Studio tab. Returns right away; each step (scene image, clip, voice, subtitles, final join) is narrated to the user as it happens; follow progress with video_project_status. Spanish: producir video, generar reel, empezar producción |
| `video_project_status` | externa | Read a video project: script, characters, scenes with their status, estimated cost, spend so far, whether the user approved the cost, and the final reel path. Use it before producing and to follow progress while it is being produced. Spanish: estado del reel, cuánto cuesta el video, progreso |
| `video_project_update` | externa | Edit a video project: script text, characters (name + visual description) and scenes (each a clip of 3-15 s with a prompt). Send the complete list of scenes/characters you want (replaces the previous list); pass the existing id to keep an already generated clip. Scene seconds should add up to roughly the target duration. YOU decide each scene's wardrobe and setting (scenography); the face of a character comes from the reference photo the user uploaded and never changes. Changing scenes, format or resolution withdraws any cost approval. Free; nothing is generated here. Spanish: guion, escenas, personajes, editar reel |
| `web_fetch` | web | Fetch plain content from a URL (lightweight, no JS). Spanish: obtener página, descargar contenido, extraer texto de url |
| `web_search` | web | Search the web for current information and research. Spanish: buscar en internet, búsqueda web, noticias, información |

## Skills incluidas (29)

| Skill | Categoría | Versión | Herramientas | Agentes preferidos |
|---|---|---:|---|---|
| `a2ui_dashboard` | a2ui | 1.0.0 | `a2ui_create_surface`, `a2ui_update_components`, `a2ui_update_data_model`, `a2ui_delete_surface` | — |
| `a2ui_form` | a2ui | 1.0.0 | `a2ui_create_surface`, `a2ui_update_components`, `a2ui_update_data_model`, `a2ui_delete_surface` | — |
| `a2ui_interactive` | a2ui | 1.0.0 | `a2ui_create_surface`, `a2ui_update_components`, `a2ui_update_data_model`, `a2ui_delete_surface` | — |
| `agent_spawner` | agents | 1.1.0 | `get_available_models`, `agent_find`, `agent_create`, `agent_archive` | — |
| `api_client` | api | 1.0.0 | `api_request` | — |
| `artifact_reader` | artifacts | 1.0.0 | `artifact_read`, `artifact_inspect` | — |
| `browser_automate` | web | 1.0.0 | `browser_navigate`, `browser_wait`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_script`, `computer_use_task` | — |
| `browser_scrape` | web | 1.0.0 | `browser_navigate`, `browser_screenshot`, `browser_extract`, `browser_wait` | — |
| `capability_discovery` | core | 1.2.0 | `search_knowledge` | — |
| `cli_pipeline` | cli | 1.0.0 | `cli_exec`, `fs_write` | — |
| `cli_safe_exec` | cli | 1.0.0 | `cli_exec` | — |
| `cron_manager` | cron | 2.0.0 | `cron.create`, `cron.list`, `cron.update`, `cron.delete`, `cron.pause`, `cron.resume`, `cron.trigger`, `cron.history` | — |
| `cron_reminder` | cron | 2.0.0 | `cron.create`, `notify` | — |
| `external_code_agent` | cli | 1.0.0 | `code_agent_run`, `cli_exec` | `external_code_agent` |
| `file_manager` | filesystem | 1.0.0 | `fs_list`, `fs_glob`, `fs_exists` | — |
| `file_read_and_summarize` | filesystem | 1.0.0 | `fs_read`, `fs_exists` | — |
| `file_writer` | filesystem | 1.0.0 | `fs_read`, `fs_write`, `fs_edit`, `fs_exists` | — |
| `google_calendar` | google | 1.0.0 | `gcal_list_events`, `gcal_create_event`, `gcal_update_event`, `gcal_delete_event`, `gcal_freebusy` | `google_calendar_agent` |
| `google_drive` | google | 1.0.0 | `gdrive_search`, `gdrive_download`, `gdrive_upload` | `google_drive_agent` |
| `google_gmail` | google | 1.0.0 | `gmail_search`, `gmail_read`, `gmail_thread`, `gmail_send`, `gmail_reply`, `gmail_forward`, `gmail_draft_save`, `gmail_draft_list`, `gmail_draft_send`, `gmail_draft_delete`, `gmail_modify`, `gmail_labels`, `gmail_attachment_download` | `google_mail_agent` |
| `memory_manager` | agents | 1.0.0 | `memory_write`, `memory_read`, `memory_list`, `memory_search`, `memory_delete` | — |
| `obscura_browser` | web | 1.0.0 | `obscura_navigate`, `obscura_snapshot`, `obscura_markdown`, `obscura_links`, `obscura_interactive_elements`, `obscura_detect_forms`, `obscura_extract`, `obscura_get_attribute`, `obscura_search`, `obscura_click`, `obscura_fill`, `obscura_type`, `obscura_fill_form`, `obscura_press_key`, `obscura_select_option`, `obscura_scroll`, `obscura_wait_for`, `obscura_wait_for_text`, `obscura_evaluate`, `obscura_pdf`, `obscura_get_cookies`, `obscura_set_cookie`, `obscura_storage_state`, `obscura_set_storage_state`, `obscura_tab_new`, `obscura_tab_list`, `obscura_tab_switch`, `obscura_tab_close`, `obscura_close` | `browser_operator` |
| `office_document_manager` | office | 1.0.0 | `office_leer_pdf`, `office_escribir_pdf`, `office_leer_docx`, `office_escribir_docx`, `office_leer_xlsx`, `office_escribir_xlsx`, `office_leer_pptx`, `office_escribir_pptx` | — |
| `research_and_remember` | agents | 1.0.0 | `web_search`, `web_fetch`, `memory_write` | — |
| `software_engineering` | cli | 1.0.0 | `fs_read`, `fs_write`, `fs_edit`, `fs_list`, `fs_glob`, `fs_exists`, `cli_exec` | `software_engineer` |
| `task_orchestrator` | agents | 1.2.0 | `get_available_models`, `task_delegate`, `task_list`, `task_status`, `agent_find`, `agent_create`, `bus_publish`, `bus_read` | — |
| `web_monitor` | web | 1.0.0 | `web_search`, `web_fetch`, `memory_write`, `memory_read` | — |
| `web_research` | web | 1.0.0 | `web_search`, `web_fetch` | — |
| `workspace_file_operator` | filesystem | 1.0.0 | `fs_read`, `fs_write`, `fs_edit`, `fs_delete`, `fs_list`, `fs_glob`, `fs_exists` | `workspace_file_operator` |

## Agentes de catálogo (13)

| ID | Nombre | Propósito | Herramientas autorizadas | Skills |
|---|---|---|---|---|
| `web_researcher` | Investigador web | Investiga preguntas actuales en fuentes web y entrega conclusiones verificables con referencias. | `web_search`, `web_fetch` | `web_research` |
| `browser_operator` | Operador de navegador | Navega sitios, completa formularios y verifica visualmente el estado final de una operación web. | `browser_*`, `obscura_*`, `web_fetch` | `obscura_browser`, `browser_automate`, `browser_scrape` |
| `workspace_file_operator` | Operador de archivos | Crea, lee, edita, organiza y elimina archivos o carpetas dentro del workspace autorizado. | `fs_*` | `workspace_file_operator`, `file_manager` |
| `software_engineer` | Ingeniero de software | Implementa, depura y prueba software dentro de un repositorio o workspace existente. | `fs_*`, `cli_exec` | `software_engineering`, `cli_safe_exec`, `cli_pipeline` |
| `external_code_agent` | Agente de código externo | Delega implementación y refactors a un CLI de código externo (Claude Code, Codex, OpenCode, Kimi) y verifica el resultado. | `code_agent_run`, `fs_read`, `fs_list`, `fs_glob`, `fs_exists`, `cli_exec` | `external_code_agent`, `software_engineering`, `cli_safe_exec` |
| `office_document_agent` | Operador de Office | Lee y genera documentos PDF, Word, Excel y PowerPoint dentro del workspace. | `office_*`, `fs_exists` | `office_document_manager` |
| `a2ui_builder` | Constructor A2UI | Construye formularios, dashboards y flujos interactivos compatibles con A2UI v0.9. | `a2ui_*` | `a2ui_form`, `a2ui_dashboard`, `a2ui_interactive` |
| `schedule_automation_agent` | Operador de cron | Crea y administra jobs programados de Hive: automatizaciones recurrentes o ejecuciones únicas mediante cron.*. | `cron.*` | `cron_manager`, `cron_reminder` |
| `api_operator` | Operador de APIs | Ejecuta y verifica operaciones contra APIs REST expresamente autorizadas. | `api_request` | `api_client` |
| `google_mail_agent` | Operador de Gmail | Busca, lee, responde, envía, organiza y gestiona borradores y adjuntos de la cuenta de Gmail que el usuario conectó. | `gmail_*` | `google_gmail` |
| `google_calendar_agent` | Operador de Google Calendar | Consulta, crea, modifica y cancela eventos y revisa disponibilidad en Google Calendar. | `gcal_*` | `google_calendar` |
| `google_drive_agent` | Operador de Google Drive | Busca, descarga y sube archivos y documentos en Google Drive. | `gdrive_*` | `google_drive` |
| `video_director_agent` | Director de video | Planea y produce reels y videos cortos con Gemini: guion, escenas, personajes con Nano Banana y clips con Omni, en el Estudio de video. | `video_*` |  |

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
| `@johpaz/hive-agents` | `./agent/thread-id` | `./packages/core/src/agent/thread-id.ts` |
| `@johpaz/hive-agents` | `./agent/thread-store` | `./packages/core/src/agent/thread-store.ts` |
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

