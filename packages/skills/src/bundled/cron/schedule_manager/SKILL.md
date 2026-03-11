---
name: schedule_manager
description: "Complete management of scheduled tasks with cron expressions including create, list, edit, and remove"
version: 1.1.0
author: Hive Team
icon: "⏰"
category: cron
permissions:
  - cron_manage
dependencies: []
tools: [cron_add, cron_list, cron_edit, cron_remove]

# Structured skill fields
triggers:
  - "programá una tarea"
  - "schedule task"
  - "creá un cron"
  - "create cron"
  - "editá el schedule"
  - "edit schedule"
  - "eliminá la tarea programada"
  - "remove scheduled task"
  - "lista las tareas programadas"
  - "list scheduled tasks"
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
    action: clarify_schedule
    instruction: "Ask user if task is one-time, daily, weekly, or monthly. Get specific time"
    output: schedule_type

  - step: 2
    action: build_cron_expression
    instruction: "Construct cron expression: minute hour day month weekday"
    output: cron_expression

  - step: 3
    action: cron_add or cron_edit
    instruction: "Create new task or modify existing one"
    params:
      name: "Task name"
      expression: "* * * * *"
      task: "Task description or projectId"
    output: cron_id

  - step: 4
    action: cron_list
    instruction: "Show all scheduled tasks with next execution times"
    output: scheduled_tasks

rules:
  - "NEVER use exec/terminal for scheduled tasks — always use cron_*"
  - "Ask if one-time or recurring before creating"
  - "For one-time: use '0 0 * * *' with maxRuns=1"
  - "For daily: 'MM HH * * *'"
  - "For weekly: 'MM HH * * N' (N=weekday 0-6)"
  - "For monthly: 'MM HH D * *' (D=day of month)"
  - "Always show next 3 execution times after creating"
  - "Cron expressions use SERVER local time (America/Bogota, UTC-5). When user says '9am', use that hour directly — do NOT convert to UTC"
  - "When editing: ALWAYS call cron_edit with jobId (get it from cron_list first)"
  - "cron_edit recalculates next_run automatically and stops the running instance — no gateway restart needed"
  - "After cron_edit, the new schedule activates within 30 seconds (polling interval)"
  - "If the target time has already passed TODAY, the cron fires at the next occurrence (tomorrow, next week, or next year depending on expression)"

output_format:
  structure: markdown
  sections:
    - "task_name"
    - "cron_expression"
    - "next_executions"
    - "all_scheduled_tasks"
  max_length: "List all tasks with schedules"

examples:
  - user_input: "programá un recordatorio diario a las 9am"
    expected_behavior: "cron_add({ name: 'Recordatorio', cronExpression: '0 9 * * *', taskConfig: { message: 'Recordatorio diario' } })"

  - user_input: "lista las tareas programadas"
    expected_behavior: "cron_list({}) → return all tasks with next execution times"

  - user_input: "editá el cron para que sea a las 10am en vez de 9am"
    expected_behavior: "cron_list() → find jobId → cron_edit({ jobId: '<id>', cronExpression: '0 10 * * *' })"

  - user_input: "cambiá el schedule del cron abc123 para las 3pm todos los días"
    expected_behavior: "cron_edit({ jobId: 'abc123', cronExpression: '0 15 * * *' }) → confirm next_run updated"

  - user_input: "actualizá el mensaje del cron y el horario"
    expected_behavior: "cron_list() → find jobId → cron_edit({ jobId: '<id>', cronExpression: '0 9 * * *', taskConfig: { message: 'nuevo mensaje' } })"

  - user_input: "eliminá la tarea de recordatorio"
    expected_behavior: "cron_list() → find jobId → cron_remove({ jobId: '<id>' })"
---

# Schedule Manager Skill

## Cuándo se Activa

Para gestionar tareas programadas: crear, listar, editar, o eliminar cron jobs.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `cron_add` | Crea tarea programada | Nueva tarea recurrente |
| `cron_list` | Lista tareas con horarios | Ver cronograma |
| `cron_edit` | Modifica tarea existente | Cambiar horario/config |
| `cron_remove` | Elimina tarea | Cancelar schedule |

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

## Cómo Editar un Cron Job

### Parámetros de `cron_edit`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `jobId` | string | **Requerido.** ID del job — obtener con `cron_list` primero |
| `cronExpression` | string | Nueva expresión cron. Recalcula `next_run` automáticamente |
| `taskConfig` | object | Nueva configuración (ej: `{ message: "..." }`) |

### Flujo correcto para editar

```
1. cron_list()                              → obtener el jobId exacto
2. cron_edit({ jobId, cronExpression })     → actualiza expresión + recalcula next_run
                                              + detiene instancia activa automáticamente
3. Esperar ≤30s                             → el scheduler reactiva con nueva expresión
4. cron_list()                              → confirmar next_run actualizado
```

### ⚠️ Zona horaria

El servidor usa **UTC**. Las expresiones cron usan hora local:
- Si el usuario dice "a las 9am" → usar `0 9 * * *` directamente
- Si la hora ya pasó hoy, la próxima ejecución será mañana (o el siguiente ciclo)
- Para tareas de fecha específica como `27 12 10 3 *` (10 de marzo): si ese día ya pasó, dispara el próximo año

## Workflow

1. **Clarificar** → ¿One-time, daily, weekly, monthly?
2. **Construir expresión** → 5 campos cron
3. **Crear/Editar** → `cron_add` o `cron_edit`
4. **Listar** → `cron_list` para confirmar

## Errores a Evitar

- ❌ Usar exec para tareas programadas
- ❌ No preguntar frecuencia (asumir diario)
- ❌ No mostrar próximos horarios
- ❌ Llamar `cron_edit` sin `jobId` — siempre hacer `cron_list` primero
- ❌ Convertir la hora del usuario a UTC — el servidor ya está en Bogotá
- ❌ Asumir que el cambio es inmediato — el reschedule tarda hasta 30s
