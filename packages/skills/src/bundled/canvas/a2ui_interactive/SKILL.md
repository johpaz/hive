---
name: a2ui_interactive
description: "Create multi-step interactive workflows using A2UI v0.9 protocol with tabs, modals, choice pickers, and dynamic updates based on user actions"
version: 1.0.0
author: Hive Team
icon: "🔄"
category: canvas
permissions:
  - canvas_write
dependencies: []
tools: [a2ui_create_surface, a2ui_update_components, a2ui_update_data_model, a2ui_delete_surface]

# Structured skill fields
triggers:
  - "interfaz interactiva A2UI"
  - "A2UI interactive UI"
  - "flujo A2UI"
  - "A2UI workflow"
  - "asistente A2UI"
  - "A2UI assistant"
  - "wizard A2UI"
  - "flujo multi-paso A2UI"
  - "multi-step flow A2UI"
  - "workflow interactivo"
  - "interactive workflow"
  - "asistente paso a paso"
  - "step-by-step assistant"
  - "A2UI con tabs y modales"

preferred_agents: []

steps:
  - step: 1
    action: a2ui_create_surface
    instruction: "Create an A2UI surface for the interactive workflow. Set theme with agent display name."
    params:
      surfaceId: "Descriptive ID (e.g. 'onboarding_flow', 'booking_assistant')"
      catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json"
      theme: "{ primaryColor: '#8B5CF6', agentDisplayName: 'Asistente' }"
    output: surface_created

  - step: 2
    action: a2ui_update_components
    instruction: "Build the initial workflow layout. Use Tabs for multi-step flows, Modal for confirmations, ChoicePicker for selections."
    params:
      surfaceId: "Same surfaceId from step 1"
      components: "Array of A2UI component definitions for workflow steps"
    output: workflow_layout

  - step: 3
    action: a2ui_update_data_model
    instruction: "Initialize workflow state data. Include all fields needed across steps."
    params:
      surfaceId: "Same surfaceId"
      path: "/"
      value: "Initial workflow state object"
    output: state_initialized

  - step: 4
    action: a2ui_update_components
    instruction: "Update components based on user actions. Show/hide steps, change options, add validation feedback."
    params:
      surfaceId: "Same surfaceId"
      components: "Updated component definitions reflecting state changes"
    output: workflow_updated

  - step: 5
    action: a2ui_delete_surface
    instruction: "Delete the workflow surface when the flow is completed or cancelled."
    params:
      surfaceId: "Same surfaceId"
    output: surface_deleted

rules:
  - "Always call a2ui_create_surface BEFORE a2ui_update_components"
  - "Components MUST include a root component with id='root'"
  - "Use Tabs for multi-step workflows with tabItems: [{title, child}]"
  - "Use Modal for confirmation dialogs: {entryPointChild, contentChild}"
  - "Use ChoicePicker for selections: variant='mutuallyExclusive' for single, omit for multiple"
  - "Use Button actions with event format: {event: {name: 'action_name', context: {key: {path: '/data/key'}}}}"
  - "Update workflow state with a2ui_update_data_model after each user action"
  - "Use a2ui_update_components to change the UI structure between steps"
  - "Show progress indicators with Text components showing current step"
  - "Validate inputs with checks on TextField: [{call: 'required', args: {value: {path: '...'}}, message: 'Required'}]"
  - "Delete surfaces with a2ui_delete_surface when workflow is completed"
  - "For simple confirmations prefer canvas_confirm; use A2UI for multi-step workflows"

output_format:
  structure: a2ui_interactive
  sections:
    - "surface_creation"
    - "workflow_layout"
    - "state_initialization"
    - "dynamic_updates"
    - "cleanup"
  max_length: "Structured JSON components"

examples:
  - user_input: "creá un asistente de reserva"
    expected_behavior: "a2ui_create_surface(surfaceId:'booking', theme:{primaryColor:'#8B5CF6'}) → a2ui_update_components with Tabs[step1:service, step2:datetime, step3:confirm] → a2ui_update_data_model(path:'/', value:{service:'', date:'', time:''})"

  - user_input: "I need a multi-step onboarding flow"
    expected_behavior: "a2ui_create_surface → a2ui_update_components with Column[step indicator, step content, nav buttons] → a2ui_update_data_model with empty state → on action: a2ui_update_components for next step"

  - user_input: "creá un wizard con selección de opciones"
    expected_behavior: "a2ui_create_surface → a2ui_update_components with ChoicePicker for options, Button for navigation → a2ui_update_data_model with initial state"
---

# A2UI Interactive Skill

## Cuándo se Activa

Para crear flujos interactivos multi-paso usando A2UI v0.9. Usar cuando se necesita:
- Wizards paso a paso
- Flujos de onboarding
- Asistentes de reserva/configuración
- Formularios con selections dinámicas
- Interacciones con modales de confirmación
- UIs que cambian según las acciones del usuario

## Herramientes Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `a2ui_create_surface` | Crea la superficie A2UI | Siempre primero |
| `a2ui_update_components` | Envía/actualiza componentes | Para layout y cambios de UI |
| `a2ui_update_data_model` | Actualiza datos | Para estado del workflow |
| `a2ui_delete_surface` | Elimina la superficie | Al terminar flujo |

## Flujo Obligatorio

```
1. a2ui_create_surface(surfaceId, catalogId, theme)
2. a2ui_update_components(surfaceId, components[])
3. a2ui_update_data_model(surfaceId, path, value)  // estado inicial
4. [recibir acción del usuario]
5. a2ui_update_data_model(...)  // actualizar estado con respuesta
6. a2ui_update_components(...)  // cambiar UI al siguiente paso
7. ... repetir 4-6 según necesidad ...
8. a2ui_delete_surface(surfaceId)  // al terminar
```

## Patrones de Flujo Interactivo

### Wizard con Tabs (multi-paso)

```json
[
  {id: "root", component: "Column", children: ["step_indicator", "tabs"]},
  {id: "step_indicator", component: "Text", text: {path: "/stepLabel"}, variant: "caption"},
  {id: "tabs", component: "Tabs", tabs: [
    {title: "Servicio", child: "step1"},
    {title: "Fecha", child: "step2"},
    {title: "Confirmar", child: "step3"}
  ]},
  {id: "step1", component: "Column", children: ["svc_label", "svc_picker"]},
  {id: "svc_label", component: "Text", text: "Seleccioná un servicio", variant: "h3"},
  {id: "svc_picker", component: "ChoicePicker", variant: "mutuallyExclusive", options: [...], value: {path: "/data/service"}},
  // ... más pasos
]
```

### Confirmación con Modal

```json
[
  {id: "confirm_modal", component: "Modal", trigger: "confirm_btn", content: "confirm_dialog"},
  {id: "confirm_btn", component: "Button", child: "confirm_btn_text", action: {}},
  {id: "confirm_btn_text", component: "Text", text: "Confirmar Reserva"},
  {id: "confirm_dialog", component: "Column", children: ["confirm_msg", "confirm_yes", "confirm_no"]},
  {id: "confirm_msg", component: "Text", text: "¿Confirmás tu reserva?"},
  {id: "confirm_yes", component: "Button", child: "yes_text", variant: "primary", action: {event: {name: "confirm_booking", context: {service: {path: "/data/service"}}}}},
  {id: "yes_text", component: "Text", text: "Sí, confirmar"},
  {id: "confirm_no", component: "Button", child: "no_text", variant: "borderless", action: {event: {name: "cancel"}}}},
  {id: "no_text", component: "Text", text: "Cancelar"}
]
```

### Selección con ChoicePicker

```json
[
  {id: "service_picker", component: "ChoicePicker",
    variant: "mutuallyExclusive",
    options: [
      {label: "Consulta General", value: "general"},
      {label: "Especializada", value: "specialist"},
      {label: "Urgencia", value: "urgent"}
    ],
    value: {path: "/data/serviceType"},
    action: {event: {name: "service_selected", context: {service: {path: "/data/serviceType"}}}}
  }
]
```

## Mejores Prácticas

- Usar Tabs para wizards multi-paso
- Usar Modal para confirmaciones antes de acciones críticas
- Usar ChoicePicker con `variant: "mutuallyExclusive"` para selección única
- Mostrar indicador de progreso (paso X de Y)
- Actualizar data model después de cada acción del usuario
- Usar `a2ui_update_components` para cambiar la UI entre pasos
- Agregar validación con `checks` en TextField
- Mantener el estado del flujo en el data model (`/data/step`, `/data/serviceType`, etc.)
- Eliminar surfaces con `a2ui_delete_surface` al completar o cancelar