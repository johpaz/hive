---
name: code_generate
description: "Generate new code using external CLI subagents (Claude Code, Qwen, Gemini, OpenCode) via Code Bridge"
version: 1.0.0
author: Hive Team
icon: "✨"
category: codebridge
permissions:
  - codebridge_execute
dependencies: []
tools: [codebridge_launch, codebridge_status, fs_write, fs_read]

# Structured skill fields
triggers:
  - "generá código"
  - "generate code"
  - "creá el código"
  - "create code"
  - "escribí el código"
  - "write code"
  - "implementá desde cero"
  - "implement from scratch"
  - "nuevo archivo"
  - "new file"
  - "crear módulo"
  - "create module"
  - "código nuevo"
  - "new code"

preferred_agents: []

steps:
  - step: 1
    action: clarify_requirements
    instruction: "Understand what code needs to be generated: language, framework, functionality, constraints"
    output: requirements

  - step: 2
    action: codebridge_launch
    instruction: "Launch CLI subagent with detailed code generation prompt"
    params:
      cli: "qwen|claude|gemini|opencode"
      prompt: "Generate [language] code for [functionality] with [requirements]"
    output: process_id

  - step: 3
    action: codebridge_status
    instruction: "Monitor code generation progress"
    params:
      process_id: "ID from step 2"
    output: generation_status

  - step: 4
    action: fs_read
    instruction: "Read generated code files to verify quality"
    params:
      path: "generated file paths"
    output: generated_code

  - step: 5
    action: synthesize
    instruction: "Summarize what was generated and provide usage instructions"
    output: final_report

rules:
  - "Always clarify language, framework, and specific requirements before generating"
  - "Use codebridge_launch with detailed, specific prompts for best results"
  - "Verify generated code compiles/passes lint if applicable"
  - "Read generated files to ensure they match requirements"
  - "Provide clear summary of what was created and how to use it"
  - "Suggest improvements or next steps if code needs refinement"

output_format:
  structure: markdown
  sections:
    - "files_created"
    - "language_framework"
    - "functionality_summary"
    - "usage_instructions"
    - "next_steps"
  max_length: "Clear summary with file paths and key functions"

examples:
  - user_input: "generá un endpoint REST en Express"
    expected_behavior: "codebridge_launch({ cli: 'qwen', prompt: 'Generate Express.js REST endpoint' }) → verify → return file paths"

  - user_input: "creá el código para un componente React con TypeScript"
    expected_behavior: "Clarify props → codebridge_launch → generate .tsx file → return component with usage example"

  - user_input: "implementá una función que valide emails"
    expected_behavior: "codebridge_launch → generate validation function with regex → return code with test examples"
---

# Code Generate Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita crear código nuevo desde cero: archivos, módulos, funciones, componentes, endpoints, etc.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `codebridge_launch` | Lanza subagente CLI para generar código | Generación de código nuevo |
| `codebridge_status` | Verifica estado de generación | Monitoreo de progreso |
| `fs_read` | Lee archivos generados | Verificación de calidad |
| `fs_write` | Guarda código en workspace | Si el subagente no lo hace automáticamente |

## Workflow

### Generación de Código
```javascript
// 1. Clarificar requisitos
// - Lenguaje: TypeScript, Python, etc.
// - Framework: React, Express, FastAPI, etc.
// - Funcionalidad específica
// - Constraints: estilo, patrones, etc.

// 2. Lanzar subagente
const { process_id } = codebridge_launch({
  cli: "qwen",
  prompt: `
    Generate TypeScript function for email validation:
    - Use regex pattern
    - Handle edge cases
    - Include JSDoc comments
    - Export as named function
  `
})

// 3. Monitorear
const status = codebridge_status({ process_id })

// 4. Verificar código generado
const code = fs_read({ path: "src/utils/validateEmail.ts" })

// 5. Reportar resultado
```

## Subagentes Disponibles - Configuración por CLI

### Qwen CLI (Rápido)
```typescript
codebridge_launch({
  taskId: "gen-001",
  config: {
    role: "development",
    cli: "qwen",
    args: ["--non-interactive"],  // Flag por defecto
    cwd: "/path/to/project",      // Carpeta del proyecto
    timeoutSeconds: 180,          // 3 minutos
  },
  prompt: `Generate a utility function to...`
})
```
**Ideal para:** Funciones utilitarias, código rápido, bug fixes

### Claude Code (Complejo)
```typescript
codebridge_launch({
  taskId: "gen-002",
  config: {
    role: "development",
    cli: "claude",
    args: ["--no-approve", "--output-format", "stream"],
    cwd: "/path/to/project",
    timeoutSeconds: 300,  // 5 minutos - análisis profundo
  },
  prompt: `Design and implement a complete authentication module with JWT...`
})
```
**Ideal para:** Arquitectura compleja, refactorización, security review

### Gemini CLI (Docs + Código)
```typescript
codebridge_launch({
  taskId: "gen-003",
  config: {
    role: "development",
    cli: "gemini",
    args: ["-y", "--quiet"],
    cwd: "/path/to/project",
    timeoutSeconds: 240,
  },
  prompt: `Create a REST API endpoint with full JSDoc documentation...`
})
```
**Ideal para:** Código + documentación, multi-lenguaje, tests

### OpenCode (Open Source)
```typescript
codebridge_launch({
  taskId: "gen-004",
  config: {
    role: "development",
    cli: "opencode",
    args: ["--headless", "--auto-accept"],
    cwd: "/path/to/project",
    timeoutSeconds: 200,
  },
  prompt: `Scaffold an open source library structure with...`
})
```
**Ideal para:** Scaffolding, prototipado rápido, patrones community-driven

## Tabla Comparativa de CLIs

| CLI | Timeout | stdin Close | Approval Flag | Mejor Caso de Uso |
|-----|---------|-------------|---------------|-------------------|
| **qwen** | 180s | ✅ Sí | N/A | Código rápido |
| **claude** | 300s | ❌ No | `--no-approve` | Arquitectura compleja |
| **gemini** | 240s | ❌ No | `-y` | Código + docs |
| **opencode** | 200s | ❌ No | `--auto-accept` | Open source |

## Ejemplos Detallados

### Ejemplo 1: Función Utilitaria con Qwen
```typescript
// Usuario: "generá una función para validar emails"
codebridge_launch({
  taskId: "validate-email-001",
  config: {
    role: "development",
    cli: "qwen",
    cwd: process.cwd(),
    timeoutSeconds: 120,
  },
  prompt: `
    Generate TypeScript function for email validation.
    Requirements:
    - Use regex pattern matching
    - Handle edge cases (null, undefined, empty)
    - Include JSDoc comments
    - Export as named function: validateEmail
    
    Expected behavior:
    validateEmail("test@example.com") → true
    validateEmail("") → false
    validateEmail(null) → false
  `
})
```

### Ejemplo 2: Componente React con Claude
```typescript
// Usuario: "creá un componente Button con TypeScript"
codebridge_launch({
  taskId: "button-component-002",
  config: {
    role: "development",
    cli: "claude",
    cwd: "/path/to/react-project",
    timeoutSeconds: 300,
  },
  prompt: `
    Create a reusable Button component in React with TypeScript.
    
    Requirements:
    - Props: label, onClick, variant (primary|secondary), disabled, loading
    - Use Tailwind CSS for styling
    - Include loading spinner animation
    - Accessible (ARIA attributes)
    - Unit test example with Jest
    
    File: src/components/Button.tsx
  `
})
```

### Ejemplo 3: API Endpoint con Gemini
```typescript
// Usuario: "creá un endpoint de registro de usuarios"
codebridge_launch({
  taskId: "register-endpoint-003",
  config: {
    role: "development",
    cli: "gemini",
    cwd: "/path/to/api-project",
    timeoutSeconds: 240,
  },
  prompt: `
    Create Express.js REST endpoint for user registration.
    
    Requirements:
    - POST /api/auth/register
    - Input validation (email, password min 8 chars)
    - Password hashing with bcrypt
    - JWT token generation
    - Error handling
    - Full JSDoc documentation
    - Example curl request
    
    File: src/routes/auth.ts
  `
})
```

## Variables de Entorno Requeridas

| CLI | Variable | Cómo obtener |
|-----|----------|--------------|
| claude | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| gemini | `GOOGLE_API_KEY` | https://makersuite.google.com/app/apikey |
| qwen | — | No requiere |
| opencode | — | No requiere |

## Mejores Prácticas

### ✅ DOs
- Especificar lenguaje y framework explícitamente
- Incluir ejemplos de input/output esperado
- Definir constraints (estilo, patrones, convenciones)
- Verificar código generado con `fs_read`
- Proveer instrucciones de uso claras

### ❌ DON'Ts
- ❌ Prompts vagos ("hacé código")
- ❌ No especificar lenguaje/framework
- ❌ Olidar verificar calidad del código
- ❌ Entregar sin instrucciones de uso
- ❌ Ignorar errores de compilación/lint

## Manejo de Errores

### Error: "Missing environment variables"
```typescript
// Verificar antes de lanzar
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY required for Claude Code");
}
```

### Error: "Process exited with code 1"
- Verificar stdout/stderr en busca de mensajes de error
- Reintentar con otro CLI si corresponde
- Simplificar el prompt y reintentar

### Error: Timeout
- Aumentar `timeoutSeconds` en config
- Dividir tarea en subtareas más pequeñas
- Usar CLI más rápido (Qwen para tareas simples)

## Errores a Evitar

- ❌ Prompts vagos ("hacé código")
- ❌ No especificar lenguaje/framework
- ❌ No verificar calidad del código
- ❌ Entregar sin instrucciones de uso
- ❌ Ignorar variables de entorno requeridas
