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
tools: [browser_navigate, browser_screenshot, browser_extract, browser_wait]

# Structured skill fields
triggers:
  - "captura el contenido"
  - "scrape content"
  - "obtén la página renderizada"
  - "get rendered page"
  - "sitios dinámicos"
  - "dynamic sites"
  - "web con javascript"
  - "javascript websites"
  - "toma screenshot y contenido"
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
    action: browser_wait
    instruction: "Wait for the content selector before extracting — an SPA renders after load fires"
    params:
      selector: "CSS selector of the content that must be present"
    output: content_ready

  - step: 4
    action: browser_extract
    instruction: "Extract the rendered DOM. Omit the selector for a compact accessibility snapshot of the whole page"
    params:
      selector: "CSS selector, or 'body' for the whole page"
    output: extracted_content

  - step: 5
    action: synthesize
    instruction: "Combine screenshot and text content for comprehensive capture"
    output: scraped_data

rules:
  - "Extraer con `browser_extract`, NUNCA con `web_fetch`: web_fetch vuelve a pedir la URL al servidor y recibe el HTML sin renderizar, que es justamente lo que esta skill existe para evitar. En un SPA devuelve una cáscara vacía."
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
  - user_input: "captura el contenido de https://example.com/dashboard"
    expected_behavior: "browser_navigate → browser_wait → browser_screenshot → browser_extract → return both"

  - user_input: "obtén la página renderizada de la app"
    expected_behavior: "Navigate → browser_wait for the SPA root → screenshot + browser_extract"

  - user_input: "scrapea este sitio con javascript"
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
| `browser_extract` | Extrae del DOM ya renderizado | Contenido textual o estructurado del SPA |
| `browser_wait` | Espera a que aparezca un selector | Antes de extraer, en páginas que cargan por partes |

> **No usar `web_fetch` acá.** Vuelve a pedir la URL al servidor y recibe el HTML
> sin JavaScript ejecutado — en un SPA, una cáscara vacía. Para eso está
> `browser_extract`, que lee el DOM que el navegador ya renderizó.

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
