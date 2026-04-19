---
name: browser_scrape
description: "Navigate to web pages and capture rendered content including screenshots for dynamic sites"
version: 1.0.0
author: Hive Team
icon: "📸"
category: web
permissions:
  - browser_control
dependencies: []
tools: [browser_navigate, browser_screenshot, web_fetch]

# Structured skill fields
triggers:
  - "capturá el contenido"
  - "scrape content"
  - "obtené la página renderizada"
  - "get rendered page"
  - "sitios dinámicos"
  - "dynamic sites"
  - "web con javascript"
  - "javascript websites"
  - "tomá screenshot y contenido"
  - "screenshot and content"

preferred_agents: []

steps:
  - step: 1
    action: browser_navigate
    instruction: "Navigate to URL and wait for full page load including JavaScript rendering"
    params:
      url: "target URL"
    output: page_loaded

  - step: 2
    action: browser_screenshot
    instruction: "Take screenshot to capture visual state of rendered page"
    output: screenshot

  - step: 3
    action: web_fetch
    instruction: "Extract text content from rendered page as markdown"
    output: extracted_content

  - step: 4
    action: synthesize
    instruction: "Combine screenshot and text content for comprehensive capture"
    output: scraped_data

rules:
  - "Wait for full page load including JavaScript-rendered content"
  - "Take screenshot before extracting text to capture initial state"
  - "For infinite scroll pages, scroll down and capture multiple screenshots"
  - "Respect website terms of service — no aggressive scraping"
  - "Store both screenshot and text for complete record"

output_format:
  structure: markdown
  sections:
    - "url"
    - "screenshot_path"
    - "extracted_content"
    - "timestamp"
  max_length: "Full content extraction"

examples:
  - user_input: "capturá el contenido de https://example.com/dashboard"
    expected_behavior: "browser_navigate → wait for JS render → browser_screenshot → browser_fetch → return both"

  - user_input: "obtené la página renderizada de la app"
    expected_behavior: "Navigate → wait for SPA to load → screenshot + fetch content"

  - user_input: "scrapeá este sitio con javascript"
    expected_behavior: "Full browser render → capture visual and text content"
---

# Browser Scrape Skill

## Cuándo se Activa

Esta skill se activa para sitios web dinámicos que requieren JavaScript rendering, donde el contenido no está disponible en HTML estático.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `browser_navigate` | Navega y renderiza página completa | Sitios con JavaScript/SPA |
| `browser_screenshot` | Captura estado visual | Evidencia de contenido renderizado |
| `web_fetch` | Extrae texto como markdown | Contenido textual de página renderizada |

## Workflow

1. **Navegar** → `browser_navigate({ url })` + esperar renderizado JS
2. **Capturar visual** → `browser_screenshot()`
3. **Extraer texto** → `web_fetch()`
4. **Combinar** → screenshot + texto para scrape completo

## Mejores Prácticas

- Esperar renderizado completo de JavaScript
- Para infinite scroll: hacer scroll y múltiples screenshots
- Capturar antes y después de interacciones si es dinámico

## Errores a Evitar

- ❌ No esperar renderizado JavaScript
- ❌ Solo capturar HTML estático para sitios SPA
- ❌ Ignorar términos de servicio del sitio
