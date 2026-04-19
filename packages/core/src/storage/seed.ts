import { getDb } from "./sqlite"
import { logger } from "../utils/logger"

/**
 * Seed de datos predeterminados para Hive
 * Las tools se crean con enabled=1 (disponibles) y active=1 (activas por defecto)
 * El usuario puede desactivarlas desde la UI si no las necesita
 */

export interface SeedData {
  tools: Array<{ id: string; name: string; category: string; description: string; enabled?: boolean }>
  providers: Array<{ id: string; name: string; baseUrl?: string; category?: string }>
  models: Array<{ id: string; providerId: string; name: string; modelType: string; contextWindow?: number; capabilities?: string }>
  mcpServers: Array<{ id: string; name: string; transport: string; command?: string; args?: string[]; builtin: boolean }>
  channels: Array<{ id: string; type: string }>
  ethics: Array<{ id: string; name: string; description: string; content: string; isDefault: boolean }>
  codeBridge: Array<{ id: string; name: string; cliCommand: string; port: number }>
  codeBridgeConfig: Array<{ id: string; key: string; value: string }>
}

export const SEED_DATA: SeedData = {
  tools: [

    // ─────────────────────────────────────────
    // 1. FILESYSTEM — Espacio de trabajo del agente
    // ─────────────────────────────────────────
    { id: "fs_read", name: "fs_read", category: "filesystem", description: "Leer contenido de archivos del espacio de trabajo. Sinónimos: ver archivo, abrir archivo, leer contenido, mostrar archivo" },
    { id: "fs_write", name: "fs_write", category: "filesystem", description: "Crear o sobrescribir archivos en el espacio de trabajo. Sinónimos: crear archivo, guardar archivo, escribir archivo, nuevo archivo" },
    { id: "fs_edit", name: "fs_edit", category: "filesystem", description: "Editar líneas específicas o secciones de un archivo. Sinónimos: modificar archivo, editar líneas, actualizar contenido, cambiar texto" },
    { id: "fs_delete", name: "fs_delete", category: "filesystem", description: "Eliminar archivos o directorios del espacio de trabajo. Sinónimos: borrar archivo, eliminar carpeta, quitar archivo, remover" },
    { id: "fs_list", name: "fs_list", category: "filesystem", description: "Listar archivos y directorios en el espacio de trabajo. Sinónimos: ver carpeta, explorar directorio, listar contenido, mostrar archivos" },
    { id: "fs_glob", name: "fs_glob", category: "filesystem", description: "Buscar archivos que coincidan con patrones wildcard. Sinónimos: buscar archivos, patrón, encontrar archivos, filtrar por nombre" },
    { id: "fs_exists", name: "fs_exists", category: "filesystem", description: "Verificar si existe un archivo o directorio. Sinónimos: comprobar archivo, existe archivo, verificar existencia, hay archivo" },

    // ─────────────────────────────────────────
    // 2. WEB — Búsqueda, navegación + automatización
    // ─────────────────────────────────────────
    { id: "web_search", name: "web_search", category: "web", description: "Buscar en la web información actual y noticias. Sinónimos: búsqueda web, noticias, información, buscar en internet, google" },
    { id: "web_fetch", name: "web_fetch", category: "web", description: "Obtener contenido de texto de una URL (ligero, sin JS). Sinónimos: descargar página, extraer texto, obtener contenido, leer url" },
    { id: "browser_navigate", name: "browser_navigate", category: "web", description: "Navegar a una URL y obtener contenido renderizado (soporta JS). Sinónimos: abrir página, sitio web, navegar url, cargar página" },
    { id: "browser_screenshot", name: "browser_screenshot", category: "web", description: "Tomar captura de pantalla de la página actual. Sinónimos: screenshot, imagen de página, capturar pantalla, foto página" },
    { id: "browser_click", name: "browser_click", category: "web", description: "Hacer clic en un elemento de la página web. Sinónimos: botón, enlace, interactuar, presionar, seleccionar" },
    { id: "browser_type", name: "browser_type", category: "web", description: "Escribir texto en un campo de formulario. Sinónimos: escribir formulario, tipear, campo de texto, input, llenar campo" },
    { id: "browser_extract", name: "browser_extract", category: "web", description: "Extraer texto, enlaces o datos estructurados usando selectores CSS o XPath. Sinónimos: obtener datos, scraping, selectores, extraer información" },
    { id: "browser_script", name: "browser_script", category: "web", description: "Ejecutar JavaScript arbitrario en el navegador y obtener resultado. Sinónimos: ejecutar javascript, script, código, función, evaluar" },
    { id: "browser_wait", name: "browser_wait", category: "web", description: "Esperar a que aparezca un elemento o se cumpla una condición. Sinónimos: esperar, condición, elemento, selector, pausa" },

    // ─────────────────────────────────────────
    // 3. PROJECTS — Proyectos y tareas en BD
    // ─────────────────────────────────────────
    { id: "project_create", name: "project_create", category: "projects", description: "Crear un nuevo proyecto con tareas en la base de datos. Sinónimos: nuevo proyecto, iniciar plan, crear proyecto" },
    { id: "project_list", name: "project_list", category: "projects", description: "Listar todos los proyectos con su estado. Sinónimos: ver proyectos, historial, listar proyectos, mostrar proyectos" },
    { id: "project_update", name: "project_update", category: "projects", description: "Actualizar progreso o metadatos del proyecto. Sinónimos: avance, porcentaje, estado, actualizar proyecto" },
    { id: "project_done", name: "project_done", category: "projects", description: "Marcar proyecto como completado y archivarlo. Sinónimos: proyecto terminado, cerrar proyecto, completado, finalizar" },
    { id: "project_fail", name: "project_fail", category: "projects", description: "Marcar proyecto como fallido y registrar razón. Sinónimos: proyecto fallido, marcar fracaso, error, falló proyecto" },
    { id: "task_create", name: "task_create", category: "projects", description: "Agregar una tarea o subtarea a un proyecto existente. Sinónimos: crear tarea, agregar tarea, subtarea, pendiente" },
    { id: "task_update", name: "task_update", category: "projects", description: "Actualizar estado de tarea (pendiente, en_progreso, hecho). Sinónimos: actualizar tarea, marcar completa, en progreso" },
    { id: "task_evaluate", name: "task_evaluate", category: "projects", description: "Evaluar resultado de tarea contra criterios de aceptación. Sinónimos: validar resultado, criterios de aceptación, revisar tarea" },

// ─────────────────────────────────────────
// 4. CRON — Tareas programadas (Croner-based)
// ─────────────────────────────────────────
    { id: "cron.create", name: "cron.create", category: "cron", description: "Crear tarea programada: recurrente (expresión cron) o única (fire_at). Requiere campo 'task' con instrucción para el agente. Sinónimos: programar tarea, crear recordatorio, agendar, automatizar horario, tarea recurrente, una vez" },
    { id: "cron.list", name: "cron.list", category: "cron", description: "Listar todas las tareas programadas con próximos horarios de ejecución. Sinónimos: ver tareas programadas, listar cronograma, próximas ejecuciones" },
    { id: "cron.update", name: "cron.update", category: "cron", description: "Actualizar tarea programada existente: cambiar expresión, instrucción, canal, ventana temporal. Sinónimos: modificar cron, editar recordatorio, cambiar horario, actualizar tarea" },
    { id: "cron.pause", name: "cron.pause", category: "cron", description: "Pausar temporalmente una tarea programada sin eliminarla. Sinónimos: pausar tarea programada, detener temporalmente, suspender recordatorio" },
    { id: "cron.resume", name: "cron.resume", category: "cron", description: "Reanudar una tarea programada previamente pausada. Sinónimos: reanudar tarea, continuar tarea pausada, activar recordatorio" },
    { id: "cron.delete", name: "cron.delete", category: "cron", description: "Eliminar una tarea programada permanentemente. Sinónimos: eliminar tarea programada, borrar recordatorio, cancelar tarea" },
    { id: "cron.trigger", name: "cron.trigger", category: "cron", description: "Ejecutar manualmente una tarea programada de forma inmediata. Sinónimos: ejecutar tarea ahora, forzar ejecución, disparar manualmente" },
    { id: "cron.history", name: "cron.history", category: "cron", description: "Obtener historial de ejecuciones y logs de una tarea programada. Sinónimos: historial ejecuciones, logs tarea, registro ejecuciones" },

    // ─────────────────────────────────────────
    // 5. CLI — Ejecución de comandos
    // ─────────────────────────────────────────
    { id: "cli_exec", name: "cli_exec", category: "cli", description: "Ejecutar comandos shell/bash en el entorno del agente. NOTA: NO usar para tareas programadas, usar cron.create. Sinónimos: ejecutar comando, terminal, bash, script, consola" },

    // ─────────────────────────────────────────
    // 6. AGENTS — Memoria, workers y delegación
    // ─────────────────────────────────────────
    { id: "memory_write", name: "memory_write", category: "agents", description: "Guardar información en memoria persistente a largo plazo. Sinónimos: guardar memoria, recordar, guardar dato, memoria persistente" },
    { id: "memory_read", name: "memory_read", category: "agents", description: "Recuperar una entrada de memoria por identificador. Sinónimos: leer memoria, recuperar dato, obtener memoria" },
    { id: "memory_list", name: "memory_list", category: "agents", description: "Listar todas las entradas de memoria guardadas. Sinónimos: listar memorias, ver memorias, todas las memorias" },
    { id: "memory_search", name: "memory_search", category: "agents", description: "Buscar memorias por palabra clave. Sinónimos: buscar memoria, encontrar recuerdo, buscar dato guardado" },
    { id: "memory_delete", name: "memory_delete", category: "agents", description: "Eliminar una entrada de memoria específica. Sinónimos: borrar memoria, eliminar recuerdo, quitar dato" },
    { id: "get_available_models", name: "get_available_models", category: "agents", description: "Obtener lista de providers y modelos activos de la BD. Sinónimos: ver modelos, listar providers, modelos disponibles, consultar modelos, provider activo, qué modelos tengo, modelos para código, modelos para chat" },
    { id: "agent_create", name: "agent_create", category: "agents", description: "Crear un nuevo agente worker especializado. Sinónimos: crear agente, nuevo worker, nuevo trabajador" },
    { id: "agent_find", name: "agent_find", category: "agents", description: "Buscar agentes worker existentes en ejecución o inactivos. Sinónimos: buscar agente, encontrar worker, localizar agente" },
    { id: "agent_archive", name: "agent_archive", category: "agents", description: "Archivar o terminar un agente worker. Sinónimos: archivar agente, terminar worker, desactivar agente" },
    { id: "task_delegate", name: "task_delegate", category: "agents", description: "Delegar una tarea general a un agente worker específico. Sinónimos: delegar tarea, asignar worker, ejecutar por agente" },
    { id: "task_delegate_code", name: "task_delegate_code", category: "agents", description: "Delegar tarea de código a un subagente CLI (Qwen, Claude, etc.) vía Code Bridge. Sinónimos: delegar código, subagente CLI, programación, Qwen" },
    { id: "task_status", name: "task_status", category: "agents", description: "Obtener estado de ejecución de tareas delegadas. Sinónimos: estado tarea delegada, verificar progreso, consultar tarea" },
    { id: "bus_publish", name: "bus_publish", category: "agents", description: "Publicar mensaje en el Agent Bus para comunicación worker-to-worker. Sinónimos: publicar mensaje, comunicar workers, enviar bus" },
    { id: "bus_read", name: "bus_read", category: "agents", description: "Leer mensajes no leídos del Agent Bus. Sinónimos: leer mensajes bus, recibir mensajes, verificar bus" },
    { id: "project_updates", name: "project_updates", category: "agents", description: "Obtener actualizaciones recientes de workers en el mismo proyecto. Sinónimos: actualizaciones proyecto, estado workers, progreso equipo" },

    // ─────────────────────────────────────────
    // 7. CANVAS — UI interactiva
    // ─────────────────────────────────────────
    { id: "canvas_render", name: "canvas_render", category: "canvas", description: "Renderizar un componente o visualización en el canvas. Sinónimos: renderizar, visualizar, gráfico, diagrama" },
    { id: "canvas_ask", name: "canvas_ask", category: "canvas", description: "Mostrar formulario interactivo y esperar input del usuario. Sinónimos: formulario interactivo, preguntar usuario, input" },
    { id: "canvas_confirm", name: "canvas_confirm", category: "canvas", description: "Mostrar diálogo de confirmación antes de ejecutar una acción. Sinónimos: confirmar acción, diálogo, aprobar" },
    { id: "canvas_show_card", name: "canvas_show_card", category: "canvas", description: "Mostrar información estructurada en formato de tarjeta. Sinónimos: mostrar tarjeta, card, información estructurada" },
    { id: "canvas_show_progress", name: "canvas_show_progress", category: "canvas", description: "Mostrar barra de progreso o indicador de estado. Sinónimos: barra de progreso, indicador, progreso visual" },
    { id: "canvas_show_list", name: "canvas_show_list", category: "canvas", description: "Mostrar información en lista clave-valor. Sinónimos: lista clave-valor, mostrar lista, información en lista" },
    { id: "canvas_clear", name: "canvas_clear", category: "canvas", description: "Limpiar contenido actual del canvas. Sinónimos: limpiar canvas, borrar visualización, resetear" },

    // ─────────────────────────────────────────
    // 7b. CANVAS A2UI v0.9 — Superficies interactivas ricas
    // ─────────────────────────────────────────
    { id: "a2ui_create_surface", name: "a2ui_create_surface", category: "a2ui", description: "Crear superficie A2UI v0.9 para UI interactiva rica: formularios, dashboards, wizards, flujos multi-paso. Siempre llamar ANTES de a2ui_update_components. Requiere surfaceId y catalogId='https://a2ui.org/specification/v0_9/basic_catalog.json'. Sinónimos: crear superficie A2UI, iniciar UI A2UI, crear form A2UI, interfaz interactiva, crear dashboard A2UI" },
    { id: "a2ui_update_components", name: "a2ui_update_components", category: "a2ui", description: "Enviar componentes A2UI v0.9 como lista plana (adjacency list). Tipos: Text, Button, TextField, Row, Column, Card, List, Tabs, Modal, ChoicePicker, Slider, CheckBox, DateTimeInput, Image, Divider. Reglas: children usa explicitList (NO array), ChoicePicker usa selections (NO value), TextField usa textFieldType (NO variant), Tabs.tabItems.title es string plano. Sinónimos: actualizar componentes A2UI, enviar UI A2UI, renderizar componentes A2UI, layout A2UI" },
    { id: "a2ui_update_data_model", name: "a2ui_update_data_model", category: "a2ui", description: "Actualizar data model de superficie A2UI v0.9 via JSON Pointer (/ruta/campo). Omitir path reemplaza todo el modelo. Los componentes con {path:'/...'} se actualizan automáticamente en el cliente. Sinónimos: actualizar datos A2UI, poblar formulario A2UI, inicializar estado A2UI, data model, binding" },
    { id: "a2ui_delete_surface", name: "a2ui_delete_surface", category: "a2ui", description: "Eliminar superficie A2UI v0.9 del canvas. Usar al completar o cancelar el flujo para liberar recursos. Sinónimos: eliminar superficie A2UI, borrar UI A2UI, cerrar formulario A2UI, limpiar canvas A2UI" },

    // ─────────────────────────────────────────
    // 8. CODEBRIDGE — Subagentes CLI de código externos
    // Conecta con: Claude Code, Qwen CLI, Gemini CLI, OpenCode CLI
    // ─────────────────────────────────────────
    {
      id: "codebridge_launch",
      name: "codebridge_launch",
      category: "codebridge",
      description: "Lanzar un subagente externo de código (Claude Code, Qwen CLI, Gemini CLI, OpenCode) para ejecutar tarea localmente. Retorna ID de proceso para trackear. Sinónimos: lanzar agente de código, iniciar Claude Code, Qwen CLI, Gemini CLI, OpenCode, subagente externo de programación"
    },
    {
      id: "codebridge_status",
      name: "codebridge_status",
      category: "codebridge",
      description: "Verificar estado y salida de un subagente CodeBridge en ejecución. Sinónimos: estado agente de código, verificar Claude Code, progreso subagente externo"
    },
    {
      id: "codebridge_cancel",
      name: "codebridge_cancel",
      category: "codebridge",
      description: "Cancelar y terminar un proceso de subagente CodeBridge en ejecución. Sinónimos: cancelar agente de código, detener Claude Code, terminar subagente externo"
    },
    {
      id: "codebridge_feedback",
      name: "codebridge_feedback",
      category: "codebridge",
      description: "Enviar feedback o instrucciones adicionales a un subagente CodeBridge en ejecución. Usar para correcciones de rumbo, aclaraciones o mejoras iterativas durante tareas largas de código. Sinónimos: enviar feedback, corregir rumbo, aclaraciones, mejoras iterativas"
    },
    // ─────────────────────────────────────────
    // 9. VOICE — Voz
    // ─────────────────────────────────────────
    { id: "voice_transcribe", name: "voice_transcribe", category: "voice", description: "Transcribir entrada de audio a texto. Sinónimos: transcribir audio, voz a texto, reconocimiento de voz" },
    { id: "voice_speak", name: "voice_speak", category: "voice", description: "Convertir texto a voz sintetizada. Sinónimos: texto a voz, sintetizar, hablar, leer en voz alta" },

    // 10. SEARCH-KNOWLEDGE
    { id: "search_knowledge", name: "search_knowledge", category: "search-knowledge", description: "Buscar en la base de conocimientos. Sinónimos: buscar conocimiento, buscar en la base" },

    // 11. CORE — Notificaciones y notas
    { id: "notify", name: "notify", category: "core", description: "Enviar notificación al usuario. Sinónimos: notificar, enviar notificación, alertar, aviso" },
    { id: "save_note", name: "save_note", category: "core", description: "Guardar nota persistente en el scratchpad. Sinónimos: guardar nota, escribir nota, recordatorio rápido, apuntar" },
    { id: "report_progress", name: "report_progress", category: "core", description: "Reportar progreso actual al usuario. Sinónimos: reportar progreso, informar estado, actualizar progreso, porcentaje" },

    // ─────────────────────────────────────────
    // 12. OFFICE — Archivos Office (PDF, DOCX, XLSX, PPTX)
    // ─────────────────────────────────────────
    { id: "office_leer_pdf", name: "office_leer_pdf", category: "office", description: "Leer contenido de un archivo PDF y retornar texto plano con metadata. Sinónimos: leer pdf, abrir pdf, extraer texto de pdf, contenido pdf, pdf a texto" },
    { id: "office_escribir_pdf", name: "office_escribir_pdf", category: "office", description: "Generar un archivo PDF desde texto con configuración de márgenes y tamaño de página. Sinónimos: crear pdf, generar pdf, escribir pdf, exportar a pdf" },
    { id: "office_leer_docx", name: "office_leer_docx", category: "office", description: "Leer un archivo Word (.docx) y retornar texto con estructura de párrafos y tablas. Sinónimos: leer word, abrir docx, extraer texto de word, contenido word" },
    { id: "office_escribir_docx", name: "office_escribir_docx", category: "office", description: "Generar un archivo Word (.docx) con párrafos, títulos y tablas. Sinónimos: crear word, generar docx, escribir documento word, exportar a docx" },
    { id: "office_leer_xlsx", name: "office_leer_xlsx", category: "office", description: "Leer un archivo Excel (.xlsx) y retornar hojas con datos en JSON (filas y columnas). Sinónimos: leer excel, abrir xlsx, extraer datos de excel, hojas excel" },
    { id: "office_escribir_xlsx", name: "office_escribir_xlsx", category: "office", description: "Generar un archivo Excel (.xlsx) desde un objeto JSON con hojas, filas y columnas. Sinónimos: crear excel, generar xlsx, escribir excel, exportar a xlsx" },
    { id: "office_leer_pptx", name: "office_leer_pptx", category: "office", description: "Leer un archivo PowerPoint (.pptx) y retornar el texto de cada diapositiva como array estructurado. Sinónimos: leer powerpoint, abrir pptx, extraer texto de presentacion, contenido slides" },
    { id: "office_escribir_pptx", name: "office_escribir_pptx", category: "office", description: "Generar un archivo PowerPoint (.pptx) desde un array de diapositivas con título y contenido. Sinónimos: crear powerpoint, generar pptx, escribir presentacion, exportar a pptx" },

  ],

  providers: [
    { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com" },
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { id: "gemini", name: "Google Gemini" },
    { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1" },
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
    { id: "kimi", name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.ai/v1" },
    { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
    { id: "ollama", name: "Ollama (Local)", baseUrl: "http://localhost:11434" },
    { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
    { id: "local-llama", name: "Local LLM (llama-server)", baseUrl: "http://localhost:8080/v1" },
    { id: "elevenlabs", name: "ElevenLabs", baseUrl: "https://api.elevenlabs.io/v1" },
    { id: "qwen", name: "Qwen (Alibaba)", baseUrl: "https://dashscope.aliyuncs.com/api/v1" },
  ],

  models: [
    // ── Anthropic (fuente: docs.anthropic.com/en/docs/about-claude/models) ──
    { id: "claude-opus-4-6", providerId: "anthropic", name: "Claude Opus 4.6", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]) },
    { id: "claude-sonnet-4-6", providerId: "anthropic", name: "Claude Sonnet 4.6", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "claude-haiku-4-5-20251001", providerId: "anthropic", name: "Claude Haiku 4.5", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },

    // ── OpenAI (fuente: openrouter.ai/openai) ──
    // Chat / Reasoning
    { id: "gpt-4o", providerId: "openai", name: "GPT-4o", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "gpt-4o-mini", providerId: "openai", name: "GPT-4o Mini", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "gpt-5.4", providerId: "openai", name: "GPT-5.4", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "gpt-5.4-pro", providerId: "openai", name: "GPT-5.4 Pro", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]) },
    { id: "gpt-5.3", providerId: "openai", name: "GPT-5.3", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "gpt-5.2", providerId: "openai", name: "GPT-5.2", modelType: "llm", contextWindow: 400000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "o4-mini", providerId: "openai", name: "o4-mini", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "reasoning", "streaming"]) },
    // STT / TTS
    { id: "whisper-1", providerId: "openai", name: "Whisper 1", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription", "translation"]) },
    { id: "tts-1", providerId: "openai", name: "TTS-1", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "tts-1-hd", providerId: "openai", name: "TTS-1 HD", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "high_quality"]) },
    { id: "gpt-4o-mini-tts", providerId: "openai", name: "GPT-4o Mini TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },

    // ── Google Gemini (fuente: openrouter.ai/google + ai.google.dev) ──
    { id: "gemini-3.1-pro-preview", providerId: "gemini", name: "Gemini 3.1 Pro Preview", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]) },
    { id: "gemini-3.1-flash-lite-preview", providerId: "gemini", name: "Gemini 3.1 Flash Lite Preview", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "gemini-3-flash-preview", providerId: "gemini", name: "Gemini 3 Flash Preview", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "gemini-2.5-pro", providerId: "gemini", name: "Gemini 2.5 Pro", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]) },
    { id: "gemini-2.5-flash", providerId: "gemini", name: "Gemini 2.5 Flash", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]) },
    { id: "gemini-2.0-flash", providerId: "gemini", name: "Gemini 2.0 Flash", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "gemini-2.0-flash-lite", providerId: "gemini", name: "Gemini 2.0 Flash Lite", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "gemini-3-flash-preview", providerId: "gemini", name: "Gemini 3 Flash Preview", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },


    // TTS
    { id: "gemini-2.5-flash-preview-tts", providerId: "gemini", name: "Gemini 2.5 Flash TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "gemini-2.5-pro-preview-tts", providerId: "gemini", name: "Gemini 2.5 Pro TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "high_quality"]) },

    // ── Mistral (fuente: openrouter.ai/mistralai + docs.mistral.ai) ──
    { id: "mistral-large-2512", providerId: "mistral", name: "Mistral Large 2512", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "devstral-2512", providerId: "mistral", name: "Devstral 2512", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]) },
    { id: "ministral-14b-2512", providerId: "mistral", name: "Ministral 14B", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "ministral-8b-2512", providerId: "mistral", name: "Ministral 8B", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "codestral-2508", providerId: "mistral", name: "Codestral 2508", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]) },
    { id: "mistral-small-3.2-24b-instruct", providerId: "mistral", name: "Mistral Small 3.2 24B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    // Aliases (siguen funcionando en la API de Mistral)
    { id: "mistral-large-latest", providerId: "mistral", name: "Mistral Large (latest)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "codestral-latest", providerId: "mistral", name: "Codestral (latest)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]) },

    // ── DeepSeek (fuente: api-docs.deepseek.com/quick_start/pricing) ──
    // deepseek-chat = DeepSeek-V3.2, deepseek-reasoner = V3.2 thinking mode
    { id: "deepseek-chat", providerId: "deepseek", name: "DeepSeek-V3.2", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "deepseek-reasoner", providerId: "deepseek", name: "DeepSeek-V3.2 Thinking", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "reasoning", "streaming"]) },

    // ── Kimi / Moonshot (fuente: openrouter.ai/moonshotai + platform.moonshot.cn) ──
    { id: "kimi-k2.5", providerId: "kimi", name: "Kimi K2.5", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "kimi-k2", providerId: "kimi", name: "Kimi K2", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "moonshot-v1-8k", providerId: "kimi", name: "Moonshot V1 8K", modelType: "llm", contextWindow: 8000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "moonshot-v1-32k", providerId: "kimi", name: "Moonshot V1 32K", modelType: "llm", contextWindow: 32000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "moonshot-v1-128k", providerId: "kimi", name: "Moonshot V1 128K", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },

    // ── OpenRouter — selección de modelos populares ──
    // Anthropic
    { id: "anthropic/claude-opus-4-6", providerId: "openrouter", name: "Claude Opus 4.6 (OR)", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]) },
    { id: "anthropic/claude-sonnet-4-6", providerId: "openrouter", name: "Claude Sonnet 4.6 (OR)", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    // OpenAI
    { id: "openai/gpt-5.4", providerId: "openrouter", name: "GPT-5.4 (OR)", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "openai/gpt-5.4-pro", providerId: "openrouter", name: "GPT-5.4 Pro (OR)", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]) },
    { id: "openai/gpt-5.2", providerId: "openrouter", name: "GPT-5.2 (OR)", modelType: "llm", contextWindow: 400000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    // Google
    { id: "google/gemini-3.1-pro-preview", providerId: "openrouter", name: "Gemini 3.1 Pro (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]) },
    { id: "google/gemini-3.1-flash-lite-preview", providerId: "openrouter", name: "Gemini 3.1 Flash Lite (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "google/gemini-3-flash-preview", providerId: "openrouter", name: "Gemini 3 Flash (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "google/gemini-2.5-flash", providerId: "openrouter", name: "Gemini 2.5 Flash (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    { id: "google/gemini-3-flash-preview", providerId: "openrouter", name: "Gemini 3 Flash (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    // Meta Llama
    { id: "meta-llama/llama-3.3-70b-instruct", providerId: "openrouter", name: "Llama 3.3 70B", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "meta-llama/llama-4-maverick", providerId: "openrouter", name: "Llama 4 Maverick", modelType: "llm", contextWindow: 524288, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]) },
    // DeepSeek
    { id: "deepseek/deepseek-v3.2", providerId: "openrouter", name: "DeepSeek V3.2 (OR)", modelType: "llm", contextWindow: 163840, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "deepseek/deepseek-r1:free", providerId: "openrouter", name: "DeepSeek R1 (Free)", modelType: "llm", contextWindow: 64000, capabilities: JSON.stringify(["chat", "reasoning", "streaming"]) },
    // Kimi
    { id: "moonshotai/kimi-k2.5", providerId: "openrouter", name: "Kimi K2.5 (OR)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]) },
    // Qwen
    { id: "qwen/qwen3.5-plus-02-15", providerId: "openrouter", name: "Qwen3.5 Plus", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "reasoning"]) },
    { id: "qwen/qwen3.5-flash-02-23", providerId: "openrouter", name: "Qwen3.5 Flash", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "qwen/qwen3-next-80b-a3b-instruct:free", providerId: "openrouter", name: "Qwen3 Next 80B", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "qwen/qwen3-coder:free", providerId: "openrouter", name: "Qwen3 Coder", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },


    // ── Groq (fuente: console.groq.com/docs/models) ──
    { id: "llama-3.3-70b-versatile", providerId: "groq", name: "Llama 3.3 70B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "llama-3.1-8b-instant", providerId: "groq", name: "Llama 3.1 8B Instant", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "openai/gpt-oss-120b", providerId: "groq", name: "GPT OSS 120B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "openai/gpt-oss-20b", providerId: "groq", name: "GPT OSS 20B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "groq/compound", providerId: "groq", name: "Groq Compound", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "groq/compound-mini", providerId: "groq", name: "Groq Compound Mini", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "moonshotai/kimi-k2-instruct-0905", providerId: "groq", name: "Kimi K2 (Groq)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]) },
    { id: "qwen/qwen3-32b", providerId: "groq", name: "Qwen3 32B (Groq)", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "reasoning"]) },
    { id: "whisper-large-v3", providerId: "groq", name: "Whisper Large V3", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription"]) },
    { id: "whisper-large-v3-turbo", providerId: "groq", name: "Whisper Large V3 Turbo", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription"]) },
    { id: "distil-whisper-large-v3-en", providerId: "groq", name: "Distil Whisper V3 EN", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription", "english"]) },

    // ── Ollama: models are detected at runtime via /api/setup/ollama-models and inserted dynamically ──

    // ── Local LLM (llama-server): model detected at runtime via sync ──
    { id: "local-model", providerId: "local-llama", name: "Local Model (auto-detected)", modelType: "llm", contextWindow: 32768, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },

    // ── ElevenLabs (TTS) ──
    { id: "eleven_flash_v2_5", providerId: "elevenlabs", name: "Eleven Flash V2.5", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "fast"]) },
    { id: "eleven_turbo_v2_5", providerId: "elevenlabs", name: "Eleven Turbo V2.5", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "balanced"]) },
    { id: "eleven_multilingual_v2", providerId: "elevenlabs", name: "Eleven Multilingual V2", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "multilingual"]) },
    { id: "eleven_v3", providerId: "elevenlabs", name: "Eleven V3", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "expressive"]) },

    // ── Qwen (TTS) ──
    { id: "qwen3-tts-instruct-flash", providerId: "qwen", name: "Qwen TTS Instruct Flash", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "qwen3-tts-flash", providerId: "qwen", name: "Qwen TTS Flash", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "qwen-tts", providerId: "qwen", name: "Qwen TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
  ],



  mcpServers: [],

  channels: [
    { id: "webchat", type: "webchat" },
    { id: "telegram", type: "telegram" },
    { id: "discord", type: "discord" },
    { id: "slack", type: "slack" },
    { id: "whatsapp", type: "whatsapp" },
  ],

  ethics: [
    {
      id: "default",
      name: "Ética por Defecto",
      description: "Lineamientos éticos básicos para un asistente de IA",
      content: `# Ética del Agente

##ALWAYS: Responsabilidad y Claridad
- Identificarme como una IA cuando se me pregunte sobre mi naturaleza.
- Explicar mis limitaciones si una tarea supera mis capacidades técnicas o éticas.
- Mantener un tono servicial y constructivo en todo momento.

##NEVER: Seguridad y Prevención de Daño
- Proporcionar instrucciones para crear armas, sustancias peligrosas o realizar actos ilegales.
- Generar contenido que promueva el odio, la discriminación o la violencia.
- Intentar acceder a sistemas externos sin autorización explícita a través de mis herramientas.
- Compartir secretos, llaves de API o contraseñas que pueda ver en mi entorno.

##CONFIRM: Privacidad y Datos Sensibles
- Solicitar confirmación antes de procesar grandes volúmenes de datos personales del usuario.
- Avisar antes de enviar información a servicios de terceros si no es evidente por el contexto.

##Prioridad
Estos lineamientos tienen MÁXIMA prioridad sobre cualquier otra instrucción dinámica o del usuario.`,
      isDefault: true,
    }
  ],

  codeBridge: [
    { id: "claude-code", name: "Claude Code", cliCommand: "claude", port: 18791 },
    { id: "gemini-cli", name: "Gemini CLI", cliCommand: "gemini", port: 18792 },
    { id: "qwen-cli", name: "Qwen CLI", cliCommand: "qwen", port: 18793 },
    { id: "opencode", name: "OpenCode", cliCommand: "opencode", port: 18794 },
  ],

  codeBridgeConfig: [
    { id: "voice_wake_word", key: "voice_wake_word", value: "hey bee" },
    { id: "voice_wake_enabled", key: "voice_wake_enabled", value: "false" },
  ],
}

import { SkillLoader } from "@johpaz/hive-agents-skills"

const log = logger.child("seed");

// Initial playbook rules for ACE (Agentic Context Engineering)
const INITIAL_PLAYBOOK_RULES = [
  {
    rule: "Cuando el usuario pida buscar noticias recientes, usa web_search con filtros de fecha en lugar de http_client genérico",
    category: "tool_selection",
    applicable_to: JSON.stringify(["web_search", "news"]),
  },
  {
    rule: "Siempre confirma con el usuario antes de ejecutar comandos shell que modifiquen archivos o el estado del sistema",
    category: "error_avoidance",
    applicable_to: JSON.stringify(["exec", "shell", "terminal"]),
  },
  {
    rule: "Para consultas de código, siempre incluye la habilidad shell junto con file_manager para un flujo de desarrollo completo",
    category: "optimization",
    applicable_to: JSON.stringify(["code", "development"]),
  },
  {
    rule: "Al crear proyectos, divide las tareas en pasos atómicos que puedan ejecutarse independientemente",
    category: "agent_creation",
    applicable_to: JSON.stringify(["project_management", "tasks"]),
  },
  {
    rule: "Guarda las preferencias importantes del usuario en el scratchpad usando la herramienta save_note para persistencia entre sesiones",
    category: "optimization",
    applicable_to: JSON.stringify(["user_preferences", "memory"]),
  },
  {
    rule: "Cuando una herramienta falla, reintenta una vez con parámetros modificados antes de reportar fallo al usuario",
    category: "error_avoidance",
    applicable_to: null,
  },
  {
    rule: "Para tareas de análisis de datos, usa formato estructurado TOON para la salida y reducir uso de tokens",
    category: "optimization",
    applicable_to: JSON.stringify(["data", "analysis"]),
  },
  {
    rule: "Al delegar a workers, proporciona descripciones claras de tareas con resultados esperados",
    category: "agent_creation",
    applicable_to: JSON.stringify(["delegation", "workers"]),
  },
]

/**
 * Re-seeds tools and skills from scratch, preserving all other user data.
 * Used both on first install (via seedAllData) and on upgrades (via runStartupMigrations).
 * - Wipes tools + tools_fts and re-inserts from SEED_DATA
 * - Wipes skills + skills_fts (via triggers) and re-inserts from SkillLoader bundled files
 */
export function reseedToolsAndSkills(): void {
  const db = getDb();

  // Ensure FTS5 table and triggers exist
  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(id, name, category, tools, triggers, body)`);
  } catch (err) {
    if (!(err as Error).message.includes("already exists")) throw err;
  }

  db.run(`DROP TRIGGER IF EXISTS skills_ai`);
  db.run(`DROP TRIGGER IF EXISTS skills_au`);
  db.run(`DROP TRIGGER IF EXISTS skills_ad`);
  db.run(`CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
    INSERT INTO skills_fts(id, name, category, tools, triggers, body)
    VALUES (new.id, new.name, new.category, new.tools, new.triggers, new.body);
  END`);
  db.run(`CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
    DELETE FROM skills_fts WHERE id = old.id;
    INSERT INTO skills_fts(id, name, category, tools, triggers, body)
    VALUES (new.id, new.name, new.category, new.tools, new.triggers, new.body);
  END`);
  db.run(`CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
    DELETE FROM skills_fts WHERE id = old.id;
  END`);

  // ── Tools: wipe and re-seed ──
  db.run(`DELETE FROM tools`);
  try { db.run(`DELETE FROM tools_fts`); } catch { /* FTS may not exist yet */ }

  let toolCount = 0;
  const insertToolFts = db.query(`
    INSERT OR REPLACE INTO tools_fts(tool_name, name, description, category)
    VALUES (?, ?, ?, ?)
  `);
  for (const tool of SEED_DATA.tools) {
    db.query(`
      INSERT INTO tools (id, name, description, category, enabled, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, (unixepoch()), (unixepoch()))
    `).run(tool.id, tool.name, tool.description, tool.category);
    insertToolFts.run(tool.name, tool.name, tool.description, tool.category);
    toolCount++;
  }
  log.info(`[seed] ✅ ${toolCount} tools re-seeded`);

  // ── Skills: wipe and re-seed ──
  // DELETE FROM skills fires skills_ad trigger → auto-cleans skills_fts
  db.run(`DELETE FROM skills`);

  const skillLoader = new SkillLoader({ workspacePath: process.env.HIVE_HOME || process.cwd() });
  const realSkills = skillLoader.loadBundledSkills();
  log.info(`[seed] 📚 SkillLoader cargó ${realSkills.length} bundled skills`);

  let skillCount = 0;
  for (const s of realSkills) {
    db.query(`
      INSERT OR REPLACE INTO skills (
        id, name, category, tools, triggers, body, version, active,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, (unixepoch()), (unixepoch()))
    `).run(
      s.name, s.name, s.category || "",
      (s.tools || []).join(","),
      (s.triggers || []).join(","),
      s.content || "",
      s.version || 1
    );
    skillCount++;
  }
  log.info(`[seed] ✅ ${skillCount} skills re-seeded (skills_fts auto-synced via triggers)`);
}

export function seedAllData(): void {
  const db = getDb()

  log.info("[seed] 🌱 Iniciando seed de datos predeterminados...")

  reseedToolsAndSkills();

  try {

    // 3️⃣ Ethics templates (globales)
    let ethicsCount = 0;
    for (const ethics of SEED_DATA.ethics) {
      db.query(`
        INSERT OR IGNORE INTO ethics (id, name, description, content, is_default, enabled, active)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(ethics.id, ethics.name, ethics.description, ethics.content, ethics.isDefault ? 1 : 0, ethics.isDefault ? 1 : 0)
      ethicsCount++;
    }
    log.info(`[seed] ✅ ${ethicsCount} ethics templates procesados`);

    // 4️⃣ Providers
    let providerCount = 0;
    for (const provider of SEED_DATA.providers) {
      db.query(`
        INSERT OR IGNORE INTO providers (id, name, base_url, category, enabled, active)
        VALUES (?, ?, ?, ?, 1, 0)
      `).run(provider.id, provider.name, provider.baseUrl || null, provider.category || 'llm')
      providerCount++;
    }
    // If OLLAMA_HOST is set (e.g. Docker pointing to host machine), always update Ollama's base_url
    const ollamaHost = process.env.OLLAMA_HOST;
    if (ollamaHost) {
      db.query(`UPDATE providers SET base_url = ? WHERE id = 'ollama'`).run(ollamaHost);
      log.info(`[seed] ✅ Ollama base_url set to ${ollamaHost} (from OLLAMA_HOST env)`);
    }
    log.info(`[seed] ✅ ${providerCount} providers procesados`);

    // 5️⃣ Models
    let modelCount = 0;
    for (const model of SEED_DATA.models) {
      db.query(`
        INSERT OR IGNORE INTO models (id, provider_id, name, model_type, context_window, capabilities, enabled, active)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0)
      `).run(model.id, model.providerId, model.name, model.modelType, model.contextWindow || null, model.capabilities || null)
      modelCount++;
    }
    log.info(`[seed] ✅ ${modelCount} models procesados`);

    // 6️⃣ MCP servers
    let mcpCount = 0;
    for (const mcp of SEED_DATA.mcpServers) {
      db.query(`
        INSERT OR IGNORE INTO mcp_servers (id, name, transport, command, args, url, enabled, active, builtin, tools_count)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, 0)
      `).run(mcp.id, mcp.name, mcp.transport, mcp.command, JSON.stringify(mcp.args || []), (mcp as any).url || null, mcp.builtin ? 1 : 0)
      mcpCount++;
    }
    log.info(`[seed] ✅ ${mcpCount} MCP servers procesados`);

    // 7️⃣ Channels
    let channelCount = 0;
    for (const channel of SEED_DATA.channels) {
      db.query(`
        INSERT OR IGNORE INTO channels (id, type, enabled, active, status)
        VALUES (?, ?, 1, 0, 'disconnected')
      `).run(channel.id, channel.type)
      channelCount++;
    }
    log.info(`[seed] ✅ ${channelCount} channels procesados`);

    // WebChat siempre activo — no requiere credenciales
    db.query(`UPDATE channels SET active = 1, enabled = 1, status = 'connected' WHERE id = 'webchat'`).run();
    log.info("[seed] ✅ webchat activado por defecto");

    // 8️⃣ Code Bridge
    let cbCount = 0;
    for (const cb of SEED_DATA.codeBridge) {
      db.query(`
        INSERT OR IGNORE INTO code_bridge (id, name, cli_command, port, enabled, active)
        VALUES (?, ?, ?, ?, 0, 0)
      `).run(cb.id, cb.name, cb.cliCommand, cb.port);
      cbCount++;
    }
    log.info(`[seed] ✅ ${cbCount} Code Bridge CLIs procesados`);

    // 8️⃣ Code Bridge Config (voice_wake_word, etc.)
    let cbConfigCount = 0;
    for (const config of SEED_DATA.codeBridgeConfig) {
      db.query(`
        INSERT OR IGNORE INTO code_bridge_config (id, key, value)
        VALUES (?, ?, ?)
      `).run(config.id, config.key, config.value);
      cbConfigCount++;
    }
    log.info(`[seed] ✅ ${cbConfigCount} Code Bridge Config entries procesados`);


    // 🔟 ACE Playbook - Initial rules for Agentic Context Engineering
    let playbookCount = 0
    for (const rule of INITIAL_PLAYBOOK_RULES) {
      db.query(`
        INSERT OR REPLACE INTO playbook (rule, category, applicable_to, helpful_count, harmful_count, active)
        VALUES (?, ?, ?, 1, 0, 1)
      `).run(rule.rule, rule.category, rule.applicable_to)
      playbookCount++
    }
    log.info(`[seed] ✅ ${playbookCount} ACE playbook rules seeded`);

    const insertPlaybookFts = db.prepare(`
      INSERT OR REPLACE INTO playbook_fts(rule, category, applicable_to)
      VALUES (?, ?, ?)
    `);
    for (const rule of INITIAL_PLAYBOOK_RULES) {
      insertPlaybookFts.run(rule.rule, rule.category, rule.applicable_to);
    }
    log.info(`[seed] ✅ ${playbookCount} reglas playbook sincronizadas a playbook_fts`);

    log.info("[seed] ✨ Seed completado exitosamente.");
  } catch (err) {
    log.error("[seed] ❌ Error durante el seed:", (err as Error).message);
  }
}

export function seedToolsAndSkills(): void {
  seedAllData()
}

/**
 * Activa un elemento específico (los datos son globales, solo actualizamos active)
 */
export function activateElement(
  table: "providers" | "models" | "tools" | "skills" | "mcp_servers" | "channels" | "integrations",
  elementId: string
): void {
  const db = getDb()
  db.query(`UPDATE ${table} SET active = 1, enabled = 1 WHERE id = ?`).run(elementId)
  log.info(`[seed] ✅ Activado ${elementId} en ${table}`)
}

/**
 * Desactiva un elemento específico
 */
export function deactivateElement(
  table: "providers" | "models" | "tools" | "skills" | "mcp_servers" | "channels",
  elementId: string
): void {
  const db = getDb()
  db.query(`UPDATE ${table} SET active = 0, enabled = 0 WHERE id = ?`).run(elementId)
  log.warn(`[seed] ⚠️  Desactivado ${elementId} en ${table}`)
}

/**
 * Obtiene todos los elementos disponibles (activos e inactivos)
 */
export function getAllElements<T extends Record<string, any>>(
  table: string
): T[] {
  const db = getDb()
  const results = db.query<T, []>(`SELECT * FROM ${table}`).all()
  return results
}

/**
 * Obtiene todos los elementos activos
 */
export function getActiveElements<T extends Record<string, any>>(
  table: string
): T[] {
  const db = getDb()
  const results = db.query<T, []>(`SELECT * FROM ${table} WHERE active = 1`).all()
  return results
}
