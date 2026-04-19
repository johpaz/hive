---
name: cron_manager
description: "Complete management of cron jobs with cron expressions. Create, list, update, pause, resume, delete, trigger, and view history. Use for reminders, automated reports, periodic checks."
version: 2.0.0
author: Hive Team
icon: "⏰"
category: cron
permissions:
  - cron_manage
dependencies: []
tools: [cron.create, cron.list, cron.update, cron.delete, cron.pause, cron.resume, cron.trigger, cron.history]

# Structured skill fields
triggers:
  - "programá una tarea"
  - "schedule task"
  - "creá un cron"
  - "create cron"
  - "editá el cron"
  - "edit cron"
  - "eliminá el cron"
  - "remove cron"
  - "lista las tareas"
  - "list cron jobs"
  - "modificá el cron"
  - "modify cron"
  - "tarea recurrente"
  - "recurring task"
  - "todos los días"
  - "daily"
  - "cada semana"
  - "weekly"

preferred_agents: []

steps:
  - step: 1
    action: clarify_task
    instruction: "Ask if task is one_shot (single execution) or recurring (repeats). Get specific time and task instruction."
    output: task_type

  - step: 2
    action: build_cron_expression
    instruction: "For recurring: construct cron expression (minute hour day month weekday). For one_shot: get ISO datetime."
    output: cron_expression or fire_at

  - step: 3
    action: cron.create
    instruction: "Create new cron job with required 'task' field (instruction for the agent)"
    params:
      name: "Short identifier (e.g., 'daily-report')"
      task: "REQUIRED - Natural language instruction the agent reads when triggered (e.g., 'Generate sales report and send to Telegram')"
      task_type: "'recurring' or 'one_shot'"
      cron_expression: "Cron expression for recurring (e.g., '0 9 * * *')"
      fire_at: "ISO datetime for one_shot (e.g., '2026-04-20T09:00:00')"
      channel: "Notification channel (telegram, discord, webchat)"
      start_at: "Optional ISO datetime - start of execution window (Croner startAt)"
      stop_at: "Optional ISO datetime - end of execution window (Croner stopAt)"
      dom_and_dow: "0 = OR logic (default), 1 = AND logic for day-of-month + day-of-week"
      max_runs: "Optional max executions"
    output: cron_id

  - step: 4
    action: cron.list
    instruction: "List all cron jobs with next execution times"
    output: cron_jobs

rules:
  - "ALWAYS use cron.* tools — never exec/terminal"
  - "The 'task' field is REQUIRED and contains the instruction the agent reads when triggered"
  - "Ask if one_shot or recurring before creating"
  - "For one_shot: use fire_at with ISO datetime"
  - "For daily: 'MM HH * * *'"
  - "For weekly: 'MM HH * * N' (N=0-6, 0=Sun)"
  - "For monthly: 'MM HH D * *' (D=1-31)"
  - "Always show next 3 execution times after creating"
  - "Use start_at/stop_at to limit execution time window"
  - "Use dom_and_dow=1 to require BOTH day-of-month AND day-of-week"
  - "To edit: ALWAYS call cron.update with task_id (get from cron.list first)"

output_format:
  structure: markdown
  sections:
    - "job_name"
    - "task_instruction"
    - "cron_expression"
    - "next_executions"
  max_length: "List all jobs"

examples:
  - user_input: "programá un recordatorio diario a las 9am"
    expected_behavior: "cron.create({ name: 'daily-reminder', task: 'Send reminder message', task_type: 'recurring', cron_expression: '0 9 * * *', channel: 'telegram' })"

  - user_input: "lista las tareas programadas"
    expected_behavior: "cron.list({})"

  - user_input: "editá el cron para que sea a las 10am"
    expected_behavior: "cron.list() → get task_id → cron.update({ task_id: '<id>', cron_expression: '0 10 * * *' })"

  - user_input: "actualizá la instrucción del cron"
    expected_behavior: "cron.list() → get task_id → cron.update({ task_id: '<id>', task: 'New instruction for agent' })"

  - user_input: "elimina el cron"
    expected_behavior: "cron.list() → get task_id → cron.delete({ task_id: '<id>' })"
---

# Cron Manager Skill

## Cuándo se Activa

Para gestionar tareas programadas (cron jobs): crear, listar, actualizar, pausar, reanudar, eliminar, ejecutar y ver historial.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `cron.create` | Crear cron job | Nueva tarea |
| `cron.list` | Listar todos | Ver existentes |
| `cron.update` | Actualizar existente | Cambiar horario/instrucción |
| `cron.pause` | Pausar temporalmente | Sin eliminar |
| `cron.resume` | Reanudar pausado | Continuar ejecución |
| `cron.delete` | Eliminar permanentemente | Cancelar para siempre |
| `cron.trigger` | Ejecutar ahora | Forzar ejecución |
| `cron.history` | Ver historial | Ver logs de ejecuciones |

## Campos Principales

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | string | Identificador corto (e.g., 'daily-report') |
| `task` | string | **REQUERIDO** - Instrucciones para el agente al ejecutarse |
| `task_type` | string | 'recurring' (repite) o 'one_shot' (una vez) |
| `cron_expression` | string | Expresión cron (solo para recurring) |
| `fire_at` | string | Datetime ISO (solo para one_shot) |
| `channel` | string | Canal de notificación |
| `start_at` | string | Inicio de ventana opcional (Croner startAt) |
| `stop_at` | string | Fin de ventana opcional (Croner stopAt) |
| `dom_and_dow` | number | 0=OR (default), 1=AND (día mes + día semana) |

## Cron Expression Format

```
* * * * *
│ │ │ │ │
│ │ │ │ └── Día semana (0-6, 0=Domingo)
│ │ │ └──── Mes (1-12)
│ │ └────── Día del mes (1-31)
│ └──────── Hora (0-23)
└────────── Minuto (0-59)
```

## Ejemplos Comunes

| Expresión | Significado |
|-----------|-------------|
| `0 9 * * *` | Diario 9:00 AM |
| `0 7 * * 1-5` | Lun-Vie 7:00 AM |
| `0 */2 * * *` | Cada 2 horas |
| `0 0 * * 0` | Domingos medianoche |
| `0 0 1 * *` | Día 1 de cada mes |

## Cómo Usar start_at / stop_at

- `start_at`: La tarea no ejecuta antes de esta fecha
- `stop_at`: La tarea no ejecuta después de esta fecha
- Formato ISO: `'2026-04-01T00:00:00'`

## Cómo Usar dom_and_dow

- `0` (default): Se ejecuta si es el día del mes O el día de semana
- `1`: Se ejecuta solo si es EL MISMO día del mes Y el día de semana

Ejemplo: `0 9 15 * *` con dom_and_dow=1 significa "los 15 de cada mes QUE SEA domingo"

## Workflow para Crear

1. **Preguntar** → ¿one_shot o recurring?
2. **Obtener** → Hora y canal de notificación
3. **Crear** → `cron.create` con campo `task` obligatorio
4. **Confirmar** → `cron.list` mostrar next runs

## Errores a Evitar

- ❌ Olvidar el campo `task` — es obligatorio
- ❌ Usar exec para tareas programadas
- ❌ No preguntar si es one_shot o recurring
- ❌ No mostrar próximos horarios al crear
- ❌ Llamar `cron.update` sin `task_id` — siempre hacer `cron.list` primero