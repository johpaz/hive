---
name: web_monitor
description: "Monitor changes in web sources and track updates over time with persistent memory"
version: 1.0.0
author: Hive Team
icon: "📡"
category: web
permissions:
  - internet_access
  - memory_write
  - memory_read
dependencies: []
tools: [web_search, web_fetch, memory_write, memory_read]

# Structured skill fields
triggers:
  - "monitoreá"
  - "monitor"
  - "seguí los cambios"
  - "track changes"
  - "avisame si cambia"
  - "notify if changes"
  - "actualización de"
  - "update on"
  - "novedades de"
  - "news about"
  - "cambios en"
  - "changes in"

preferred_agents: []

steps:
  - step: 1
    action: memory_read
    instruction: "Read previously stored content for this URL/topic to compare"
    params:
      title: "monitor_{url_or_topic}"
    output: previous_content

  - step: 2
    action: web_fetch
    instruction: "Fetch current content from monitored URL"
    params:
      url: "monitored URL"
    output: current_content

  - step: 3
    action: compare
    instruction: "Compare current content with previous version to identify changes"
    output: changes_detected

  - step: 4
    action: memory_write
    instruction: "Store current content as new baseline for future comparisons"
    params:
      title: "monitor_{url_or_topic}"
      content: "current content + timestamp"
    output: stored

  - step: 5
    action: notify
    instruction: "If changes detected, notify user with summary of what changed"
    output: notification_sent

rules:
  - "Always store baseline on first monitor request"
  - "Compare content systematically — identify additions, removals, modifications"
  - "Notify only if meaningful changes detected (ignore timestamps, ads)"
  - "Store timestamp with each baseline for tracking frequency"
  - "For recurring monitors, use cron.create to schedule automatic checks"

output_format:
  structure: markdown
  sections:
    - "url"
    - "change_detected"
    - "summary_of_changes"
    - "timestamp"
  max_length: "Brief summary of changes"

examples:
  - user_input: "monitoreá cambios en https://example.com/pricing"
    expected_behavior: "Fetch current pricing → store as baseline → on next check, compare and notify if changed"

  - user_input: "avisame si hay novedades sobre IA"
    expected_behavior: "web_search('IA news') → compare with stored results → notify if new significant news"

  - user_input: "seguí los cambios en la documentación de React"
    expected_behavior: "Fetch React docs → store baseline → periodic checks → notify on content changes"
---

# Web Monitor Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita:
- Monitorear cambios en una URL específica
- Recibir notificaciones de actualizaciones
- Seguir novedades sobre un tema
- Trackear evolución de contenido

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `web_fetch` | Descarga contenido de URL | Obtener contenido actual |
| `web_search` | Busca novedades | Monitoreo por tema (no URL fija) |
| `memory_write` | Guarda baseline | Almacenar contenido para comparación |
| `memory_read` | Recupera baseline anterior | Comparar con contenido actual |

## Workflow

1. **Primera ejecución**: `web_fetch` → `memory_write` (baseline)
2. **Chequeos siguientes**: `memory_read` → `web_fetch` → comparar → `notify` si cambia
3. **Actualizar baseline**: `memory_write` con nuevo contenido

## Mejores Prácticas

- Ignorar cambios menores (timestamps, ads, contenido dinámico irrelevante)
- Notificar solo cambios significativos
- Para monitoreo periódico, combinar con `cron.create`

## Errores a Evitar

- ❌ No almacenar baseline inicial
- ❌ Notificar por cambios triviales
- ❌ No actualizar timestamp de baseline
