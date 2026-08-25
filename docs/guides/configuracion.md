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
