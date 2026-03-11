---
name: schedule_reminder
description: "Schedule reminders with automatic notifications at specified times"
version: 1.0.0
author: Hive Team
icon: "🔔"
category: cron
permissions:
  - cron_manage
  - notify
dependencies: []
tools: [cron_add, notify]

# Structured skill fields
triggers:
  - "recordame"
  - "remind me"
  - "avisame"
  - "notify me"
  - "no me olvides"
  - "don't forget"
  - "alarma"
  - "alarm"
  - "recordatorio"
  - "reminder"
  - "aviso"
  - "notification"

preferred_agents: []

steps:
  - step: 1
    action: clarify_reminder
    instruction: "Get reminder details: what, when (date/time), and notification channel preference"
    output: reminder_details

  - step: 2
    action: build_cron_expression
    instruction: "Convert requested time to cron expression"
    output: cron_expression

  - step: 3
    action: cron_add
    instruction: "Create scheduled task with notify action at specified time"
    params:
      name: "Reminder: {topic}"
      expression: "cron expression"
      task: "notify({ message: 'Reminder: {topic}' })"
      notifyChannelId: "user preferred channel"
    output: reminder_scheduled

  - step: 4
    action: confirm
    instruction: "Confirm reminder is set with scheduled time"
    output: confirmation

rules:
  - "Always confirm reminder details before scheduling"
  - "Use user's preferred notification channel (Telegram > Discord > webchat)"
  - "For one-time reminders, set maxRuns=1"
  - "Include clear, actionable message in reminder"
  - "Convert natural language time to correct cron expression"

output_format:
  structure: markdown
  sections:
    - "reminder_topic"
    - "scheduled_time"
    - "notification_channel"
    - "confirmation"
  max_length: "Brief confirmation"

examples:
  - user_input: "recordame llamar al dentista mañana a las 3pm"
    expected_behavior: "cron_add({ name: 'Llamar al dentista', expression: '0 15 * * *', task: 'notify: Llamar al dentista', maxRuns: 1 })"

  - user_input: "avisame todos los lunes a las 9am para revisar emails"
    expected_behavior: "cron_add({ name: 'Revisar emails', expression: '0 9 * * 1', task: 'notify: Revisar emails' })"

  - user_input: "no me olvides de enviar el reporte el viernes"
    expected_behavior: "cron_add({ name: 'Enviar reporte', expression: '0 9 * * 5', task: 'notify: Enviar reporte semanal' })"
---

# Schedule Reminder Skill

## Cuándo se Activa

Para programar recordatorios con notificaciones automáticas en horarios específicos.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `cron_add` | Programa tarea con notify | Crear recordatorio |
| `notify` | Envía notificación | Acción del recordatorio |

## Workflow

1. **Clarificar** → Qué, cuándo, canal preferido
2. **Convertir tiempo** → Natural language → cron expression
3. **Programar** → `cron_add({ task: "notify(...)" })`
4. **Confirmar** → Mostrar horario programado

## Canales de Notificación

Por orden de preferencia:
1. Telegram (si disponible)
2. Discord
3. Webchat

## Errores a Evitar

- ❌ No confirmar detalles del recordatorio
- ❌ Expresión cron incorrecta para el tiempo pedido
- ❌ No especificar canal de notificación
