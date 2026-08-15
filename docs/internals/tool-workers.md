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

El entry del worker se resuelve en este orden: el archivo en disco junto al bundle (`tool-worker.js` o el `.ts` en desarrollo), `HIVE_TOOL_WORKER_PATH`, el directorio del ejecutable, `/app/tool-worker.js` y, por último, la copia embebida en el ejecutable standalone.

Cada distribución usa una vía distinta: el paquete npm publica `dist/tool-worker.js` junto a `dist/hive.js`; la imagen Docker lo copia al lado del binario; el binario standalone —el sidecar de la app de escritorio— lo lleva embebido, porque un instalador no deja archivos sueltos junto al ejecutable. `scripts/build-gateway.ts` hace ese embebido: `new Worker(path)` resuelve su ruta en runtime, así que el bundler no lo detecta y `bun build --compile` no lo incluiría por su cuenta.

Si ninguna vía resuelve, el runtime registra un warning y ejecuta los lotes en el hilo principal de forma secuencial. Los workers son una optimización: su ausencia nunca debe romper un turno.
