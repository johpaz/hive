# Changelog — Hive 1.1.0

Fecha: 2026-09-23

Hive 1.1.0 presenta **Jev**, un plano de decisión opcional que elige qué contexto recibe el modelo principal en cada turno para gastar menos tokens, y lo hace visible en el dashboard y en la Oficina 3D. La versión también trae varias conversaciones por canal, un motor de cron propio y un conjunto de correcciones de estabilidad en el web chat, el Panel interactivo, la cola de trabajos y el uso de modelos locales con Ollama.

## Añadido

- **Jev, el plano de decisión** (opcional, requiere una clave de OpenRouter):
  - Antes de cada turno elige qué historial, herramientas, skills, notas y reglas entran al prompt. Entre iteraciones puede omitir resultados viejos de herramientas y decide si un lote de lecturas independientes puede ejecutarse en paralelo.
  - Decide sobre un mapa del enjambre: los especialistas del catálogo y los creados con `agent_create`, sus herramientas y el estado de cada servidor MCP (`activo`, `disponible` o `apagado`).
  - Si el especialista indicado depende de un MCP apagado, el coordinador no delega: le pide al usuario que lo encienda en **Ajustes → Entorno → MCP Servers**.
  - Se activa al guardar la clave en **Providers → OpenRouter** y se apaga al quitarla. Si Jev tarda más de tres segundos, falla o responde algo inválido, el turno continúa con la selección clásica.
  - Nueva herramienta `conversation_read` para recuperar mensajes y notas que Jev dejó fuera del prompt, limitada a la conversación actual.
- **Jev en el dashboard**: el panel **Uso y Costos de API** muestra, por período, las decisiones de Jev, su costo, los tokens de entrada que evitó al modelo principal, el ahorro neto y el desglose por agente.
- **Jev en la Oficina 3D**: un cristal violeta sobre el coordinador lanza un rayo al agente que asesora en cada decisión, con el ahorro y la latencia. Incluye panel de métricas, insignia en la barra superior, fila en el inspector de cada agente y entradas en la cinta de eventos.
- **Varias conversaciones por canal**: el web chat permite crear, renombrar y borrar conversaciones, y cada canal y contacto conserva su propio hilo. En la web, `/new` abre una conversación nueva; en Telegram, `/new` ahora reinicia de verdad el contexto de ese chat.
- **HiveLive recuerda la conversación**: al iniciar una llamada, BIA recibe el historial reciente del hilo en lugar de empezar en blanco.
- **BIA ve lo que hace el enjambre**: al consultar el estado de la colmena, BIA recibe qué hace Bee, qué especialista tiene cada tarea y con qué herramienta, qué terminó hace poco con su resultado o error, y los últimos pasos de la conversación. Antes solo recibía el nombre de las tareas y el resultado final de Bee.
- **BIA aprovecha Jev**: la sesión de voz no cambia, pero cada pedido que BIA le pasa a Bee es un turno normal del coordinador, así que el trabajo que dispara la voz recibe la misma selección de contexto, el mismo mapa de especialistas y el mismo ahorro que el chat escrito.
- **MCP por Streamable HTTP**: Hive se conecta a servidores MCP remotos modernos (un único endpoint, normalmente `/mcp`), con cabeceras de autorización y reanudación de sesión.
- **Skill `artifact_reader`** para leer resultados grandes guardados como artefactos.
- **Tarifa de Gemini 3.8 Flash** en el catálogo, para que su costo y el ahorro de Jev ya no aparezcan en $0.

## Cambiado

- **Ollama usa la ventana de contexto que realmente lee.** `num_ctx` pasa de 4.096 a 16.384 tokens por defecto (o la ventana del modelo, si es menor), y el compilador de contexto y la compactación presupuestan con ese mismo valor. Cuando el historial no cabe, se descartan primero los mensajes más antiguos y siempre se conservan los dos últimos intercambios. Se puede ajustar en **Providers → Ollama**.
- **HiveLive usa Gemini 3.8 Live**, la versión estable que Google recomienda en lugar de Gemini 3.1 Flash Live (preview), al mismo precio. Las instalaciones existentes cambian solas al actualizar.
- **Motor de cron propio**, sin dependencias externas: reemplaza a `croner` e interpreta expresiones y zonas horarias con el runtime de Bun.
- **HiveDB 0.5.1**.
- La interfaz se compila con **React Compiler**.
- Hive requiere **Bun 1.4.2** o superior.
- Las skills incluidas y los prompts del catálogo usan español neutro.
- El web chat entrega cada respuesta a todas las ventanas abiertas de la misma sesión (por ejemplo, la app de escritorio y una pestaña del navegador).
- El uso de los modelos se registra por cada llamada, con su latencia, en lugar de una vez por turno.
- `get_available_models` ya no ofrece modelos de decisión como modelos de texto para los agentes.

## Corregido

- **Respuestas perdidas y "pensando" permanente en el web chat.** El canal guardaba un solo socket por sesión: tras reiniciar el gateway, las reconexiones que se solapaban dejaban la sesión sin registrar y se perdían las respuestas, las narraciones y el fin del turno. Ahora conserva todos los sockets, y la interfaz vuelve a leer el historial al reconectarse.
- **El Panel interactivo congelaba y cerraba la pestaña** cuando un agente creaba un componente que se contenía a sí mismo. `a2ui_update_components` rechaza ahora los ciclos con un error que el agente puede corregir, y el panel muestra un aviso en lugar de repetir el componente sin fin.
- **Dos turnos de la misma conversación podían ejecutarse en paralelo** (por ejemplo, una acción del Panel interactivo mientras el coordinador resumía una delegación), y ambos volvían a delegar el trabajo completo. La cola ejecuta ahora un solo trabajo a la vez por conversación.
- **BIA no narraba el resultado de lo que delegaba y podía chocar con el chat escrito.** Los pedidos de voz se encolaban en la sesión del usuario, mientras Bee trabajaba en la conversación y el resultado de lo delegado volvía a la conversación. Además, un pedido de voz y un mensaje escrito del mismo hilo podían ejecutarse a la vez, y el pedido de voz podía caer en la conversación más reciente en lugar de la abierta en la consola. Ahora voz y texto comparten la cola de la conversación: BIA sigue, narra y cancela el trabajo en el hilo correcto.
- **Detener un turno no liberaba la conversación.** Al pulsar ■, el turno se marcaba como cancelado, pero el siguiente mensaje seguía esperando hasta que el modelo terminara lo que estaba generando. Ahora la conversación queda libre en el momento de cancelar.
- **La compactación podía bloquear un turno por minutos** con modelos locales en CPU, y no se podía cancelar. Ahora se detiene al cancelar el turno y tiene un límite de 60 segundos; si lo supera, el turno sigue sin compactar y el historial se recorta a la ventana del modelo.
- **Los proveedores compatibles con OpenAI no reportaban tokens en streaming.** Hive no pedía el uso al proveedor y además descartaba el último fragmento del stream, que es donde llega. Por eso las llamadas a NVIDIA, entre otros, quedaban registradas con 0 tokens y su costo no aparecía en el dashboard. Si un servidor no acepta la petición de uso, Hive la repite sin ella.
- **Ollama recortaba el prompt sin avisar**: Hive armaba contextos de más de 20.000 tokens y el modelo solo leía los primeros 4.096.
- Una clave borrada podía seguir activa en memoria hasta reiniciar si una lectura coincidía con el borrado.
- El replay del Panel interactivo podía mostrar una superficie distinta a la que se estaba viendo, porque reemplazaba los componentes en lugar de combinarlos.
- Gemini descartaba un mensaje cuando el historial seleccionado empezaba con una respuesta del asistente.
- La sesión del navegador integrado comprueba que las cookies realmente quedaron puestas y reintenta; antes el agente podía navegar sin sesión sin que nada fallara.
- OpenCode Go recibe el identificador de sesión que exige; NVIDIA explica cuando un modelo existe pero no está habilitado para la cuenta, en lugar de darlo por retirado.

## Notas de Jev

- **Privacidad**: mientras Jev está activo, Hive envía a OpenRouter extractos de la conversación (el objetivo del turno, fragmentos de mensajes recientes, resultados de herramientas, notas y reglas) junto con nombres y descripciones de herramientas y especialistas. No envía claves ni archivos completos. El detalle y los límites están en [Seguridad](docs/guides/seguridad.md#datos-enviados-a-jev).
- **Ahorro estimado**: los tokens ahorrados se calculan comparando los caracteres que habría enviado el flujo clásico con los del plan de Jev, divididos entre 4. El valor en dólares usa la tarifa de entrada del modelo de cada agente.
- **Latencia**: cada decisión añade entre 0,3 y 0,6 segundos.
- **Sin clave, sin cambios**: si no se configura OpenRouter, Hive funciona exactamente como antes.
- **Precio de Gemini 3.8 Flash**: el precio de lanzamiento (USD 0,75 de entrada y 3,75 de salida por millón de tokens) rige hasta el 31 de diciembre de 2026; desde el 1 de enero de 2027 pasa a 1,50 y 7,50, y el catálogo deberá actualizarse.

## Compatibilidad

- Actualización compatible con las instalaciones 1.0.x existentes, sin migraciones manuales. Los datos nuevos (decisiones de Jev, tarifas) se crean al arrancar; el uso registrado antes de la actualización conserva su costo original.
- Con Ollama y sin `num_ctx` configurado, los modelos locales usan más memoria que antes (16.384 tokens de contexto en lugar de 4.096). En equipos con poca RAM puede bajarse desde **Providers → Ollama**.
- La aplicación de escritorio y la imagen de Docker no cambian su instalación. Jev solo necesita salida HTTPS hacia `openrouter.ai`; en Docker, la clave guardada desde la interfaz persiste en el volumen de datos.
- Las superficies del Panel interactivo viven en la memoria del gateway y se pierden al reiniciarlo, igual que en versiones anteriores.
- `hive-sdk` y `hive-cloud` no incluyen Jev en esta versión.
