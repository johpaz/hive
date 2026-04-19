---
name: cron_reminder
description: "Schedule a reminder for yourself at a specific time. Creates a one_shot cron job that sends a notification message via your preferred channel."
version: 2.0.0
author: Hive Team
icon: "⏰"
category: cron
permissions:
  - cron_manage
dependencies: []
tools: [cron.create, notify]

# Structured skill fields
triggers:
  - "recordame"
  - "remind me"
  - "recordatorio"
  - "reminder"
  - "alerta"
  - "alert"
  - "avísame"
  - "notify me"
  - "programá"
  - "schedule"
  - "para mañana"
  - "for tomorrow"
  - "en 30 minutos"
  - "in 30 minutes"

preferred_agents: []

steps:
  - step: 1
    action: clarify_reminder
    instruction: "Ask: What do you want to be reminded about? At what time? Via which channel?"
    output: reminder_message, reminder_time, channel

  - step: 2
    action: build_reminder_payload
    instruction: "Build the task payload with message and channel"
    output: payload

  - step: 3
    action: cron.create
    instruction: "Create one_shot cron job"
    params:
      name: "Short name (e.g., 'meeting-reminder')"
      task: "REQUIRED - The reminder message (e.g., 'Meeting starts in 5 minutes')"
      task_type: "one_shot"
      fire_at: "ISO datetime (e.g., '2026-04-20T14:00:00')"
      channel: "telegram, discord, webchat, whatsapp"
    output: cron_id

rules:
  - "ALWAYS use cron.create with task_type='one_shot' for reminders"
  - "The 'task' field is REQUIRED and contains the reminder message"
  - "fire_at must be in the future"
  - "Use notify tool as fallback if cron fails"
  - "Default channel is user's preferred, ask if not specified"

output_format:
  structure: markdown
  sections:
    - "reminder_message"
    - "scheduled_time"
    - "channel"
  max_length: "Short confirmation"

examples:
  - user_input: "recordame la reunion a las 3pm"
    expected_behavior: "cron.create({ name: 'meeting-reminder', task: 'La reunión empieza en 5 minutos', task_type: 'one_shot', fire_at: '2026-04-20T15:00:00', channel: 'telegram' })"

  - user_input: "avísame en 30 minutos"
    expected_behavior: "cron.create({ name: 'quick-reminder', task: 'Revisa el email', task_type: 'one_shot', fire_at: '<30-min-from-now>', channel: 'telegram' })"

  - user_input: "recordame mañana a las 9am"
    expected_behavior: "cron.create({ name: 'morning-reminder', task: 'Buenos días! Revisa tu agenda', task_type: 'one_shot', fire_at: '<tomorrow-9am>', channel: 'telegram' })"
---

# Cron Reminder Skill

## Cuándo se Activa

Para crear recordatorios de una sola ejecución (one_shot): "recuerdame a las 3pm", "avísame en 30 minutos", etc.

## Herramientas

| Tool | Qué hace |
|------|----------|
| `cron.create` | Crear recordatorio one_shot |
| `notify` | Enviar notificación directa |

## Cómo Funciona

1. **Preguntar** → ¿De qué te aviso? ¿A qué hora? ¿Por qué canal?
2. **Crear** → `cron.create` con `task_type: 'one_shot'` y `fire_at` en formato ISO
3. **Confirmar** → Mostrar hora programada

## Parámetros

| Campo | Descripción |
|-------|-------------|
| `task` | **REQUERIDO** - Mensaje del recordatorio |
| `task_type` | Siempre `'one_shot'` |
| `fire_at` | Fecha/hora ISO (ej: `'2026-04-20T15:00:00'`) |
| `channel` | Canal (telegram, discord, whatsapp, webchat) |

## Errores Comunes

- ❌ Olvidar el campo `task` — obligatorio para que el agente sepa qué enviar
- ❌ Usar expresiones cron para recordatorios (usar `fire_at` en vez de `cron_expression`)
- ❌ Poner `fire_at` en el pasado