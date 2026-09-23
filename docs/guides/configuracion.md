# Configuración

## Directorio de datos

Hive resuelve su directorio en este orden:

1. `HIVE_HOME`, si está definido.
2. `.hive-dev` dentro del directorio actual cuando `HIVE_DEV=true` o `1`.
3. `~/.hive`.

Dentro se almacenan `.env`, `.auth_token`, HiveDB, logs, workspace, credenciales de canales y artefactos. No copies este directorio a control de versiones.

## Variables principales

| Variable | Uso | Valor por defecto |
|---|---|---|
| `HIVE_HOME` | Directorio de datos | `~/.hive` |
| `HIVE_HOST` | Dirección del gateway | `127.0.0.1` |
| `HIVE_PORT` | Puerto HTTP/WebSocket | `18790` |
| `HIVE_AUTH_TOKEN` | Token Bearer y clave de recuperación | generado al arrancar |
| `HIVE_LOG_LEVEL` | `debug`, `info`, `warn` o `error` | `info` |
| `HIVE_PUBLIC_URL` | URL pública usada por integraciones | no definida |
| `HIVE_HARNESS_MAX_CONCURRENCY` | Concurrencia global | `4` |
| `HIVE_HARNESS_TASK_TIMEOUT_MS` | Límite de una tarea durable | 30 minutos |
| `HIVE_HARNESS_JOB_MAX_RETRIES` | Reintentos de jobs | `3` |

Las variables pueden colocarse en `HIVE_HOME/.env`, una por línea. Las variables ya presentes en el proceso tienen prioridad funcional cuando el runtime las consulta.

```dotenv
HIVE_HOST=127.0.0.1
HIVE_PORT=18790
HIVE_LOG_LEVEL=info
OPENAI_API_KEY=...
```

## Configuración persistente

Proveedores, modelos, agentes, bindings, canales, skills, MCP y reglas operativas se administran desde la UI y HiveDB. Para ver la configuración efectiva sin imprimir secretos:

```bash
hive config show
```

`hive config edit` está deshabilitado. Usa el onboarding, la UI, variables de entorno o las APIs administrativas.

El onboarding solicita un correo propio y lo guarda en el perfil del usuario. El coordinador lo usa como destinatario predeterminado cuando el usuario dice «envíame», «mándame» o «a mi correo» sin indicar otra dirección. Puede modificarse después desde **Configuración → Perfil**.

Guardar el correo no activa autenticación por contraseña. Si el usuario decide habilitarla más adelante, puede hacerlo desde **Configuración → Perfil → Acceso y seguridad**: Hive reutiliza ese mismo correo y solo solicita crear una contraseña.

Los especialistas MCP se crean desde la conversación únicamente después de la confirmación del usuario. La asignación queda visible en el loadout del agente y se reutiliza en tareas futuras. Cada especialista conserva un solo servidor; habilitarlo, deshabilitarlo o archivarlo sigue siendo una acción manual.

## Workspace

Cada agente puede tener un workspace y un scope de lectura/escritura. Las herramientas `fs_*` resuelven los paths contra ese scope. Los agentes de catálogo reciben scopes por tipo de trabajo: ninguno, workspace completo o recursos concretos como una superficie A2UI.

## Modelos

El onboarding asigna proveedor y modelo al coordinador y completa agentes sin configuración. Un agente puede definir un override por capacidades; si no lo tiene, hereda el modelo del coordinador. Los cambios explícitos hechos en la UI no son sobrescritos durante un arranque normal.

### Decisiones con Jev

Al guardar una API key en **Proveedores → OpenRouter**, Hive activa OpenRouter y Jev inmediatamente. Jev usa la API Decisions de OpenRouter para escoger qué historial, herramientas, skills, notas y reglas incluir en el contexto; también recomienda especialistas y decide si los lotes de herramientas independientes pueden ejecutarse en paralelo. El modelo de texto sigue redactando respuestas, argumentos de herramientas y tareas delegadas.

Jev decide sobre un mapa del enjambre que recibe en cada turno: todos los especialistas habilitados (los del catálogo y los creados con `agent_create`), con sus herramientas y sus servidores MCP, y el estado de cada servidor: `activo` (conectado), `disponible` (encendido, se conecta en el primer uso) o `apagado`. Solo propone herramientas MCP de servidores encendidos, conectados y permitidos para ese agente. Si el especialista indicado para una tarea depende de un MCP apagado, el coordinador no delega: le pide al usuario que lo encienda en **Ajustes → Entorno → MCP Servers** y continúa cuando quede conectado. Ningún agente puede encender un MCP por su cuenta, porque hacerlo arranca procesos y usa credenciales.

Cada decisión añade entre 0,3 y 0,6 segundos: una al preparar el turno y otra antes de cada llamada al modelo cuando hay resultados de herramientas que valga la pena omitir. Con varios especialistas arrancando a la vez, alguna decisión puede pasar de los tres segundos; ese agente usa el flujo clásico en ese turno y los demás no se ven afectados.

Antes de configurar la clave, revisa qué datos de la conversación viajan a OpenRouter en [Seguridad](seguridad.md#datos-enviados-a-jev).

La tarjeta de OpenRouter muestra `activo`, `desactivado` o `usando flujo clásico`. Al quitar la clave o desactivar OpenRouter, Hive vuelve al compilador y al loop anteriores. También vuelve temporalmente a ese flujo si Jev tarda más de tres segundos, falla o devuelve una respuesta inválida. Las notas y mensajes omitidos se pueden recuperar mediante `conversation_read`, limitado al hilo actual.

Una clave en `OPENROUTER_API_KEY` puede sustituir a la clave guardada, siempre que OpenRouter esté activo. La clave se envía solo al endpoint de decisiones; Jev no aparece como modelo de texto seleccionable para los agentes, ni en la UI ni en `get_available_models`. Los registros de uso incluyen sus tokens y latencia. El ahorro real depende del historial y de las herramientas de cada tarea, por lo que debe medirse en ejecuciones comparables con y sin la clave.

El panel **Uso y Costos de API** del dashboard muestra, para el período elegido (6 h, 24 h o 7 días), las decisiones de Jev, su costo, los tokens de entrada que evitó al modelo principal y el ahorro neto, con un desglose por agente. En la **Oficina 3D**, Jev aparece como un cristal violeta sobre el coordinador que lanza un rayo al agente que asesora en cada decisión. Los tokens ahorrados son una estimación: se comparan los caracteres que habría enviado el flujo clásico con los del plan de Jev y se dividen entre 4. El valor en dólares usa la tarifa de entrada del modelo de cada agente; un modelo sin tarifa en el catálogo cuenta su ahorro como $0.

Las tarifas viven en el catálogo de modelos (`packages/core/src/storage/seed.ts`) y el arranque las vuelve a sembrar. Gemini 3.8 Flash tiene precio de lanzamiento hasta el 31 de diciembre de 2026 (USD 0,75 de entrada y 3,75 de salida por millón de tokens) y pasa a 1,50 y 7,50 desde el 1 de enero de 2027: ese día hay que actualizar el catálogo o el dashboard mostrará la mitad del costo real.

### Ventana de contexto con Ollama

Ollama lee solo `num_ctx` tokens de cada petición y descarta el resto sin avisar. Hive presupuesta el contexto con la ventana que de verdad envía: la menor entre la ventana del modelo y `num_ctx`. Si no configuras `num_ctx` en **Providers → Ollama**, Hive usa 16.384 tokens, o la ventana del modelo si es menor. Un valor más alto da más contexto a cambio de más RAM y respuestas más lentas; uno más bajo acelera modelos pequeños, pero por debajo de unos 8.000 tokens no caben las instrucciones y herramientas del coordinador junto con la conversación.

Cuando el historial no cabe, el compilador descarta primero los mensajes más antiguos. Siempre conserva los dos últimos intercambios, el historial empieza en un mensaje del usuario y el mensaje actual, si es enorme, se recorta por el medio para conservar su inicio y su final. La compactación automática usa la misma ventana: resume la conversación cuando supera la cuarta parte.

### Razonamiento visible

Cada turno pide razonamiento y cada proveedor decide cómo cumplirlo: Anthropic con extended thinking, Gemini y Ollama con sus propios campos, y los compatibles con OpenAI leyendo `reasoning_content` del stream.

NVIDIA NIM es el caso especial: lo mantiene apagado salvo que se lo pidan por `chat_template_kwargs`, con una clave distinta por familia de modelo — `enable_thinking` para GLM, `thinking_mode` para MiniMax, `thinking` para Kimi y DeepSeek. Nemotron 3 razona sin pedírselo. Si un modelo rechaza esa clave, la llamada se repite sin ella: se pierde el razonamiento en pantalla, nunca el turno.

## Audio de HiveLive

La entrada y la salida se eligen en el panel de sonido de la consola de voz, y también en Ajustes → Pantalla y audio. La lista la reporta el sistema operativo: en Linux son los puertos de tarjeta, los mismos que enseña el menú de sonido del escritorio, así que un altavoz USB o un HDMI que hoy no está activo también aparece — al elegirlo se activa su perfil.

### Manos libres

Con la voz saliendo por un altavoz abierto —un televisor, unos bafles— el micrófono recoge a la colmena y el detector de voz del modelo lo toma por una interrupción: se contesta a sí misma. En el navegador no pasa porque Chrome cancela su propia salida dentro del micrófono; el motor de la app de escritorio en Linux no puede hacerlo, porque su cancelador necesita una referencia de la reproducción que WebAudio no le entrega.

Por eso existe el modo altavoz, que se enciende solo al elegir una salida al aire: mientras la colmena habla no se le envía micrófono, y su detector se vuelve más exigente para darse por interrumpido. El precio es que en ese rato no se la puede cortar hablando encima; el botón del micrófono sí la corta. Con auriculares no hace falta y se apaga solo.

### Full-duplex real por altavoz

Quien quiera interrumpir hablando encima con el sonido saliendo por un altavoz necesita cancelación de eco del sistema, no de la aplicación. PipeWire la trae en `module-echo-cancel`: crea un micrófono virtual ya cancelado que HiveLive listará como uno más.

```ini
# ~/.config/pipewire/pipewire.conf.d/99-echo-cancel.conf
context.modules = [
  { name = libpipewire-module-echo-cancel
    args = {
      capture.props  = { node.name = "efecto_entrada.eco"  }
      source.props   = { node.name = "eco_cancelado"       }
    }
  }
]
```

Después de `systemctl --user restart pipewire`, se elige «eco_cancelado» como micrófono y se apaga el modo altavoz. Hive no toca esa configuración: es del sistema y afecta a todas las aplicaciones.
