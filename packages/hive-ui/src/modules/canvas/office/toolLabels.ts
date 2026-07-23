const FRIENDLY_TOOL_LABELS: Record<string, string> = {
  task_delegate: "Delegando tarea",
  task_status: "Consultando estado",
  task_delegate_code: "Delegando código",
  web_search: "Buscando en la web",
  web_fetch: "Leyendo página web",
  browser_navigate: "Navegando",
  browser_click: "Haciendo clic",
  browser_type: "Escribiendo en la página",
  browser_screenshot: "Tomando captura",
  browser_extract: "Extrayendo datos",
  fs_read: "Leyendo archivo",
  fs_write: "Escribiendo archivo",
  fs_exists: "Verificando archivo",
  exec: "Ejecutando comando",
  search_knowledge: "Buscando herramientas",
  a2ui_create_surface: "Creando interfaz",
  a2ui_update_components: "Actualizando interfaz",
  a2ui_update_data_model: "Actualizando datos",
  memory_write: "Guardando en memoria",
  memory_read: "Leyendo memoria",
  memory_search: "Buscando en memoria",
  save_note: "Guardando nota",
  "cron.create": "Programando tarea",
  notify: "Enviando aviso",
  report_progress: "Reportando avance",
};

export function humanizeTool(name: string | null | undefined): string | null {
  if (!name) return null;
  if (FRIENDLY_TOOL_LABELS[name]) return FRIENDLY_TOOL_LABELS[name];
  const prefix = name.split("__")[0];
  if (prefix && prefix !== name) return `Usando ${prefix}`;
  const spaced = name.replace(/[_.]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
