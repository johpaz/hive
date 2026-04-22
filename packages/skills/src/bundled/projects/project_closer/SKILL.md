---
name: project_closer
description: "Evaluate task results and close projects with comprehensive summaries or failure analysis"
version: 1.0.0
author: Hive Team
icon: "✅"
category: projects
permissions:
  - project_manage
dependencies: []
tools: [task_evaluate, project_done, project_fail]

# Structured skill fields
triggers:
  - "cerrá el proyecto"
  - "close project"
  - "proyecto terminado"
  - "project done"
  - "proyecto fallido"
  - "project failed"
  - "evaluá la tarea"
  - "evaluate task"
  - "resumen final"
  - "final summary"
  - "lecciones aprendidas"
  - "lessons learned"

preferred_agents: []

steps:
  - step: 1
    action: task_evaluate
    instruction: "Evaluate completed tasks against acceptance criteria"
    params:
      task_id: "task ID"
      criteria: "Array of acceptance criteria"
      auto_update: true
    output: evaluation_result

  - step: 2
    action: verify_all_tasks
    instruction: "Verify all tasks are completed before closing project"
    output: all_complete

  - step: 3
    action: decision_done_or_fail
    instruction: "If all tasks pass evaluation → project_done. If blocking failure → project_fail"
    output: decision

  - step: 4
    action: project_done or project_fail
    instruction: "Close project with executive summary or failure analysis"
    params:
      projectId: "project ID"
      summary: "for done OR reason for fail"
    output: project_closed

rules:
  - "Evaluate tasks with clear acceptance criteria before closing"
  - "Verify ALL tasks are completed before project_done"
  - "Use project_fail only for irrecoverable blocking failures"
  - "Include lessons learned in failure reports"
  - "Provide executive summary with measurable outcomes for done"

output_format:
  structure: markdown
  sections:
    - "project_name"
    - "status"
    - "summary"
    - "outcomes"
    - "lessons_learned"
  max_length: "Comprehensive closure report"

examples:
  - user_input: "cerrá el proyecto Growth AI"
    expected_behavior: "Verify all tasks complete → task_evaluate → project_done({ summary: '7 trends, 5 posts, email sent' })"

  - user_input: "el proyecto falló porque la API no responde"
    expected_behavior: "task_evaluate (failed) → project_fail({ reason: 'API unavailable after 3 retries', lessons: 'Implement fallback' })"

  - user_input: "evaluá la tarea de investigación"
    expected_behavior: "task_evaluate({ criteria: ['5+ sources', 'valid URLs', 'recent data'], auto_update: true })"
---

# Project Closer Skill

## Cuándo se Activa

Para evaluar resultados y cerrar proyectos completados o fallidos.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `task_evaluate` | Evalúa tarea con criterios | Validar calidad antes de cerrar |
| `project_done` | Marca proyecto completado | Todas las tasks passing |
| `project_fail` | Marca proyecto fallido | Error irrecuperable |

## Workflow

### Cierre Exitoso
1. **Evaluar tasks** → `task_evaluate({ criteria })`
2. **Verificar todas** → Todas completadas
3. **Cerrar** → `project_done({ summary })`

### Cierre por Fallo
1. **Identificar fallo** → Task crítica falló
2. **Analizar causa** → Root cause
3. **Cerrar** → `project_fail({ reason, lessons })`

## Mejores Prácticas

- Criterios de aceptación medibles y específicos
- Resumen ejecutivo con outcomes medibles
- Lecciones aprendidas accionables en failure

## Errores a Evitar

- ❌ Cerrar sin evaluar todas las tasks
- ❌ project_fail sin análisis de causa raíz
- ❌ Resúmenes vagos sin datos concretos
