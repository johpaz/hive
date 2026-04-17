---
name: canvas_report
description: "Display structured results to users using cards, lists, and progress indicators"
version: 1.0.0
author: Hive Team
icon: "📊"
category: canvas
permissions:
  - canvas_write
dependencies: []
tools: [canvas_show_card, canvas_show_list, canvas_show_progress]

# Structured skill fields
triggers:
  - "mostrame en el canvas"
  - "show on canvas"
  - "mostrá los resultados"
  - "show results"
  - "tarjeta informativa"
  - "info card"
  - "lista los resultados"
  - "list results"
  - "barra de progreso"
  - "progress bar"
  - "dashboard"
  - "estado visual"
  - "visual status"

preferred_agents: []

steps:
  - step: 1
    action: determine_display_type
    instruction: "Determine best display format: card for structured info, list for key-value, progress for status"
    output: display_type

  - step: 2
    action: canvas_show_card or canvas_show_list
    instruction: "Render content in appropriate format"
    params:
      card: "title, items with labels"
      list: "key-value pairs"
    output: rendered

  - step: 3
    action: canvas_show_progress (if applicable)
    instruction: "Show progress bars for ongoing tasks"
    params:
      bars: "Array of {label, value: 0-100}"
    output: progress_displayed

rules:
  - "Use canvas_show_card for structured information with labeled items"
  - "Use canvas_show_list for simple key-value pairs"
  - "Use canvas_show_progress for multi-task progress visualization"
  - "Keep card items concise (max 5-7 items for readability)"
  - "Use clear labels that indicate what each value represents"
  - "Clear canvas when switching contexts significantly"

output_format:
  structure: canvas_component
  sections:
    - "component_type"
    - "title"
    - "content"
  max_length: "Concise visual display"

examples:
  - user_input: "mostrame los resultados en el canvas"
    expected_behavior: "canvas_show_card({ title: 'Results', items: [{label: 'Found', value: '7 trends'}, {label: 'Sources', value: '5 URLs'}] })"

  - user_input: "lista las configuraciones actuales"
    expected_behavior: "canvas_show_list({ items: { 'Language': 'Spanish', 'Timezone': 'UTC-3', 'Channel': 'Telegram' } })"

  - user_input: "mostrá el progreso del proyecto"
    expected_behavior: "canvas_show_progress({ bars: [{label: 'Research', value: 100}, {label: 'Content', value: 60}, {label: 'Email', value: 0}] })"
---

# Canvas Report Skill

## Cuándo se Activa

Para mostrar resultados estructurados visualmente en el canvas del usuario.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `canvas_show_card` | Muestra información estructurada | Resultados con items etiquetados |
| `canvas_show_list` | Lista clave-valor | Configuraciones, datos simples |
| `canvas_show_progress` | Barras de progreso | Estado de tasks múltiples |

## Workflow

1. **Determinar formato** → Card vs List vs Progress
2. **Renderizar** → `canvas_show_*` apropiado
3. **Clear** → Si cambio de contexto significativo

## Formatos

### Card
```javascript
canvas_show_card({
  title: "Research Results",
  items: [
    { label: "Trends Found", value: "7" },
    { label: "Sources", value: "5 URLs" },
    { label: "Time", value: "2.5 min" }
  ]
})

// Full-width card (ocupa todo el ancho del canvas):
canvas_show_card({
  title: "Full Report",
  span: "full",
  items: [...]
})
```

### List
```javascript
canvas_show_list({
  items: {
    "Language": "Spanish",
    "Timezone": "UTC-3",
    "Channel": "Telegram"
  }
})
```

### Progress
```javascript
canvas_show_progress({
  bars: [
    { label: "Research", value: 100 },
    { label: "Content", value: 60 },
    { label: "Email", value: 0 }
  ]
})
```

## Errores a Evitar

- ❌ Cards con demasiados items (>7)
- ❌ Labels vagos sin contexto
- ❌ No clear entre contextos diferentes
