# Documentación de Hive 1.0

Esta es la entrada canónica a la documentación. Todo el contenido operativo está en español y describe el código de la versión 1.0.0.

## Para empezar

- [Instalación y actualización](guides/instalacion.md)
- [Configuración](guides/configuracion.md)
- [Seguridad](guides/seguridad.md)
- [Canales](guides/canales.md)
- [Reuniones](guides/reuniones.md)

## Para operar Hive

- [CLI](reference/cli.md)
- [Agentes y delegación](reference/agentes.md)
- [Herramientas](reference/herramientas.md)
- [Skills](reference/skills.md)
- [MCP](reference/mcp.md)
- [Panel interactivo](reference/panel-interactivo.md)
- [API HTTP y WebSocket](reference/api.md)
- [Inventario generado](reference/inventario.md)

## Para contribuir o integrar

- [Arquitectura general](architecture/overview.md)
- [Runtime de agentes](architecture/runtime.md)
- [Navegador](internals/browser.md)
- [Workers de herramientas](internals/tool-workers.md)
- [Formato TOON](internals/toon.md)
- [Playbook ACE](internals/ace.md)
- [Benchmarks y documentos históricos](internals/benchmarks.md)
- [Guía de contribución](../CONTRIBUTING.md)

## Política documental

El código y los tests son la fuente de verdad. `bun run docs:generate` actualiza el inventario; `bun run docs:check` comprueba inventario, versiones, exports, declaraciones de skills y enlaces locales. Los datos históricos deben marcar su fecha y no presentarse como capacidades actuales.
