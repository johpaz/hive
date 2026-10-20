---
name: obscura_browser
description: "Browse, read, scrape and fill forms with Obscura, a lightweight headless browser with a live session and element refs; use Chrome (browser_*) only for visuals"
version: 1.0.0
author: Hive Team
icon: "🕸️"
category: web
permissions:
  - browser_control
dependencies: []
tools: [obscura_navigate, obscura_snapshot, obscura_markdown, obscura_links, obscura_interactive_elements, obscura_detect_forms, obscura_extract, obscura_get_attribute, obscura_search, obscura_click, obscura_fill, obscura_type, obscura_fill_form, obscura_press_key, obscura_select_option, obscura_scroll, obscura_wait_for, obscura_wait_for_text, obscura_evaluate, obscura_pdf, obscura_get_cookies, obscura_set_cookie, obscura_storage_state, obscura_set_storage_state, obscura_tab_new, obscura_tab_list, obscura_tab_switch, obscura_tab_close, obscura_close]

triggers:
  - "scrapea"
  - "extrae datos de la página"
  - "lee esta página"
  - "llena el formulario"
  - "scrape this page"
  - "read this page"
  - "fill the form"
  - "obscura"

preferred_agents: [browser_operator]

steps:
  - step: 1
    action: obscura_navigate
    instruction: "Open the URL. It returns only the final URL and title and keeps ONE live session for the following calls"
    params:
      url: "target URL"
    output: session

  - step: 2
    action: obscura_snapshot
    instruction: "Read the page as text with element refs (e3, e7…). Use obscura_markdown for article-like content and obscura_links to crawl"
    output: page_text

  - step: 3
    action: act
    instruction: "Act with refs: obscura_click, obscura_fill / obscura_fill_form (one call for a whole form, with optional submit), obscura_press_key, obscura_select_option. Fall back to CSS selectors when no ref exists"
    output: action_result

  - step: 4
    action: verify
    instruction: "Re-read with obscura_snapshot or obscura_evaluate to confirm the final state before reporting"
    output: final_state

rules:
  - "Refs are only valid for the last snapshot: take a new obscura_snapshot after navigating or after the DOM changes"
  - "There is one live session: do not interleave Obscura calls for two different sites; use obscura_tab_new for a second page"
  - "Obscura blocks localhost and private networks by default (SSRF protection): that is expected, not a bug"
  - "Obscura is not a rendering engine: for screenshots of what the user sees, visual checks or computer_use_task, use the Chrome-backed browser_* tools"
  - "If a tool says Obscura is not installed, continue with the browser_* tools instead of retrying"
  - "Never confirm purchases, sends or deletions unless the principal explicitly authorized that effect"

output_format:
  structure: markdown
  sections:
    - "url"
    - "findings"
    - "evidence"
  max_length: "Concise"

examples:
  - user_input: "lee los títulos de esta página y sus enlaces"
    expected_behavior: "obscura_navigate → obscura_snapshot → obscura_links → summarize"
  - user_input: "llena el formulario de contacto"
    expected_behavior: "obscura_navigate → obscura_detect_forms → obscura_fill_form with fields → obscura_snapshot to verify"
---
