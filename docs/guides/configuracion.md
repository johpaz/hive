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

## Workspace

Cada agente puede tener un workspace y un scope de lectura/escritura. Las herramientas `fs_*` resuelven los paths contra ese scope. Los agentes de catálogo reciben scopes por tipo de trabajo: ninguno, workspace completo o recursos concretos como una superficie A2UI.

## Modelos

El onboarding asigna proveedor y modelo al coordinador y completa agentes sin configuración. Un agente puede definir un override por capacidades; si no lo tiene, hereda el modelo del coordinador. Los cambios explícitos hechos en la UI no son sobrescritos durante un arranque normal.
