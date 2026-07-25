# MCP

MCP conecta Hive con herramientas externas mediante servidores `stdio`, `sse` o `websocket`.

## Administración

```bash
hive mcp list
hive mcp add
hive mcp test <nombre>
hive mcp tools <nombre>
hive mcp remove <nombre>
```

La UI permite crear, editar, activar y sincronizar servidores. Las variables secretas deben referenciarse desde el entorno, no escribirse en documentación ni logs.

## Ciclo de vida

1. El manager carga servidores habilitados.
2. Conecta el transporte y descubre tools.
3. Normaliza sus nombres para evitar colisiones.
4. Sincroniza metadatos con HiveDB para que `search_knowledge` pueda encontrarlas.
5. Una delegación adquiere un lease para los servidores autorizados.
6. Al terminar, libera el lease; hot reload puede reemplazar conexiones sin cortar tareas activas.

## Fallos

Una tool MCP ausente o un servidor desconectado no se presenta como éxito. El agente debe devolver evidencia del error y el coordinador puede elegir una alternativa nativa. No se reintentan automáticamente mutaciones no idempotentes.

## Diagnóstico

- Ejecuta `hive mcp test <nombre>`.
- Comprueba binario, argumentos, URL y variables requeridas.
- Revisa `hive logs --follow`.
- Verifica que el servidor esté habilitado y asignado al agente.
