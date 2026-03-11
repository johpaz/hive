---
name: file_manager
description: "Explore project structure and locate files using glob patterns and directory listing"
version: 1.0.0
author: Hive Team
icon: "📁"
category: filesystem
permissions:
  - filesystem_read
dependencies: []
tools: [project_list, project_glob, project_exists]

# Structured skill fields
triggers:
  - "lista los archivos"
  - "list files"
  - "buscá archivos"
  - "find files"
  - "explorá el proyecto"
  - "explore project"
  - "qué archivos hay"
  - "what files exist"
  - "buscá por patrón"
  - "search by pattern"
  - "existe este archivo"
  - "file exists"
  - "dónde está"
  - "where is"

preferred_agents: []

steps:
  - step: 1
    action: project_list
    instruction: "List directory contents to understand project structure"
    params:
      path: "."
    output: directory_tree

  - step: 2
    action: project_glob
    instruction: "Find files matching specific pattern (e.g., **/*.ts, **/*.md)"
    params:
      pattern: "**/*.ts"
    output: matching_files

  - step: 3
    action: project_exists
    instruction: "Verify specific file or directory exists"
    params:
      path: "specific/path"
    output: exists_boolean

rules:
  - "Use project_list for initial exploration of unknown directories"
  - "Use project_glob when user specifies file type or pattern"
  - "Always verify with project_exists before read/edit operations"
  - "Stay within workspace directory unless explicitly requested otherwise"
  - "For recursive search, use ** pattern (e.g., **/*.ts finds all .ts files)"

output_format:
  structure: markdown
  sections:
    - "search_type"
    - "results"
    - "file_count"
  max_length: "List up to 20 files, summarize if more"

examples:
  - user_input: "lista los archivos del proyecto"
    expected_behavior: "project_list({ path: '.' }) → return root directory structure"

  - user_input: "buscá todos los archivos TypeScript"
    expected_behavior: "project_glob({ pattern: '**/*.ts' }) → return list of .ts files"

  - user_input: "existe el archivo src/config.ts"
    expected_behavior: "project_exists({ path: 'src/config.ts' }) → return true/false"
---

# File Manager Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita:
- Explorar la estructura del proyecto
- Buscar archivos por extensión o patrón
- Verificar si existe un archivo o directorio
- Encontrar la ubicación de un archivo

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `project_list` | Lista directorios y archivos | Exploración inicial |
| `project_glob` | Busca archivos por patrón wildcard | Búsqueda por extensión/patrón |
| `project_exists` | Verifica existencia | Pre-check antes de operaciones |

## Workflow

1. **Explorar** → `project_list({ path })` para estructura general
2. **Buscar por patrón** → `project_glob({ pattern })` para tipos específicos
3. **Verificar** → `project_exists({ path })` para confirmación

## Patrones Glob Comunes

| Patrón | Encuentra |
|--------|-----------|
| `**/*.ts` | Todos los TypeScript |
| `**/*.test.ts` | Solo tests |
| `**/*.md` | Documentación |
| `**/package.json` | Todos los package.json |
| `src/**/*.tsx` | React components en src |

## Errores a Evitar

- ❌ No verificar existencia antes de leer/editar
- ❌ Usar project_list cuando se conoce el patrón (usar glob)
- ❌ Patrones muy amplios sin filtrado
