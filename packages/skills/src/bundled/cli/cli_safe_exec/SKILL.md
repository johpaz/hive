---
name: cli_safe_exec
description: "Execute shell commands safely with error handling, timeouts, and output validation"
version: 1.0.0
author: Hive Team
icon: "💻"
category: cli
permissions:
  - shell_exec
dependencies: []
tools: [exec, terminal]

# Structured skill fields
triggers:
  - "ejecutá este comando"
  - "run this command"
  - "corré el comando"
  - "execute command"
  - "terminal"
  - "bash"
  - "shell"
  - "npm"
  - "yarn"
  - "bun"
  - "git"
  - "docker"
  - "comando de sistema"
  - "system command"

preferred_agents: []

steps:
  - step: 1
    action: validate_command
    instruction: "Validate command is safe. Check for destructive operations (rm, DROP, DELETE)"
    output: validated_command

  - step: 2
    action: exec or terminal
    instruction: "Execute with appropriate timeout. Use exec for simple, terminal for complex"
    params:
      command: "validated command"
      timeout: 30-300 seconds
    output: command_result

  - step: 3
    action: parse_result
    instruction: "Parse stdout and stderr. Check exitCode (0=success)"
    output: parsed_output

  - step: 4
    action: handle_error
    instruction: "If failed, analyze error and suggest fixes or retry options"
    output: error_handling

rules:
  - "NEVER use for scheduled tasks — use cron.create instead"
  - "Prefer read-only commands when possible"
  - "Confirm before destructive operations (rm, DROP, DELETE, --force)"
  - "Set appropriate timeout: 30s simple, 120s builds, 300s heavy"
  - "Always check exitCode — non-zero means failure"
  - "Use absolute paths for reliability"

output_format:
  structure: markdown
  sections:
    - "command"
    - "exit_code"
    - "stdout"
    - "stderr"
    - "execution_time"
  max_length: "Full output with analysis"

examples:
  - user_input: "ejecutá npm install"
    expected_behavior: "exec({ command: 'npm install', timeout: 120 }) → check exitCode → return installation summary"

  - user_input: "corré los tests"
    expected_behavior: "exec({ command: 'npm test', timeout: 180 }) → parse results → report pass/fail count"

  - user_input: "hacé git status"
    expected_behavior: "exec({ command: 'git status' }) → return current branch and changes"
---

# CLI Safe Exec Skill

## Cuándo se Activa

Para ejecutar comandos de shell de forma segura con manejo de errores y timeouts.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `exec` | Ejecuta con validación y timeout | Comandos simples (<30s) |
| `terminal` | Ejecuta con entorno completo | Comandos complejos, Git, npm |

## ⚠️ ADVERTENCIA CRÍTICA

**NUNCA usar para tareas programadas** — usar `cron.create` en su lugar.

## Workflow

1. **Validar** → Comando es seguro, no destructivo
2. **Ejecutar** → `exec` o `terminal` con timeout apropiado
3. **Parsear** → Check exitCode, stdout, stderr
4. **Manejar error** → Si falló, analizar y sugerir fixes

## Timeouts Apropiados

| Tipo | Timeout |
|------|---------|
| Listar archivos | 10s |
| Git operations | 30s |
| npm install | 120s |
| npm run build | 120s |
| npm test | 180s |
| Docker builds | 300s |

## Errores a Evitar

- ❌ Usar para cron (usar cron.create)
- ❌ Sin timeout apropiado
- ❌ Ignorar exitCode
- ❌ Comandos destructivos sin confirmar
