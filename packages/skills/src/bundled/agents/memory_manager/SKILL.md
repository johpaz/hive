---
name: memory_manager
description: "Complete management of persistent memory including write, read, search, list, and delete operations"
version: 1.0.0
author: Hive Team
icon: "🧠"
category: agents
permissions:
  - memory_read
  - memory_write
dependencies: []
tools: [memory_write, memory_read, memory_list, memory_search, memory_delete]

# Structured skill fields
triggers:
  - "guardá en memoria"
  - "save to memory"
  - "recordá esto"
  - "remember this"
  - "leé la memoria"
  - "read memory"
  - "qué hay en memoria"
  - "what's in memory"
  - "buscá en memoria"
  - "search memory"
  - "lista las memorias"
  - "list memories"
  - "eliminá de memoria"
  - "delete from memory"
  - "preferencias"
  - "preferences"
  - "datos persistentes"
  - "persistent data"

preferred_agents: []

steps:
  - step: 1
    action: determine_operation
    instruction: "Determine if user wants to write, read, list, search, or delete"
    output: operation_type

  - step: 2
    action: execute_memory_op
    instruction: "Execute appropriate memory operation"
    params:
      write: "memory_write({ title, content })"
      read: "memory_read({ title })"
      list: "memory_list({})"
      search: "memory_search({ query })"
      delete: "memory_delete({ title })"
    output: memory_result

  - step: 3
    action: format_result
    instruction: "Format memory content for user consumption"
    output: formatted_result

rules:
  - "Use descriptive, unique titles for memory_write — titles are used for direct lookup"
  - "If title exists, memory_write overwrites — confirm before overwriting important data"
  - "Use memory_search for fuzzy matching when exact title unknown"
  - "Use memory_list to show all when user asks 'what did you save'"
  - "Avoid storing sensitive data (passwords, API keys, tokens)"
  - "Keep content concise — split large data into multiple entries"

output_format:
  structure: markdown
  sections:
    - "title"
    - "content_summary"
    - "created_at"
  max_length: "1000 characters per entry"

examples:
  - user_input: "guardá en memoria que prefiero TypeScript"
    expected_behavior: "memory_write({ title: 'Preferencias de Desarrollo', content: 'El usuario prefiere TypeScript' })"

  - user_input: "qué guardaste sobre mis preferencias"
    expected_behavior: "memory_search({ query: 'preferencias' }) → return matching memories"

  - user_input: "lista todas las memorias"
    expected_behavior: "memory_list({}) → return all memory titles"

  - user_input: "buscá en memoria información sobre la DB"
    expected_behavior: "memory_search({ query: 'DB database' }) → return relevant entries"
---

# Memory Manager Skill

## Cuándo se Activa

Para guardar, recuperar, buscar, listar o eliminar información persistente entre sesiones.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `memory_write` | Almacena con título único | Guardar preferencias, datos |
| `memory_read` | Recupera por título exacto | Cuando conocés el título |
| `memory_list` | Lista todos los títulos | Explorar qué hay guardado |
| `memory_search` | Busca por keywords | Cuando no recordás título exacto |
| `memory_delete` | Elimina entrada | Limpiar datos obsoletos |

## Workflow

### Write
```javascript
memory_write({ 
  title: "Preferencias de Desarrollo",
  content: "TypeScript, VS Code, Prettier single quotes"
})
```

### Read/Search
```javascript
memory_read({ title: "Preferencias" })  // Título exacto
memory_search({ query: "preferencias" })  // Fuzzy match
```

### List
```javascript
memory_list({})  // Todos los títulos
```

### Delete
```javascript
memory_delete({ title: "Datos Temporales" })
```

## Mejores Prácticas

- Títulos descriptivos y únicos
- Agrupar datos relacionados en misma entrada
- Confirmar antes de sobrescribir
- No guardar datos sensibles

## Errores a Evitar

- ❌ Datos sensibles (passwords, API keys)
- ❌ Títulos genéricos ("Config", "Datos")
- ❌ Sobrescribir sin confirmar
- ❌ Entradas gigantes (split por tema)
