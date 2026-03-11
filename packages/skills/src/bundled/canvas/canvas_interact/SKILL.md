---
name: canvas_interact
description: "Collect user input and confirmations through interactive forms and dialogs"
version: 1.0.0
author: Hive Team
icon: "💬"
category: canvas
permissions:
  - canvas_write
dependencies: []
tools: [canvas_ask, canvas_confirm]

# Structured skill fields
triggers:
  - "preguntame"
  - "ask me"
  - "formulario"
  - "form"
  - "confirmame"
  - "confirm"
  - "necesito ingresar datos"
  - "need to enter data"
  - "dialogo"
  - "dialog"
  - "input del usuario"
  - "user input"
  - "seleccionar opcion"
  - "select option"

preferred_agents: []

steps:
  - step: 1
    action: determine_interaction_type
    instruction: "Determine if simple confirmation (yes/no) or complex form input needed"
    output: interaction_type

  - step: 2
    action: canvas_confirm or canvas_ask
    instruction: "Show appropriate interactive component"
    params:
      confirm: "message, confirm/cancel labels"
      ask: "title, fields array with type/label/options"
    output: user_response

  - step: 3
    action: process_response
    instruction: "Handle user response: proceed if confirmed, collect form data"
    output: processed_data

rules:
  - "Use canvas_confirm for simple yes/no decisions"
  - "Use canvas_ask for multi-field data collection"
  - "Always provide clear labels and placeholders for form fields"
  - "Mark required fields explicitly"
  - "Validate input types (email, number) when applicable"
  - "Handle cancel/dismiss gracefully"

output_format:
  structure: canvas_component
  sections:
    - "component_type"
    - "title"
    - "fields_or_message"
    - "user_response"
  max_length: "Interactive form or confirmation"

examples:
  - user_input: "necesito ingresar mis datos de usuario"
    expected_behavior: "canvas_ask({ title: 'User Data', fields: [{name: 'email', label: 'Email', type: 'email'}, {name: 'role', label: 'Role', type: 'select', options: [...]}] })"

  - user_input: "confirmame antes de eliminar"
    expected_behavior: "canvas_confirm({ message: '¿Eliminar archivo?', confirmLabel: 'Sí', cancelLabel: 'Cancelar' })"

  - user_input: "preguntame las preferencias"
    expected_behavior: "canvas_ask({ title: 'Preferences', fields: [{name: 'theme', label: 'Theme', type: 'select', options: [{label: 'Dark', value: 'dark'}, {label: 'Light', value: 'light'}]}] })"
---

# Canvas Interact Skill

## Cuándo se Activa

Para recoger input del usuario mediante formularios interactivos o confirmaciones.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `canvas_ask` | Muestra formulario | Input multi-campo |
| `canvas_confirm` | Diálogo confirmación | Yes/No decisions |

## Workflow

### Confirmación Simple
```javascript
canvas_confirm({
  message: "¿Eliminar archivo?",
  confirmLabel: "Sí, eliminar",
  cancelLabel: "Cancelar"
})
```

### Formulario Complejo
```javascript
canvas_ask({
  title: "User Registration",
  fields: [
    { name: "email", label: "Email", type: "email", required: true },
    { name: "password", label: "Password", type: "password", required: true },
    { 
      name: "role", 
      label: "Role", 
      type: "select", 
      options: [
        { label: "Admin", value: "admin" },
        { label: "User", value: "user" }
      ]
    }
  ]
})
```

## Tipos de Campo

| Type | Uso |
|------|-----|
| `text` | Texto libre |
| `email` | Email con validación |
| `password` | Contraseña (oculto) |
| `number` | Números |
| `select` | Dropdown con opciones |
| `checkbox` | Booleano |
| `textarea` | Texto multilínea |

## Mejores Prácticas

- Labels claros y descriptivos
- Placeholders con ejemplos
- Marcar required explícitamente
- Validar tipos (email, number)
- Manejar cancel gracefully

## Errores a Evitar

- ❌ Labels vagos sin contexto
- ❌ No marcar required fields
- ❌ Sin validación de tipo
- ❌ No manejar cancel
