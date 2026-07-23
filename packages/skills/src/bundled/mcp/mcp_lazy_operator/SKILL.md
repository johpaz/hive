---
name: mcp_lazy_operator
description: "Operate only task-scoped MCP servers through lazy leases and verify external effects"
version: 1.0.0
author: Hive Team
icon: "🔌"
category: mcp
permissions: [mcp_use]
dependencies: []
tools: []
triggers: [integración MCP, servicio conectado, external integration, MCP tool]
preferred_agents: [mcp_integration_operator]
---

# Operación MCP lazy

1. Usa únicamente los servidores y tools MCP incluidos en el loadout.
2. Respeta el esquema publicado y minimiza llamadas.
3. No expongas headers, tokens ni credenciales.
4. Después de una mutación, usa una operación read-only de comprobación si existe.
5. Reporta servidor, tool, resultado saneado y evidencia.

La conexión pertenece a un lease del runtime; no intentes mantenerla abierta.
