// ─── Tool narration map ───────────────────────────────────────────────────────
// Maps tool name prefixes/exact names to human-readable Spanish narrations.
// Shown to the user while the agent executes a tool.
const TOOL_NARRATIONS: Record<string, string> = {
  // Web
  web_search: "Buscando en la web...",
  web_fetch: "Leyendo página web...",
  // Files
  read: "Leyendo archivo...",
  write: "Escribiendo archivo...",
  edit: "Editando archivo...",
  exec: "Ejecutando comando...",
  // Cron
  "cron.create": "Programando tarea...",
  "cron.list": "Consultando tareas programadas...",
  "cron.update": "Actualizando tarea programada...",
  "cron.delete": "Eliminando tarea programada...",
  "cron.pause": "Pausando tarea programada...",
  "cron.resume": "Reanudando tarea programada...",
  "cron.trigger": "Ejecutando tarea ahora...",
  "cron.history": "Consultando historial...",
  // Agents
  agent_create: "Creando agente worker...",
  agent_find: "Buscando agente disponible...",
  agent_archive: "Archivando agente...",
  get_available_models: "Consultando modelos disponibles...",
  task_delegate: "Delegando tarea a un agente...",
  task_list: "Listando tareas en ejecución...",
  task_status: "Consultando estado de la tarea...",
  bus_publish: "Coordinando con otro agente...",
  bus_read: "Leyendo mensajes de los agentes...",
  // Discovery
  search_knowledge: "Buscando capacidades disponibles...",
  // Memory
  save_note: "Guardando nota...",
  memory_write: "Guardando en memoria...",
  memory_read: "Leyendo memoria...",
  memory_search: "Buscando en memoria...",
  memory_delete: "Eliminando de memoria...",
  memory_list: "Listando notas...",
  // Browser
  browser_navigate: "Navegando a la página...",
  browser_click: "Haciendo clic...",
  browser_type: "Escribiendo en la página...",
  browser_screenshot: "Tomando captura de pantalla...",
  browser_extract: "Extrayendo información de la página...",
  // Artefactos
  artifact_inspect: "Verificando el archivo generado...",
  artifact_read: "Leyendo el resultado completo...",
  // Canvas
  canvas_add_node: "Actualizando canvas...",
  canvas_update: "Actualizando canvas...",
  // Notify
  notify: "Enviando notificación...",
  report_progress: "Reportando progreso...",
}

export function getNarration(toolName: string): string {
  if (TOOL_NARRATIONS[toolName]) return TOOL_NARRATIONS[toolName]
  // Prefix matching for MCP tools like "github__create_pr" → "Ejecutando github..."
  const prefix = toolName.split("__")[0]
  if (prefix && prefix !== toolName) return `Ejecutando ${prefix}...`
  // Fallback
  return `Ejecutando ${toolName.replace(/_/g, " ")}...`
}
