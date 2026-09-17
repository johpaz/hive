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
tools: [browser_navigate, browser_wait, browser_click, browser_type, browser_screenshot, browser_script, computer_use_task]

# Structured skill fields
triggers:
  - "automatiza el navegador"
  - "automate browser"
  - "completa el formulario"
  - "fill form"
  - "haz clic en"
  - "click on"
  - "inicia sesión"
  - "login"
  - "regístrate"
  - "sign up"
  - "interactúa con la web"
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
    action: browser_wait
    instruction: "Wait for the element before acting on it. Clicking or typing before the element exists is the most common failure in web automation, and it fails silently"
    params:
      selector: "CSS selector of the element about to be used"
    output: element_ready

  - step: 3
    action: browser_click
    instruction: "Click on elements (buttons, links) to navigate or trigger actions"
    params:
      selector: "CSS selector for element"
    output: click_result

  - step: 4
    action: browser_type
    instruction: "Type text into form fields (inputs, textareas)"
    params:
      selector: "CSS selector for input"
      text: "text to type"
    output: type_result

  - step: 5
    action: browser_screenshot
    instruction: "Take screenshot to verify state after interactions"
    output: verification_screenshot

rules:
  - "Escalar sólo cuando haga falta, en este orden: `browser_click`/`browser_type` con un selector → `browser_script` si el elemento no se puede alcanzar con un selector estable → `computer_use_task` si la página no tiene selectores usables. Empezar por el último es lento y caro: mira la pantalla y razona en cada paso."
  - "Esperar con `browser_wait` antes de cada clic o tipeo, no confiar en que la página ya cargó: es la falla más común de la automatización web, y falla en silencio."
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
  - user_input: "automatiza el login en example.com"
    expected_behavior: "Navigate → type credentials → click submit → screenshot verification"

  - user_input: "completa el formulario de contacto"
    expected_behavior: "Navigate → type name/email/message → click submit → verify submission"

  - user_input: "haz clic en todos los enlaces del menú"
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
