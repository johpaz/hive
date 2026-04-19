# Stack Tecnológico - Hive 🐝

> Última actualización: Abril 2026 | Versión: 0.0.25

---

## 📋 Resumen Ejecutivo

Hive es un **Gateway de IA Orquestado** con arquitectura de enjambre (swarm) de agentes especializados. Es **local-first**, **multi-canal**, **open source** (MIT), y está construido desde Colombia.

---

## 🤖 AI Models & Providers

### Modelos de LLM Soportados

| Provider | Modelos | SDK | Tipo |
|----------|---------|-----|------|
| **OpenAI** | GPT-4, GPT-4o, GPT-4o-mini, o1, o3 | `openai` v6.18.0 | Cloud API |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus | `@anthropic-ai/sdk` v0.74.0 | Cloud API |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash | `@google/genai` v1.43.0 | Cloud API |
| **Groq** | Llama 3, Mixtral, Gemma (inferencia rápida) | `groq-sdk` v0.37.0 | Cloud API |
| **Ollama** | Llama 3, Mistral, Phi, Qwen, CodeLlama (local) | `ollama` v0.6.3 | Local inference |

---

## 🛠️ Native Tools (73 herramientas)

### System & File Operations
- `read` - Leer archivos
- `write` - Escribir archivos
- `edit` - Editar archivos (search & replace)
- `move` - Mover archivos/directorios
- `copy` - Copiar archivos/directorios
- `delete` - Eliminar archivos/directorios
- `list` - Listar directorios
- `search_files` - Buscar archivos por nombre/patrón

### Web & Browser
- `browse` - Navegar URLs
- `screenshot` - Capturas de pantalla web
- `search_web` - Búsqueda web
- `extract_content` - Extraer contenido de páginas
- `click` - Interacciones con elementos web

### Scheduling & Automation
- `cron_add` - Crear tareas programadas
- `cron_list` - Listar tareas programadas
- `cron_remove` - Eliminar tareas programadas
- `cron_edit` - Editar tareas programadas

### Project Management
- `project_create` - Crear proyectos
- `task_create` - Crear tareas
- `task_update` - Actualizar estado de tareas
- `task_list` - Listar tareas
- `find_agent` - Buscar agentes por FTS5

### Agent Management
- `create_agent` - Crear nuevos agentes
- `assign_task` - Asignar tareas a agentes
- `save_note` - Guardar notas en scratchpad
- `notify` - Enviar notificaciones
- `report_progress` - Reportar progreso

### Code & Development
- `run_command` - Ejecutar comandos shell
- `install_package` - Instalar dependencias
- `code_execute` - Ejecutar código
- `code_lint` - Linting de código
- `code_test` - Ejecutar tests

### Document & Office
- `read_pdf` / `write_pdf`
- `read_word` / `write_word`
- `read_excel` / `write_excel`
- `read_powerpoint` / `write_powerpoint`

### Canvas & Visualization
- `draw` - Dibujar en canvas
- `annotate` - Anotar visualizaciones
- `export_canvas` - Exportar visualizaciones

### Voice
- `speech_to_text` - Transcripción de voz
- `text_to_speech` - Síntesis de voz

---

## 📚 Frameworks & Libraries

### AI Agent Frameworks
| Framework | Versión | Propósito |
|-----------|---------|-----------|
| **@ag-ui/core** | v0.0.46 | Agent UI protocol para comunicación agent-UI |
| **@modelcontextprotocol/sdk** | v1.26.0 | Model Context Protocol (MCP) para extensibilidad |

### Messaging & Channel SDKs
| SDK | Versión | Canal |
|-----|---------|-------|
| **grammy** | latest | Telegram Bot API |
| **discord.js** | latest | Discord API |
| **@whiskeysockets/baileys** | latest | WhatsApp Web API |
| **@slack/bolt** | latest | Slack Bolt API |

### Core Libraries
| Library | Versión | Propósito |
|---------|---------|-----------|
| **zod** | latest | Schema validation & type safety |
| **jsonwebtoken** | v9.0.3 | JWT authentication tokens |
| **isomorphic-git** | v1.37.2 | Git operations (sin CLI) |
| **js-yaml** | v4.1.1 | YAML parsing para configuración |
| **cron-parser** | v5.5.0 | Parsing de expresiones cron |
| **croner** | v10.0.1 | Task scheduling engine |
| **async-mutex** | v0.5.0 | Mutex para concurrencia |
| **react-markdown** | v10.1.0 | Markdown rendering en UI |
| **@clack/prompts** | v0.5.0 | CLI prompts interactivos |
| **qrcode-terminal** | latest | QR codes en terminal |
| **toon-format-parser** | v1.1.0 | Format parsing |
| **@sapphire/snowflake** | latest | ID generation (snowflake IDs) |
| **groq-sdk** | v0.37.0 | Groq API client |
| **openai** | v6.18.0 | OpenAI API client |
| **@anthropic-ai/sdk** | v0.74.0 | Anthropic API client |
| **@google/genai** | v1.43.0 | Google AI client |
| **ollama** | v0.6.3 | Ollama local inference client |

---

## 🌐 APIs & Protocols

### AI APIs
- **OpenAI API** - GPT models (chat completions, embeddings)
- **Anthropic API** - Claude models (messages API)
- **Google AI Studio API** - Gemini models (generateContent)
- **Groq API** - Fast inference API (cloud)
- **Ollama API** - Local model inference (localhost:11434)

### Messaging APIs
- **Telegram Bot API** - Via grammy framework
- **Discord Gateway API** - Via discord.js (WebSocket gateway)
- **WhatsApp Web API** - Via Baileys (WhatsApp Web protocol)
- **Slack Events API** - Via @slack/bolt (Events API + Bolt framework)

### Protocols
- **MCP (Model Context Protocol)** - Extensión de herramientas vía servidores MCP
- **AG-UI Protocol** - Comunicación agent-UI
- **HTTP REST API** - Gateway HTTP (puerto 18790)
- **WebSocket** - Real-time communication para WebChat

---

## 🏗️ Architecture Patterns

### Native Agent Loop
```
mensaje entrante
  → Context Compiler (compileContext)
      → callLLM()
          → [executeTool() → callLLM()]*
              → respuesta al usuario
```

### Context Engineering (4 estrategias)
| Estrategia | Implementación |
|------------|----------------|
| **SELECCIONAR** | Historial inteligente: conversaciones cortas = todos los mensajes; largas = summaries + últimos N |
| **ESCRIBIR** | Scratchpad persistente (tabla `scratchpad`) inyectado en system prompt |
| **APRENDER** | Playbook con FTS5 (Full-Text Search) - reglas auto-aprendidas por ACE |
| **AISLAR** | Tool filtering en 3 niveles: catálogo → agente → turno (máx. 20 tools) |

### ACE (Adaptive Context Engine)
| Componente | Tabla SQLite | Función |
|------------|--------------|---------|
| **Tracer** | `traces` | Guarda ejecuciones (agente, tool, input, output, tokens, latency) |
| **Reflector** | `reflections` | Análisis periódico de patrones (cada 20 trazas) |
| **Curator** | `playbook` | Crea reglas operativas automáticamente |

### Multi-Agent Swarm
- **Coordinador**: Gateway central que orquesta el enjambre
- **Workers**: Agentes especializados ejecutan tareas en paralelo (Promise.all)
- **Project System**: Descomposición de problemas complejos en proyectos con tareas
- **Dependency Resolution**: Ejecución respeta dependencias entre tareas

---

## 💾 Storage & Database

### SQLite Tables
| Tabla | Propósito |
|-------|-----------|
| `agents` | Configuración de agentes (name, description, system_prompt, tools_json) |
| `conversations` | Historial de conversaciones |
| `messages` | Mensajes individuales |
| `summaries` | Resúmenes de conversaciones largas |
| `scratchpad` | Notas persistentes por thread |
| `playbook` | Reglas de comportamiento (FTS5 index) |
| `ethics` | Reglas constitucionales (siempre inyectadas) |
| `traces` | Trazas de ejecución (Tracer) |
| `reflections` | Insights del Reflector |
| `tools` | Catálogo de herramientas |
| `projects` | Proyectos complejos |
| `tasks` | Tareas dentro de proyectos |
| `users` | Perfiles de usuarios |
| `hive_capabilities` | Manifest de capacidades del sistema |

### Crypto & Security
- Encriptación de API keys y datos sensibles
- JWT para autenticación de sesiones
- Workspace isolation (agente solo accede a path configurado)

---

## 📦 Platform Support

### Operating Systems
- **Linux** x64/ARM64 (incluye Raspberry Pi)
- **macOS** Apple Silicon (M1/M2/M3/M4) + Intel
- **Windows** x64

### Deployment Methods
| Método | Tamaño | Requirements | Ideal para |
|--------|--------|--------------|------------|
| **Docker** | ~120 MB | Docker | Servers, VPS, Raspberry Pi |
| **Binary Standalone** | ~50 MB | Ninguno | USB, laptops, uso personal |
| **npm package** | ~12 MB | Bun runtime | Developers |

### Hardware Minimum
- **Raspberry Pi Zero 2W** con 512 MB RAM
- Todo el runtime cabe en dispositivos con recursos limitados

---

## 🌍 Ecosystem & Integrations

### External Services
- **Docker Hub** - Container registry (johpaz/hive-agents)
- **npm Registry** - Package distribution (@johpaz/hive-agents)
- **GitHub Releases** - Binary distribution

### File Formats Supported
- **Documents:** PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx)
- **Code:** JavaScript, TypeScript, Python, y más (vía shell execution)
- **Config:** YAML, JSON
- **Markup:** Markdown

---

## 📊 Codebase Statistics

```
Language          files     blank   comment      code
─────────────────────────────────────────────────────
TypeScript          434      7671      2683     51937
Markdown             45      2225         0      8233
JSON                 15         5         0       575
CSS                   1       141        29       450
YAML                  2        35        11       197
Shell                 2        14         5        61
Dockerfile            1        19        10        38
─────────────────────────────────────────────────────
TOTAL               504     10119      2741     61546
```

---

## 📚 Resources

- **Repository:** https://github.com/johpaz/hive
- **npm:** https://www.npmjs.com/package/@johpaz/hive-agents
- **Website:** https://hiveagents.io
- **License:** MIT
- **Origin:** 🇨🇴 Colombia

---

*Document generated automatically - April 2026*
