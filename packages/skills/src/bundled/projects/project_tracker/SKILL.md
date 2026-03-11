---
name: project_tracker
description: "Track project progress and update task status with real-time monitoring"
version: 1.0.0
author: Hive Team
icon: "📊"
category: projects
permissions:
  - project_manage
dependencies: []
tools: [project_list, project_update, task_update]

# Structured skill fields
triggers:
  - "cómo va el proyecto"
  - "project status"
  - "actualizá el progreso"
  - "update progress"
  - "seguimiento del proyecto"
  - "project tracking"
  - "lista los proyectos"
  - "list projects"
  - "qué tareas están en curso"
  - "tasks in progress"
  - "avance del proyecto"
  - "project progress"

preferred_agents: []

steps:
  - step: 1
    action: project_list
    instruction: "List all projects to find target project"
    output: projects

  - step: 2
    action: task_update
    instruction: "Update individual task status as workers complete work"
    params:
      task_id: "task ID"
      status: "pending|in_progress|completed|failed"
      progress: 0-100
      result: "task result summary"
    output: task_updated

  - step: 3
    action: project_update
    instruction: "Update overall project progress based on task completion"
    params:
      projectId: "project ID"
      progress: "calculated from tasks"
      status: "active|completed|at_risk"
    output: project_updated

rules:
  - "Update task status immediately when worker delivers result"
  - "Calculate project progress as weighted average of task completion"
  - "Mark project 'at_risk' if any critical task is blocked or failed"
  - "Notify user of significant milestones (25%, 50%, 75%, 100%)"
  - "Keep task descriptions and results synchronized with actual work"

output_format:
  structure: markdown
  sections:
    - "project_name"
    - "overall_progress"
    - "task_status"
    - "blockers"
  max_length: "Concise progress summary"

examples:
  - user_input: "cómo va el proyecto Growth AI"
    expected_behavior: "project_list → find project → return task status and overall progress"

  - user_input: "actualizá el progreso de la tarea de investigación"
    expected_behavior: "task_update({ task_id, status: 'completed', progress: 100, result: '5 trends found' })"

  - user_input: "lista todos los proyectos activos"
    expected_behavior: "project_list({ status: 'active' }) → return all active projects with progress"
---

# Project Tracker Skill

## Cuándo se Activa

Para monitorear y actualizar el progreso de proyectos y tareas en curso.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `project_list` | Lista proyectos | Ver todos o filtrar por estado |
| `task_update` | Actualiza estado de tarea | Worker completa o cambia estado |
| `project_update` | Actualiza progreso general | Milestones del proyecto |

## Workflow

1. **Listar** → `project_list()` para encontrar proyecto
2. **Actualizar tasks** → `task_update()` cuando workers entregan
3. **Actualizar proyecto** → `project_update()` con progreso calculado

## Mejores Prácticas

- Actualizar inmediatamente cuando worker entrega
- Calcular progreso como promedio de tasks completadas
- Notificar milestones (25%, 50%, 75%, 100%)
- Marcar 'at_risk' si task crítica está bloqueada

## Errores a Evitar

- ❌ Dejar estado desactualizado
- ❌ No notificar blockers
- ❌ Progreso incorrecto vs realidad
