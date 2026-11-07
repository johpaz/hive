# Runtime de agentes

## Inicio de un turno

El servicio carga al coordinador, historial reciente, notas, playbook y una carga mínima de ocho herramientas. El compilador de contexto aplica presupuestos y evita incluir catálogos completos.

El presupuesto se calcula con la ventana que el proveedor realmente lee (`resolveProviderConfig`): la del modelo o, con Ollama, la menor entre esa y `num_ctx`. Si el historial no cabe, se descartan primero los mensajes más antiguos; los dos últimos intercambios siempre se conservan. La compactación automática usa la misma ventana.

### Compactación y memoria del historial

El diseño sigue «You don't need long context» (arXiv 2611.05306, https://arxiv.org/abs/2611.05306): mantener el contexto corto compactando con frecuencia, pasar un estado explícito de un tramo al siguiente y leer el historial de forma selectiva.

- **Traspaso de seis campos.** Al superar el umbral (por defecto, la cuarta parte de la ventana), el hilo se compacta en un JSON con objetivo, hechos establecidos con sus valores exactos, cambios aplicados, verificación, callejones sin salida y plan restante. Se guarda en `SummaryDoc.structured`; `summary` conserva el texto renderizado. Cada compactación incorpora el traspaso anterior y lee solo lo posterior, de modo que un dato sobrevive a varias compactaciones.
- **Historial recuperable.** Los mensajes compactados se indexan en HiveDB (BM25 + vectores). `conversation_read` con `query` busca por significado en todo el historial; con `message_ids` o `note_keys` lee lo omitido por id.
- **Entre hilos** (opt-in, `memory.crossThreadRecall`): se inyectan los resúmenes de otros hilos más parecidos al objetivo y, si el HiveDB lo soporta (`embedQuery`), los episodios parecidos vía `episodicSimilarity` de `buildAgentContext`.

### Línea de tiempo del historial (experimental, opt-in)

Lo que queda **fuera de la ventana** (los últimos 15 mensajes) llega al modelo por tres vías: el resumen de compactación, una
recuperación por búsqueda de 3 mensajes × 500 caracteres y la herramienta `conversation_read`. Con
`HIVE_HISTORY_TIMELINE=true` se añaden dos piezas, ambas **sin llamar a un modelo**:

| Pieza | Qué inyecta | Presupuesto |
|---|---|---|
| Línea de tiempo | Bloque `# LÍNEA DE TIEMPO DE LA CONVERSACIÓN`: una línea `#id [rol] primeros 80 caracteres` por mensaje fuera de ventana (en los del asistente, además `→ tools: nombres`). Si no caben todas, conserva la primera y la última y reparte el resto con paso fijo. | 3 % de la ventana del modelo (entre 300 y 2 000 tokens) |
| Recuperación adaptativa | Reemplaza el 3 × 500 fijo: pide 20 candidatos a la búsqueda híbrida y los empaqueta de mayor a menor relevancia hasta llenar el presupuesto (hasta 1 200 caracteres por mensaje); el que no cabe se **salta**, no corta a los siguientes. | 4 % de la ventana (entre 300 y 3 000 tokens) |

**Qué no hace.** Nunca copia el contenido de mensajes `tool` ni los argumentos de las tools a la línea de tiempo (pueden llevar
credenciales). No toca la compactación por LLM, que sigue igual. Con el flag apagado el prompt es idéntico al de antes.

**Configuración.**

| Variable | Efecto | Por defecto |
|---|---|---|
| `HIVE_HISTORY_TIMELINE` | Enciende la función (`memory.historyTimeline.enabled`) | apagada |
| `HIVE_HISTORY_TIMELINE_MIN_WINDOW` | Ventana mínima (tokens) para que actúe; por debajo se ignora el flag y queda una línea en el log. `0` quita la compuerta | `16000` (provisional, sin respaldo firme) |
| `HIVE_HISTORY_TIMELINE_PARTS` | `both`, `timeline` o `recall`: activa solo una pieza. Es para medir por separado qué aporta cada una | `both` |

**Respaldo.** La idea sale de *FlexA-Mem: Budget-Adaptive Agentic Memory for LLM Agents* (Xu et al., arXiv
[2610.33274](https://arxiv.org/abs/2610.33274), octubre de 2026): guardar cada unidad de historia una sola vez y **renderizar en cada llamada** una
línea de tiempo compacta más el detalle que quepa en el presupuesto restante, con una regla fija y sin llamar a un modelo al renderizar. Según los autores,
con presupuesto de 4 000 tokens supera al segundo mejor método en 11,5 puntos en AppWorld (40,3 frente a 28,8), y en LongMemEval su recuperación por
trozos (78,0) iguala a un recuperador por palabras clave sin memoria escrita (78,4); en sus ablaciones, quitar la línea de tiempo cuesta 15,5 puntos en
AppWorld y quitar la recuperación cuesta 28,2 en LongMemEval. Esas cifras son suyas: **no las hemos reproducido**.

Lo que tomamos y lo que no:

| FlexA-Mem | Aquí |
|---|---|
| Almacén inmutable, una escritura por unidad | Ya existía: cada mensaje se guarda una vez y se indexa en HiveDB |
| Registro de 80 palabras por unidad, escrito por un LLM | **No**: la línea es el recorte de los primeros 80 caracteres del mensaje |
| Fusión de registros viejos con un LLM | **No**: muestreo fijo (primero, último y paso constante) |
| Trozos de 150 tokens ordenados por BM25, con degradación de resolución | **No**: mensajes completos (recortados a 1 200 caracteres desde el principio) de la búsqueda híbrida |
| Presupuesto = lo que queda tras el prompt y la ventana reciente (30 % o 50 % a la línea de tiempo) | **Distinto**: porcentaje fijo de la ventana del modelo, porque el prompt aún no está armado cuando se calcula |
| Unidades de pasos de agente con grafo | **No**: aquí solo conversación. El log causal es por ejecución y sus `ToolCall` no guardan argumentos ni resultado |

**Evidencia propia** (metodología, límites y datos crudos en [`bench/history-timeline/README.md`](../../bench/history-timeline/README.md)). En `hive` solo se repitió el banco sin modelo (mismas retenciones que en el SDK); la prueba con modelo se hizo en `hive-sdk` y **no se ha repetido sobre el código de `hive`**.

1. **Sin modelo, exacta** (27 datos plantados fuera de la ventana, 3 semillas; porcentaje que llega al prompt). Se miden las piezas por separado con `HIVE_HISTORY_TIMELINE_PARTS`:

| Consulta | Ventana | Actual | Solo recuperación | Solo línea | Ambas |
|---|---:|---:|---:|---:|---:|
| Con palabras del dato | cualquiera | 100 % | 100 % | 100 % | 100 % |
| Vaga (sin palabras del dato) | 8 000 | 0 % | 0 % | 7 % | 7 % |
| Vaga | 32 000 | 0 % | 0 % | 56 % | 56 % |
| Vaga | 128 000 | 0 % | 0 % | 85 % | 85 % |
| Pide todo a la vez | 8 000 | 33 % | 81 % | 33 % | 81 % |
| Pide todo a la vez | 32 000 | 33 % | 100 % | 74 % | 100 % |
| Pide todo a la vez | 128 000 | 33 % | 100 % | 85 % | 100 % |

   Las dos piezas se complementan: la **línea de tiempo** es la única que ayuda con una consulta vaga, y la **recuperación adaptativa** explica casi toda la mejora cuando se pide todo a la vez (el modo actual recupera siempre 3 mensajes, así que ese control no escala con el presupuesto). Con una consulta que comparte palabras con el dato no hay diferencia, como en el paper. Costo: de ~300 a ~7 500 caracteres más de prompt, según la pieza y la ventana.

2. **Con modelo** (Gemini 3.8 Flash, `conversation_read` disponible, ventana de 16 000, preguntas con otras palabras, 18 por celda, 2 semillas):

| Modo | Dato en el contexto | Respondió bien (corrida 2) |
|---|---:|---:|
| Actual | 6/18 | 11/18 |
| Solo recuperación | 6/18 | 10/18 |
| Solo línea | 12/18 | 12/18 |
| Ambas | 12/18 | 14/18 |

   «Dato en el contexto» es determinista y repite el resultado exacto de arriba. **«Respondió bien» no es concluyente:** la misma configuración «Actual» dio 8/18 en una corrida anterior y 11/18 en esta (mismo código, temperatura 0), así que el ruido entre corridas es de unos 3 casos, del tamaño de las diferencias que se miden. Que la función haga contestar mejor al agente **no está demostrado**; lo que sí se ve es que pone más datos en el contexto cuando la pregunta no repite las palabras del dato.

El umbral de 16 000 y la compuerta son por tanto una suposición razonable, no un resultado: los datos no muestran daño a 8 000 que no sea ruido. La función sigue apagada por defecto.

La ventaja de tener esto sobre HiveDB es que el estado, el historial indexado y la búsqueda híbrida viven en una sola base local, sin servicio de vectores aparte ni llamadas extra para recuperar. El modo de una acción por contexto del paper existe en `@johpaz/hive-sdk` pero no en Hive.

Con una clave de OpenRouter activa, Jev selecciona antes de cada turno qué historial, herramientas, skills, notas y reglas entran al prompt, sobre un mapa de los especialistas y del estado de cada servidor MCP. Entre iteraciones puede omitir resultados viejos de herramientas. Si Jev no responde en tres segundos o falla, el turno sigue con la selección clásica. El detalle está en [Jev](../internals/jev.md).

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

### Agentes de código externos

El especialista `external_code_agent` delega a Claude Code, Codex, OpenCode o Kimi con `code_agent_run`. Cada CLI corre sin supervisión en un `git worktree` temporal creado desde HEAD (no ve cambios sin commitear) y nunca modifica el workspace: la herramienta devuelve resumen, archivos cambiados, diff y un `patch_path`. El criterio `diff_checks` se verifica sin LLM: la entrega debe apuntar a un patch existente y no vacío. Si el CLI no está instalado o su sesión/saldo caducó, la herramienta lo informa y el especialista prueba otro.

### Navegador: Obscura y Chrome

Hay dos juegos de herramientas de navegador. `obscura_*` (37) maneja el binario [Obscura](https://obscura.sh) como servidor MCP por stdio: headless, sin Chromium, con una sesión viva y refs de elementos (`e3`) en `obscura_snapshot`, además de markdown, enlaces, formularios completos en una llamada, cookies, estado de sesión, pestañas y PDF. El binario se busca en `OBSCURA_PATH`, el PATH, `~/.hive/bin` y `~/.hivecode/bin`; sin él, las herramientas responden con un error de instalación. `browser_*` usa `Bun.WebView` sobre Chrome y queda para capturas, verificación visual y `computer_use_task`. Obscura bloquea localhost y redes privadas por defecto (`OBSCURA_ALLOW_PRIVATE_NETWORK=1` lo permite). La skill `obscura_browser` explica cuándo usar cada uno.

## Durabilidad

Runs y jobs tienen estados y leases. La cola ejecuta un solo job a la vez por lane; en el web chat, el lane es la conversación. Un mensaje nuevo, una acción del Panel interactivo o el resumen de una delegación que llegan mientras otro turno de la misma conversación sigue en curso esperan a que termine, en lugar de correr en paralelo y duplicar trabajo. Los pedidos que BIA le pasa a Bee desde HiveLive usan el mismo lane que el chat escrito de esa conversación, así que voz y texto también se ordenan entre sí, y la sesión de voz sigue ese lane para narrar el resultado de lo delegado. El scheduler renueva leases mientras hay trabajo; una caída permite recuperar elementos vencidos. Los reintentos usan backoff y jitter, pero las operaciones externas no idempotentes no deben repetirse sin una política explícita.

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
