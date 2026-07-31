# Referencia del CLI

Ejecuta `hive --help` o, desde el repositorio, `bun run hive --help`.

## Gateway

| Comando | Descripción |
|---|---|
| `hive start [--daemon]` | Inicia gateway y UI — abre el asistente de configuración en el navegador si es la primera vez |
| `hive dev` | Desarrollo con `.hive-dev` |
| `hive stop` | Detiene el gateway |
| `hive reload` | Recarga la configuración |
| `hive status` | Estado de gateway y agentes |
| `hive doctor` | Diagnóstico y reparación |
| `hive migrate` | Migra schema y datos existentes |
| `hive update` | Actualiza la instalación |
| `hive install-service` | Instala un servicio systemd |

## Conversación

| Comando | Descripción |
|---|---|
| `hive chat [--agent <id>]` | Chat interactivo en terminal |
| `hive agent run --message <texto> [--wait]` | Ejecuta un turno |
| `hive message send --to <id> --content <texto>` | Envía por un canal |
| `hive logs [--follow] [--level <nivel>]` | Consulta logs |
| `hive sessions list` | Lista sesiones |
| `hive sessions view <id>` | Muestra una transcripción |
| `hive sessions prune` | Poda sesiones inactivas |

## Agentes

```text
hive agents list [--bindings]
hive agents create
hive agents add <id>
hive agents remove <id>
hive agents logs <id>
hive agents hibernate <id>
hive agents wake <id>
hive agents terminate <id> [--cascade]
hive agents tree
```

Los 8 agentes del sistema usan `source: catalog`; no deben eliminarse como mecanismo de desinstalación. Deshabilítalos o ajusta su modelo desde la UI.

## Automatizaciones

```text
hive cron list [--status=<estado>] [--type=<tipo>]
hive cron add [opciones]
hive cron pause <id|nombre>
hive cron resume <id|nombre>
hive cron delete <id|nombre>
hive cron trigger <id|nombre>
hive cron history <id|nombre>
hive cron status
```

Para tareas recurrentes usa `--type recurring --cron "<expresión>"`; para una ejecución usa `--type one_shot --fire-at "<ISO-8601>"`. Indica siempre la zona horaria cuando la intención dependa de ella.

## MCP y skills

```text
hive mcp list
hive mcp add
hive mcp test <nombre>
hive mcp tools <nombre>
hive mcp remove <nombre>

hive skills list
hive skills search <consulta>
hive skills install <slug>
hive skills remove <nombre>
hive skills update
```

## Sistema

| Comando | Descripción |
|---|---|
| `hive config show` | Muestra la configuración efectiva con secretos redactados |
| `hive config edit` | Informa los mecanismos admitidos; edición manual deshabilitada |
| `hive causal watch [--agent <id>] [--stream <id>]` | Sigue eventos causales en vivo |
| `hive security audit` | Audita permisos y configuración |
| `hive --version` | Muestra la versión |
