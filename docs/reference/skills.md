# Skills

Una skill es un `SKILL.md` con frontmatter YAML y una guía operativa. Hive carga skills incluidas, administradas en `HIVE_HOME/skills` y opcionalmente skills del workspace.

La lista exacta de las 25 skills incluidas está en el [inventario generado](inventario.md).

## Campos principales

```yaml
---
name: mi_skill
description: Qué resuelve
version: 1.0.0
category: filesystem
tools: [fs_read, fs_exists]
triggers: [leer archivo]
preferred_agents: [workspace_file_operator]
---
```

- `tools` debe contener nombres registrados.
- `preferred_agents` debe referirse a IDs del catálogo.
- `triggers` ayuda a seleccionar la skill.
- `steps`, `rules`, `examples` y `output_format` son opcionales.
- `requirements` declara binarios, variables o sistemas necesarios.

## Prioridad y carga

La precedencia es workspace, administrada y finalmente incluida. Una allowlist `skills.allowBundled` puede restringir las incluidas. El hot reload permite refrescar directorios configurados sin reiniciar todo el gateway.

Solo `capability_discovery` forma parte de la carga mínima actual porque documenta una tool siempre disponible. Las demás se incorporan cuando el turno descubre las capacidades que enseñan.

## Validación

```bash
bun run docs:check
```

El check rechaza tools o agentes preferidos inexistentes. Después de editar una skill incluida también debe regenerarse el bundle estático usado por las distribuciones compiladas.

Las antiguas skills `canvas_report`, `canvas_dashboard` y `canvas_interact`
fueron retiradas. Para interfaces generadas por agentes se usan
`a2ui_form`, `a2ui_dashboard` y `a2ui_interactive`.
