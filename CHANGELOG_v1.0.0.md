# Changelog — Hive 1.0.0

Fecha: 2026-07-25

Hive 1.0 consolida el runtime local-first alrededor de agentes de catálogo, descubrimiento bajo demanda, delegación durable y evidencia verificable. Es una versión mayor con cambios incompatibles respecto a la línea 0.0.x.

## Añadido

- 11 agentes de catálogo persistentes con routing, scopes, criterios de aceptación y overrides de modelo.
- Carga mínima de siete herramientas y descubrimiento dinámico mediante `search_knowledge`.
- Grupos de delegación paralela con fan-in y síntesis posterior.
- Verificador independiente, criterios de aceptación y proof packets.
- Artifact store para capturas y evidencia binaria con SHA-256 y retención.
- Narración y eventos de observabilidad para tareas delegadas.
- A2UI v0.9 con replay de superficies para clientes que conectan tarde.
- Office3D orbital con posiciones vivas, haces de delegación, cámara y estallidos de actividad.
- Recuperación de jobs por leases, reintentos y reconciliación durante el arranque.
- Generación y validación automática del inventario documental.

## Cambiado

- Los antiguos templates de especialistas fueron reemplazados por filas `AgentDoc` con `source: catalog`.
- La búsqueda y persistencia operativa usan HiveDB como única fuente de verdad.
- Las allowlists se expanden contra el registro de herramientas vigente al delegar.
- Los agentes heredan el modelo del coordinador salvo override explícito.
- Los servidores MCP se asignan mediante leases durante la ejecución.
- Canvas conserva renders desconectados y los reproduce al reconectar.
- Las capturas del navegador devuelven artefactos administrados en vez de depender de archivos temporales.
- La documentación canónica pasa a español y se organiza por audiencia.

## Eliminado

- Runtime, rutas, tipos y UI de especialistas.
- Scheduler DAG, task driver, proyectos y tools `project_*`.
- CodeBridge y su delegador.
- Detección y resolución automática de CAPTCHA.
- Tools y skills de voz y reuniones. La voz y las reuniones continúan como funciones de la UI y APIs del gateway.
- Exports públicos que apuntaban a voz-tools, DAG e integraciones inexistentes.
- Documentación basada en SQLite/FTS5 o componentes retirados.

## Incompatibilidades

- Versión de todos los paquetes y rangos internos: `1.0.0`.
- Usa `fs_read`, `fs_write`, `fs_edit`, `fs_exists` y demás `fs_*` en lugar de `project_*`.
- Usa `task_delegate` y grupos de delegación en lugar del scheduler DAG.
- Los consumidores de `@johpaz/hive-agents-core/tools/voice`, `integrations/*` o `scheduler/dag` deben retirar esos imports.
- El agregado `@johpaz/hive-agents-core/agent` vuelve a exportar las superficies vigentes del runtime.
- Configuraciones antiguas de CAPTCHA se ignoran y deben eliminarse.

## Migración desde 0.0.x

```bash
hive stop
# Respaldar ~/.hive o el directorio definido en HIVE_HOME
hive migrate
hive doctor
hive start
```

Después del arranque:

1. Confirma proveedor y modelo del coordinador.
2. Revisa los 11 agentes de catálogo y sus overrides.
3. Verifica canales y servidores MCP.
4. Sustituye nombres de tools retiradas en skills administradas.
5. Ejecuta una delegación y comprueba su evidencia.

Hive conserva datos de usuario y reconcilia runs, jobs y reuniones interrumpidos. Las filas del sistema retiradas dejan de sembrarse.

## Verificación de la release

```bash
bun run lint
bun run test
bun run test:ui
bun run docs:check
bun run build
```

La publicación, creación de tag y push no forman parte de esta actualización del worktree.
