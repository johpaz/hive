---
name: file_writer
description: "Create, modify, and delete files with safe edit operations after required authorization"
version: 1.0.0
author: Hive Team
icon: "✍️"
category: filesystem
permissions:
  - filesystem_read
  - filesystem_write
dependencies: []
tools: [fs_read, fs_write, fs_edit, fs_exists]

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
    action: fs_exists
    instruction: "Check if file exists to determine if creating or editing"
    output: exists_boolean

  - step: 2
    action: fs_read
    instruction: "Read existing file to understand current structure before modifying"
    output: current_content

  - step: 3
    action: decision_write_or_edit
    instruction: "Choose fs_write for new files or complete rewrite, fs_edit for targeted changes"
    output: operation_type

  - step: 4
    action: fs_write_or_edit
    instruction: "Execute the authorized write operation with the appropriate method"
    output: result

rules:
  - "Always read file before editing to understand structure"
  - "Use fs_edit for small, targeted changes (find/replace)"
  - "Use fs_write for new files or complete rewrites"
  - "Verify file path is within workspace unless explicitly requested otherwise"
  - "For destructive operations, require explicit authorization before this skill runs"

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
    expected_behavior: "fs_exists (false) → fs_write({ path: 'README.md', content: '...' })"

  - user_input: "editá el package.json para agregar la dependencia lodash"
    expected_behavior: "fs_read → fs_edit with old_string/new_string for dependencies"

  - user_input: "eliminá el archivo temporal.log"
    expected_behavior: "after explicit authorization: fs_exists → fs_delete"
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
| `fs_read` | Lee archivo existente | Antes de editar para entender estructura |
| `fs_write` | Crea o sobreescribe archivo | Archivos nuevos o reescritura completa |
| `fs_edit` | Edita secciones específicas | Cambios puntuales (find/replace) |
| `fs_exists` | Verifica existencia | Para decidir crear vs editar |

## Workflow

### Crear Archivo Nuevo
1. `fs_exists({ path })` → verificar no existe
2. `fs_write({ path, content })` → crear

### Editar Archivo Existente
1. `fs_exists({ path })` → verificar existe
2. `fs_read({ path })` → entender estructura
3. `fs_edit({ path, old_string, new_string })` → modificar
4. Ejecutar únicamente dentro del alcance autorizado por el coordinador

### Eliminar Archivo
1. `fs_exists({ path })` → verificar existe
2. Verificar que el coordinador ya obtuvo autorización explícita
3. `fs_delete({ path })`

## Mejores Prácticas

- **Leer antes de editar**: Nunca modificar sin entender estructura
- **Edit vs Write**: Usar edit para cambios pequeños, write para nuevos archivos
- **Respetar autorización**: las confirmaciones se gestionan previamente desde el panel interactivo
- **Paths seguros**: Trabajar dentro del workspace por defecto

## Errores a Evitar

- ❌ Editar sin leer primero
- ❌ Ampliar el alcance autorizado
- ❌ Eliminar sin autorización explícita previa
- ❌ Usar write cuando edit es suficiente
