---
name: code_review
description: "Review code quality, identify issues, and provide actionable feedback using CLI subagents"
version: 1.0.0
author: Hive Team
icon: "🔍"
category: codebridge
permissions:
  - codebridge_execute
dependencies: []
tools: [codebridge_launch, codebridge_status, fs_read, canvas_show_card]

# Structured skill fields
triggers:
  - "revisá el código"
  - "review code"
  - "hacé un code review"
  - "do a code review"
  - "encontrá problemas en el código"
  - "find issues in code"
  - "verificá la calidad"
  - "check quality"
  - "buscá bugs"
  - "find bugs"
  - "análisis de código"
  - "code analysis"
  - "mejores prácticas"
  - "best practices"

preferred_agents: []

steps:
  - step: 1
    action: fs_read
    instruction: "Read code files to review"
    params:
      path: "files to review"
    output: code_content

  - step: 2
    action: codebridge_launch
    instruction: "Launch CLI subagent to perform comprehensive code review"
    params:
      agent: "claude|qwen|gemini"
      prompt: "Review code for: bugs, security issues, performance, readability, best practices. Provide specific line references."
    output: process_id

  - step: 3
    action: codebridge_status
    instruction: "Wait for review completion"
    params:
      process_id: "ID from step 2"
    output: review_result

  - step: 4
    action: synthesize
    instruction: "Organize findings by severity and category"
    output: organized_feedback

  - step: 5
    action: canvas_show_card
    instruction: "Display review results in structured format"
    params:
      title: "Code Review Results"
      items: "Critical, Major, Minor issues with line numbers"
    output: displayed_review

rules:
  - "Read all relevant files before starting review"
  - "Categorize issues by severity: Critical, Major, Minor, Nitpick"
  - "Include specific line numbers for each issue"
  - "Provide actionable suggestions, not just criticism"
  - "Highlight positive aspects too (good patterns, clean code)"
  - "Consider context: production vs prototype, team conventions"

output_format:
  structure: markdown
  sections:
    - "summary"
    - "critical_issues"
    - "major_issues"
    - "minor_issues"
    - "positive_aspects"
    - "recommendations"
  max_length: "Comprehensive but concise review"

examples:
  - user_input: "revisá este PR en busca de bugs"
    expected_behavior: "Read files → codebridge_launch → return bugs with line numbers and fixes"

  - user_input: "hacé un code review buscando problemas de seguridad"
    expected_behavior: "Security-focused review → identify vulnerabilities → suggest mitigations"

  - user_input: "verificá si sigue las mejores prácticas de TypeScript"
    expected_behavior: "TypeScript best practices review → type safety, interfaces, generics → recommendations"
---

# Code Review Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita revisión de código: encontrar bugs, verificar calidad, seguridad, performance, o adherence a best practices.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `fs_read` | Lee archivos de código | Cargar código a revisar |
| `codebridge_launch` | Lanza subagente para review | Análisis profundo |
| `codebridge_status` | Obtiene resultado del review | Completado del análisis |
| `canvas_show_card` | Muestra resultados estructurados | Presentar feedback |

## Workflow

### Code Review
```javascript
// 1. Leer código
const files = fs_read({ path: "src/*.ts" })

// 2. Lanzar review con subagente
const { process_id } = codebridge_launch({
  agent: "claude",
  prompt: `
    Code Review Checklist:
    1. Bugs potenciales (null checks, edge cases)
    2. Security issues (XSS, injection, auth)
    3. Performance (loops, queries, memory)
    4. Readability (naming, structure)
    5. TypeScript best practices
    6. Testing coverage
    
    Proporcionar línea específica para cada issue.
  `
})

// 3. Obtener resultado
const review = codebridge_status({ process_id })

// 4. Organizar por severidad
// Critical: Bugs, security
// Major: Performance, anti-patterns
// Minor: Naming, style
// Nitpick: Suggestions

// 5. Mostrar resultados
canvas_show_card({
  title: "Code Review",
  items: [
    { label: "Critical", value: "2 issues" },
    { label: "Major", value: "5 issues" },
    { label: "Minor", value: "8 issues" }
  ]
})
```

## Categorías de Review

| Categoría | Qué buscar |
|-----------|------------|
| Bugs | Null dereference, off-by-one, race conditions |
| Security | XSS, SQL injection, auth bypass, secrets |
| Performance | N+1 queries, O(n²) loops, memory leaks |
| Readability | Nombres confusos, funciones largas |
| Best Practices | Linting, patterns, conventions |
| Testing | Coverage, edge cases, mocks |

## Niveles de Severidad

| Nivel | Ejemplo | Acción |
|-------|---------|--------|
| Critical | Bug de seguridad, crash | Fix inmediato |
| Major | Performance issue, anti-pattern | Fix antes de merge |
| Minor | Naming, style | Fix cuando sea posible |
| Nitpick | Sugerencia opcional | Considerar |

## Mejores Prácticas

- Feedback específico con líneas
- Sugerencias accionables
- Balance: issues + aspectos positivos
- Contexto: prod vs prototype

## Errores a Evitar

- ❌ Crítica sin sugerencias
- ❌ Issues vagos sin línea específica
- ❌ Ignorar contexto del proyecto
- ❌ Solo criticar, no destacar lo bueno
