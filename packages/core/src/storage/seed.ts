import { col, toIndexable, nextId } from "./hive"
import type { Collection } from "@johpaz/hive-db"
import { logger } from "../utils/logger"
import { catalogModelKey } from "./model-id"
import { invalidateModelPricingCache } from "./usage"

/**
 * Seed de datos predeterminados para Hive
 * Las tools se crean con enabled=1 (disponibles) y active=1 (activas por defecto)
 * El usuario puede desactivarlas desde la UI si no las necesita
 */

export interface SeedData {
  tools: Array<{ id: string; name: string; category: string; description: string; enabled?: boolean }>
  providers: Array<{ id: string; name: string; baseUrl?: string; category?: string }>
  /**
   * Catálogo de modelos — única fuente de verdad, incluidos los precios.
   *
   * `id` es el nombre del modelo tal como lo llama su propietario. La clave real
   * en la BD la deriva `catalogModelKey()` (storage/model-id.ts), que prefija a
   * los providers revendedores para que dos servicios puedan ofrecer el mismo
   * modelo sin pisarse.
   *
   * `inputPer1M` / `outputPer1M` son USD por millón de tokens y alimentan el
   * costo del dashboard. Obligatorios en los modelos `llm`: omitirlos hace que
   * el modelo aparezca gratis, que es indistinguible de un endpoint sin costo.
   * Los endpoints realmente gratuitos (NVIDIA NIM, Ollama, HiveAgents) van con 0.
   */
  models: Array<{ id: string; providerId: string; name: string; modelType: string; contextWindow?: number; capabilities?: string; inputPer1M?: number; outputPer1M?: number }>
  mcpServers: Array<{ id: string; name: string; transport: string; command?: string; args?: string[]; builtin: boolean }>
  channels: Array<{ id: string; type: string }>
  ethics: Array<{ id: string; name: string; description: string; content: string; isDefault: boolean }>
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
    { id: "api_request", name: "api_request", category: "api", description: "Ejecutar una petición HTTP autorizada contra un endpoint REST y validar la respuesta. Sinónimos: llamar api, request rest, consumir endpoint, petición http, hacer get, hacer post" },
    { id: "web_search", name: "web_search", category: "web", description: "Buscar en la web información actual y noticias. Sinónimos: búsqueda web, noticias, información, buscar en internet, google" },
    { id: "web_fetch", name: "web_fetch", category: "web", description: "Obtener contenido de texto de una URL (ligero, sin JS). Sinónimos: descargar página, extraer texto, obtener contenido, leer url" },
    { id: "browser_navigate", name: "browser_navigate", category: "web", description: "Navegar a una URL y obtener contenido renderizado (soporta JS). Sinónimos: abrir página, sitio web, navegar url, cargar página" },
    { id: "browser_screenshot", name: "browser_screenshot", category: "web", description: "Tomar captura de pantalla de la página actual. Sinónimos: screenshot, imagen de página, capturar pantalla, foto página" },
    { id: "artifact_inspect", name: "artifact_inspect", category: "web", description: "Inspeccionar integridad y metadatos de un artefacto administrado sin modificarlo. Sinónimos: inspeccionar artefacto, verificar archivo generado, metadatos artefacto, comprobar entrega" },
    { id: "browser_click", name: "browser_click", category: "web", description: "Hacer clic en un elemento de la página web. Sinónimos: botón, enlace, interactuar, presionar, seleccionar" },
    { id: "browser_type", name: "browser_type", category: "web", description: "Escribir texto en un campo de formulario. Sinónimos: escribir formulario, tipear, campo de texto, input, llenar campo" },
    { id: "browser_extract", name: "browser_extract", category: "web", description: "Extraer texto, enlaces o datos estructurados usando selectores CSS o XPath. Sinónimos: obtener datos, scraping, selectores, extraer información" },
    { id: "browser_script", name: "browser_script", category: "web", description: "Ejecutar JavaScript arbitrario en el navegador y obtener resultado. Sinónimos: ejecutar javascript, script, código, función, evaluar" },
    { id: "browser_wait", name: "browser_wait", category: "web", description: "Esperar a que aparezca un elemento o se cumpla una condición. Sinónimos: esperar, condición, elemento, selector, pausa" },

    // ─────────────────────────────────────────
    // 3. CRON — Tareas programadas (Croner-based)
    // ─────────────────────────────────────────
    { id: "cron.create", name: "cron.create", category: "cron", description: "Crear una automatización de Hive programada: recurrente (expresión cron) o ejecución futura única (fire_at). Requiere 'task'. Sinónimos: programar tarea, crear automatización, ejecutar después, tarea recurrente, una vez" },
    { id: "cron.list", name: "cron.list", category: "cron", description: "Listar todas las tareas programadas con próximos horarios de ejecución. Sinónimos: ver tareas programadas, listar cronograma, próximas ejecuciones" },
    { id: "cron.update", name: "cron.update", category: "cron", description: "Actualizar tarea programada existente: cambiar expresión, instrucción, canal, ventana temporal. Sinónimos: modificar cron, editar recordatorio, cambiar horario, actualizar tarea" },
    { id: "cron.pause", name: "cron.pause", category: "cron", description: "Pausar temporalmente una tarea programada sin eliminarla. Sinónimos: pausar tarea programada, detener temporalmente, suspender recordatorio" },
    { id: "cron.resume", name: "cron.resume", category: "cron", description: "Reanudar una tarea programada previamente pausada. Sinónimos: reanudar tarea, continuar tarea pausada, activar recordatorio" },
    { id: "cron.delete", name: "cron.delete", category: "cron", description: "Eliminar una tarea programada permanentemente. Sinónimos: eliminar tarea programada, borrar recordatorio, cancelar tarea" },
    { id: "cron.trigger", name: "cron.trigger", category: "cron", description: "Ejecutar manualmente una tarea programada de forma inmediata. Sinónimos: ejecutar tarea ahora, forzar ejecución, disparar manualmente" },
    { id: "cron.history", name: "cron.history", category: "cron", description: "Obtener historial de ejecuciones y logs de una tarea programada. Sinónimos: historial ejecuciones, logs tarea, registro ejecuciones" },

    // ─────────────────────────────────────────
    // 4. CLI — Ejecución de comandos
    // ─────────────────────────────────────────
    { id: "cli_exec", name: "cli_exec", category: "cli", description: "Ejecutar comandos shell/bash en el entorno del agente. NOTA: NO usar para tareas programadas, usar cron.create. Sinónimos: ejecutar comando, terminal, bash, script, consola" },

    // ─────────────────────────────────────────
    // 5. AGENTS — Memoria, workers y delegación
    // ─────────────────────────────────────────
    { id: "memory_write", name: "memory_write", category: "agents", description: "Guardar información en memoria persistente a largo plazo. Sinónimos: guardar memoria, recordar, guardar dato, memoria persistente" },
    { id: "memory_read", name: "memory_read", category: "agents", description: "Recuperar una entrada de memoria por identificador. Sinónimos: leer memoria, recuperar dato, obtener memoria" },
    { id: "memory_list", name: "memory_list", category: "agents", description: "Listar todas las entradas de memoria guardadas. Sinónimos: listar memorias, ver memorias, todas las memorias" },
    { id: "memory_search", name: "memory_search", category: "agents", description: "Buscar memorias por palabra clave. Sinónimos: buscar memoria, encontrar recuerdo, buscar dato guardado" },
    { id: "memory_delete", name: "memory_delete", category: "agents", description: "Eliminar una entrada de memoria específica. Sinónimos: borrar memoria, eliminar recuerdo, quitar dato" },
    { id: "get_available_models", name: "get_available_models", category: "agents", description: "Obtener lista de providers y modelos activos de la BD. Sinónimos: ver modelos, listar providers, modelos disponibles, consultar modelos, provider activo, qué modelos tengo, modelos para código, modelos para chat" },
    { id: "agent_create", name: "agent_create", category: "agents", description: "Crear un nuevo agente worker especializado; puede asignar un servidor MCP persistente después de la confirmación del usuario. Sinónimos: crear agente, nuevo worker, nuevo trabajador" },
    { id: "agent_find", name: "agent_find", category: "agents", description: "Descubrir agentes worker disponibles: catálogo global del sistema y workers privados del usuario. No indica ejecución; para eso usar task_list. Sinónimos: buscar agente, encontrar worker, localizar agente" },
    { id: "agent_archive", name: "agent_archive", category: "agents", description: "Archivar o terminar un agente worker. Sinónimos: archivar agente, terminar worker, desactivar agente" },
    { id: "task_delegate", name: "task_delegate", category: "agents", description: "Delegar una tarea general a un agente worker específico. Sinónimos: delegar tarea, asignar worker, ejecutar por agente" },
    { id: "task_revise", name: "task_revise", category: "agents", description: "Devolver una tarea delegada a su worker con feedback cuando no cumple sus criterios de aceptación. Sinónimos: corregir tarea, devolver al worker, pedir corrección, reencolar tarea" },
    { id: "task_list", name: "task_list", category: "agents", description: "Listar ejecuciones reales de tareas delegadas del usuario, consultando tareas y jobs persistidos. Sinónimos: listar tareas activas, ver subagentes trabajando, ejecuciones reales" },
    { id: "task_status", name: "task_status", category: "agents", description: "Obtener estado de ejecución de tareas delegadas. Sinónimos: estado tarea delegada, verificar progreso, consultar tarea" },
    { id: "bus_publish", name: "bus_publish", category: "agents", description: "Publicar mensaje en el Agent Bus para comunicación worker-to-worker. Sinónimos: publicar mensaje, comunicar workers, enviar bus" },
    { id: "bus_read", name: "bus_read", category: "agents", description: "Leer mensajes no leídos del Agent Bus. Sinónimos: leer mensajes bus, recibir mensajes, verificar bus" },

    // ─────────────────────────────────────────
    // 6. A2UI v0.9 — Panel interactivo
    // ─────────────────────────────────────────
    { id: "a2ui_create_surface", name: "a2ui_create_surface", category: "a2ui", description: "Crear superficie A2UI v0.9 para UI interactiva rica: formularios, dashboards, wizards, flujos multi-paso. Siempre llamar ANTES de a2ui_update_components. Requiere surfaceId y catalogId='https://a2ui.org/specification/v0_9/basic_catalog.json'. Sinónimos: crear superficie A2UI, iniciar UI A2UI, crear form A2UI, interfaz interactiva, crear dashboard A2UI" },
    { id: "a2ui_update_components", name: "a2ui_update_components", category: "a2ui", description: "Enviar componentes A2UI v0.9 como lista plana (adjacency list). Tipos: Text, Button, TextField, Row, Column, Card, List, Tabs, Modal, ChoicePicker, Slider, CheckBox, DateTimeInput, Image, Divider. Reglas: children usa explicitList (NO array), ChoicePicker usa selections (NO value), TextField usa textFieldType (NO variant), Tabs.tabItems.title es string plano. Sinónimos: actualizar componentes A2UI, enviar UI A2UI, renderizar componentes A2UI, layout A2UI" },
    { id: "a2ui_update_data_model", name: "a2ui_update_data_model", category: "a2ui", description: "Actualizar data model de superficie A2UI v0.9 via JSON Pointer (/ruta/campo). Omitir path reemplaza todo el modelo. Los componentes con {path:'/...'} se actualizan automáticamente en el cliente. Sinónimos: actualizar datos A2UI, poblar formulario A2UI, inicializar estado A2UI, data model, binding" },
    { id: "a2ui_delete_surface", name: "a2ui_delete_surface", category: "a2ui", description: "Eliminar una superficie A2UI v0.9 del panel interactivo. Usar al completar o cancelar el flujo para liberar recursos. Sinónimos: eliminar superficie A2UI, borrar UI A2UI, cerrar formulario A2UI, limpiar panel A2UI" },

    // 8. SEARCH-KNOWLEDGE
    { id: "search_knowledge", name: "search_knowledge", category: "search-knowledge", description: "Buscar en la base de conocimientos. Sinónimos: buscar conocimiento, buscar en la base" },

    // 9. CORE — Notificaciones y notas
    { id: "notify", name: "notify", category: "core", description: "Enviar notificación al usuario. Sinónimos: notificar, enviar notificación, alertar, aviso" },
    { id: "save_note", name: "save_note", category: "core", description: "Guardar nota persistente en el scratchpad. Sinónimos: guardar nota, escribir nota, recordatorio rápido, apuntar" },
    { id: "report_progress", name: "report_progress", category: "core", description: "Reportar progreso actual al usuario. Sinónimos: reportar progreso, informar estado, actualizar progreso, porcentaje" },

    // ─────────────────────────────────────────
    // 10. OFFICE — Archivos Office (PDF, DOCX, XLSX, PPTX)
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
    { id: "elevenlabs", name: "ElevenLabs", baseUrl: "https://api.elevenlabs.io/v1", category: "tts" },
    { id: "qwen", name: "Qwen (Alibaba)", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", category: "llm" },
    { id: "nvidia", name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1" },
    { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimaxi.com/v1" },
    { id: "z-ai", name: "Z.ai (GLM)", baseUrl: "https://api.z.ai/api/paas/v4" },
    // `.ai` (internacional), NO `.cn`. Son plataformas separadas con cuentas y
    // tokens propios: un token internacional responde 401 en el endpoint chino.
    // Confunde porque GET /v1/models da 200 en ambos — ese listado es público y
    // no valida la key; el 401 recién aparece al invocar el modelo.
    { id: "modelscope", name: "ModelScope Qwen", baseUrl: "https://api-inference.modelscope.ai/v1" },
    { id: "opencode-go", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1" },
    { id: "piper", name: "Piper (Local TTS)", category: "tts" },
    { id: "hiveagents", name: "HiveAgents LLM (Cloudflare)", baseUrl: "https://llm.hiveagents.io/v1", category: "llm" },
  ],

  models: [
    // ── Anthropic (fuente: platform.claude.com/docs/en/about-claude/models/overview) ──
    // Generación actual (4.6/4.7/4.8 pasaron a "legacy"). Los IDs sin fecha ya son
    // snapshots fijos, no alias evergreen.
    { id: "claude-opus-5", providerId: "anthropic", name: "Claude Opus 5", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 5, outputPer1M: 25 },
    { id: "claude-sonnet-5", providerId: "anthropic", name: "Claude Sonnet 5", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 3, outputPer1M: 15 },
    { id: "claude-fable-5", providerId: "anthropic", name: "Claude Fable 5", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 10, outputPer1M: 50 },
    { id: "claude-haiku-4-5-20251001", providerId: "anthropic", name: "Claude Haiku 4.5", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 1, outputPer1M: 5 },

    // ── OpenAI (fuente: developers.openai.com/api/docs/models) ──
    // Serie 5.6: Sol (frontier), Terra (equilibrio) y Luna (alto volumen / bajo costo).
    // Las tres comparten 1.05M de contexto; se quitó la familia GPT-4o (2024).
    { id: "gpt-5.6-luna", providerId: "openai", name: "GPT-5.6 Luna", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 0.1, outputPer1M: 0.6 },
    { id: "gpt-5.6-terra", providerId: "openai", name: "GPT-5.6 Terra", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 1, outputPer1M: 6 },
    { id: "gpt-5.6-sol", providerId: "openai", name: "GPT-5.6 Sol", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 5, outputPer1M: 30 },
    // STT / TTS
    { id: "whisper-1", providerId: "openai", name: "Whisper 1", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription", "translation"]) },
    { id: "tts-1", providerId: "openai", name: "TTS-1", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "tts-1-hd", providerId: "openai", name: "TTS-1 HD", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "high_quality"]) },
    { id: "gpt-4o-mini-tts", providerId: "openai", name: "GPT-4o Mini TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "es_MX-claude-14947-epoch-high", providerId: "piper", name: "Piper Spanish (Claude)", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "local"]) },

    // ── Google Gemini (fuente: ai.google.dev/gemini-api/docs/models) ──
    // Solo la generación 3.x: la familia 2.0 ya está apagada y la 2.5 quedó
    // superada. `gemini-3.5-pro` y `gemini-3.1-flash-lite-preview` se quitaron:
    // el primero no existe en el catálogo y el segundo ya salió de preview.
    { id: "gemini-3.6-flash", providerId: "gemini", name: "Gemini 3.6 Flash", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 1.5, outputPer1M: 7.5 },
    { id: "gemini-3.5-flash", providerId: "gemini", name: "Gemini 3.5 Flash", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 1.5, outputPer1M: 9 },
    { id: "gemini-3.5-flash-lite", providerId: "gemini", name: "Gemini 3.5 Flash Lite", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.3, outputPer1M: 2.5 },
    { id: "gemini-3.1-pro-preview", providerId: "gemini", name: "Gemini 3.1 Pro Preview", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 2, outputPer1M: 12 },
    { id: "gemini-3.1-flash-lite", providerId: "gemini", name: "Gemini 3.1 Flash Lite", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.25, outputPer1M: 1.5 },

    // TTS
    { id: "gemini-2.5-flash-preview-tts", providerId: "gemini", name: "Gemini 2.5 Flash TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "gemini-2.5-pro-preview-tts", providerId: "gemini", name: "Gemini 2.5 Pro TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "high_quality"]) },

    // ── Mistral (fuente: openrouter.ai/mistralai + docs.mistral.ai) ──
    { id: "mistral-large-2512", providerId: "mistral", name: "Mistral Large 2512", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.5, outputPer1M: 1.5 },
    { id: "devstral-2512", providerId: "mistral", name: "Devstral 2512", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0.4, outputPer1M: 2 },
    { id: "ministral-14b-2512", providerId: "mistral", name: "Ministral 14B", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.2, outputPer1M: 0.2 },
    { id: "ministral-8b-2512", providerId: "mistral", name: "Ministral 8B", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.15, outputPer1M: 0.15 },
    { id: "codestral-2508", providerId: "mistral", name: "Codestral 2508", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0.2, outputPer1M: 0.6 },
    { id: "mistral-small-3.2-24b-instruct", providerId: "mistral", name: "Mistral Small 3.2 24B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.1, outputPer1M: 0.3 },
    // Aliases (siguen funcionando en la API de Mistral)
    { id: "mistral-large-latest", providerId: "mistral", name: "Mistral Large (latest)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.5, outputPer1M: 1.5 },
    { id: "codestral-latest", providerId: "mistral", name: "Codestral (latest)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0.2, outputPer1M: 0.6 },

    // ── DeepSeek (fuente: api-docs.deepseek.com/quick_start/pricing) ──
    // V4 reemplazó a deepseek-chat/deepseek-reasoner (V3.2): 1M de contexto,
    // 384K de salida máxima y tool calling en ambos.
    { id: "deepseek-v4-pro", providerId: "deepseek", name: "DeepSeek V4 Pro", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 0.435, outputPer1M: 0.87 },
    { id: "deepseek-v4-flash", providerId: "deepseek", name: "DeepSeek V4 Flash", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 0.14, outputPer1M: 0.28 },

    // ── Kimi / Moonshot (fuente: platform.kimi.ai/docs/pricing/chat) ──
    // La serie moonshot-v1-* se apaga el 2026-08-31; K2/K2.5 quedaron superadas.
    { id: "kimi-k3", providerId: "kimi", name: "Kimi K3", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 3, outputPer1M: 15 },
    { id: "kimi-k2.7-code", providerId: "kimi", name: "Kimi K2.7 Code", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 0.73, outputPer1M: 3.5 },
    { id: "kimi-k2.6", providerId: "kimi", name: "Kimi K2.6", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 0.6, outputPer1M: 3.41 },

    // ── OpenRouter (fuente: GET https://openrouter.ai/api/v1/models) ──
    // Solo modelos vivos con `tools` en supported_parameters y publicados desde
    // 2025-07. contextWindow = context_length reportado por el propio catálogo.
    // Anthropic
    { id: "anthropic/claude-opus-5", providerId: "openrouter", name: "Claude Opus 5 (OR)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 5, outputPer1M: 25 },
    { id: "anthropic/claude-sonnet-5", providerId: "openrouter", name: "Claude Sonnet 5 (OR)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 2, outputPer1M: 10 },
    // OpenAI — la serie 5.6 se divide en Sol (flagship), Terra (equilibrado) y Luna (económico)
    { id: "openai/gpt-5.6-sol", providerId: "openrouter", name: "GPT-5.6 Sol (OR)", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 5, outputPer1M: 30 },
    { id: "openai/gpt-5.6-terra", providerId: "openrouter", name: "GPT-5.6 Terra (OR)", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 1, outputPer1M: 6 },
    { id: "openai/gpt-5.6-luna", providerId: "openrouter", name: "GPT-5.6 Luna (OR)", modelType: "llm", contextWindow: 1050000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.1, outputPer1M: 0.6 },
    // Google
    { id: "google/gemini-3.6-flash", providerId: "openrouter", name: "Gemini 3.6 Flash (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 1.5, outputPer1M: 7.5 },
    { id: "google/gemini-3.5-flash", providerId: "openrouter", name: "Gemini 3.5 Flash (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 1.5, outputPer1M: 9 },
    { id: "google/gemini-3.1-pro-preview", providerId: "openrouter", name: "Gemini 3.1 Pro (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 2, outputPer1M: 12 },
    // DeepSeek
    { id: "deepseek/deepseek-v4-pro", providerId: "openrouter", name: "DeepSeek V4 Pro (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 0.435, outputPer1M: 0.87 },
    { id: "deepseek/deepseek-v4-flash", providerId: "openrouter", name: "DeepSeek V4 Flash (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 0.14, outputPer1M: 0.28 },
    // Kimi
    { id: "moonshotai/kimi-k3", providerId: "openrouter", name: "Kimi K3 (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 3, outputPer1M: 15 },
    { id: "moonshotai/kimi-k2.7-code", providerId: "openrouter", name: "Kimi K2.7 Code (OR)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 0.73, outputPer1M: 3.5 },
    // MiniMax
    { id: "minimax/minimax-m3", providerId: "openrouter", name: "MiniMax M3 (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 0.3, outputPer1M: 1.2 },
    // Z.ai / GLM
    { id: "z-ai/glm-5.2", providerId: "openrouter", name: "GLM 5.2 (OR)", modelType: "llm", contextWindow: 1048576, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code", "reasoning"]), inputPer1M: 0.63, outputPer1M: 1.98 },
    // Qwen
    { id: "qwen/qwen3.8-max", providerId: "openrouter", name: "Qwen3.8 Max (OR)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 2, outputPer1M: 6 },
    { id: "qwen/qwen3.7-flash", providerId: "openrouter", name: "Qwen3.7 Flash (OR)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.03, outputPer1M: 0.13 },
    // xAI
    { id: "x-ai/grok-4.5", providerId: "openrouter", name: "Grok 4.5 (OR)", modelType: "llm", contextWindow: 500000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 2, outputPer1M: 6 },
    // Mistral
    { id: "mistralai/mistral-medium-3-5", providerId: "openrouter", name: "Mistral Medium 3.5 (OR)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 1.5, outputPer1M: 7.5 },


    // ── Groq (fuente: console.groq.com/docs/models) ──
    { id: "llama-3.3-70b-versatile", providerId: "groq", name: "Llama 3.3 70B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.59, outputPer1M: 0.79 },
    { id: "llama-3.1-8b-instant", providerId: "groq", name: "Llama 3.1 8B Instant", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.05, outputPer1M: 0.08 },
    { id: "openai/gpt-oss-120b", providerId: "groq", name: "GPT OSS 120B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 0.15, outputPer1M: 0.6 },
    { id: "openai/gpt-oss-20b", providerId: "groq", name: "GPT OSS 20B", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.075, outputPer1M: 0.3 },
    { id: "groq/compound", providerId: "groq", name: "Groq Compound", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "groq/compound-mini", providerId: "groq", name: "Groq Compound Mini", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "moonshotai/kimi-k2-instruct-0905", providerId: "groq", name: "Kimi K2 (Groq)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "code"]), inputPer1M: 0.45, outputPer1M: 2.2 },
    { id: "qwen/qwen3-32b", providerId: "groq", name: "Qwen3 32B (Groq)", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "whisper-large-v3", providerId: "groq", name: "Whisper Large V3", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription"]) },
    { id: "whisper-large-v3-turbo", providerId: "groq", name: "Whisper Large V3 Turbo", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription"]) },
    { id: "distil-whisper-large-v3-en", providerId: "groq", name: "Distil Whisper V3 EN", modelType: "stt", contextWindow: 0, capabilities: JSON.stringify(["transcription", "english"]) },

    // ── Ollama: models are detected at runtime via /api/setup/ollama-models and inserted dynamically ──


    // ── ElevenLabs (TTS) ──
    { id: "eleven_flash_v2_5", providerId: "elevenlabs", name: "Eleven Flash V2.5", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "fast"]) },
    { id: "eleven_turbo_v2_5", providerId: "elevenlabs", name: "Eleven Turbo V2.5", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "balanced"]) },
    { id: "eleven_multilingual_v2", providerId: "elevenlabs", name: "Eleven Multilingual V2", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "multilingual"]) },
    { id: "eleven_v3", providerId: "elevenlabs", name: "Eleven V3", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech", "expressive"]) },

    // ── Qwen (Alibaba DashScope / Model Studio) ──
    // Serie 3.7 = generación actual. Los contextWindow salen del catálogo de
    // OpenRouter, que enruta a los mismos modelos: el `qwen3.6-max-preview` que
    // estaba sembrado con 32768 en realidad tiene 262144.
    { id: "qwen3.7-max", providerId: "qwen", name: "Qwen 3.7 Max", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 1.475, outputPer1M: 4.425 },
    { id: "qwen3.7-plus", providerId: "qwen", name: "Qwen 3.7 Plus", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0.32, outputPer1M: 1.28 },
    { id: "qwen3.6-flash", providerId: "qwen", name: "Qwen 3.6 Flash", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.1875, outputPer1M: 1.125 },
    { id: "qwen3.5-omni-plus", providerId: "qwen", name: "Qwen 3.5 Omni Plus", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "json_mode", "function_calling", "streaming"]), inputPer1M: 0.32, outputPer1M: 1.28 },

    // ── Qwen (TTS) ──
    { id: "qwen3-tts-instruct-flash", providerId: "qwen", name: "Qwen TTS Instruct Flash", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "qwen3-tts-flash", providerId: "qwen", name: "Qwen TTS Flash", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },
    { id: "qwen-tts", providerId: "qwen", name: "Qwen TTS", modelType: "tts", contextWindow: 0, capabilities: JSON.stringify(["tts", "speech"]) },

    // ── NVIDIA NIM (fuente: GET https://integrate.api.nvidia.com/v1/models) ──
    // Solo los mejores modelos agénticos (tool calling) del catálogo vivo. NVIDIA
    // retira modelos del endpoint sin avisar y responde 410 Gone al llamarlos, así
    // que esta lista se valida contra /v1/models — no contra la web de build.nvidia.com,
    // que sigue mostrando fichas de modelos ya retirados. Verificado 2026-08-03.
    // Nota: Qwen ya no tiene ningún modelo en el catálogo NVIDIA (todos retirados);
    // para Qwen usar el provider `qwen` (DashScope) directamente.
    { id: "z-ai/glm-5.2", providerId: "nvidia", name: "GLM 5.2 (NVIDIA)", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "moonshotai/kimi-k2.6", providerId: "nvidia", name: "Kimi K2.6 (NVIDIA)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "vision", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "minimaxai/minimax-m3", providerId: "nvidia", name: "MiniMax M3 (NVIDIA)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "nvidia/nemotron-3-ultra-550b-a55b", providerId: "nvidia", name: "Nemotron 3 Ultra 550B", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "nvidia/nemotron-3-super-120b-a12b", providerId: "nvidia", name: "Nemotron 3 Super 120B", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "deepseek-ai/deepseek-v4-pro", providerId: "nvidia", name: "DeepSeek V4 Pro (NVIDIA)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },

    // ── ModelScope Qwen (fuente: GET https://api-inference.modelscope.ai/v1/models) ──
    // Endpoint gratuito dentro de cuota (2000 llamadas/día, ≤500 por modelo), por
    // eso todos van con precio 0 explícito y no vacío.
    //
    // Los Qwen-Ambassador son modelos no-públicos: se listan para cualquiera pero
    // sólo los invoca una cuenta del programa de embajadores. Con otra cuenta el
    // provider devuelve un error de autorización, que ahora llega al usuario como
    // mensaje accionable en vez de guardarse como respuesta del agente.
    // Verificados contra la API: chat, tool calling y streaming los tres.
    { id: "Qwen-Ambassador/Qwen3.8-Max", providerId: "modelscope", name: "Qwen3.8 Max (Embajador)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "Qwen-Ambassador/Qwen3.7-Max", providerId: "modelscope", name: "Qwen3.7 Max (Embajador)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "Qwen-Ambassador/Qwen3.7-Plus", providerId: "modelscope", name: "Qwen3.7 Plus (Embajador)", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "vision", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    // Open-weight del mismo endpoint, para cuentas sin permiso de embajador.
    { id: "Qwen/Qwen3.5-397B-A17B", providerId: "modelscope", name: "Qwen3.5 397B (ModelScope)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "Qwen/Qwen3-Next-80B-A3B-Instruct", providerId: "modelscope", name: "Qwen3 Next 80B (ModelScope)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "Qwen/Qwen3-Coder-30B-A3B-Instruct", providerId: "modelscope", name: "Qwen3 Coder 30B (ModelScope)", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "Qwen/Qwen3-VL-235B-A22B-Instruct", providerId: "modelscope", name: "Qwen3 VL 235B (ModelScope)", modelType: "llm", contextWindow: 131072, capabilities: JSON.stringify(["chat", "vision", "json_mode", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },

    // ── MiniMax (fuente: platform.minimaxi.com) — OpenAI-compatible endpoint ──
    // La M2.x tiene 204800 de contexto, no 1M: ese valor solo aplica a M3. Estaba
    // mal y hacía que la compactación no disparara hasta muy pasado el límite real.
    { id: "MiniMax-M3", providerId: "minimax", name: "MiniMax M3", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "vision", "function_calling", "streaming", "reasoning"]), inputPer1M: 0.3, outputPer1M: 1.2 },
    { id: "MiniMax-M2.7", providerId: "minimax", name: "MiniMax M2.7", modelType: "llm", contextWindow: 204800, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0.3, outputPer1M: 1.2 },
    { id: "MiniMax-M2.7-highspeed", providerId: "minimax", name: "MiniMax M2.7 Highspeed", modelType: "llm", contextWindow: 204800, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0.3, outputPer1M: 1.2 },

    // ── Z.ai / GLM (fuente: docs.z.ai/guides/llm) — OpenAI-compatible endpoint ──
    { id: "glm-5.2", providerId: "z-ai", name: "GLM 5.2", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0.63, outputPer1M: 1.98 },
    { id: "glm-5.1", providerId: "z-ai", name: "GLM 5.1", modelType: "llm", contextWindow: 204800, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0.97, outputPer1M: 3.04 },
    { id: "glm-5", providerId: "z-ai", name: "GLM 5", modelType: "llm", contextWindow: 200000, capabilities: JSON.stringify(["chat", "code", "json_mode", "function_calling", "streaming", "reasoning"]), inputPer1M: 0.97, outputPer1M: 3.04 },

    // ── OpenCode Go (fuente: opencode.ai) — OpenAI-compatible endpoint ──
    { id: "minimax-m3", providerId: "opencode-go", name: "MiniMax M3", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "vision", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "minimax-m2.7", providerId: "opencode-go", name: "MiniMax M2.7", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "minimax-m2.5", providerId: "opencode-go", name: "MiniMax M2.5", modelType: "llm", contextWindow: 1000000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "kimi-k2.6", providerId: "opencode-go", name: "Kimi K2.6", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "kimi-k2.5", providerId: "opencode-go", name: "Kimi K2.5", modelType: "llm", contextWindow: 262144, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "glm-5.1", providerId: "opencode-go", name: "GLM-5.1", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "glm-5", providerId: "opencode-go", name: "GLM-5", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "deepseek-v4-pro", providerId: "opencode-go", name: "DeepSeek V4 Pro", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "deepseek-v4-flash", providerId: "opencode-go", name: "DeepSeek V4 Flash", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "mimo-v2-pro", providerId: "opencode-go", name: "MiMo-V2 Pro", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "mimo-v2-omni", providerId: "opencode-go", name: "MiMo-V2 Omni", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "mimo-v2.5-pro", providerId: "opencode-go", name: "MiMo-V2.5 Pro", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming", "reasoning"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "mimo-v2.5", providerId: "opencode-go", name: "MiMo-V2.5", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },
    { id: "hy3-preview", providerId: "opencode-go", name: "Hunyuan 3 Preview", modelType: "llm", contextWindow: 128000, capabilities: JSON.stringify(["chat", "code", "function_calling", "streaming"]), inputPer1M: 0, outputPer1M: 0 },

    // ── HiveAgents (llama.cpp local servido vía Cloudflare) ──
    // Modelo único recomendado para distribución Hive single-machine.
    // Ver API.md para detalles de carga e inferencia.
    //
    // El id ES el nombre del archivo .gguf que sirve llama.cpp, así que cambia
    // con cada bump del modelo. Al renombrarlo, el re-seed borra la fila vieja y
    // crea la nueva desactivada, y desvincula a los agentes que apuntaban a la
    // anterior: hay que volver a elegir el modelo en la UI una vez.
    { id: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf", providerId: "hiveagents", name: "Qwen3.6 35B MoE (Recomendado)", modelType: "llm", contextWindow: 50000, capabilities: JSON.stringify(["chat", "streaming", "reasoning", "function_calling"]), inputPer1M: 0, outputPer1M: 0 },
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
      content: `##ALWAYS: Responsabilidad y Claridad
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

}

import { SkillLoader } from "@johpaz/hive-agents-skills"
import type {
  ToolDoc, SkillDoc, EthicsDoc, ProviderDoc, ModelDoc, McpServerDoc, ChannelDoc, PlaybookDoc, AgentDoc,
} from "./collections"
import { createSeedCatalogAgents, ensureAgentsConfigured } from "../agent/agent-catalog"

const log = logger.child("seed");

/** Insert-only-if-absent — the HiveDB equivalent of SQL `INSERT OR IGNORE`. */
async function putIfAbsent<T>(c: Collection<T>, id: string, doc: T): Promise<void> {
  if (!(await c.get(id))) await c.put(id, doc)
}

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
    rule: "Al delegar trabajo complejo a workers, divide el objetivo en pasos atómicos que puedan ejecutarse independientemente",
    category: "agent_creation",
    applicable_to: JSON.stringify(["delegation", "workers", "tasks"]),
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
 * Capabilities that shipped in a previous version and were withdrawn.
 *
 * Seeding is put-in-place with natural ids, so dropping an entry from
 * SEED_DATA/bundled skills does NOT remove the row an older install already
 * wrote — and a stale row stays indexed for search_knowledge, so the agent
 * keeps discovering a capability whose executor no longer exists. Listing the
 * id here deletes it on the next boot.
 *
 * A blanket "delete anything not in the seed" pass is deliberately avoided:
 * users can author their own skills through the skills API route.
 */
const RETIRED_TOOL_IDS = [
  "task_delegate_code", // Code Bridge (never implemented; the executor was a stub returning ok:false)
  "canvas_render",
  "canvas_ask",
  "canvas_confirm",
  "canvas_show_card",
  "canvas_show_progress",
  "canvas_show_list",
  "canvas_clear",
  // Projects/DAG: this instance no longer manages projects. Its TaskDriver also
  // claimed any pending TaskDoc without filtering by project, so it could
  // double-execute async delegations.
  "project_create",
  "project_status",
  "task_create",
  "task_complete",
];

const RETIRED_SKILL_IDS = [
  "code_delegator", // Code Bridge: referenced task_delegate_code + codebridge_* tools that never existed
  "canvas_report",
  "canvas_dashboard",
  "canvas_interact",
  "mcp_lazy_operator",
];

const RETIRED_CATALOG_AGENT_IDS = [
  "canvas_presenter",
  // Kept only as an upgrade tombstone so existing installations remove the
  // former generic MCP worker. New MCP specialists are user-owned and scoped
  // persistently to one server.
  "mcp_integration_operator",
  // The independent verifier agent was replaced by deterministic acceptance
  // checks (agent/acceptance-checks.ts) plus the coordinator judging the
  // delivery itself in the closing turn — no extra agent loop per task.
  "acceptance_verifier",
];

const LEGACY_CRON_PERSONA = {
  id: "schedule_automation_agent",
  name: "Operador de agenda",
  description: "Crea y administra recordatorios y automatizaciones temporales con zona horaria correcta.",
  role: "Tu dominio es recordatorios, cron recurrente, ventanas temporales y zonas horarias.",
  receives: "Acción temporal, horario expresado por el usuario, timezone, canal y comportamiento esperado.",
  routingExamples: JSON.stringify(["recordarme mañana", "programar un reporte semanal", "pausar una tarea"]),
  calendarProhibition: "No creás, consultás ni modificás eventos, citas, reuniones, asistentes o disponibilidad de un calendario externo.",
} as const;

function migrateLegacyCatalogPersona(existing: AgentDoc, current: AgentDoc): AgentDoc {
  if (existing.id !== LEGACY_CRON_PERSONA.id || existing.source !== "catalog") return existing;

  let systemPrompt = existing.system_prompt;
  const hasLegacyStockPrompt = systemPrompt.includes(LEGACY_CRON_PERSONA.role)
    && systemPrompt.includes(LEGACY_CRON_PERSONA.receives);
  if (hasLegacyStockPrompt) {
    systemPrompt = systemPrompt
      .replace(LEGACY_CRON_PERSONA.role, current.system_prompt.match(/# ROL\n([^\n]+)/)?.[1] ?? LEGACY_CRON_PERSONA.role)
      .replace(LEGACY_CRON_PERSONA.receives, current.system_prompt.match(/# QUÉ RECIBES\n([^\n]+)/)?.[1] ?? LEGACY_CRON_PERSONA.receives);
    if (!systemPrompt.includes(LEGACY_CRON_PERSONA.calendarProhibition)) {
      systemPrompt = systemPrompt.replace(
        "- No hablás con el usuario",
        `- ${LEGACY_CRON_PERSONA.calendarProhibition}\n- No hablás con el usuario`,
      );
    }
  }

  return {
    ...existing,
    name: existing.name === LEGACY_CRON_PERSONA.name ? current.name : existing.name,
    description: existing.description === LEGACY_CRON_PERSONA.description
      ? current.description
      : existing.description,
    system_prompt: systemPrompt,
    routing_examples_json: existing.routing_examples_json === LEGACY_CRON_PERSONA.routingExamples
      ? current.routing_examples_json
      : existing.routing_examples_json,
    routing_exclusions_json: !existing.routing_exclusions_json || existing.routing_exclusions_json === "[]"
      ? current.routing_exclusions_json
      : existing.routing_exclusions_json,
  };
}

async function pruneRetired(): Promise<void> {
  const toolsCol = await col<ToolDoc>("tools");
  let removed = 0;
  for (const id of RETIRED_TOOL_IDS) {
    if (await toolsCol.get(id)) { await toolsCol.delete(id); removed++; }
  }

  const skillsCol = await col<SkillDoc>("skills");
  for (const id of RETIRED_SKILL_IDS) {
    if (await skillsCol.get(id)) { await skillsCol.delete(id); removed++; }
  }

  const agentsCol = await col<AgentDoc>("agents");
  for (const id of RETIRED_CATALOG_AGENT_IDS) {
    const existing = await agentsCol.get(id);
    if (existing?.doc.source === "catalog") {
      await agentsCol.delete(id);
      removed++;
    }
  }

  // The independent-verifier agent's audit trail is gone with it — no reader
  // exists for the `verifications` collection anymore.
  const verificationsCol = await col<{ id: string }>("verifications");
  const staleVerifications = await verificationsCol.scan({});
  for (const entry of staleVerifications) {
    await verificationsCol.delete(entry.id);
    removed++;
  }

  if (removed > 0) log.info(`[seed] 🗑️  Removed ${removed} retired capability row(s)`);
}

async function reseedToolsAndSkills(): Promise<void> {
  // Seeding only writes the rows; the search index is rebuilt from them at
  // startup by the sync pass in gateway/initializer.ts.

  // ── Tools: re-seed (overwrite in place; a natural id means no "wipe" step is needed) ──
  const toolsCol = await col<ToolDoc>("tools");
  const now = Date.now();
  let toolCount = 0;
  for (const tool of SEED_DATA.tools) {
    await toolsCol.put(tool.id, {
      id: tool.id, name: tool.name, description: tool.description, category: tool.category,
      enabled: true, active: true, created_at: now, updated_at: now,
    });
    toolCount++;
  }
  log.info(`[seed] ✅ ${toolCount} tools re-seeded`);

  // ── Skills: re-seed from the bundled skill files ──
  const skillsCol = await col<SkillDoc>("skills");
  const skillLoader = new SkillLoader({ workspacePath: process.env.HIVE_HOME || process.cwd() });
  const realSkills = skillLoader.loadBundledSkills();
  log.info(`[seed] 📚 SkillLoader cargó ${realSkills.length} bundled skills`);

  let skillCount = 0;
  for (const s of realSkills) {
    await skillsCol.put(s.name, {
      id: s.name,
      name: s.name,
      description: s.description || "",
      version: typeof s.version === "string" ? s.version : String(s.version || "0.0.1"),
      author: s.author || "Anonymous",
      icon: s.icon || "🧩",
      category: s.category || "general",
      permissions: JSON.stringify(s.permissions || []),
      dependencies: JSON.stringify(s.dependencies || []),
      tools: (s.tools || []).join(","),
      triggers: (s.triggers || []).join(","),
      preferred_agents: JSON.stringify(s.preferred_agents || []),
      body: s.content || "",
      version_num: parseInt(String(s.version || "0.0.1").split(".")[0]) || 1,
      active: true,
      created_at: now,
      updated_at: now,
    });
    skillCount++;
  }
  log.info(`[seed] ✅ ${skillCount} skills re-seeded (search index syncs at startup)`);

  await pruneRetired();
}

export async function seedAllData(): Promise<void> {
  log.info("[seed] 🌱 Iniciando seed de datos predeterminados...")

  await reseedToolsAndSkills();

  try {
    const now = Date.now();

    // 3️⃣ Ethics templates (globales)
    const ethicsCol = await col<EthicsDoc>("ethics");
    let ethicsCount = 0;
    for (const ethics of SEED_DATA.ethics) {
      await putIfAbsent(ethicsCol, ethics.id, {
        id: ethics.id, name: ethics.name, description: ethics.description, content: ethics.content,
        is_default: ethics.isDefault, enabled: true, active: ethics.isDefault,
      });
      ethicsCount++;
    }
    log.info(`[seed] ✅ ${ethicsCount} ethics templates procesados`);

    // 4️⃣ Providers
    const providersCol = await col<ProviderDoc>("providers");
    let providerCount = 0;
    for (const provider of SEED_DATA.providers) {
      await putIfAbsent(providersCol, provider.id, {
        id: provider.id, name: provider.name, base_url: provider.baseUrl || null,
        category: (provider.category || "llm") as ProviderDoc["category"],
        num_ctx: null, num_gpu: -1, enabled: false, active: false, created_at: now,
      });
      providerCount++;
    }
    // If OLLAMA_HOST is set (e.g. Docker pointing to host machine), always update Ollama's base_url
    const ollamaHost = process.env.OLLAMA_HOST;
    if (ollamaHost) {
      const ollama = await providersCol.get("ollama");
      if (ollama) {
        await providersCol.put("ollama", { ...ollama.doc, base_url: ollamaHost }, { expectedVersion: ollama.version });
        log.info(`[seed] ✅ Ollama base_url set to ${ollamaHost} (from OLLAMA_HOST env)`);
      }
    }
    // Older DBs were seeded with enabled=true hardcoded regardless of the user's own
    // activation (active). enabled/active are otherwise always kept in sync by every
    // mutation path (toggle, update, voice key save), so reconciling them here undoes
    // exactly that stale default without touching providers the user genuinely activated.
    let reconciledCount = 0;
    for (const row of await providersCol.scan({})) {
      if (row.doc.enabled !== row.doc.active) {
        await providersCol.put(row.id, { ...row.doc, enabled: row.doc.active }, { expectedVersion: row.version });
        reconciledCount++;
      }
    }
    if (reconciledCount > 0) {
      log.info(`[seed] 🔧 Reconciled ${reconciledCount} provider(s) with a stale enabled≠active state`);
    }
    log.info(`[seed] ✅ ${providerCount} providers procesados`);

    // 5️⃣ Models — wipe & recreate.
    //
    // Actualizar el catálogo es editar SEED_DATA.models y arrancar: las filas de
    // catálogo se borran enteras y se vuelven a crear, así ningún campo viejo
    // (context_window, capabilities, precio) sobrevive a una entrada renombrada
    // o corregida. Un upsert en sitio no daba esa garantía.
    //
    // Dos cosas sí se preservan a propósito:
    //   - enabled/active por id, para no desactivar el modelo que el usuario
    //     eligió cada vez que se publica un catálogo nuevo;
    //   - las filas source != "catalog" (Ollama tags, /v1/models), que no tienen
    //     origen canónico desde el que recrearse.
    log.info("[seed] 🔄 Re-seeding models (wipe & recreate)...");
    const modelsCol = await col<ModelDoc>("models");
    const beforeWipe = await modelsCol.scan({});

    const activationState = new Map(
      beforeWipe.map((e) => [e.id, { enabled: e.doc.enabled, active: e.doc.active }])
    );

    let wipedModels = 0;
    for (const row of beforeWipe) {
      if (row.doc.source !== "catalog") continue;
      await modelsCol.delete(row.id);
      wipedModels++;
    }

    let modelCount = 0;
    for (const model of SEED_DATA.models) {
      const key = catalogModelKey(model.providerId, model.id);
      const previous = activationState.get(key);
      await modelsCol.put(key, {
        id: key, provider_id: model.providerId, name: model.name,
        model_type: model.modelType as ModelDoc["model_type"],
        context_window: model.contextWindow || 0, capabilities: model.capabilities || null,
        enabled: previous?.enabled ?? true, active: previous?.active ?? false,
        source: "catalog",
        input_per_1m: model.inputPer1M ?? null,
        output_per_1m: model.outputPer1M ?? null,
      });
      modelCount++;
    }
    log.info(`[seed] 🗑️  ${wipedModels} modelo(s) de catálogo borrados y recreados desde SEED_DATA`);
    invalidateModelPricingCache();

    // An agent pointing at a model that just got removed would otherwise keep
    // a dangling model_id — unlink it so loadAgentConfigFromDB() falls back to
    // getDefaultLLM() instead of resolving a model_id that isn't there.
    const liveModelIds = new Set((await modelsCol.scan({})).map((e) => e.id));
    const agentsCol = await col<AgentDoc>("agents");
    const allAgents = await agentsCol.scan({});
    let unlinkedCount = 0;
    for (const a of allAgents) {
      if (a.doc.model_id && a.doc.model_id !== "__none__" && !liveModelIds.has(a.doc.model_id)) {
        await agentsCol.put(a.id, { ...a.doc, model_id: toIndexable(null) }, { expectedVersion: a.version });
        unlinkedCount++;
      }
    }
    if (unlinkedCount > 0) {
      log.info(`[seed] 🔗 Unlinked ${unlinkedCount} agent(s) from model(s) no longer in the catalog`);
    }
    log.info(`[seed] ✅ ${modelCount} models procesados`);

    // 6️⃣ MCP servers
    const mcpCol = await col<McpServerDoc>("mcpServers");
    let mcpCount = 0;
    for (const mcp of SEED_DATA.mcpServers) {
      await putIfAbsent(mcpCol, mcp.id, {
        id: mcp.id, name: mcp.name, transport: mcp.transport, command: mcp.command || null,
        args: JSON.stringify(mcp.args || []), url: (mcp as any).url || null,
        enabled: true, active: false, builtin: mcp.builtin, status: "disconnected", tools_count: 0,
      });
      mcpCount++;
    }
    log.info(`[seed] ✅ ${mcpCount} MCP servers procesados`);

    // Catalog agents (the curated personas) are seeded directly as `agents`
    // rows. Existing user choices remain untouched; narrowly identified
    // factory values from older releases are migrated in place.
    let catalogAgentCount = 0;
    for (const catalogAgent of createSeedCatalogAgents()) {
      await putIfAbsent(agentsCol, catalogAgent.id, catalogAgent);
      const existing = await agentsCol.get(catalogAgent.id);
      if (!existing || existing.doc.source !== "catalog") {
        catalogAgentCount++;
        continue;
      }

      let reconciled = migrateLegacyCatalogPersona(existing.doc, catalogAgent);
      // Older releases could mark permanent catalog capabilities as archived.
      // Archiving is no longer automatic, and catalog rows are never valid
      // archive targets, so repair only that stale status on every boot while
      // preserving the user's enabled/disabled choice.
      if (reconciled.status === "archived") {
        reconciled = { ...reconciled, status: "idle" };
      }
      if (JSON.stringify(reconciled) !== JSON.stringify(existing.doc)) {
        await agentsCol.put(
          existing.id,
          { ...reconciled, updated_at: now },
          { expectedVersion: existing.version },
        );
      }
      catalogAgentCount++;
    }
    log.info(`[seed] ✅ ${catalogAgentCount} catalog agents ensured`);

    // Catalog rows are born without a provider/model (no provider exists at
    // first boot), and setup only runs once — so anything that arrives later
    // (a persona added by an upgrade, an install configured before setup
    // seeded the models, an agent unlinked above) would stay blank forever.
    // Fill those from the configured coordinator; rows that already have their
    // own pair are left alone. No-op while there is no coordinator yet.
    const configuredAgents = await ensureAgentsConfigured();
    if (configuredAgents > 0) {
      log.info(`[seed] 🔧 ${configuredAgents} agent(s) configurados con el modelo del coordinador`);
    }

    // Coordinators created before a prompt change keep the old stock text in
    // their row (setup only runs once), so upgrade those in place. Prompts the
    // user rewrote are detected and left alone.
    const { refreshCoordinatorPrompts } = await import("./onboarding");
    const refreshedPrompts = await refreshCoordinatorPrompts();
    if (refreshedPrompts > 0) {
      log.info(`[seed] 🔄 ${refreshedPrompts} coordinador(es) actualizados al system prompt vigente`);
    }

    // 7️⃣ Channels
    const channelsCol = await col<ChannelDoc>("channels");
    let channelCount = 0;
    for (const channel of SEED_DATA.channels) {
      await putIfAbsent(channelsCol, channel.id, {
        id: channel.id, user_id: toIndexable(null), type: channel.type, enabled: true, active: false,
        status: "disconnected", last_active: null, voice_enabled: false, tts_enabled: false,
        stt_provider: null, tts_provider: null, tts_voice_id: null, step_delivery_mode: "milestones",
        vision_enabled: false, ocr_provider: null, vision_provider: null, vision_model_id: null,
      });
      channelCount++;
    }
    log.info(`[seed] ✅ ${channelCount} channels procesados`);

    // WebChat siempre activo — no requiere credenciales
    const webchat = await channelsCol.get("webchat");
    if (webchat) {
      await channelsCol.put("webchat", { ...webchat.doc, active: true, enabled: true, status: "connected" }, { expectedVersion: webchat.version });
    }
    log.info("[seed] ✅ webchat activado por defecto");

    // 🔟 ACE Playbook - Initial rules for Agentic Context Engineering
    const playbookCol = await col<PlaybookDoc>("playbook");
    const existingPlaybook = await playbookCol.scan({});
    const byRule = new Map(existingPlaybook.map((e) => [e.doc.rule, e]));

    let playbookCount = 0
    for (const rule of INITIAL_PLAYBOOK_RULES) {
      const existing = byRule.get(rule.rule);
      if (existing) {
        await playbookCol.put(existing.id, {
          ...existing.doc, category: rule.category, applicable_to: rule.applicable_to, active: true, updated_at: now,
        }, { expectedVersion: existing.version });
      } else {
        const id = await nextId("playbook");
        await playbookCol.put(id, {
          id, rule: rule.rule, category: rule.category, applicable_to: rule.applicable_to,
          helpful_count: 1, harmful_count: 0, active: true,
          source_reflection_id: toIndexable(null), created_at: now, updated_at: now,
        });
      }
      playbookCount++
    }
    log.info(`[seed] ✅ ${playbookCount} ACE playbook rules seeded`);

    // Playbook search indexing happens at startup via syncPlaybookToIndex (HiveDB)

    log.info("[seed] ✨ Seed completado exitosamente.");
  } catch (err) {
    log.error("[seed] ❌ Error durante el seed:", (err as Error).message);
  }
}

export async function seedToolsAndSkills(): Promise<void> {
  await seedAllData()
}

const TABLE_TO_COLLECTION: Record<string, string> = {
  providers: "providers", models: "models", tools: "tools", skills: "skills",
  mcp_servers: "mcpServers", channels: "channels", ethics: "ethics",
}

/**
 * Activa un elemento específico (los datos son globales, solo actualizamos active)
 */
export async function activateElement(
  table: "providers" | "models" | "tools" | "skills" | "mcp_servers" | "channels" | "ethics",
  elementId: string
): Promise<void> {
  const c = await col<any>(TABLE_TO_COLLECTION[table] || table)
  const existing = await c.get(elementId)
  if (existing) await c.put(elementId, { ...existing.doc, active: true, enabled: true }, { expectedVersion: existing.version })
  log.info(`[seed] ✅ Activado ${elementId} en ${table}`)
}

/**
 * Desactiva un elemento específico
 */
export async function deactivateElement(
  table: "providers" | "models" | "tools" | "skills" | "mcp_servers" | "channels",
  elementId: string
): Promise<void> {
  const c = await col<any>(TABLE_TO_COLLECTION[table] || table)
  const existing = await c.get(elementId)
  if (existing) await c.put(elementId, { ...existing.doc, active: false, enabled: false }, { expectedVersion: existing.version })
  log.warn(`[seed] ⚠️  Desactivado ${elementId} en ${table}`)
}

/**
 * Obtiene todos los elementos disponibles (activos e inactivos)
 */
export async function getAllElements<T>(table: string): Promise<T[]> {
  const c = await col<T>(TABLE_TO_COLLECTION[table] || table)
  const entries = await c.scan({})
  return entries.map((e) => e.doc)
}

/**
 * Obtiene todos los elementos activos
 */
export async function getActiveElements<T extends { active: boolean }>(table: string): Promise<T[]> {
  const all = await getAllElements<T>(table)
  return all.filter((e) => e.active)
}
