---
name: task_orchestrator
description: "Orchestrate tasks across multiple workers with delegation, status tracking, and bus communication"
version: 1.2.0
author: Hive Team
icon: "🎻"
category: agents
permissions:
  - agent_manage
  - agent_bus
dependencies: []
tools: [get_available_models, task_delegate, task_list, task_status, agent_find, agent_create, bus_publish, bus_read]

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
---
# Task Orchestrator — referencia operativa

La doctrina de orquestación (descomponer → delegar en paralelo → terminar el turno → sintetizar en el fan-in) está en tu system prompt. Esta skill es la referencia de las herramientas.

## Herramientas

| Tool | Qué hace | Cuándo |
|------|----------|--------|
| `task_delegate` | Persiste y asigna una tarea a un worker | Delegar. Preferí `mode="async"` |
| `agent_find` | Descubre workers del catálogo y propios | Antes de delegar. Nunca para comprobar ejecución |
| `task_list` | Lista ejecuciones reales persistidas | El usuario pregunta y no conocés IDs |
| `task_status` | Estado de tareas por ID | El usuario pide estado antes del fan-in |
| `get_available_models` | Providers y modelos activos | Antes de crear un worker |
| `agent_create` | Crea un worker nuevo | Último recurso: nada del catálogo sirve |
| `bus_publish` / `bus_read` | Mensajes entre workers | Dependencias entre workers en vuelo |

## Fan-out

```javascript
// Tres partes independientes → tres llamadas en la MISMA respuesta
task_delegate({ worker_id: "web_researcher",            task_description: "...", mode: "async" })
task_delegate({ worker_id: "office_document_agent",     task_description: "...", mode: "async" })
task_delegate({ worker_id: "schedule_automation_agent", task_description: "...", mode: "async" })
```

Cada llamada devuelve `task_id`, `job_id` y `run_id`: prueba de que la tarea quedó persistida.

## Fan-in

Hive te reinvoca con:

```
[Sistema] Todas las tareas delegadas de este turno alcanzaron estado terminal.
[{ task_id, worker_id, task, ok, result, error }, ...]
```

Sintetizá una sola respuesta. Las entradas con `ok: false` se reportan con su motivo real.

## Crear un worker (último recurso)

```javascript
get_available_models({ capabilities: "analysis" })
// → [{ providerId: "anthropic", modelId: "claude-sonnet-4-6", ... }]

agent_create({
  name: "data_analyst",
  description: "Experto en análisis de datos",
  system_prompt: "Sos analista de datos experto...",
  tools_json: ["web_search", "web_fetch", "save_note"],
  providerId: "anthropic",   // OBLIGATORIO
  modelId: "claude-sonnet-4-6", // OBLIGATORIO
})
```

## Errores a evitar

- ❌ Serializar tareas independientes en vez de fan-out paralelo
- ❌ Polling con `task_status` esperando el resultado — el fan-in llega solo
- ❌ Declarar éxito antes de recibir el `[Sistema]`, o presentar `ok=false` como éxito
- ❌ Delegar a `acceptance_verifier` manualmente — la verificación ya corrió
- ❌ Crear un worker que el catálogo ya cubre
- ❌ Delegar saludos, preguntas simples o la conversación
- ❌ Usar `delegate_task`, `find_agent`, `create_agent`, `get_task_status`, `publish_to_bus`, `get_bus_messages` — **no existen**
