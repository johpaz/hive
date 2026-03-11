---
name: project_planner
description: "Create comprehensive projects with structured tasks and worker assignments"
version: 1.0.0
author: Hive Team
icon: "📋"
category: projects
permissions:
  - project_manage
dependencies: []
tools: [project_create, task_create]

# Structured skill fields
triggers:
  - "creá un proyecto"
  - "create project"
  - "planificá"
  - "plan"
  - "organizá este trabajo"
  - "organize this work"
  - "estructurá el proyecto"
  - "structure project"
  - "descomponé en tareas"
  - "break down into tasks"

preferred_agents: []

steps:
  - step: 1
    action: clarify_requirements
    instruction: "Understand project goals, deliverables, and constraints from user"
    output: requirements

  - step: 2
    action: project_create
    instruction: "Create project with name, description, type, and initial tasks array"
    params:
      name: "Project name"
      description: "Clear project description"
      type: "code|research|content|other"
      tasks: "Array of tasks with name, description, agent_id"
    output: project_id

  - step: 3
    action: task_create
    instruction: "Add additional tasks if needed after initial creation"
    params:
      project_id: "project ID"
      tasks: "Additional tasks"
    output: tasks_created

rules:
  - "Only create projects for complex multi-worker coordination"
  - "Break down work into atomic, independent tasks"
  - "Assign agent_id to tasks if workers exist, null if need creation"
  - "Include clear acceptance criteria in task descriptions"
  - "Estimate task complexity for proper worker assignment"

output_format:
  structure: markdown
  sections:
    - "project_name"
    - "description"
    - "tasks"
    - "next_steps"
  max_length: "Comprehensive project plan"

examples:
  - user_input: "creá un proyecto para automatizar growth AI"
    expected_behavior: "Clarify requirements → project_create with tasks: research, content, email → return project structure"

  - user_input: "planificá el lanzamiento del producto"
    expected_behavior: "Break down into: market research, content creation, distribution, monitoring → create project with tasks"
---

# Project Planner Skill

## Cuándo se Activa

Para planificar y estructurar proyectos complejos que requieren coordinación de múltiples workers.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `project_create` | Crea proyecto con tasks | Estructura inicial |
| `task_create` | Agrega tasks adicionales | Expandir proyecto |

## Workflow

1. **Clarificar** → Entender objetivos y deliverables
2. **Descomponer** → Dividir en tareas atómicas
3. **Crear proyecto** → `project_create({ name, description, tasks })`
4. **Asignar** → agent_id en tasks (o null si hay que crear workers)

## Errores a Evitar

- ❌ Crear proyecto para tareas simples
- ❌ Tasks muy grandes o vagas
- ❌ No definir criterios de aceptación
