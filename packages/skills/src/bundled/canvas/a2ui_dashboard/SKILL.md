---
name: a2ui_dashboard
description: "Create real-time interactive dashboards using A2UI v0.9 protocol with dynamic data binding and live updates"
version: 1.0.0
author: Hive Team
icon: "📊"
category: canvas
permissions:
  - canvas_write
dependencies: []
tools: [a2ui_create_surface, a2ui_update_components, a2ui_update_data_model, a2ui_delete_surface]

# Structured skill fields
triggers:
  - "dashboard A2UI"
  - "panel de control A2UI"
  - "A2UI dashboard"
  - "mostrar métricas A2UI"
  - "A2UI metrics"
  - "dashboard interactivo A2UI"
  - "interactive dashboard"
  - "A2UI dashboard en tiempo real"
  - "real-time dashboard A2UI"
  - "mostrar datos A2UI"
  - "visualizar datos con A2UI"

preferred_agents: []

steps:
  - step: 1
    action: a2ui_create_surface
    instruction: "Create an A2UI surface for the dashboard. Set theme with primaryColor matching project branding."
    params:
      surfaceId: "Descriptive ID (e.g. 'project_dashboard', 'metrics_dashboard')"
      catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json"
      theme: "{ primaryColor: '#10B981', agentDisplayName: 'Dashboard' }"
    output: surface_created

  - step: 2
    action: a2ui_update_components
    instruction: "Build dashboard layout using Row, Column, Card, and Text components. Use weight for proportional sizing."
    params:
      surfaceId: "Same surfaceId from step 1"
      components: "Array of A2UI component definitions for dashboard layout"
    output: dashboard_layout

  - step: 3
    action: a2ui_update_data_model
    instruction: "Populate dashboard with initial data using JSON Pointer paths. All dynamic values should use path bindings."
    params:
      surfaceId: "Same surfaceId"
      path: "/"
      value: "Full data model object with all metric values"
    output: data_populated

  - step: 4
    action: a2ui_update_data_model
    instruction: "Update specific data model paths to refresh dashboard metrics in real-time."
    params:
      surfaceId: "Same surfaceId"
      path: "/metrics/completionRate"
      value: "Updated value"
    output: metrics_updated

  - step: 5
    action: a2ui_delete_surface
    instruction: "Delete the dashboard surface when no longer needed."
    params:
      surfaceId: "Same surfaceId"
    output: surface_deleted

rules:
  - "Always call a2ui_create_surface BEFORE a2ui_update_components"
  - "Components MUST include a root component with id='root'"
  - "Use Row with weight for side-by-side metrics (e.g. weight: 1 vs weight: 3)"
  - "Use Card to group related metrics together"
  - "Use Text with usageHint: 'h2' for section titles, 'h1' for dashboard title"
  - "Use Text with usageHint: 'caption' for labels"
  - "Use data binding { path: '/metrics/name' } for all dynamic values"
  - "Update metrics with a2ui_update_data_model using specific JSON Pointer paths"
  - "Use a2ui_update_data_model with path: '/' to replace entire data model if needed"
  - "Delete surfaces with a2ui_delete_surface when dashboard is no longer needed"
  - "For static dashboards prefer canvas_render with chart type; use A2UI for interactive/live dashboards"

output_format:
  structure: a2ui_dashboard
  sections:
    - "surface_creation"
    - "dashboard_layout"
    - "data_model"
    - "live_updates"
    - "cleanup"
  max_length: "Structured JSON components"

examples:
  - user_input: "mostrá el dashboard del proyecto"
    expected_behavior: "a2ui_create_surface(surfaceId:'project_dash', theme:{primaryColor:'#10B981'}) → a2ui_update_components with Row[Column[Card[metrics]],Column[tasks]] → a2ui_update_data_model(path:'/', value:{metrics:{...}})"

  - user_input: "actualizá las métricas del dashboard"
    expected_behavior: "a2ui_update_data_model(surfaceId:'project_dash', path:'/metrics/completionRate', value:75)"

  - user_input: "show a real-time dashboard with server metrics"
    expected_behavior: "a2ui_create_surface → a2ui_update_components with Cards for each metric → a2ui_update_data_model → periodic updates with a2ui_update_data_model"
---

# A2UI Dashboard Skill

## Cuándo se Activa

Para crear dashboards interactivos en tiempo real usando A2UI v0.9. Usar cuando se necesita:
- Métricas que se actualizan dinámicamente
- Dashboards con data binding
- Paneles con Cards, Rows, Columns
- Visualización de datos que cambia en tiempo real

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `a2ui_create_surface` | Crea la superficie A2UI | Siempre primero |
| `a2ui_update_components` | Envía componentes | Para layout del dashboard |
| `a2ui_update_data_model` | Actualiza datos | Para métricas dinámicas |
| `a2ui_delete_surface` | Elimina la superficie | Al cerrar dashboard |

## Flujo Obligatorio

```
1. a2ui_create_surface(surfaceId, catalogId, theme)
2. a2ui_update_components(surfaceId, components[])
3. a2ui_update_data_model(surfaceId, path, value)  // datos iniciales
4. [actualizar métricas con a2ui_update_data_model según necesidad]
5. a2ui_delete_surface(surfaceId)  // al terminar
```

## Patrón de Dashboard Típico

```json
[
  {"id": "root", "component": "Column", "children": ["title", "metrics_row", "tasks_list"]},
  {"id": "title", "component": "Text", "text": "Dashboard de Proyecto", "variant": "h1"},

  {"id": "metrics_row", "component": "Row", "children": ["card1", "card2", "card3"]},
  {"id": "card1", "component": "Card", "child": "card1_content", "weight": 1},
  {"id": "card1_content", "component": "Column", "children": ["card1_label", "card1_value"]},
  {"id": "card1_label", "component": "Text", "text": "Completado", "variant": "caption"},
  {"id": "card1_value", "component": "Text", "text": {"path": "/metrics/completionRate"}, "variant": "h2"},

  {"id": "tasks_list", "component": "List", "children": {"path": "/tasks", "componentId": "task_template"}},
  {"id": "task_template", "component": "Card", "child": "task_content"},
  {"id": "task_content", "component": "Column", "children": ["task_name", "task_status"]},
  {"id": "task_name", "component": "Text", "text": {"path": "/name"}},
  {"id": "task_status", "component": "Text", "text": {"path": "/status"}, "variant": "caption"}
]
```

## Actualización en Tiempo Real

Para actualizar métricas específicas sin reenviar componentes:
```json
a2ui_update_data_model(surfaceId: "dash", path: "/metrics/completionRate", value: 85)
a2ui_update_data_model(surfaceId: "dash", path: "/metrics/totalTasks", value: 24)
```

Para reemplazar todo el data model:
```json
a2ui_update_data_model(surfaceId: "dash", path: "/", value: {metrics: {completionRate: 90, totalTasks: 25}, tasks: [...]})
```

## Mejores Prácticas

- Usar `weight` en Row/Column para proporciones (weight:1 vs weight:3 = 25% vs 75%)
- Agrupar métricas en Cards para separación visual
- Usar `usageHint: "caption"` para labels, `"h1"/"h2"` para valores
- Bind todos los valores dinámicos con `{ path: "/..." }`
- Actualizar métricas con `a2ui_update_data_model` path específico
- Eliminar surfaces al terminar para evitar memory leaks