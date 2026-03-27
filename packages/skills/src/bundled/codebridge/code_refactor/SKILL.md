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
      cli: "claude|qwen|gemini|opencode"
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
  cli: "claude",
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

## Configuración por CLI para Refactorización

### Claude Code (Refactorización Compleja)
```typescript
codebridge_launch({
  taskId: "refactor-001",
  config: {
    role: "development",
    cli: "claude",
    args: ["--no-approve", "--output-format", "stream"],
    cwd: "/path/to/project",
    timeoutSeconds: 300,  // 5 minutos - análisis profundo
  },
  prompt: `
    Refactor this authentication module:
    - Current: 400 lines, single file
    - Issues: No separation of concerns, hard to test
    - Goal: Split into controller, service, repository
    - Add dependency injection for testability
    - Maintain backward compatible API
  `
})
```
**Ideal para:** Refactorización arquitectónica, patrones de diseño, gran escala

### Qwen CLI (Limpieza Rápida)
```typescript
codebridge_launch({
  taskId: "refactor-002",
  config: {
    role: "development",
    cli: "qwen",
    args: ["--non-interactive"],
    cwd: "/path/to/project",
    timeoutSeconds: 120,  // 2 minutos
  },
  prompt: `
    Clean up this function:
    - Rename variables: x, y, z → descriptive names
    - Extract helper functions (lines 45-89)
    - Add early returns to reduce nesting
    - Keep same functionality
  `
})
```
**Ideal para:** Limpieza rápida, rename variables, funciones cortas

### Gemini CLI (Refactor + Docs)
```typescript
codebridge_launch({
  taskId: "refactor-003",
  config: {
    role: "development",
    cli: "gemini",
    args: ["-y", "--quiet"],
    cwd: "/path/to/project",
    timeoutSeconds: 240,
  },
  prompt: `
    Refactor this API client with full documentation:
    - Add retry logic with exponential backoff
    - Implement request/response interceptors
    - Add comprehensive JSDoc comments
    - Include usage examples in docs
  `
})
```
**Ideal para:** Refactor + documentación, API clients

### OpenCode (Patrones Open Source)
```typescript
codebridge_launch({
  taskId: "refactor-004",
  config: {
    role: "development",
    cli: "opencode",
    args: ["--headless", "--auto-accept"],
    cwd: "/path/to/project",
    timeoutSeconds: 200,
  },
  prompt: `
    Refactor to follow open source best practices:
    - Add input validation at module boundaries
    - Implement error codes for programmatic handling
    - Add logging hooks for debugging
    - Follow community conventions
  `
})
```
**Ideal para:** Patrones community-driven, librerías públicas

## Tabla Comparativa de CLIs para Refactor

| CLI | Timeout | Mejor Para | Ejemplo |
|-----|---------|------------|---------|
| **claude** | 300s | Arquitectura, patrones | Split monolith |
| **qwen** | 120s | Limpieza rápida | Rename, extract |
| **gemini** | 240s | Refactor + docs | API client |
| **opencode** | 200s | Open source patterns | Public libraries |

## Ejemplos Detallados

### Ejemplo 1: Extraer Funciones con Qwen
```typescript
// Usuario: "hacé esta función más legible"
codebridge_launch({
  taskId: "refactor-legible-001",
  config: {
    role: "development",
    cli: "qwen",
    cwd: process.cwd(),
    timeoutSeconds: 120,
  },
  prompt: `
    Refactor this 80-line function to improve readability:
    
    File: src/orderProcessor.ts
    
    Tasks:
    1. Extract validation logic (lines 5-25)
    2. Extract pricing calculation (lines 30-60)
    3. Extract notification sending (lines 65-80)
    4. Add descriptive function names
    5. Maintain exact same behavior
    
    Each extracted function should be < 25 lines.
  `
})
```

### Ejemplo 2: Separación de Concerns con Claude
```typescript
// Usuario: "separá la lógica de negocio del controller"
codebridge_launch({
  taskId: "refactor-soc-002",
  config: {
    role: "development",
    cli: "claude",
    cwd: "/path/to/project",
    timeoutSeconds: 300,
  },
  prompt: `
    Refactor this Express controller to follow clean architecture:
    
    Current issues:
    - Business logic mixed with HTTP handling
    - Direct database calls in controller
    - Hard to test (requires HTTP server)
    
    Goal:
    1. Create UserService class (business logic)
    2. Create UserRepository (data access)
    3. Keep controller thin (HTTP only)
    4. Add dependency injection
    5. Maintain same API endpoints
    
    Files to create:
    - src/services/UserService.ts
    - src/repositories/UserRepository.ts
    - src/controllers/UserController.ts (refactored)
  `
})
```

### Ejemplo 3: Optimización de Performance con Gemini
```typescript
// Usuario: "optimizá esta función que es lenta"
codebridge_launch({
  taskId: "refactor-perf-003",
  config: {
    role: "development",
    cli: "gemini",
    cwd: "/path/to/project",
    timeoutSeconds: 240,
  },
  prompt: `
    Optimize this function for performance:
    
    File: src/dataProcessor.ts
    Current issues:
    - O(n²) nested loop (lines 15-40)
    - Repeated array filtering
    - No caching of computed values
    
    Requirements:
    1. Reduce to O(n) or O(n log n)
    2. Add memoization for expensive calculations
    3. Use Map/Set for O(1) lookups
    4. Add JSDoc with complexity analysis
    5. Include before/after benchmark example
  `
})
```

## Mejores Prácticas

### ✅ DOs
- Entender código antes de tocar
- Cambios incrementales, no rewrites completos
- Mantener tests pasando
- Documentar cambios estructurales grandes
- Preservar backward compatibility
- Medir mejora (performance, líneas, complejidad)

### ❌ DON'Ts
- ❌ Refactorizar sin entender funcionalidad
- ❌ Cambiar comportamiento sin avisar
- ❌ Hacer cambios muy grandes de una vez
- ❌ No verificar tests después de refactorizar
- ❌ Romper API pública sin versión mayor

## Métricas de Refactorización

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Líneas de código | 400 | 250 | -37% |
| Funciones > 30 líneas | 8 | 2 | -75% |
| Complejidad ciclomática | 45 | 22 | -51% |
| Tiempo de tests | 120s | 85s | -29% |
| Coverage | 65% | 82% | +26% |

## Manejo de Errores

### Error: "Functionality changed after refactor"
- Siempre verificar tests después de refactorizar
- Usar `fs_read` para comparar before/after
- Mantener backup del código original

### Error: "Timeout during large refactor"
- Dividir en múltiples tareas más pequeñas
- Usar Claude con timeout extendido (600s)
- Refactorizar por módulos, no todo junto

## Errores a Evitar

- ❌ Refactorizar sin entender funcionalidad
- ❌ Cambiar comportamiento sin avisar
- ❌ Hacer cambios muy grandes de una vez
- ❌ No verificar tests después de refactorizar
- ❌ No documentar cambios estructurales
