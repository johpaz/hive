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
      agent: "qwen|claude|gemini|opencode"
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
    expected_behavior: "codebridge_launch({ agent: 'qwen', prompt: 'Generate Express.js REST endpoint' }) → verify → return file paths"

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
  agent: "qwen",
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

## Subagentes Disponibles

| Agente | Cuándo usar |
|--------|-------------|
| Qwen CLI | Código rápido, funciones utilitarias |
| Claude Code | Código complejo, arquitectura |
| Gemini CLI | Código + documentación |
| OpenCode | Multi-lenguaje, open source |

## Mejores Prácticas

- Prompts específicos con lenguaje y framework
- Incluir ejemplos de input/output esperado
- Verificar código generado antes de entregar
- Proveer instrucciones de uso claras

## Errores a Evitar

- ❌ Prompts vagos ("hacé código")
- ❌ No especificar lenguaje/framework
- ❌ No verificar calidad del código
- ❌ Entregar sin instrucciones de uso
