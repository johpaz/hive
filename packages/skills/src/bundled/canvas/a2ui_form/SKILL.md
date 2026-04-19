---
name: a2ui_form
description: "Create rich interactive forms using A2UI v0.9 protocol with validation, data binding, and multi-step flows"
version: 1.0.0
author: Hive Team
icon: "📝"
category: canvas
permissions:
  - canvas_write
dependencies: []
tools: [a2ui_create_surface, a2ui_update_components, a2ui_update_data_model, a2ui_delete_surface]

# Structured skill fields
triggers:
  - "crear formulario A2UI"
  - "create A2UI form"
  - "formulario interactivo A2UI"
  - "A2UI form"
  - "pedir datos con A2UI"
  - "collect data A2UI"
  - "formulario con validación"
  - "form with validation"
  - "formulario multi-paso"
  - "multi-step form A2UI"
  - "form dinámico A2UI"
  - "dynamic form A2UI"

preferred_agents: []

steps:
  - step: 1
    action: a2ui_create_surface
    instruction: "Create an A2UI surface with a unique surfaceId and catalog. Set theme with primaryColor and agentDisplayName."
    params:
      surfaceId: "Unique identifier (e.g. 'contact_form', 'signup_form')"
      catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json"
      theme: "{ primaryColor: '#3B82F6', agentDisplayName: 'Asistente' }"
    output: surface_created

  - step: 2
    action: a2ui_update_components
    instruction: "Send the form layout as a flat list of A2UI components. Must include a 'root' component. Use Column/Row for layout, TextField for inputs, Button for submit."
    params:
      surfaceId: "Same surfaceId from step 1"
      components: "Array of A2UI component definitions"
    output: components_sent

  - step: 3
    action: a2ui_update_data_model
    instruction: "Populate initial form values using JSON Pointer paths (e.g. '/form/name'). Sets default values and enables two-way binding."
    params:
      surfaceId: "Same surfaceId"
      path: "/form"
      value: "{ name: '', email: '' }"
    output: data_populated

  - step: 4
    action: a2ui_delete_surface
    instruction: "Delete the A2UI surface when the form is completed or no longer needed."
    params:
      surfaceId: "Same surfaceId"
    output: surface_deleted

rules:
  - "Always call a2ui_create_surface BEFORE a2ui_update_components"
  - "Components MUST include a root component with id='root'"
  - "Use data binding with { path: '/form/field' } for TextField values to enable two-way binding"
  - "Add checks (validation) to TextField: [{ call: 'required', args: { value: { path: '/form/email' } }, message: 'Email is required' }]"
  - "Button actions use event format: { event: { name: 'submit_form', context: { email: { path: '/form/email' } } } }"
  - "Use Column for vertical layouts, Row for horizontal layouts"
  - "Set weight on Row/Column children for proportional sizing (e.g. weight: 1 vs weight: 3)"
  - "Delete surfaces with a2ui_delete_surface when no longer needed to prevent memory leaks"
  - "Prefer A2UI forms over canvas_ask for complex forms with validation"

output_format:
  structure: a2ui_form
  sections:
    - "surface_creation"
    - "component_layout"
    - "data_model"
    - "cleanup"
  max_length: "Structured JSON components"

examples:
  - user_input: "creá un formulario de contacto"
    expected_behavior: "a2ui_create_surface(surfaceId:'contact_form', theme:{primaryColor:'#3B82F6',agentDisplayName:'Asistente'}) → a2ui_update_components(surfaceId:'contact_form', components:[root,Column,hdr,name_fld,email_fld,msg_fld,submit_btn]) → a2ui_update_data_model(surfaceId:'contact_form', path:'/form', value:{name:'',email:'',message:''})"

  - user_input: "I need a signup form with email validation"
    expected_behavior: "a2ui_create_surface → a2ui_update_components with TextField({value:{path:'/form/email'}, checks:[{call:'required',...},{call:'email',...}]}) → a2ui_update_data_model"

  - user_input: "creá un formulario multi-paso"
    expected_behavior: "a2ui_create_surface → a2ui_update_components with Tabs+Column per step → a2ui_update_data_model for all fields"
---

# A2UI Form Skill

## Cuándo se Activa

Para crear formularios interactivos ricos usando el protocolo A2UI v0.9. Usar cuando se necesita:
- Validación de campos (required, email, regex)
- Data binding dinámico
- Formularios multi-paso
- Choice pickers, sliders, checkboxes
- Formularios con acciones personalizadas

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `a2ui_create_surface` | Crea la superficie A2UI | Siempre primero |
| `a2ui_update_components` | Envía componentes | Después de crear surface |
| `a2ui_update_data_model` | Actualiza datos | Para valores iniciales o dinámicos |
| `a2ui_delete_surface` | Elimina la superficie | Al terminar |

## Flujo Obligatorio

```
1. a2ui_create_surface(surfaceId, catalogId, theme)
2. a2ui_update_components(surfaceId, components[])
3. a2ui_update_data_model(surfaceId, path, value)  // opcional, para datos iniciales
4. [esperar acción del usuario]
5. a2ui_delete_surface(surfaceId)  // al terminar
```

## Componentes Disponibles

| Componente | Descripción | Props clave |
|------------|-------------|-------------|
| `Column` | Layout vertical | `children`, `distribution`, `alignment` |
| `Row` | Layout horizontal | `children`, `distribution`, `alignment` |
| `Text` | Texto | `text`, `usageHint` (h1-h5, body, caption, code) |
| `Button` | Botón | `child`, `variant`, `action` |
| `TextField` | Campo de texto | `label`, `value`, `variant` (shortText/longText/number/obscured), `validationRegexp`, `checks`, `action` |
| `CheckBox` | Checkbox | `label`, `value` |
| `ChoicePicker` | Selector múltiple | `options`, `value` (DynamicStringList), `variant` (mutuallyExclusive/multipleSelection), `displayStyle`, `filterable`, `action` |
| `Slider` | Slider numérico | `value`, `minValue`, `maxValue` |
| `DateTimeInput` | Fecha/hora | `value`, `enableDate`, `enableTime` |
| `Card` | Tarjeta | `child` |
| `Divider` | Separador | `axis` |
| `Image` | Imagen | `url`, `fit` |
| `Tabs` | Pestañas | `tabItems` |

## Data Binding

- Literal: `"texto directo"` o número
- Path: `{ "path": "/form/name" }` — se resuelve contra el data model
- Function call: `{ "call": "formatDate", "args": {...} }`

## Cuándo disparan acciones los inputs

| Componente | Cuándo dispara | Formato de action |
|------------|---------------|-------------------|
| `Button` | Al hacer click | `{name: "...", context: {...}}` o `{event: {name: "...", context: {...}}}` |
| `TextField` | Al perder foco (blur) o presionar Enter (en shortText) | `{name: "...", context: {...}}` |
| `ChoicePicker` | Inmediatamente al seleccionar/deseleccionar | `{name: "...", context: {...}}` |
| `Slider` | Al soltar el slider (onValueCommit) | `{name: "...", context: {...}}` |
| `CheckBox` | Al cambiar estado | — (solo two-way binding) |
| `DateTimeInput` | Al cambiar valor | — (solo two-way binding) |

**Nota**: Tanto `{name: "...", context: {...}}` (directo) como `{event: {name: "...", context: {...}}}` (con wrapper) son formatos válidos.

**Nota**: Para ChoicePicker usa siempre `selections: {path: "..."}` (no `value`) para two-way binding.

## Validación (checks)

```json
"checks": [
  { "call": "required", "args": { "value": { "path": "/form/email" } }, "message": "Email is required" },
  { "call": "email", "args": { "value": { "path": "/form/email" } }, "message": "Invalid email" },
  { "call": "regex", "args": { "value": { "path": "/form/phone" }, "pattern": "^\\d{10}$" }, "message": "10 digits required" }
]
```

## Ejemplo: Formulario de Contacto

```json
// 1. Create surface
a2ui_create_surface(surfaceId: "contact_form", catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json", theme: {primaryColor: "#3B82F6", agentDisplayName: "Asistente"})

// 2. Send components
a2ui_update_components(surfaceId: "contact_form", components: [
  {"id": "root", "component": "Column", "children": ["header","name_field","email_field","msg_field","submit_btn"]},
  {id: "header", component: "Text", text: "Contacto", variant: "h2"},
  {id: "name_field", component: "TextField", label: "Nombre", value: {path: "/form/name"}, variant: "shortText"},
  {id: "email_field", component: "TextField", label: "Email", value: {path: "/form/email"}, variant: "shortText", validationRegexp: "^[^@]+@[^@]+\\.[^@]+$", checks: [{call: "required", args: {value: {path: "/form/email"}}, message: "Email obligatorio"}, {call: "email", args: {value: {path: "/form/email"}}, message: "Email inválido"}]},
  {id: "msg_field", component: "TextField", label: "Mensaje", value: {path: "/form/message"}, variant: "longText"},
  {id: "submit_label", component: "Text", text: "Enviar"},
  {id: "submit_btn", component: "Button", child: "submit_label", variant: "primary", action: {event: {name: "submit_contact", context: {name: {path: "/form/name"}, email: {path: "/form/email"}, message: {path: "/form/message"}}}}
])

// 3. Initialize data model
a2ui_update_data_model(surfaceId: "contact_form", path: "/form", value: {name: "", email: "", message: ""})
```

## Mejores Prácticas

- Siempre incluir un componente `root` con id="root"
- Usar `{ path: "/..." }` para data binding en TextField values
- Agregar `checks` para validación de campos obligatorios
- Usar `variant: "primary"` para botones principales
- Eliminar surfaces con `a2ui_delete_surface` al terminar
- Preferir A2UI forms sobre `canvas_ask` para formularios complejos con validación