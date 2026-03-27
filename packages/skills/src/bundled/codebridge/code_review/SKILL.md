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
      cli: "claude|qwen|gemini"
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
  cli: "claude",
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

## Configuración por CLI para Code Review

### Claude Code (Review Exhaustivo)
```typescript
codebridge_launch({
  taskId: "review-001",
  config: {
    role: "development",
    cli: "claude",
    args: ["--no-approve", "--output-format", "stream"],
    cwd: "/path/to/project",
    timeoutSeconds: 300,  // 5 minutos - review profundo
  },
  prompt: `
    Comprehensive code review for PR #42:
    
    Files: src/auth/*.ts (5 files, ~600 lines)
    
    Review checklist:
    1. Security vulnerabilities (OWASP Top 10)
    2. Authentication/authorization bugs
    3. Input validation gaps
    4. Error handling completeness
    5. TypeScript type safety
    6. Test coverage gaps
    
    For each issue:
    - Line number
    - Severity (Critical/Major/Minor)
    - Description
    - Suggested fix
  `
})
```
**Ideal para:** Security review, PRs críticos, auditorías

### Qwen CLI (Review Rápido)
```typescript
codebridge_launch({
  taskId: "review-002",
  config: {
    role: "development",
    cli: "qwen",
    args: ["--non-interactive"],
    cwd: "/path/to/project",
    timeoutSeconds: 120,  // 2 minutos
  },
  prompt: `
    Quick review of this utility function:
    
    File: src/utils/formatDate.ts (45 lines)
    
    Check for:
    - Edge cases (null, undefined, invalid input)
    - TypeScript types
    - Performance issues
    - Code style consistency
    
    Return issues with line numbers.
  `
})
```
**Ideal para:** Funciones pequeñas, cambios rápidos, style check

### Gemini CLI (Review + Docs)
```typescript
codebridge_launch({
  taskId: "review-003",
  config: {
    role: "development",
    cli: "gemini",
    args: ["-y", "--quiet"],
    cwd: "/path/to/project",
    timeoutSeconds: 240,
  },
  prompt: `
    Review this API module and suggest documentation improvements:
    
    File: src/api/users.ts
    
    Review:
    1. JSDoc completeness
    2. Parameter documentation
    3. Return type descriptions
    4. Example usage
    5. Error documentation
    
    Also check for:
    - Bugs
    - Type safety
    - Error handling
  `
})
```
**Ideal para:** Review + documentación, APIs públicas

## Tabla Comparativa de CLIs para Review

| CLI | Timeout | Mejor Para | Ejemplo |
|-----|---------|------------|---------|
| **claude** | 300s | Security, auditorías | OWASP checklist |
| **qwen** | 120s | Review rápido | Functions < 50 lines |
| **gemini** | 240s | Review + docs | API documentation |

## Ejemplos Detallados

### Ejemplo 1: Security Review con Claude
```typescript
// Usuario: "revisá este código en busca de vulnerabilidades"
codebridge_launch({
  taskId: "security-review-001",
  config: {
    role: "development",
    cli: "claude",
    cwd: "/path/to/project",
    timeoutSeconds: 300,
  },
  prompt: `
    Security-focused code review:
    
    Files: 
    - src/auth/login.ts
    - src/auth/register.ts
    - src/middleware/auth.ts
    
    Check for OWASP Top 10 vulnerabilities:
    1. SQL Injection (raw queries?)
    2. XSS (unescaped output?)
    3. CSRF (missing tokens?)
    4. Authentication flaws
    5. Sensitive data exposure
    6. XXE, SSRF, etc.
    
    For each finding:
    - Severity: Critical/High/Medium/Low
    - CWE reference if applicable
    - Exploit scenario
    - Remediation with code example
  `
})
```

### Ejemplo 2: Quick Review con Qwen
```typescript
// Usuario: "revisá esta función rápida"
codebridge_launch({
  taskId: "quick-review-002",
  config: {
    role: "development",
    cli: "qwen",
    cwd: process.cwd(),
    timeoutSeconds: 90,
  },
  prompt: `
    Quick code review:
    
    File: src/helpers/parseJson.ts
    
    Function: parseJson safely handles JSON parsing
    
    Check:
    - Try/catch for invalid JSON
    - Type guards for parsed result
    - Null/undefined handling
    - TypeScript types
    
    Return any issues with specific line numbers.
  `
})
```

### Ejemplo 3: PR Review con Gemini
```typescript
// Usuario: "revisá este PR antes de merge"
codebridge_launch({
  taskId: "pr-review-003",
  config: {
    role: "development",
    cli: "gemini",
    cwd: "/path/to/project",
    timeoutSeconds: 240,
  },
  prompt: `
    Pre-merge code review for PR #156:
    
    Changes:
    - Added user profile endpoint
    - Modified database schema
    - Updated validation logic
    
    Review criteria:
    1. Does it work? (logic correctness)
    2. Is it safe? (security, validation)
    3. Is it clean? (readability, DRY)
    4. Is it tested? (unit tests, edge cases)
    5. Is it documented? (JSDoc, comments)
    
    Format output as GitHub review comment.
  `
})
```

## Checklist de Review por Categoría

### Security Checklist
- [ ] Input validation en todos los endpoints
- [ ] Output encoding para prevenir XSS
- [ ] Prepared statements (no SQL injection)
- [ ] CSRF tokens en forms
- [ ] Rate limiting en APIs sensibles
- [ ] No secrets en código/logs
- [ ] Authentication checks en rutas protegidas

### Performance Checklist
- [ ] No N+1 queries
- [ ] Indexes en DB queries
- [ ] Caching donde aplica
- [ ] No blocking operations en event loop
- [ ] Memory leaks (listeners, intervals)
- [ ] Efficient data structures

### TypeScript Checklist
- [ ] No `any` types (usar interfaces)
- [ ] Union types para valores nullable
- [ ] Type guards para runtime checks
- [ ] Generic types donde aplica
- [ ] Strict mode habilitado

### Testing Checklist
- [ ] Unit tests para lógica crítica
- [ ] Edge cases cubiertos
- [ ] Error scenarios testeados
- [ ] Mock de dependencias externas
- [ ] Coverage > 80%

## Mejores Prácticas

### ✅ DOs
- Feedback específico con líneas
- Sugerencias accionables
- Balance: issues + aspectos positivos
- Contexto: prod vs prototype
- Priorizar por severidad

### ❌ DON'Ts
- ❌ Crítica sin sugerencias
- ❌ Issues vagos sin línea específica
- ❌ Ignorar contexto del proyecto
- ❌ Solo criticar, no destacar lo bueno
- ❌ No priorizar issues

## Manejo de Errores

### Error: "Review too large for single prompt"
- Dividir por archivos
- Usar Claude con contexto extendido
- Hacer review por categorías (security, performance, etc.)

### Error: "False positive in review"
- Verificar contexto completo del código
- Considerar trade-offs del diseño
- Ajustar prompt para ser más específico

## Errores a Evitar

- ❌ Crítica sin sugerencias
- ❌ Issues vagos sin línea específica
- ❌ Ignorar contexto del proyecto
- ❌ Solo criticar, no destacar lo bueno
- ❌ No priorizar por severidad
