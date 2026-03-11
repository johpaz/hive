---
name: web_research
description: "Search and synthesize information from multiple web sources into structured reports"
version: 1.0.0
author: Hive Team
icon: "🔍"
category: web
permissions:
  - internet_access
dependencies: []
tools: [web_search, web_fetch]

# Structured skill fields
triggers:
  - "investigá sobre"
  - "research"
  - "buscá información de"
  - "find information about"
  - "qué es"
  - "what is"
  - "explicame"
  - "explain"
  - "últimos avances"
  - "latest advances"
  - "tendencias de"
  - "trends in"
  - "información actualizada"
  - "current information"

preferred_agents: []

steps:
  - step: 1
    action: web_search
    instruction: "Search for main topic using clear and concise query (max 6 words). Include year if relevant."
    params:
      query: "main topic keywords"
      numResults: 8
    output: raw_results

  - step: 2
    action: web_fetch
    instruction: "Fetch the 2-3 most relevant URLs from step 1 to get full content"
    params:
      urls: "top 2-3 URLs from search"
    output: detailed_content

  - step: 3
    action: web_search
    instruction: "If gaps exist, do second targeted search with refined query"
    params:
      query: "refined query for gaps"
    output: complementary_results

  - step: 4
    action: synthesize
    instruction: "Combine all gathered information into structured response: summary, key points, sources"
    output: final_report

rules:
  - "Always do at least 2 searches before concluding"
  - "Never invent data — only use information actually found"
  - "If no results found, notify user and suggest 2-3 alternative queries"
  - "Cite all sources at end with full URLs"
  - "Prioritize recent content (<1 year) unless historical context requested"
  - "Cross-reference claims across multiple independent sources"

output_format:
  structure: markdown
  sections:
    - "summary"
    - "key_points"
    - "sources"
  max_length: "500 words unless user requests more"

examples:
  - user_input: "investigá sobre los últimos avances en IA"
    expected_behavior: "Search 'latest AI advances 2025' → fetch top 2-3 results → synthesize into structured report"

  - user_input: "qué es un transformer en machine learning"
    expected_behavior: "Search 'transformer machine learning explained' → fetch educational content → return clear summary"

  - user_input: "buscá tendencias de quantum computing"
    expected_behavior: "Search 'quantum computing trends 2025' → fetch authoritative sources → compile 5-7 key trends"
---

# Web Research Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita información actualizada de internet, verificar datos, o investigar temas específicos.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `web_search` | Busca en internet, devuelve títulos, URLs, snippets | Búsqueda inicial, encontrar fuentes |
| `web_fetch` | Descarga contenido completo de URL (HTML→Markdown) | Profundizar en resultados específicos |

## Workflow

1. **Búsqueda inicial** → `web_search({ query, numResults: 8 })`
2. **Fetch contenido** → `web_fetch({ urls: top 2-3 })`
3. **Búsqueda complementaria** → Segundo search si hay gaps
4. **Síntesis** → summary + key points + sources

## Mejores Prácticas

- Queries específicos (máx 6 palabras)
- Mínimo 2-3 fuentes independientes
- Priorizar contenido reciente (<1 año)
- Citas con URLs completas

## Errores a Evitar

- ❌ Inventar datos no encontrados
- ❌ Concluir con una sola búsqueda
- ❌ No verificar fecha de fuentes
- ❌ Copiar contenido literal (usar paráfrasis)
