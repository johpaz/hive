---
name: task_orchestrator
description: "Orchestrate tasks across multiple workers with delegation, status tracking, and bus communication"
version: 1.1.0
author: Hive Team
icon: "🎻"
category: agents
permissions:
  - agent_manage
  - agent_bus
dependencies: []
tools: [get_available_models, task_delegate, task_status, agent_find, agent_create, bus_publish, bus_read]

# Structured skill fields
triggers:
  - "delegá esta tarea"
  - "delegate task"
  - "orquestá los workers"
  - "orchestrate workers"
  - "coordiná el equipo"
  - "coordinate team"
  - "estado de las tareas"
  - "task status"
  - "comunicá los workers"
  - "communicate workers"
  - "mensaje al bus"
  - "bus message"
  - "tarea en paralelo"
  - "parallel tasks"

preferred_agents: []

steps:
  - step: 1
    action: get_available_models
    instruction: "Query available providers and models to select optimal model for new workers if needed"
    params:
      capabilities: "required specialty (coding, analysis, research)"
    output: available_models

  - step: 2
    action: agent_find
    instruction: "Find suitable workers for each task"
    params:
      search: "required specialty"
    output: available_workers

  - step: 3
    action: agent_create (if needed)
    instruction: "Create new worker if no suitable one exists, using optimal model from get_available_models"
    params:
      name: "specialty_worker"
      providerId: "from get_available_models"
      modelId: "from get_available_models"
    output: new_worker

  - step: 4
    action: task_delegate
    instruction: "Delegate tasks to workers with clear instructions. Workers execute immediately (blocking)"
    params:
      worker_id: "selected worker ID"
      task_description: "Clear detailed instructions"
      task_id: "optional task DB ID for auto status update"
      project_id: "optional project ID for progress tracking"
    output: task_result

  - step: 5
    action: task_status
    instruction: "Monitor progress of delegated tasks"
    params:
      task_ids: "array of task IDs"
    output: task_statuses

  - step: 6
    action: bus_publish
    instruction: "Publish coordination messages for worker-to-worker communication"
    params:
      event_type: "coordination"
      to_worker_id: "target worker"
      content: "coordination message"
    output: published

  - step: 7
    action: bus_read
    instruction: "Check for messages from workers requiring coordinator attention"
    output: bus_messages

rules:
  - "task_delegate is BLOCKING — worker executes immediately, result returned synchronously"
  - "ALWAYS use get_available_models BEFORE agent_create — providerId y modelId son OBLIGATORIOS"
  - "Assign tasks based on worker specialty and current load"
  - "Use bus_publish / bus_read for worker-to-worker coordination"
  - "Monitor task status continuously for multi-task orchestration"
  - "Publish to bus when workers need to share context"
  - "Check bus messages for worker requests or completion notifications"

output_format:
  structure: markdown
  sections:
    - "tasks_delegated"
    - "workers_assigned"
    - "current_status"
    - "bus_messages"
  max_length: "Orchestration summary"

examples:
  - user_input: "delegá la investigación y generación de contenido a workers"
    expected_behavior: "find_agent('researcher') → delegate_task → find_agent('writer') → delegate_task → monitor both"

  - user_input: "cuál es el estado de las tareas"
    expected_behavior: "get_task_status({ task_ids: [...] }) → return status for each task"

  - user_input: "avisale al writer que el researcher terminó"
    expected_behavior: "publish_to_bus({ to_worker_id: 'writer', content: 'Research complete, ready for content generation' })"
---

# Task Orchestrator Skill

## Cuándo se Activa

Para coordinar múltiples workers, delegar tareas, monitorear progreso, y facilitar comunicación worker-to-worker.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `get_available_models` | Consulta providers y modelos activos | Al crear workers — seleccionar modelo óptimo |
| `agent_find` | Busca workers disponibles | Antes de delegar |
| `agent_create` | Crea nuevo worker | Si no hay uno adecuado |
| `task_delegate` | Asigna y EJECUTA tarea | Delegar con ejecución inmediata |
| `task_status` | Verifica estado de tareas | Monitorear progreso |
| `bus_publish` | Publica mensaje | Coordinación worker-to-worker |
| `bus_read` | Lee mensajes del bus | Ver solicitudes de workers |

## Workflow

### Delegación
1. **Consultar modelos** → `get_available_models({ capabilities })` — si necesita crear workers
2. **Buscar worker** → `agent_find({ search })`
3. **Si no existe** → `agent_create({...})` — con providerId y modelId OBLIGATORIOS
4. **Delegar** → `task_delegate({ worker_id, task_description, task_id?, project_id? })` — **BLOQUEANTE**
5. **Resultado retornado** → Worker ejecuta inmediatamente y devuelve resultado

### Create Agent Config (providerId y modelId son OBLIGATORIOS)
```javascript
// 1. Consultar modelos disponibles
get_available_models({ capabilities: "analysis" })
// → [{ providerId: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 200000 }, ...]

// 2. Crear worker con modelo óptimo
agent_create({
  name: "data_analyst",
  description: "Especialista en análisis de datos y visualización",
  system_prompt: "Sos analista de datos experto...",
  tools_json: ["web_search", "web_fetch", "save_note"],
  providerId: "anthropic",  // OBLIGATORIO
  modelId: "claude-sonnet-4-6",  // OBLIGATORIO
  tone: "analytical"
})
```

### Monitoreo
1. **Check estado** → `task_status({ task_ids })`
2. **Publicar coordinación** → `bus_publish()` si needed
3. **Leer bus** → `bus_read()` para respuestas

## Agent Bus Communication

```javascript
// Worker notifica completado:
bus_publish({
  event_type: "task_complete",
  to_worker_id: "next_worker",
  content: "Research done. Found 7 trends. Ready for content generation."
})

// Worker solicita contexto:
bus_read() → [{ from: "writer", content: "Need research results" }]
```

## Mejores Prácticas

- `task_delegate` es bloqueante — el resultado llega en el retorno de la tool
- Consultar modelos disponibles antes de crear workers (`get_available_models`)
- Asignar workers por especialidad (`agent_find`)
- Usar `bus_publish` / `bus_read` para coordinación entre workers
- Pasar `task_id` y `project_id` a `task_delegate` para auto-tracking de progreso
- Seleccionar modelo según capacidad: coding → modelos grandes, chat → modelos rápidos

## Errores a Evitar

- ❌ Usar `delegate_task` (no existe) — usar `task_delegate`
- ❌ Usar `find_agent` (no existe) — usar `agent_find`
- ❌ Usar `publish_to_bus` / `get_bus_messages` (no existen) — usar `bus_publish` / `bus_read`
- ❌ Usar `get_task_status` (no existe) — usar `task_status`
- ❌ No consultar modelos disponibles antes de crear workers
- ❌ No monitorear estado de tasks
- ❌ No coordinar workers cuando hay dependencias
