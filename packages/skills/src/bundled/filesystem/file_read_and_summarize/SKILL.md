---
name: file_read_and_summarize
description: "Read and understand file content with automatic summarization for large files"
version: 1.0.0
author: Hive Team
icon: "📄"
category: filesystem
permissions:
  - filesystem_read
dependencies: []
tools: [project_read]

# Structured skill fields
triggers:
  - "leé este archivo"
  - "read this file"
  - "mostrame el contenido"
  - "show content"
  - "qué dice este archivo"
  - "resumí este archivo"
  - "summarize this file"
  - "entendé este código"
  - "understand this code"

preferred_agents: []

steps:
  - step: 1
    action: project_exists
    instruction: "Verify file exists before attempting to read"
    output: exists_boolean

  - step: 2
    action: project_read
    instruction: "Read file content. Use offset/limit for large files (>1000 lines)"
    params:
      path: "file path"
      offset: 0
      limit: 100
    output: file_content

  - step: 3
    action: synthesize
    instruction: "Summarize content if file is large. Extract key information relevant to user request"
    output: summary

rules:
  - "Always check file exists with project_exists before reading"
  - "Use offset and limit for files >1000 lines to avoid context saturation"
  - "Read in chunks for very large files — iterate with offset"
  - "Summarize automatically for files >500 lines unless user requests full content"
  - "Identify file type by extension and adapt summary format (code vs text vs config)"

output_format:
  structure: markdown
  sections:
    - "file_path"
    - "file_type"
    - "line_count"
    - "summary"
    - "key_points"
  max_length: "500 words for summary, full content if requested"

examples:
  - user_input: "leé el archivo package.json"
    expected_behavior: "Check exists → project_read({ path: 'package.json' }) → return full content (small file)"

  - user_input: "resumí el archivo src/main.ts"
    expected_behavior: "project_read with offset/limit → identify main exports and functions → summarize structure"

  - user_input: "qué dice este archivo de configuración"
    expected_behavior: "project_read → parse config format → explain key settings in plain language"
---

# File Read and Summarize Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita leer y entender el contenido de un archivo, especialmente cuando:
- El archivo es grande y necesita resumen
- Se requiere comprensión del contenido (no solo lectura)
- El usuario pide "qué dice", "resumí", "entendé"

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `project_read` | Lee contenido de archivo del workspace | Lectura de cualquier archivo |

## Workflow

1. **Verificar existencia** → `project_exists({ path })`
2. **Leer contenido** → `project_read({ path, offset, limit })`
3. **Sintetizar** → Resumir si es grande, extraer puntos clave

## Mejores Prácticas

- Para archivos >1000 líneas, usar `offset` y `limit`
- Identificar tipo de archivo por extensión y adaptar formato de resumen
- Para código: identificar funciones, clases, exports principales
- Para config: explicar settings clave en lenguaje simple
- Para texto: extraer ideas principales

## Errores a Evitar

- ❌ Leer sin verificar existencia
- ❌ Retornar archivo completo sin resumir si es muy grande
- ❌ No identificar tipo de archivo para adaptar resumen
