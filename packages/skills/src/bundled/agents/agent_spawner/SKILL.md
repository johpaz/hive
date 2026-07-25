---
name: agent_spawner
description: "Create and manage specialized worker agents with optimal tool assignments and lifecycle control"
version: 1.1.0
author: Hive Team
icon: "🤖"
category: agents
permissions:
  - agent_manage
dependencies: []
tools: [get_available_models, agent_find, agent_create, agent_archive]

# Structured skill fields
triggers:
  - "creá un agente"
  - "create agent"
  - "creá un worker"
  - "create worker"
  - "nuevo agente"
  - "new agent"
  - "agente especializado"
  - "specialized agent"
  - "buscá un agente"
  - "find agent"
  - "archivá agente"
  - "archive agent"
  - "worker inactivo"
  - "inactive worker"

preferred_agents: []

steps:
  - step: 1
    action: agent_find
    instruction: "Search for existing agents before creating new one"
    params:
      search: "agent name or specialty"
      status: "idle"
    output: existing_agents

  - step: 2
    action: decision_reuse_or_create
    instruction: "If suitable agent exists, reuse it. Otherwise, proceed to create"
    output: decision

  - step: 3
    action: get_available_models
    instruction: "Query available providers and models from database to select optimal model for the agent"
    params:
      capabilities: "required capability (coding, chat, analysis, vision)"
      modelType: "llm (default)"
    output: available_models

  - step: 4
    action: agent_create
    instruction: "Create new worker with focused system_prompt, minimal tools, and optimal provider/model"
    params:
      name: "specialty_name"
      description: "Clear specialty description"
      system_prompt: "Focused instructions for role"
      tools_json: ["minimal", "required", "tools"]
      providerId: "selected from get_available_models"
      modelId: "selected from get_available_models"
    output: new_agent_id

  - step: 5
    action: agent_archive (if needed)
    instruction: "Archive workers that are no longer needed or inactive >14 days"
    params:
      agent_id: "agent to archive"
      reason: "no longer needed"
    output: archived

rules:
  - "The COLMENA DE AGENTES catalog workers already cover web, browser, files, code, Office, A2UI, cron, APIs and MCP — creating a new worker is a LAST RESORT, not the default path"
  - "ALWAYS use agent_find BEFORE agent_create — never duplicate workers"
  - "ALWAYS use get_available_models BEFORE agent_create — providerId y modelId son OBLIGATORIOS"
  - "Workers have role='worker', coordinator has role='coordinator'"
  - "Assign MINIMUM required tools (principle of least privilege)"
  - "system_prompt must be specific and focused on specialty"
  - "Use descriptive names that indicate agent's purpose"
  - "Archive agents inactive >14 days (Curator does this automatically)"

output_format:
  structure: markdown
  sections:
    - "action_taken"
    - "agent_name"
    - "specialty"
    - "tools_assigned"
    - "status"
  max_length: "Agent creation/management summary"

examples:
  - user_input: "creá un agente para investigación web"
    expected_behavior: "agent_find('researcher') → if not exists, agent_create({ name: 'ai_researcher', tools: ['web_search', 'web_fetch'] })"

  - user_input: "hay un worker para escribir contenido"
    expected_behavior: "agent_find({ search: 'writer' }) → return existing writer agents"

  - user_input: "archivá los agentes inactivos"
    expected_behavior: "agent_find({ status: 'idle' }) → agent_archive for those inactive >14 days"
---

# Agent Spawner Skill

## Cuándo se Activa

Para crear nuevos workers especializados o gestionar el ciclo de vida de agents existentes.

> **Antes de crear nada**: la sección COLMENA DE AGENTES del system prompt ya lista workers listos para recibir trabajo (web, browser, archivos, código, Office, A2UI, cron, APIs, MCP). Crear un worker es el último recurso, cuando ninguno de ellos cubre la especialidad pedida.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `get_available_models` | Consulta providers y modelos activos de la BD | **ANTES de crear** — seleccionar modelo óptimo |
| `agent_find` | Busca agents existentes | **PRIMERO** — antes de crear |
| `agent_create` | Crea nuevo worker | Si no existe apto |
| `agent_archive` | Archiva worker | Limpieza, inactivos |

## Workflow

### Crear Agent
1. **Buscar** → `agent_find({ search })` — ¿existe?
2. **Si existe** → Reutilizar
3. **Si no existe** → `get_available_models({ capabilities })` — seleccionar modelo óptimo
4. **Crear** → `agent_create({...})` con providerId y modelId seleccionados

### Create Agent Config
```javascript
// 1. Consultar modelos disponibles para coding
get_available_models({ capabilities: "coding" })
// → [{ providerId: "openai", modelId: "gpt-4o", contextWindow: 128000 }, ...]

// 2. Crear agente con modelo óptimo (providerId y modelId son OBLIGATORIOS)
agent_create({
  name: "ai_coder",
  description: "Experto en código y refactorización",
  system_prompt: `
    Sos desarrollador experto. Tu rol:
    1. Escribir código limpio y testeable
    2. Refactorizar código existente
    3. Revisar PRs y sugerir mejoras
  `,
  tools_json: ["fs_read", "fs_write", "fs_edit", "cli_exec"],
  providerId: "openai",  // OBLIGATORIO - seleccionado de get_available_models
  modelId: "gpt-4o",     // OBLIGATORIO - seleccionado de get_available_models
  tone: "professional",
  max_iterations: 15
})
```

## Mejores Prácticas

- **Buscar primero**: Nunca duplicar workers
- **Consultar modelos**: Usar `get_available_models` ANTES de crear para seleccionar provider/model óptimo
- **System prompt específico**: Enfocado en especialidad
- **Mínimo privilegio**: Solo tools necesarias
- **Nombres descriptivos**: Que indiquen propósito
- **Modelo adecuado**: Seleccionar según capacidad requerida (coding, chat, analysis, vision)

## Errores a Evitar

- ❌ Crear sin buscar primero
- ❌ Crear sin consultar modelos disponibles (`get_available_models`)
- ❌ Usar modelo inadecuado para la tarea (ej: modelo pequeño para coding complejo)
- ❌ Tools en exceso ("por las dudas")
- ❌ System prompt genérico
- ❌ Nombres vagos ("worker1", "agent1")
