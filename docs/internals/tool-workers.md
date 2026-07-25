# Workers de herramientas

El runtime puede ejecutar lotes de tools en workers de Bun para aislar fallos y aprovechar paralelismo.

## Selección

Una llamada única, el modo serial o una tool marcada para el hilo principal se ejecutan en proceso. Los lotes paralelos se encolan en un pool con un máximo configurable.

Las tools con estado local —HiveDB, canales, navegador, A2UI, cron, agentes y MCP dinámico— usan RPC: el worker solicita la operación y el proceso principal responde.

## Timeouts y abortos

La precedencia del timeout es:

1. `Tool.timeoutMs`
2. `config.tools.timeouts[nombre]`
3. `workerPool.toolTimeoutMs`

Un timeout o aborto genera un `ToolBatchResult` normal con `ok: false`; no rompe el orden de resultados ni cancela trabajos hermanos completados.

Al apagar el runtime se resuelven como abortados tanto jobs en cola como jobs activos, se limpian timers y luego se terminan workers. Una respuesta RPC tardía comprueba que su worker y job sigan vigentes antes de enviar.

## Empaquetado

Las distribuciones incluyen `dist/tool-worker.js`. `HIVE_TOOL_WORKER_PATH` permite señalar una ubicación explícita en entornos empaquetados especiales.
