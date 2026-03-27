---
name: code_debug
description: "Debug and fix code errors by analyzing stack traces, identifying root causes, and applying fixes using CLI subagents"
version: 1.0.0
author: Hive Team
icon: "🐛"
category: codebridge
permissions:
  - codebridge_execute
dependencies: []
tools: [codebridge_launch, codebridge_status, fs_read, fs_edit, cli_exec]

# Structured skill fields
triggers:
  - "debugueá el código"
  - "debug code"
  - "arreglá el error"
  - "fix error"
  - "encontrá el bug"
  - "find bug"
  - "por qué falla"
  - "why it fails"
  - "stack trace"
  - "error en el código"
  - "code error"
  - "no funciona"
  - "not working"
  - "excepción"
  - "exception"

preferred_agents: []

steps:
  - step: 1
    action: gather_context
    instruction: "Collect error message, stack trace, affected files, and reproduction steps"
    output: error_context

  - step: 2
    action: fs_read
    instruction: "Read relevant code files where error occurs"
    params:
      path: "files mentioned in stack trace"
    output: code_files

  - step: 3
    action: cli_exec (optional)
    instruction: "Run tests or reproduce error to confirm"
    params:
      command: "test command or reproduction step"
    output: error_reproduction

  - step: 4
    action: codebridge_launch
    instruction: "Launch CLI subagent to analyze error and propose fix"
    params:
      cli: "claude|qwen|gemini"
      prompt: "Analyze error: [error message]. Stack trace: [trace]. Propose root cause and fix."
    output: process_id

  - step: 5
    action: codebridge_status
    instruction: "Get debugging analysis and proposed fix"
    params:
      process_id: "ID from step 4"
    output: debug_analysis

  - step: 6
    action: fs_edit
    instruction: "Apply fix to code"
    params:
      path: "file to fix"
      changes: "proposed changes from debug analysis"
    output: fix_applied

  - step: 7
    action: cli_exec
    instruction: "Verify fix by running tests or reproducing scenario"
    params:
      command: "test command"
    output: verification_result

rules:
  - "Always read full error message and stack trace before analyzing"
  - "Identify exact line and file where error originates"
  - "Understand root cause, not just symptoms"
  - "Propose minimal fix that addresses root cause"
  - "Verify fix doesn't break existing functionality"
  - "Add regression test if applicable"

output_format:
  structure: markdown
  sections:
    - "error_summary"
    - "root_cause"
    - "affected_files"
    - "fix_applied"
    - "verification"
    - "prevention_tips"
  max_length: "Clear explanation with before/after code"

examples:
  - user_input: "debugueá este error: TypeError: Cannot read property of undefined"
    expected_behavior: "Read stack trace → identify undefined variable → fix null check → verify"

  - user_input: "los tests están fallando, encontrá el bug"
    expected_behavior: "Run tests → read failing test → analyze code → fix → re-run tests"

  - user_input: "la API devuelve 500, por qué falla"
    expected_behavior: "Read server logs → identify error → fix backend code → verify API works"
---

# Code Debug Skill

## Cuándo se Activa

Esta skill se activa cuando hay errores en el código: exceptions, bugs, tests fallando, comportamientos inesperados.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `fs_read` | Lee código con errores | Análisis inicial |
| `cli_exec` | Ejecuta tests, reproduce error | Confirmar bug |
| `codebridge_launch` | Lanza subagente para debug | Análisis profundo |
| `codebridge_status` | Obtiene diagnóstico | Resultado del análisis |
| `fs_edit` | Aplica fix al código | Corrección |

## Workflow

### Debugging
```javascript
// 1. Recopilar contexto
// - Error message completo
// - Stack trace
// - Archivos afectados
// - Steps para reproducir

// 2. Leer código relevante
const code = fs_read({ path: "src/failing.ts" })

// 3. Reproducir error (opcional)
const result = cli_exec({ command: "npm test -- failing.test.ts" })

// 4. Analizar con subagente
const { process_id } = codebridge_launch({
  cli: "claude",
  prompt: `
    Error: TypeError: Cannot read property 'id' of undefined
    Stack trace:
      at getUser (src/user.ts:15)
      at handler (src/handler.ts:42)

    Analizar:
    1. ¿Qué variable es undefined?
    2. ¿Por qué no está inicializada?
    3. ¿Cómo fixear?
  `
})

// 5. Obtener diagnóstico
const analysis = codebridge_status({ process_id })

// 6. Aplicar fix
fs_edit({
  path: "src/user.ts",
  changes: "Add null check before accessing .id"
})

// 7. Verificar
cli_exec({ command: "npm test" })
```

## Tipos Comunes de Errores

| Error | Causa común | Fix típico |
|-------|-------------|------------|
| TypeError undefined | Null/undefined access | Add null check |
| ReferenceError | Variable no declarada | Declarar/importar |
| SyntaxError | Typos, missing chars | Fix syntax |
| AssertionError | Lógica incorrecta | Fix condition |
| Timeout | Async no resuelve | Add timeout handling |

## Estrategia de Debug

1. **Reproducir**: Confirmar que el error existe
2. **Localizar**: Stack trace → archivo → línea
3. **Entender**: ¿Por qué pasa aquí?
4. **Fixear**: Mínimo cambio que resuelve root cause
5. **Verificar**: Tests pasan, no hay regresiones

## Configuración por CLI para Debug

### Qwen CLI (Debug Rápido)
```typescript
codebridge_launch({
  taskId: "debug-001",
  config: {
    role: "development",
    cli: "qwen",
    args: ["--non-interactive"],
    cwd: "/path/to/project",
    timeoutSeconds: 120,  // 2 minutos - rápido
  },
  prompt: `
    Error: TypeError: Cannot read property 'id' of undefined
    File: src/user.ts:15
    Stack trace:
      at getUser (src/user.ts:15)
      at handler (src/handler.ts:42)
    
    Identify the root cause and propose a minimal fix.
  `
})
```
**Ideal para:** Errores simples, null checks, bugs rápidos

### Claude Code (Debug Complejo)
```typescript
codebridge_launch({
  taskId: "debug-002",
  config: {
    role: "development",
    cli: "claude",
    args: ["--no-approve", "--output-format", "stream"],
    cwd: "/path/to/project",
    timeoutSeconds: 300,  // 5 minutos - análisis profundo
  },
  prompt: `
    Analyze this intermittent race condition:
    - Error occurs in 10% of requests
    - Affects async database operations
    - Stack trace shows Promise.all() in src/batch.ts
    
    Provide:
    1. Root cause analysis
    2. Fix with proper Promise handling
    3. Test to reproduce the race condition
  `
})
```
**Ideal para:** Race conditions, bugs intermitentes, análisis profundo

### Gemini CLI (Debug + Docs)
```typescript
codebridge_launch({
  taskId: "debug-003",
  config: {
    role: "development",
    cli: "gemini",
    args: ["-y", "--quiet"],
    cwd: "/path/to/project",
    timeoutSeconds: 240,
  },
  prompt: `
    Fix this TypeScript type error and add documentation:
    
    Error: Type 'X' is not assignable to type 'Y'
    File: src/types.ts:45
    
    Provide:
    1. Type fix
    2. JSDoc explaining the type constraint
    3. Example of correct usage
  `
})
```
**Ideal para:** Errores de tipo + documentación

## Tabla Comparativa de CLIs para Debug

| CLI | Timeout | Mejor Para | Ejemplo |
|-----|---------|------------|---------|
| **qwen** | 120s | Bugs rápidos, null checks | TypeError, ReferenceError |
| **claude** | 300s | Race conditions, análisis profundo | Intermittent bugs |
| **gemini** | 240s | Type errors + docs | TypeScript errors |

## Ejemplos Detallados

### Ejemplo 1: TypeError Simple con Qwen
```typescript
// Usuario: "arreglá este error: Cannot read property 'name' of undefined"
codebridge_launch({
  taskId: "typeerror-001",
  config: {
    role: "development",
    cli: "qwen",
    cwd: process.cwd(),
    timeoutSeconds: 120,
  },
  prompt: `
    Error: TypeError: Cannot read property 'name' of undefined
    File: src/components/UserCard.tsx:23
    Code: const userName = user.name;
    
    The 'user' prop can be undefined. Add proper null check.
    Provide minimal fix.
  `
})
```

### Ejemplo 2: Race Condition con Claude
```typescript
// Usuario: "la app crashea intermitentemente en producción"
codebridge_launch({
  taskId: "racecondition-002",
  config: {
    role: "development",
    cli: "claude",
    cwd: "/path/to/project",
    timeoutSeconds: 300,
  },
  prompt: `
    Intermittent crash in production (10% of requests):
    
    Error: Cannot read properties of undefined (reading 'map')
    File: src/dashboard/Dashboard.tsx:89
    
    Context:
    - Dashboard fetches data from 3 APIs in parallel
    - Uses Promise.all() without error handling
    - One API sometimes returns empty response
    
    Analyze:
    1. Root cause of race condition
    2. Fix with proper error handling
    3. Add retry logic for flaky API
  `
})
```

### Ejemplo 3: Error de Tipo con Gemini
```typescript
// Usuario: "TypeScript no compila, error de tipos"
codebridge_launch({
  taskId: "typeerror-003",
  config: {
    role: "development",
    cli: "gemini",
    cwd: "/path/to/project",
    timeoutSeconds: 240,
  },
  prompt: `
    TypeScript Error:
    Type '(user: User) => Promise<User>' is not assignable to type '(user: User) => User'
    
    File: src/services/userService.ts:34
    Function: updateUser
    
    Current code returns Promise<User> but interface expects User.
    Fix the type mismatch and add JSDoc explaining the async behavior.
  `
})
```

## Mejores Prácticas

### ✅ DOs
- Leer error completo y stack trace
- Identificar archivo y línea exactos
- Entender root cause, no solo síntomas
- Fix minimalista que aborda causa raíz
- Agregar test de regresión
- Verificar con tests existentes

### ❌ DON'Ts
- ❌ Fixear síntomas sin entender causa
- ❌ Cambios grandes sin necesidad
- ❌ No verificar que el fix funciona
- ❌ Ignorar tests que ahora fallan
- ❌ Olvidar casos edge (null, undefined)

## Manejo de Errores

### Error: "Missing environment variables"
```typescript
// Verificar antes de lanzar
if (!process.env.ANTHROPIC_API_KEY && cli === "claude") {
  throw new Error("ANTHROPIC_API_KEY required for Claude Code");
}
```

### Error: "Process exited with code 1"
- Leer stdout/stderr para mensaje de error específico
- El CLI puede haber rechazado el prompt (muy vago)
- Reintentar con prompt más detallado

### Error: Timeout
- Aumentar `timeoutSeconds` para análisis complejos
- Dividir debug en pasos más pequeños
- Usar Qwen para bugs simples (más rápido)

## Errores a Evitar

- ❌ Fixear síntomas sin entender causa
- ❌ Cambios grandes sin necesidad
- ❌ No verificar que el fix funciona
- ❌ Ignorar tests que ahora fallan
- ❌ No agregar test de regresión
