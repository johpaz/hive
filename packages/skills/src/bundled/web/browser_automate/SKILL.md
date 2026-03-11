---
name: browser_automate
description: "Automate web workflows with navigation, clicks, form filling, and visual verification"
version: 1.0.0
author: Hive Team
icon: "🤖"
category: web
permissions:
  - browser_control
dependencies: []
tools: [browser_navigate, browser_click, browser_type, browser_screenshot]

# Structured skill fields
triggers:
  - "automatizá el navegador"
  - "automate browser"
  - "completá el formulario"
  - "fill form"
  - "hacé clic en"
  - "click on"
  - "iniciá sesión"
  - "login"
  - "registrate"
  - "sign up"
  - "interactuá con la web"
  - "interact with website"
  - "flujo web"
  - "web workflow"

preferred_agents: []

steps:
  - step: 1
    action: browser_navigate
    instruction: "Navigate to target URL and wait for page to fully load"
    params:
      url: "target URL"
    output: page_loaded

  - step: 2
    action: browser_click
    instruction: "Click on elements (buttons, links) to navigate or trigger actions"
    params:
      selector: "CSS selector for element"
    output: click_result

  - step: 3
    action: browser_type
    instruction: "Type text into form fields (inputs, textareas)"
    params:
      selector: "CSS selector for input"
      text: "text to type"
    output: type_result

  - step: 4
    action: browser_screenshot
    instruction: "Take screenshot to verify state after interactions"
    output: verification_screenshot

rules:
  - "Wait for page to fully load after each navigation or significant interaction"
  - "Use specific, stable CSS selectors (IDs preferred over classes)"
  - "Take screenshots after critical steps for verification"
  - "Handle errors gracefully — element may not exist or be interactable"
  - "For multi-step flows, verify state after each step before proceeding"

output_format:
  structure: markdown
  sections:
    - "workflow_steps"
    - "final_state"
    - "screenshot_path"
  max_length: "Summary of automation flow"

examples:
  - user_input: "automatizá el login en example.com"
    expected_behavior: "Navigate → type credentials → click submit → screenshot verification"

  - user_input: "completá el formulario de contacto"
    expected_behavior: "Navigate → type name/email/message → click submit → verify submission"

  - user_input: "hacé clic en todos los enlaces del menú"
    expected_behavior: "Navigate → click each menu item → screenshot each page"
---

# Browser Automate Skill

## Cuándo se Activa

Esta skill se activa para automatizar flujos de interacción con aplicaciones web: logins, formularios, navegación programática.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `browser_navigate` | Navega a URL | Inicio de flujo |
| `browser_click` | Click en elementos | Botones, enlaces, triggers |
| `browser_type` | Escribe en inputs | Formularios, búsquedas |
| `browser_screenshot` | Captura estado | Verificación visual |

## Workflow Típico

1. **Navegar** → URL inicial
2. **Interactuar** → click/type según flujo
3. **Verificar** → screenshot después de acciones críticas
4. **Repetir** → para flujos multi-paso

## Mejores Prácticas

- Selectores estables (IDs > classes > XPath)
- Esperar carga después de navegación
- Verificar estado visual con screenshots
- Manejar errores de elementos no encontrados

## Errores a Evitar

- ❌ Selectores frágiles que cambian
- ❌ No esperar carga de página
- ❌ Ignorar errores de elementos
- ❌ No verificar estado después de acciones
