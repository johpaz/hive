# Benchmarks y documentos históricos

Los análisis anteriores a 1.0 medían una arquitectura con especialistas, proyectos DAG, SQLite/FTS5 y otras capacidades ya retiradas. Sus cifras no describen el producto actual y por eso no forman parte de la referencia operativa.

## Cómo publicar un benchmark vigente

Todo resultado nuevo debe incluir:

- commit o versión;
- fecha;
- sistema operativo, CPU, memoria y versión de Bun;
- proveedor y modelo cuando intervenga inferencia;
- dataset o fixture reproducible;
- comando exacto;
- promedio, dispersión y número de muestras.

Los conteos de tools, skills, agentes y exports nunca se copian manualmente: proceden del [inventario generado](../reference/inventario.md).

La medición de calidad debe separar selección de capacidades, ejecución, verificación y síntesis. Un resultado exitoso sin evidencia del estado final no cuenta como tarea aceptada.
