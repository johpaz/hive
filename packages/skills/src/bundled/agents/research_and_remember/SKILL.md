---
name: research_and_remember
description: "Research information from web sources and save findings to persistent memory"
version: 1.0.0
author: Hive Team
icon: "🔍🧠"
category: agents
permissions:
  - internet_access
  - memory_write
dependencies: []
tools: [web_search, web_fetch, memory_write]

# Structured skill fields
triggers:
  - "investigá y guardá"
  - "research and save"
  - "buscá y recordá"
  - "find and remember"
  - "aprendé sobre"
  - "learn about"
  - "estudiá esto"
  - "study this"
  - "documentate y guardá"
  - "research and store"

preferred_agents: []

steps:
  - step: 1
    action: web_search
    instruction: "Search for topic using clear query. Get 5-8 relevant results"
    params:
      query: "topic keywords"
      numResults: 8
    output: search_results

  - step: 2
    action: web_fetch
    instruction: "Fetch 2-3 most relevant URLs for detailed content"
    params:
      urls: "top 2-3 URLs"
    output: detailed_content

  - step: 3
    action: synthesize
    instruction: "Synthesize findings into structured knowledge with sources"
    output: synthesized_knowledge

  - step: 4
    action: memory_write
    instruction: "Store synthesized knowledge with clear title for future retrieval"
    params:
      title: "Topic: {topic_name}"
      content: "synthesized knowledge + sources"
    output: memory_stored

rules:
  - "Always do at least 2 searches for comprehensive coverage"
  - "Cross-reference information across multiple sources"
  - "Include source URLs in stored memory for verification"
  - "Organize knowledge with clear structure (headings, bullet points)"
  - "Use descriptive titles that include topic and date if relevant"
  - "Flag uncertain or conflicting information explicitly"

output_format:
  structure: markdown
  sections:
    - "topic"
    - "summary"
    - "key_findings"
    - "sources"
    - "memory_title"
  max_length: "Comprehensive but concise knowledge entry"

examples:
  - user_input: "investigá y guardá información sobre transformers en ML"
    expected_behavior: "web_search → web_fetch top sources → synthesize → memory_write({ title: 'Transformers ML', content: '...' })"

  - user_input: "aprendé sobre las mejores prácticas de React 2025"
    expected_behavior: "Search 'React best practices 2025' → fetch docs → synthesize → memory_write"

  - user_input: "buscá y recordá las tendencias de IA actuales"
    expected_behavior: "Search 'AI trends 2025' → fetch multiple sources → compile trends → memory_write"
---

# Research and Remember Skill

## Cuándo se Activa

Para investigar temas en la web y guardar el conocimiento sintetizado en memoria persistente.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `web_search` | Busca en internet | Encontrar fuentes |
| `web_fetch` | Descarga contenido | Obtener detalles |
| `memory_write` | Guarda conocimiento | Almacenar para futuro |

## Workflow

1. **Buscar** → `web_search({ query, numResults: 8 })`
2. **Fetch** → `web_fetch({ urls: top 2-3 })`
3. **Sintetizar** → Compilar hallazgos con estructura clara
4. **Guardar** → `memory_write({ title, content })`

## Estructura de Conocimiento

```markdown
# {Topic}

## Summary
2-3 oración resumen

## Key Findings
- Punto clave 1
- Punto clave 2
- ...

## Sources
- [Source 1](url)
- [Source 2](url)
```

## Mejores Prácticas

- Mínimo 2 searches para cobertura completa
- Cruzar información entre fuentes múltiples
- Incluir URLs para verificación
- Estructura clara con headings
- Flaggear información incierta

## Errores a Evitar

- ❌ Una sola búsqueda (insuficiente)
- ❌ Sin fuentes (no verificable)
- ❌ Títulos vagos para memoria
- ❌ No flaggear información conflictiva
