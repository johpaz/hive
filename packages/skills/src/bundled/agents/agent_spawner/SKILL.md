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
tools: [get_available_models, find_agent, create_agent, archive_agent]

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
    action: find_agent
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
    action: create_agent
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
    action: archive_agent (if needed)
    instruction: "Archive workers that are no longer needed or inactive >14 days"
    params:
      agent_id: "agent to archive"
      reason: "no longer needed"
    output: archived

rules:
  - "ALWAYS use find_agent BEFORE create_agent — never duplicate workers"
  - "ALWAYS use get_available_models BEFORE create_agent — providerId y modelId son OBLIGATORIOS"
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
    expected_behavior: "find_agent('researcher') → if not exists, create_agent({ name: 'ai_researcher', tools: ['web_search', 'web_fetch'] })"

  - user_input: "hay un worker para escribir contenido"
    expected_behavior: "find_agent({ search: 'writer' }) → return existing writer agents"

  - user_input: "archivá los agentes inactivos"
    expected_behavior: "find_agent({ status: 'idle' }) → archive_agent for those inactive >14 days"
---

# Agent Spawner Skill

## Cuándo se Activa

Para crear nuevos workers especializados o gestionar el ciclo de vida de agents existentes.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `get_available_models` | Consulta providers y modelos activos de la BD | **ANTES de crear** — seleccionar modelo óptimo |
| `find_agent` | Busca agents existentes | **PRIMERO** — antes de crear |
| `create_agent` | Crea nuevo worker | Si no existe apto |
| `archive_agent` | Archiva worker | Limpieza, inactivos |

## Workflow

### Crear Agent
1. **Buscar** → `find_agent({ search })` — ¿existe?
2. **Si existe** → Reutilizar
3. **Si no existe** → `get_available_models({ capabilities })` — seleccionar modelo óptimo
4. **Crear** → `create_agent({...})` con providerId y modelId seleccionados

### Create Agent Config
```javascript
// 1. Consultar modelos disponibles para coding
get_available_models({ capabilities: "coding" })
// → [{ providerId: "openai", modelId: "gpt-4o", contextWindow: 128000 }, ...]

// 2. Crear agente con modelo óptimo (providerId y modelId son OBLIGATORIOS)
create_agent({
  name: "ai_coder",
  description: "Especialista en código y refactorización",
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
