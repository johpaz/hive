# Agentes y delegación

Hive siembra 10 agentes de catálogo como filas normales de la colección `agents`. Sus IDs y contratos están en el [inventario generado](inventario.md).

## Modelo

El coordinador conserva la conversación con el usuario. Cuando encuentra una subtarea acotada:

1. Busca agentes por BM25 y ejemplos de routing.
2. Construye criterios de aceptación.
3. Expande la allowlist de tools contra el registro actual.
4. Asigna modelo, skills, workspace, recursos MCP y límites.
5. Crea una tarea durable.
6. Recibe un resultado estructurado y sintetiza.

Los workers de catálogo no conversan con el usuario, no delegan y no amplían el alcance. Entregan `status`, trabajo realizado, artefactos, evidencia, riesgos y una pregunta solo si necesitan información del coordinador.

## Paralelismo

Las subtareas independientes forman un grupo de delegación. El coordinador puede terminar su turno mientras el gateway ejecuta workers en paralelo. Cuando el grupo alcanza el fan-in, se crea un nuevo turno de síntesis con los resultados.

## Modelo y MCP

Cada agente puede declarar capacidades de modelo requeridas y una política de fallback. Sin override, hereda proveedor y modelo del coordinador. Los servidores MCP se adquieren mediante leases durante la tarea y se liberan al finalizar.

## Verificación

`acceptance_verifier` usa un modelo que, cuando es posible, pertenece a una familia diferente. Comprueba cada criterio con readback, inspección o evidencia trazada. Devuelve:

- `verified`: todos los criterios están demostrados.
- `needs_evidence`: falta evidencia que podría obtenerse.
- `rejected`: el resultado contradice el objetivo.

El verificador no corrige la tarea. El coordinador decide si delega una reparación o informa el límite.

## Administración

Los agentes de catálogo se reconcilian en el arranque y conservan configuración explícita de modelos. Los agentes creados por el usuario usan `source: user`. La UI permite habilitar, deshabilitar, configurar y observar ambos.
