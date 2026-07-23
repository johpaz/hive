---
name: acceptance_verification
description: "Independently verify acceptance criteria before Hive reports a delegated or effectful task as complete"
version: 1.0.0
author: Hive Team
icon: "✅"
category: agents
permissions: [filesystem_read]
dependencies: []
tools: [fs_read, fs_exists, fs_list, web_fetch, browser_navigate, browser_extract, browser_screenshot, office_leer_pdf, office_leer_docx, office_leer_xlsx, office_leer_pptx, cron.list, cron.history, project_status, task_status]
triggers: [verificar cumplimiento, acceptance gate, audit result, proof packet]
preferred_agents: [acceptance_verifier]
---

# Verificación independiente

Evalúa cada criterio por separado. Una afirmación del ejecutor no es evidencia independiente.

Orden de preferencia:

1. Check determinístico.
2. Readback seguro del estado final.
3. Inspección directa del artefacto.
4. Evidencia trazada y consistente.

Devuelve `verified` únicamente cuando todos los criterios estén demostrados. Usa `needs_evidence` cuando podría demostrarse con información adicional y `rejected` cuando la evidencia contradiga el objetivo. Nunca repares la tarea.
