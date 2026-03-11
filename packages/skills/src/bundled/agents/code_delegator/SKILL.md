---
name: code_delegator
description: "Delegate coding tasks to CLI subagents (Qwen, Claude, Gemini, OpenCode) via Code Bridge and monitor execution"
version: 1.0.0
author: Hive Team
icon: "💻"
category: agents
permissions:
  - codebridge_manage
dependencies: []
tools: [task_delegate_code, task_status, codebridge_launch, codebridge_status]

# Structured skill fields
triggers:
  - "delegá el código"
  - "delegate code"
  - "que lo haga un subagente"
  - "let subagent do it"
  - "programá esto"
  - "code this"
  - "implementá con CLI"
  - "implement with CLI"
  - "usá Qwen"
  - "use Qwen"
  - "usá Claude Code"
  - "use Claude Code"
  - "subagente de código"
  - "coding subagent"

preferred_agents: []

steps:
  - step: 1
    action: analyze_task
    instruction: "Analyze coding task complexity and determine best subagent (Qwen, Claude, Gemini, OpenCode)"
    output: task_analysis

  - step: 2
    action: codebridge_launch
    instruction: "Launch appropriate CLI subagent with task prompt"
    params:
      agent: "qwen|claude|gemini|opencode"
      prompt: "Clear coding task description with requirements"
    output: process_id

  - step: 3
    action: codebridge_status
    instruction: "Monitor subagent execution progress"
    params:
      process_id: "ID from step 2"
    output: execution_status

  - step: 4
    action: task_status
    instruction: "Get final result and verify completion"
    params:
      task_id: "delegated task ID"
    output: final_result

rules:
  - "Use task_delegate_code for simple coding tasks that don't require full CLI subagent"
  - "Use codebridge_launch for complex coding requiring external CLI (Qwen, Claude Code, etc.)"
  - "Specify clear requirements and acceptance criteria in prompt"
  - "Monitor execution with codebridge_status every 30-60 seconds for long tasks"
  - "Verify output matches requirements before marking complete"
  - "Handle errors gracefully — retry with clarified prompt if subagent fails"

output_format:
  structure: markdown
  sections:
    - "task_description"
    - "subagent_used"
    - "execution_status"
    - "result_summary"
    - "files_modified"
  max_length: "Comprehensive delegation summary"

examples:
  - user_input: "delegá la implementación del endpoint REST a Qwen"
    expected_behavior: "codebridge_launch({ agent: 'qwen', prompt: 'Implement REST endpoint with GET/POST' }) → monitor → return result"

  - user_input: "que Claude Code haga los tests unitarios"
    expected_behavior: "codebridge_launch({ agent: 'claude', prompt: 'Write unit tests for module X' }) → codebridge_status → return test files"

  - user_input: "implementá esto con un subagente"
    expected_behavior: "Analyze task → select best subagent → codebridge_launch → monitor → deliver result"
---

# Code Delegator Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita delegar tareas de programación a subagentes CLI especializados (Qwen CLI, Claude Code, Gemini CLI, OpenCode).

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `task_delegate_code` | Delega tarea de código simple | Tasks pequeños/medianos |
| `codebridge_launch` | Lanza subagente CLI externo | Tasks complejos que requieren CLI completo |
| `codebridge_status` | Verifica estado de ejecución | Monitoreo de progreso |
| `task_status` | Obtiene estado de tarea delegada | Verificación final |

## Workflow

### Delegación Simple
```javascript
task_delegate_code({
  description: "Implementar función de autenticación",
  acceptance_criteria: "Funciona con JWT, maneja errores"
})
```

### Delegación Completa (CLI Subagent)
```javascript
// 1. Lanzar subagente
const { process_id } = codebridge_launch({
  agent: "qwen",  // o "claude", "gemini", "opencode"
  prompt: `
    Implementar endpoint REST para usuarios:
    - GET /users - listar usuarios
    - POST /users - crear usuario
    - Validación con Zod
    - Tests con Jest
  `
})

// 2. Monitorear
const status = codebridge_status({ process_id })

// 3. Verificar resultado
const result = task_status({ task_id })
```

## Subagentes Disponibles

| Agente | Comando | Especialidad |
|--------|---------|--------------|
| Qwen CLI | `qwen` | Código general, rápido |
| Claude Code | `claude` | Código complejo, refactor |
| Gemini CLI | `gemini` | Código + documentación |
| OpenCode | `opencode` | Open source, multi-lenguaje |

## Mejores Prácticas

- Prompts claros con requisitos específicos
- Criterios de aceptación explícitos
- Monitoreo periódico (30-60s para tasks largos)
- Verificación de output antes de cerrar

## Errores a Evitar

- ❌ Prompts vagos sin criterios claros
- ❌ No monitorear ejecución larga
- ❌ Ignorar errores del subagente
- ❌ No verificar que el código cumple requisitos
