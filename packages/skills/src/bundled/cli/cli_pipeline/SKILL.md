---
name: cli_pipeline
description: "Execute shell commands and pipe output to files for logging and further processing"
version: 1.0.0
author: Hive Team
icon: "🔗"
category: cli
permissions:
  - shell_exec
  - filesystem_write
dependencies: []
tools: [exec, terminal, project_write]

# Structured skill fields
triggers:
  - "guardá el output"
  - "save output"
  - "pipeline"
  - "pipe to file"
  - "redireccioná el output"
  - "redirect output"
  - "log del comando"
  - "command log"
  - "ejecutá y guardá"
  - "run and save"
  - "resultado en archivo"
  - "result to file"

preferred_agents: []

steps:
  - step: 1
    action: validate_command
    instruction: "Validate command is safe and appropriate for pipeline execution"
    output: validated_command

  - step: 2
    action: exec or terminal
    instruction: "Execute command and capture full output (stdout + stderr)"
    params:
      command: "validated command"
      timeout: "appropriate timeout"
    output: command_output

  - step: 3
    action: format_output
    instruction: "Format output for file storage: add timestamp, command, execution time"
    output: formatted_output

  - step: 4
    action: project_write
    instruction: "Write output to specified file path"
    params:
      path: "logs/command_YYYY-MM-DD_HH-MM-SS.log"
      content: "formatted output"
    output: file_written

rules:
  - "Capture both stdout and stderr for complete logging"
  - "Add metadata: timestamp, command, execution time, exitCode"
  - "Use descriptive filenames with timestamps for logs"
  - "For large outputs, write incrementally or split files"
  - "Confirm file path before writing"

output_format:
  structure: markdown
  sections:
    - "command"
    - "timestamp"
    - "exit_code"
    - "execution_time"
    - "output_file"
  max_length: "Full logged output"

examples:
  - user_input: "ejecutá npm install y guardá el output en logs/install.log"
    expected_behavior: "exec({ command: 'npm install' }) → format with metadata → project_write({ path: 'logs/install.log' })"

  - user_input: "corré los tests y guardá el resultado"
    expected_behavior: "terminal({ command: 'npm test' }) → capture full output → write to timestamped log file"

  - user_input: "hacé un pipeline de git log a archivo"
    expected_behavior: "exec({ command: 'git log --oneline' }) → write to 'logs/git_log_YYYY-MM-DD.md'"
---

# CLI Pipeline Skill

## Cuándo se Activa

Para ejecutar comandos y guardar el output en archivos para logging o procesamiento posterior.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `exec` | Ejecuta comando | Comandos simples |
| `terminal` | Ejecuta con entorno | Comandos complejos |
| `project_write` | Escribe archivo | Guardar output |

## Workflow

1. **Validar comando** → Seguro para ejecución
2. **Ejecutar** → Capturar stdout + stderr
3. **Formatear** → Agregar timestamp, comando, metadata
4. **Escribir** → `project_write({ path, content })`

## Formato de Log

```markdown
# Command Log

**Command**: npm install
**Timestamp**: 2025-03-09 14:30:00
**Exit Code**: 0
**Execution Time**: 45.2s

---

## Output

[stdout content...]
[stderr if any...]
```

## Mejores Prácticas

- Filenames con timestamp para tracking
- Incluir metadata completa (exitCode, tiempo)
- Capturar stdout y stderr
- Para outputs grandes, escribir incrementalmente

## Errores a Evitar

- ❌ No incluir metadata en log
- ❌ Filenames genéricos sin timestamp
- ❌ No capturar stderr
