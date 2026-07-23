---
name: software_engineering
description: "Implement, debug, and verify scoped software changes in an existing repository"
version: 1.0.0
author: Hive Team
icon: "🛠️"
category: cli
permissions: [filesystem_read, filesystem_write, shell_exec]
dependencies: []
tools: [fs_read, fs_write, fs_edit, fs_list, fs_glob, fs_exists, cli_exec]
triggers: [implementar código, corregir bug, ejecutar tests, implement code, fix bug]
preferred_agents: [software_engineer]
---

# Ingeniería de software

1. Inspecciona estructura, convenciones y cambios existentes.
2. Determina la causa o el cambio mínimo antes de editar.
3. Conserva cambios ajenos y limita el diff al objetivo.
4. Ejecuta tests, typecheck o build proporcionales al riesgo.
5. Entrega archivos cambiados, comandos ejecutados, resultados y riesgos.

No publiques, no delegues y no uses comandos destructivos sin autorización explícita.
