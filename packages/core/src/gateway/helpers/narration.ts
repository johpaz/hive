// ─── Tool narration map ───────────────────────────────────────────────────────
// Maps tool name prefixes/exact names to human-readable Spanish narrations.
// Shown to the user while the agent executes a tool.
export const TOOL_NARRATIONS: Record<string, string> = {
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
  // Projects
  project_create: "Creando proyecto...",
  project_update: "Actualizando proyecto...",
  project_done: "Marcando proyecto como completado...",
  project_fail: "Registrando falla en el proyecto...",
  task_create: "Creando tarea...",
  task_update: "Actualizando tarea...",
  // Agents
  create_agent: "Creando agente worker...",
  find_agent: "Buscando agente disponible...",
  archive_agent: "Archivando agente...",
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
  // Canvas
  canvas_add_node: "Actualizando canvas...",
  canvas_update: "Actualizando canvas...",
  // Code Bridge
  bridge_send: "Enviando tarea al CLI...",
  bridge_exec: "Ejecutando en el Code Bridge...",
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
