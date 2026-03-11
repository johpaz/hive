---
name: code_refactor
description: "Refactor existing code to improve structure, performance, and maintainability using CLI subagents"
version: 1.0.0
author: Hive Team
icon: "🔧"
category: codebridge
permissions:
  - codebridge_execute
dependencies: []
tools: [codebridge_launch, codebridge_status, fs_read, fs_edit, fs_write]

# Structured skill fields
triggers:
  - "refactorizá el código"
  - "refactor code"
  - "mejorá el código"
  - "improve code"
  - "optimizá este archivo"
  - "optimize this file"
  - "hacé el código más limpio"
  - "make code cleaner"
  - "reestructurá"
  - "restructure"
  - "mejorá la performance"
  - "improve performance"
  - "limpieza de código"
  - "code cleanup"

preferred_agents: []

steps:
  - step: 1
    action: fs_read
    instruction: "Read existing code to understand current implementation"
    params:
      path: "file to refactor"
    output: current_code

  - step: 2
    action: analyze_code
    instruction: "Identify areas for improvement: duplication, complexity, performance, readability"
    output: improvement_areas

  - step: 3
    action: codebridge_launch
    instruction: "Launch CLI subagent with refactoring prompt specifying improvements needed"
    params:
      agent: "claude|qwen|gemini|opencode"
      prompt: "Refactor code to improve: [specific areas]. Maintain functionality, improve [metrics]"
    output: process_id

  - step: 4
    action: codebridge_status
    instruction: "Monitor refactoring progress"
    params:
      process_id: "ID from step 3"
    output: refactor_status

  - step: 5
    action: fs_read
    instruction: "Read refactored code and compare with original"
    params:
      path: "refactored file path"
    output: refactored_code

  - step: 6
    action: synthesize
    instruction: "Summarize changes made and benefits of refactoring"
    output: refactor_summary

rules:
  - "Always read and understand existing code before refactoring"
  - "Identify specific improvement areas: DRY, complexity, performance, naming"
  - "Preserve existing functionality — refactoring ≠ rewriting"
  - "Maintain backward compatibility if code is used by others"
  - "Verify refactored code passes existing tests if available"
  - "Document significant structural changes for team awareness"

output_format:
  structure: markdown
  sections:
    - "file_refactored"
    - "changes_summary"
    - "improvements"
    - "before_after_comparison"
    - "testing_recommendations"
  max_length: "Clear summary with key changes highlighted"

examples:
  - user_input: "refactorizá este archivo para que sea más legible"
    expected_behavior: "Read → identify complexity → codebridge_launch → return refactored code with summary"

  - user_input: "optimizá la performance de esta función"
    expected_behavior: "Analyze bottlenecks → codebridge_launch with optimization focus → return optimized code"

  - user_input: "hacé el código más limpio y mantenible"
    expected_behavior: "Identify smells → extract functions, rename variables → return cleaner code"
---

# Code Refactor Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita mejorar código existente: limpiar, optimizar, reestructurar, o hacer más mantenible.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `fs_read` | Lee código existente | Análisis inicial |
| `codebridge_launch` | Lanza subagente para refactorizar | Refactorización real |
| `codebridge_status` | Verifica estado | Monitoreo |
| `fs_edit` | Aplica cambios específicos | Cambios puntuales |
| `fs_write` | Guarda código refactorizado | Si hay nuevos archivos |

## Workflow

### Refactorización
```javascript
// 1. Leer código existente
const code = fs_read({ path: "src/legacy.ts" })

// 2. Analizar áreas de mejora
// - Funciones muy largas (>50 líneas)
// - Duplicación de lógica
// - Nombres poco claros
// - Complejidad ciclomática alta
// - Performance issues

// 3. Lanzar subagente con foco específico
const { process_id } = codebridge_launch({
  agent: "claude",
  prompt: `
    Refactor this TypeScript code:
    - Extract functions longer than 30 lines
    - Rename variables for clarity
    - Apply DRY principle
    - Add JSDoc comments
    - Maintain exact functionality
  `
})

// 4. Verificar resultado
const refactored = fs_read({ path: "src/refactored.ts" })

// 5. Comparar y resumir cambios
```

## Áreas Comunes de Refactorización

| Área | Técnicas |
|------|----------|
| Legibilidad | Nombres claros, funciones cortas, comentarios |
| DRY | Extraer funciones, eliminar duplicación |
| Performance | Algoritmos eficientes, caching, lazy loading |
| Mantenibilidad | Interfaces claras, separación de concerns |
| Testing | Hacer código testable, inyección de dependencias |

## Mejores Prácticas

- Entender código antes de tocar
- Cambios incrementales, no rewrites completos
- Mantener tests pasando
- Documentar cambios estructurales grandes

## Errores a Evitar

- ❌ Refactorizar sin entender funcionalidad
- ❌ Cambiar comportamiento sin avisar
- ❌ Hacer cambios muy grandes de una vez
- ❌ No verificar tests después de refactorizar
