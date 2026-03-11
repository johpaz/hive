import { getDb } from "./sqlite"
import { logger } from "../utils/logger"

/**
 * Seed de datos predeterminados para Hive
 * Todos los elementos se crean con enabled=1 (disponibles) pero active=0 (no activados)
 * El usuario los activa durante el onboarding o desde la UI
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

const SEED_DATA: SeedData = {
  tools: [

    // ─────────────────────────────────────────
    // 1. FILESYSTEM — Espacio de trabajo del agente
    // ─────────────────────────────────────────
    { id: "fs_read", name: "fs_read", category: "filesystem", description: "Read file content from agent workspace. Spanish: leer archivo, ver contenido, abrir archivo" },
    { id: "fs_write", name: "fs_write", category: "filesystem", description: "Create or overwrite file in agent workspace. Spanish: crear archivo, guardar archivo, escribir archivo" },
    { id: "fs_edit", name: "fs_edit", category: "filesystem", description: "Edit specific lines or sections of a file. Spanish: editar archivo, modificar líneas, actualizar contenido" },
    { id: "fs_delete", name: "fs_delete", category: "filesystem", description: "Delete file or directory from workspace. Spanish: eliminar archivo, borrar archivo, borrar carpeta" },
    { id: "fs_list", name: "fs_list", category: "filesystem", description: "List files and directories in workspace. Spanish: listar archivos, ver carpeta, explorar directorio" },
    { id: "fs_glob", name: "fs_glob", category: "filesystem", description: "Find files matching wildcard patterns. Spanish: buscar archivos, patrón, encontrar archivos" },
    { id: "fs_exists", name: "fs_exists", category: "filesystem", description: "Check if a file or directory exists. Spanish: verificar archivo, comprobar, existe archivo" },

    // ─────────────────────────────────────────
    // 2. WEB — Búsqueda, navegación + automatización
    // ─────────────────────────────────────────
    { id: "web_search", name: "web_search", category: "web", description: "Search the web for current information and research. Spanish: buscar en internet, búsqueda web, noticias, información" },
    { id: "web_fetch", name: "web_fetch", category: "web", description: "Fetch plain content from a URL (lightweight, no JS). Spanish: obtener página, descargar contenido, extraer texto de url" },
    { id: "browser_navigate", name: "browser_navigate", category: "web", description: "Navigate browser to URL, get rendered page content (supports JS). Spanish: navegar a url, abrir página, sitio web" },
    { id: "browser_screenshot", name: "browser_screenshot", category: "web", description: "Take screenshot of current browser page. Spanish: captura de pantalla, screenshot, imagen de página" },
    { id: "browser_click", name: "browser_click", category: "web", description: "Click on a web page element. Spanish: hacer clic, botón, enlace, interactuar" },
    { id: "browser_type", name: "browser_type", category: "web", description: "Type text into a form field in the browser. Spanish: escribir formulario, tipear, campo de texto, input" },

    // ─────────────────────────────────────────
    // 3. PROJECTS — Proyectos y tareas en BD
    // ─────────────────────────────────────────
    { id: "project_create", name: "project_create", category: "projects", description: "Create a new project with tasks in the database. Spanish: crear proyecto, nuevo proyecto, iniciar plan" },
    { id: "project_list", name: "project_list", category: "projects", description: "List all projects with their status. Spanish: listar proyectos, ver proyectos, historial" },
    { id: "project_update", name: "project_update", category: "projects", description: "Update project progress or metadata. Spanish: actualizar proyecto, avance, porcentaje, estado" },
    { id: "project_done", name: "project_done", category: "projects", description: "Mark project as completed and archive it. Spanish: proyecto terminado, cerrar proyecto, completado" },
    { id: "project_fail", name: "project_fail", category: "projects", description: "Mark project as failed and record reason. Spanish: proyecto fallido, marcar fracaso, error" },
    { id: "task_create", name: "task_create", category: "projects", description: "Add a task or subtask to an existing project. Spanish: crear tarea, agregar tarea, subtarea, pendiente" },
    { id: "task_update", name: "task_update", category: "projects", description: "Update task status (pending, in_progress, done). Spanish: actualizar tarea, marcar completa, en progreso" },
    { id: "task_evaluate", name: "task_evaluate", category: "projects", description: "Evaluate task result against acceptance criteria. Spanish: evaluar tarea, validar resultado, criterios de aceptación" },

    // ─────────────────────────────────────────
    // 4. CRON — Tareas programadas (≠ tareas de proyecto)
    // ─────────────────────────────────────────
    { id: "cron_add", name: "cron_add", category: "cron", description: "Schedule a recurring or one-time job using a cron expression. NOTE: for project tasks use task_create instead. Spanish: programar tarea, recordatorio, alarma, automatizar horario" },
    { id: "cron_list", name: "cron_list", category: "cron", description: "List all scheduled cron jobs and next execution times. Spanish: ver tareas programadas, cronograma, próximos eventos" },
    { id: "cron_edit", name: "cron_edit", category: "cron", description: "Edit an existing cron job expression or config. Spanish: modificar horario, cambiar programación, editar cron" },
    { id: "cron_remove", name: "cron_remove", category: "cron", description: "Remove a scheduled cron job. NOTE: to remove project tasks use task_update. Spanish: eliminar cron, cancelar recordatorio, borrar programación" },

    // ─────────────────────────────────────────
    // 5. CLI — Ejecución de comandos
    // ─────────────────────────────────────────
    { id: "cli_exec", name: "cli_exec", category: "cli", description: "Execute shell/bash commands in the agent environment. NOTE: do NOT use for cron scheduling, use cron_add instead. Spanish: ejecutar comando, terminal, bash, script, consola" },

    // ─────────────────────────────────────────
    // 6. AGENTS — Memoria, workers y delegación
    // ─────────────────────────────────────────
    { id: "memory_write", name: "memory_write", category: "agents", description: "Store information in persistent long-term memory. Spanish: guardar memoria, recordar, guardar dato, memoria persistente" },
    { id: "memory_read", name: "memory_read", category: "agents", description: "Retrieve a memory entry by identifier. Spanish: leer memoria, recuperar dato, obtener memoria" },
    { id: "memory_list", name: "memory_list", category: "agents", description: "List all saved memory entries. Spanish: listar memorias, ver memorias, todas las memorias" },
    { id: "memory_search", name: "memory_search", category: "agents", description: "Search memories by keyword. Spanish: buscar memoria, encontrar recuerdo, buscar dato guardado" },
    { id: "memory_delete", name: "memory_delete", category: "agents", description: "Delete a specific memory entry. Spanish: borrar memoria, eliminar recuerdo, quitar dato" },
    { id: "agent_create", name: "agent_create", category: "agents", description: "Create a new specialized worker agent. Spanish: crear agente, nuevo worker, nuevo trabajador" },
    { id: "agent_find", name: "agent_find", category: "agents", description: "Find existing running or idle worker agents. Spanish: buscar agente, encontrar worker, localizar agente" },
    { id: "agent_archive", name: "agent_archive", category: "agents", description: "Archive or terminate a worker agent. Spanish: archivar agente, terminar worker, desactivar agente" },
    { id: "task_delegate", name: "task_delegate", category: "agents", description: "Delegate a general task to a specific worker agent. Spanish: delegar tarea, asignar worker, ejecutar por agente" },
    { id: "task_delegate_code", name: "task_delegate_code", category: "agents", description: "Delegate a coding task to a CLI subagent (Qwen, Claude, etc.) via Code Bridge. Spanish: delegar código, subagente CLI, programación, Qwen" },
    { id: "task_status", name: "task_status", category: "agents", description: "Get execution status of one or more delegated tasks. Spanish: estado tarea delegada, verificar progreso, consultar tarea" },
    { id: "bus_publish", name: "bus_publish", category: "agents", description: "Publish a message to the Agent Bus for worker-to-worker communication. Spanish: publicar mensaje, comunicar workers, enviar bus" },
    { id: "bus_read", name: "bus_read", category: "agents", description: "Read unread messages from the Agent Bus. Spanish: leer mensajes bus, recibir mensajes, verificar bus" },
    { id: "project_updates", name: "project_updates", category: "agents", description: "Get recent status updates from workers in the same project. Spanish: actualizaciones proyecto, estado workers, progreso equipo" },

    // ─────────────────────────────────────────
    // 7. CANVAS — UI interactiva
    // ─────────────────────────────────────────
    { id: "canvas_render", name: "canvas_render", category: "canvas", description: "Render a component or visualization on the canvas. Spanish: renderizar, visualizar, gráfico, diagrama" },
    { id: "canvas_ask", name: "canvas_ask", category: "canvas", description: "Show interactive form and wait for user input. Spanish: formulario interactivo, preguntar usuario, input" },
    { id: "canvas_confirm", name: "canvas_confirm", category: "canvas", description: "Show a confirmation dialog before executing an action. Spanish: confirmar acción, diálogo, aprobar" },
    { id: "canvas_show_card", name: "canvas_show_card", category: "canvas", description: "Display structured information in card format. Spanish: mostrar tarjeta, card, información estructurada" },
    { id: "canvas_show_progress", name: "canvas_show_progress", category: "canvas", description: "Show progress bar or status indicator. Spanish: barra de progreso, indicador, progreso visual" },
    { id: "canvas_show_list", name: "canvas_show_list", category: "canvas", description: "Display key-value list information. Spanish: lista clave-valor, mostrar lista, información en lista" },
    { id: "canvas_clear", name: "canvas_clear", category: "canvas", description: "Clear current canvas content. Spanish: limpiar canvas, borrar visualización, resetear" },

    // ─────────────────────────────────────────
    // 8. CODEBRIDGE — Subagentes CLI de código externos
    // Conecta con: Claude Code, Qwen CLI, Gemini CLI, OpenCode CLI
    // ─────────────────────────────────────────
    {
      id: "codebridge_launch",
      name: "codebridge_launch",
      category: "codebridge",
      description: "Launch an external coding CLI subagent (Claude Code, Qwen CLI, Gemini CLI, OpenCode CLI) to execute a coding task locally. Returns a process ID to track execution. Spanish: lanzar agente de código, iniciar Claude Code, Qwen CLI, Gemini CLI, OpenCode, subagente externo de programación"
    },
    {
      id: "codebridge_status",
      name: "codebridge_status",
      category: "codebridge",
      description: "Check the status and output of a running CodeBridge subagent (Claude Code, Qwen CLI, Gemini CLI, OpenCode CLI). Spanish: estado agente de código, verificar Claude Code, progreso subagente externo"
    },
    {
      id: "codebridge_cancel",
      name: "codebridge_cancel",
      category: "codebridge",
      description: "Cancel and terminate a running CodeBridge subagent process (Claude Code, Qwen CLI, Gemini CLI, OpenCode CLI). Spanish: cancelar agente de código, detener Claude Code, terminar subagente externo"
    },
    // ─────────────────────────────────────────
    // 9. VOICE — Voz
    // ─────────────────────────────────────────
    { id: "voice_transcribe", name: "voice_transcribe", category: "voice", description: "Transcribe audio input to text. Spanish: transcribir audio, voz a texto, reconocimiento de voz" },
    { id: "voice_speak", name: "voice_speak", category: "voice", description: "Convert text to synthesized speech output. Spanish: texto a voz, sintetizar, hablar, leer en voz alta" },

    // 10. SEARCH-KNOWLEDGE
    { id: "search_knowledge", name: "search_knowledge", category: "search-knowledge", description: "Search in the knowledge base. Spanish: buscar en la base de conocimientos" },

    // 11. CORE — Notificaciones y notas
    { id: "notify",          name: "notify",          category: "core", description: "Send notification to user. Spanish: notificar, enviar notificación, alertar, aviso" },
    { id: "save_note",       name: "save_note",       category: "core", description: "Save persistent note to scratchpad. Spanish: guardar nota, escribir nota, recordatorio rápido, apuntar" },
    { id: "report_progress", name: "report_progress", category: "core", description: "Report current progress to user. Spanish: reportar progreso, informar estado, actualizar progreso, porcentaje" },

  ],

  providers: [
    { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com" },
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1" },
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
    { id: "kimi", name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.ai/v1" },
    { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
    { id: "ollama", name: "Ollama (Local)", baseUrl: "http://localhost:11434" },
    { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
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

    // ── Ollama (modelos locales — free) ──
    { id: "qwen3:4b", providerId: "ollama", name: "Qwen3 4B", modelType: "llm", contextWindow: 32000, capabilities: JSON.stringify(["chat", "json_mode", "streaming"]) },
    { id: "qwen3:8b", providerId: "ollama", name: "Qwen3 8B", modelType: "llm", contextWindow: 32000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "qwen3:14b", providerId: "ollama", name: "Qwen3 14B", modelType: "llm", contextWindow: 32000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]) },
    { id: "llama3.2:3b", providerId: "ollama", name: "Llama 3.2 3B", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "json_mode", "streaming"]) },
    { id: "gemma3:9b", providerId: "ollama", name: "Gemma 3 9B", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "json_mode", "streaming"]) },

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

import { SkillLoader } from "@johpaz/hive-skills"

const log = logger.child("seed");

// Initial playbook rules for ACE (Agentic Context Engineering)
const INITIAL_PLAYBOOK_RULES = [
  {
    rule: "When the user asks to search for recent news, use web_search with date filters rather than generic http_client",
    category: "tool_selection",
    applicable_to: JSON.stringify(["web_search", "news"]),
  },
  {
    rule: "Always confirm with the user before executing shell commands that modify files or system state",
    category: "error_avoidance",
    applicable_to: JSON.stringify(["exec", "shell", "terminal"]),
  },
  {
    rule: "For code-related queries, always include the shell skill alongside file_manager for complete development workflow",
    category: "optimization",
    applicable_to: JSON.stringify(["code", "development"]),
  },
  {
    rule: "When creating projects, break down tasks into atomic steps that can be executed independently",
    category: "agent_creation",
    applicable_to: JSON.stringify(["project_management", "tasks"]),
  },
  {
    rule: "Save important user preferences to scratchpad using save_note tool for persistence across sessions",
    category: "optimization",
    applicable_to: JSON.stringify(["user_preferences", "memory"]),
  },
  {
    rule: "When a tool fails, retry once with modified parameters before reporting failure to user",
    category: "error_avoidance",
    applicable_to: null,
  },
  {
    rule: "For data analysis tasks, use structured TOON format for output to reduce token usage",
    category: "optimization",
    applicable_to: JSON.stringify(["data", "analysis"]),
  },
  {
    rule: "When delegating to workers, provide clear task descriptions with expected outcomes",
    category: "agent_creation",
    applicable_to: JSON.stringify(["delegation", "workers"]),
  },
]

export function seedAllData(): void {
  const db = getDb()

  log.info("[seed] 🌱 Iniciando seed de datos predeterminados...")

  // 0️⃣ Crear tabla FTS5 para skills (no se puede usar IF NOT EXISTS en VIRTUAL TABLES)
  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(id, name, category, tools, triggers, body)`);
    log.info("[seed] ✅ skills_fts table created/verified");
  } catch (err) {
    if ((err as Error).message.includes("already exists")) {
      log.debug("[seed] skills_fts already exists, skipping creation");
    } else {
      throw err;
    }
  }

  // Crear triggers para sincronización FTS5
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

  log.info("[seed] ✅ skills_fts triggers created");

  // 0️⃣ Cargar skills reales con SkillLoader para obtener el contenido (instrucciones)
  const skillLoader = new SkillLoader({
    workspacePath: process.env.HIVE_HOME || process.cwd()
  });
  const realSkills = skillLoader.loadBundledSkills();
  log.info(`[seed] 📚 SkillLoader cargó ${realSkills.length} bundled skills con contenido.`);

  try {
    // 1️⃣ Tools (globales, sin user_id)
    let toolCount = 0;
    for (const tool of SEED_DATA.tools) {
      db.query(`
        INSERT OR IGNORE INTO tools (id, name, description, category, enabled, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, (unixepoch()), (unixepoch()))
      `).run(tool.id, tool.name, tool.description, tool.category)
      toolCount++;
    }
    log.info(`[seed] ✅ ${toolCount} tools procesadas`);

    const insertToolFts = db.query(`
      INSERT OR REPLACE INTO tools_fts(tool_name, name, description, category)
      VALUES (?, ?, ?, ?)
    `);
    for (const tool of SEED_DATA.tools) {
      insertToolFts.run(tool.name, tool.name, tool.description, tool.category);
    }
    log.info(`[seed] ✅ ${toolCount} tools sincronizadas a tools_fts`);

    // 2️⃣ Skills (cargadas desde archivos .md del paquete skills)
    // Simplified schema: id, name, category, tools, triggers, body, version, active
    let skillCount = 0;
    for (const s of realSkills) {
      // Convert tools array to comma-separated string
      const toolsStr = (s.tools || []).join(",");

      // Convert triggers array to comma-separated string
      const triggersStr = (s.triggers || []).join(",");

      // Use content as body (markdown content)
      const body = s.content || "";

      db.query(`
        INSERT OR REPLACE INTO skills (
          id, name, category, tools, triggers, body, version, active,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, (unixepoch()), (unixepoch()))
      `).run(
        s.name, s.name, s.category || "", toolsStr, triggersStr, body, s.version || 1
      );
      skillCount++;
    }
    log.info(`[seed] ✅ ${skillCount} skills procesadas (schema simplificado)`);

    // Los triggers se encargan de sincronizar skills_fts automáticamente
    log.info(`[seed] ✅ skills_fts sincronizada vía triggers`);

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
