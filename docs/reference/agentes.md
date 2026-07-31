# Agentes y delegación

Hive siembra 8 agentes de catálogo como filas normales de la colección `agents`. Sus IDs y contratos están en el [inventario generado](inventario.md).

## Modelo

El coordinador conserva la conversación con el usuario. Cuando encuentra una subtarea acotada:

1. Busca agentes por BM25 y ejemplos de routing.
2. Construye criterios de aceptación.
3. Expande la allowlist de tools contra el registro actual.
4. Asigna modelo, skills, workspace y límites.
5. Crea una tarea durable.
6. Recibe un resultado estructurado y sintetiza.

Los workers de catálogo no conversan con el usuario, no delegan y no amplían el alcance. Entregan `status`, trabajo realizado, artefactos, evidencia, riesgos y una pregunta solo si necesitan información del coordinador.

## Paralelismo

Las subtareas independientes forman un grupo de delegación. El coordinador puede terminar su turno mientras el gateway ejecuta workers en paralelo. Cuando el grupo alcanza el fan-in, se crea un nuevo turno de síntesis con los resultados.

## Modelo y MCP

Cada agente puede declarar capacidades de modelo requeridas y una política de fallback. Sin override, hereda proveedor y modelo del coordinador.

Cuando una tarea requiere MCP, el coordinador busca primero un especialista del usuario asociado al `server_id`. Si no existe, solicita autorización antes de crear uno. Cada especialista conserva un único servidor en `mcp_server_ids_json`, recibe todas sus tools actuales y futuras y adquiere un lease durante la ejecución. Si el usuario rechaza la creación, el coordinador puede usar la integración directamente para esa solicitud puntual.

## Cron y calendario

`schedule_automation_agent` es el **Operador de cron**. Administra jobs que Hive
ejecutará en el futuro: automatizaciones recurrentes, reportes, monitoreos y
recordatorios de una sola ejecución. No administra una agenda externa.

Crear, consultar o modificar eventos, citas o reuniones; invitar asistentes; y
consultar disponibilidad corresponde al especialista MCP del servidor de
calendario. La frase «agenda una reunión» se interpreta como calendario, no
como `cron.create`.

## Aceptación

No hay un agente verificador separado: cada entrega pasa por `runAcceptanceChecks` (sin LLM) antes de llegar al coordinador. Por criterio, ejecuta su `checkTool` si lo declara, inspecciona artefactos referenciados (`artifact_inspect`) y aplica gates baratos (entrega no vacía, el worker no declaró `status: failed`). El resultado es:

- `passed`: al menos un check determinístico confirmó la entrega y ninguno falló.
- `failed`: algún check determinístico falló — la tarea queda `blocked` sin llegar al coordinador.
- `unchecked`: ningún criterio tenía check determinístico — el coordinador la juzga con el contenido y la evidencia adjunta, en el mismo turno de cierre que ya sintetiza la respuesta.

El coordinador nunca repara la tarea a ciegas: si no cumple sus criterios, usa `task_revise` para devolverla al mismo worker (mismo `thread_id`, conserva su contexto) con feedback concreto, o la corrige él mismo si es trivial.

## Administración

Los agentes de catálogo se reconcilian en el arranque y conservan configuración explícita de modelos. Los agentes creados por el usuario usan `source: user`. La UI permite habilitar, deshabilitar, configurar y observar ambos. Ningún agente se archiva automáticamente.
