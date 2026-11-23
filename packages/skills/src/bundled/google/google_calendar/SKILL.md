---
name: google_calendar
description: "Query, create, update and cancel Google Calendar events and check availability"
version: 1.0.0
author: Hive Team
icon: "📅"
category: google
permissions:
  - internet_access
dependencies: []
tools: [gcal_list_events, gcal_create_event, gcal_update_event, gcal_delete_event, gcal_freebusy]

triggers:
  - "agenda una reunión"
  - "qué tengo esta semana"
  - "cuándo estoy libre"
  - "crea un evento"
  - "cancela la reunión"
  - "mueve la cita"
  - "google calendar"

preferred_agents: [google_calendar_agent]

steps:
  - step: 1
    action: gcal_freebusy
    instruction: "Normaliza fecha y zona horaria a ISO 8601, revisa disponibilidad, y para invitar, modificar o borrar muestra un preview y espera aprobación."
    output: result

rules:
  - "Calendario no es cron: los recordatorios internos de Hive usan cron.*"
  - "Crear con invitados envía correos: requiere confirmación"
  - "Pregunta la zona horaria si falta y cambia el resultado"

output_format:
  structure: markdown
  sections:
    - "resultado"
    - "siguiente_paso"
  max_length: "400 words"

examples:
  - user_input: "agenda una reunión con Luis mañana a las 3pm"
    expected_behavior: "gcal_freebusy → preview con invitado → tras aprobación gcal_create_event({ attendees: ['luis@…'], confirmed: true })"
---

# Google Calendar

## Cuándo se activa

Cuando el usuario quiere ver, crear, mover o cancelar eventos o saber su disponibilidad.
