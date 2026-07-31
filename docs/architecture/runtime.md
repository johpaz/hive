# Runtime de agentes

## Inicio de un turno

El servicio carga al coordinador, historial reciente, notas, playbook y una carga mínima de siete herramientas. El compilador de contexto aplica presupuestos y evita incluir catálogos completos.

`search_knowledge` consulta el índice combinado de tools, skills, MCP y reglas ACE. Una capacidad seleccionada se incorpora al loadout del turno y puede activar su skill asociada.

## Loop

En cada iteración:

1. Se construye el prompt con identidad, contexto, herramientas y reglas.
2. El proveedor devuelve texto, tool calls o ambos.
3. Las tools independientes se ejecutan en paralelo cuando es seguro.
4. Los resultados se normalizan y se agregan al siguiente paso.
5. El loop termina al responder, delegar, agotar el límite o encontrar un fallo terminal.

El tracer y el event log causal registran decisiones, tool calls y estados sin convertir el log en memoria conversacional.

## Delegación

`task_delegate` resuelve un agente de catálogo o uno solicitado explícitamente. El runtime fija:

- objetivo y criterios de aceptación;
- tools expandidas y skills;
- workspace y recursos autorizados;
- proveedor/modelo y fallback;
- MCP leases;
- IDs de run, turno, tarea y grupo.

Las delegaciones hermanas pueden compartir un grupo. La respuesta inicial del coordinador finaliza y el gateway continúa los jobs. Al terminar todas, un turno de fan-in evalúa criterios de aceptación y checks, y sintetiza resultados, fallos y evidencia — o devuelve una tarea al worker con `task_revise` si no cumplió.

## Durabilidad

Runs y jobs tienen estados y leases. El scheduler renueva leases mientras hay trabajo; una caída permite recuperar elementos vencidos. Los reintentos usan backoff y jitter, pero las operaciones externas no idempotentes no deben repetirse sin una política explícita.

El cierre del gateway cancela o resuelve trabajos pendientes antes de terminar workers, canales y conexiones.

## Evidencia

Cada worker entrega un resultado estructurado. El proof packet asocia criterios con artefactos, readbacks y eventos. Para tareas efectuales, checks determinísticos (sin LLM) inspeccionan la evidencia — checkTool por criterio, inspección de artefactos, gates de entrega — y lo que no tiene check determinístico lo evalúa el coordinador con la evidencia adjunta. El coordinador solo comunica cumplimiento cuando el estado observado lo respalda.

## Contexto persistente

- Conversación: mensajes e historial por thread.
- Memoria: documentos explícitos administrados con `memory_*`.
- Notas: información breve guardada con `save_note` para sobrevivir compactación.
- Playbook: reglas ACE seleccionadas por relevancia.
- Skills: procedimientos cargados junto con las tools que describen.

Estas capas tienen propósitos distintos y no deben duplicarse indiscriminadamente en cada prompt.
