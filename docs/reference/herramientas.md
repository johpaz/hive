# Herramientas

El número, nombre y descripción exactos de las herramientas nativas se generan en el [inventario](inventario.md).

## Categorías

- `filesystem`: leer, escribir, editar, eliminar, listar, buscar y comprobar paths autorizados.
- `web`: búsqueda/fetch, navegador renderizado, capturas y artefactos visuales.
- `cron`: crear, consultar, modificar y ejecutar automatizaciones programadas de Hive; no administra eventos de calendario.
- `cli`: ejecutar comandos con timeout y captura de salida.
- `agents`: memoria, catálogo, delegación, tareas y bus interno.
- `a2ui`: superficies del Panel interactivo mediante A2UI v0.9.
- `core`: descubrimiento, notas, progreso y notificaciones.
- `office`: lectura/escritura de PDF, DOCX, XLSX y PPTX.
- `api`: requests REST autorizados.

## Descubrimiento

El coordinador comienza con:

```text
search_knowledge
notify
report_progress
save_note
task_delegate
agent_find
task_status
```

`search_knowledge` consulta el índice de HiveDB. Al seleccionar una capacidad, el runtime añade la tool y la skill asociada al contexto del turno. Esto evita enviar el catálogo completo al modelo.

## Ejecución

Las llamadas independientes pueden ejecutarse en paralelo mediante el pool de workers. Las tools que dependen de singletons del proceso —HiveDB, canales, navegador, A2UI, cron y delegación— se resuelven por RPC en el hilo principal.

Cada tool puede definir un timeout; después se aplica `config.tools.timeouts[nombre]` y finalmente el timeout general del pool. Un fallo produce un resultado estructurado y no cancela herramientas hermanas.

## Seguridad

- Los paths se resuelven contra el workspace y scope del agente.
- Una allowlist con patrones como `fs_*` se expande contra el registro vivo al delegar.
- Las tools MCP solo existen mientras el servidor y su lease estén activos.
- Nunca incluyas tokens, cookies o secretos en parámetros que terminarán en logs o proof packets.

## Cambios incompatibles

Ya no existen categorías nativas para proyectos/DAG, CAPTCHA, voz o reuniones. Usa `fs_*` para archivos, `task_delegate` para trabajo distribuido y las APIs de producto para voz o reuniones.

También se retiró la categoría `canvas` y sus herramientas
`canvas_render`, `canvas_ask`, `canvas_confirm`, `canvas_show_card`,
`canvas_show_list`, `canvas_show_progress` y `canvas_clear`. Las interfaces
generadas por agentes deben usar `a2ui_create_surface`,
`a2ui_update_components`, `a2ui_update_data_model` y
`a2ui_delete_surface`.
