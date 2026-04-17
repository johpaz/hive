---
name: canvas_dashboard
description: "Real-time visual dashboard for monitoring task status, progress, and system state"
version: 1.0.0
author: Hive Team
icon: "📈"
category: canvas
permissions:
  - canvas_write
dependencies: []
tools: [canvas_render, canvas_show_progress, canvas_clear]

# Structured skill fields
triggers:
  - "mostrá el dashboard"
  - "show dashboard"
  - "estado en tiempo real"
  - "real-time status"
  - "monitoreo visual"
  - "visual monitoring"
  - "panel de control"
  - "control panel"
  - "limpiá el canvas"
  - "clear canvas"
  - "actualizá el dashboard"
  - "update dashboard"

preferred_agents: []

steps:
  - step: 1
    action: canvas_clear
    instruction: "Clear existing canvas content before rendering new dashboard"
    output: canvas_cleared

  - step: 2
    action: canvas_render
    instruction: "Render dashboard layout with components (progress, status, metrics)"
    params:
      component: "dashboard"
      sections: "Array of dashboard sections"
    output: dashboard_rendered

  - step: 3
    action: canvas_show_progress
    instruction: "Update progress bars for ongoing tasks"
    params:
      bars: "Array of {label, value, status}"
    output: progress_updated

  - step: 4
    action: canvas_render (updates)
    instruction: "Update dashboard with real-time changes"
    params:
      updates: "Changed components"
    output: dashboard_updated

rules:
  - "Clear canvas before rendering new dashboard to avoid clutter"
  - "Use consistent layout: header, progress section, status section, metrics"
  - "Update progress bars in real-time as tasks advance"
  - "Use color coding: green=complete, blue=in_progress, red=error"
  - "Keep dashboard concise — show only critical information"
  - "Clear dashboard when session context changes significantly"
  - "Use span: 'full' in canvas_render or canvas_show_* for components that need full canvas width (tables, charts, long markdown)"

output_format:
  structure: canvas_dashboard
  sections:
    - "header"
    - "progress_section"
    - "status_section"
    - "metrics"
  max_length: "Concise real-time overview"

examples:
  - user_input: "mostrá el dashboard del proyecto"
    expected_behavior: "canvas_clear → canvas_render({ sections: [progress, tasks, metrics] }) → update in real-time"

  - user_input: "actualizá el estado en el dashboard"
    expected_behavior: "canvas_show_progress({ bars: [{label: 'Research', value: 100, status: 'complete'}, ...] })"

  - user_input: "limpiá el canvas"
    expected_behavior: "canvas_clear({}) → empty canvas"
---

# Canvas Dashboard Skill

## Cuándo se Activa

Para mostrar dashboards visuales de monitoreo en tiempo real de tareas, proyectos, o estado del sistema.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `canvas_render` | Renderiza componentes | Layout del dashboard |
| `canvas_show_progress` | Barras de progreso | Estado de tasks |
| `canvas_clear` | Limpia canvas | Antes de nuevo dashboard |

## Workflow

1. **Clear** → `canvas_clear()` — limpiar previo
2. **Render layout** → `canvas_render({ sections })`
3. **Update progress** → `canvas_show_progress()` en tiempo real
4. **Refresh** → `canvas_render({ updates })` para cambios

## Estructura de Dashboard

```javascript
canvas_render({
  component: {
    id: "dashboard-main",
    type: "markdown",
    props: { content: "## Dashboard\n..." },
    span: "full"   // ← ancho completo del canvas
  }
})

// O con tarjetas individuales:
canvas_show_card({ title: "Métricas", span: "full", items: [...] })
canvas_show_progress({ tasks: [...], span: "full" })
```

## Color Coding

| Color | Estado |
|-------|--------|
| 🟢 Verde | Complete |
| 🔵 Azul | In Progress |
| 🔴 Rojo | Error/Blocked |
| 🟡 Amarillo | Pending |

## Mejores Prácticas

- Clear antes de renderizar nuevo dashboard
- Layout consistente (header, progress, status, metrics)
- Update en tiempo real con progreso
- Solo información crítica (no sobrecargar)

## Errores a Evitar

- ❌ No clear entre dashboards (clutter)
- ❌ Demasiada información (sobrecarga visual)
- ❌ No actualizar en tiempo real
- ❌ Sin color coding para estados
