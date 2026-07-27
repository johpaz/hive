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
4. Sincroniza metadatos y `server_id` con HiveDB para que `search_knowledge` pueda encontrarlas.
5. El coordinador busca un especialista persistente para ese servidor.
6. Si no existe, pregunta al usuario antes de crearlo; si el usuario rechaza, ejecuta directamente la solicitud puntual.
7. Una delegación adquiere el lease del servidor persistido en el agente.
8. Al terminar, libera el lease; hot reload puede reemplazar conexiones sin cortar tareas activas.

Cada especialista representa un solo servidor y recibe todas sus tools actuales y futuras. Si una tarea requiere varios servidores, se reutiliza o crea un agente independiente para cada uno.

## Fallos

Una tool MCP ausente o un servidor desconectado no se presenta como éxito. El agente debe devolver evidencia del error y el coordinador puede elegir una alternativa nativa. No se reintentan automáticamente mutaciones no idempotentes.

## Diagnóstico

- Ejecuta `hive mcp test <nombre>`.
- Comprueba binario, argumentos, URL y variables requeridas.
- Revisa `hive logs --follow`.
- Verifica que el servidor esté habilitado y asignado al agente.
