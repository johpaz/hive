---
name: file_writer
description: "Create, modify, and delete files with safe edit operations and confirmation for large changes"
version: 1.0.0
author: Hive Team
icon: "✍️"
category: filesystem
permissions:
  - filesystem_read
  - filesystem_write
dependencies: []
tools: [project_read, project_write, project_edit, project_exists]

# Structured skill fields
triggers:
  - "creá un archivo"
  - "create a file"
  - "escribí en"
  - "write to"
  - "editá este archivo"
  - "edit this file"
  - "modificá"
  - "modify"
  - "eliminá el archivo"
  - "delete file"
  - "guardá esto"
  - "save this"
  - "actualizá el archivo"
  - "update file"

preferred_agents: []

steps:
  - step: 1
    action: project_exists
    instruction: "Check if file exists to determine if creating or editing"
    output: exists_boolean

  - step: 2
    action: project_read (if editing)
    instruction: "Read existing file to understand current structure before modifying"
    output: current_content

  - step: 3
    action: decision_write_or_edit
    instruction: "Choose project_write for new files or complete rewrite, project_edit for targeted changes"
    output: operation_type

  - step: 4
    action: canvas_confirm (if large changes)
    instruction: "Confirm with user before overwriting files with >50 lines of changes"
    output: user_approval

  - step: 5
    action: project_write or project_edit
    instruction: "Execute the write operation with appropriate method"
    output: result

rules:
  - "Always read file before editing to understand structure"
  - "Use project_edit for small, targeted changes (find/replace)"
  - "Use project_write for new files or complete rewrites"
  - "Confirm with canvas_confirm before changes >50 lines"
  - "Verify file path is within workspace unless explicitly requested otherwise"
  - "For delete operations, confirm explicitly with user"

output_format:
  structure: markdown
  sections:
    - "operation"
    - "file_path"
    - "lines_changed"
    - "summary"
  max_length: "Brief summary of changes"

examples:
  - user_input: "creá un archivo README.md con la descripción del proyecto"
    expected_behavior: "project_exists (false) → project_write({ path: 'README.md', content: '...' })"

  - user_input: "editá el package.json para agregar la dependencia lodash"
    expected_behavior: "project_read → project_edit with old_string/new_string for dependencies → confirm"

  - user_input: "eliminá el archivo temporal.log"
    expected_behavior: "project_exists → canvas_confirm('¿Eliminar archivo?') → if approved, delete operation"
---

# File Writer Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita:
- Crear nuevos archivos
- Modificar contenido existente
- Eliminar archivos
- Guardar cambios

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `project_read` | Lee archivo existente | Antes de editar para entender estructura |
| `project_write` | Crea o sobreescribe archivo | Archivos nuevos o reescritura completa |
| `project_edit` | Edita secciones específicas | Cambios puntuales (find/replace) |
| `project_exists` | Verifica existencia | Para decidir crear vs editar |

## Workflow

### Crear Archivo Nuevo
1. `project_exists({ path })` → verificar no existe
2. `project_write({ path, content })` → crear

### Editar Archivo Existente
1. `project_exists({ path })` → verificar existe
2. `project_read({ path })` → entender estructura
3. `project_edit({ path, old_string, new_string })` → modificar
4. `canvas_confirm()` si cambios >50 líneas

### Eliminar Archivo
1. `project_exists({ path })` → verificar existe
2. `canvas_confirm({ message: '¿Eliminar archivo?' })` → confirmar
3. Operación de delete

## Mejores Prácticas

- **Leer antes de editar**: Nunca modificar sin entender estructura
- **Edit vs Write**: Usar edit para cambios pequeños, write para nuevos archivos
- **Confirmar cambios grandes**: >50 líneas requiere confirmación explícita
- **Paths seguros**: Trabajar dentro del workspace por defecto

## Errores a Evitar

- ❌ Editar sin leer primero
- ❌ Sobreescribir sin confirmar si es cambio grande
- ❌ Eliminar sin confirmación explícita
- ❌ Usar write cuando edit es suficiente
