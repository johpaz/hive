# Hive 1.0

Hive es un runtime local-first para coordinar agentes de IA desde una interfaz web, la terminal o canales de mensajería. Combina un coordinador con agentes de catálogo, herramientas nativas, skills, servidores MCP y ejecución durable.

La versión 1.0 reemplaza el antiguo modelo de especialistas y proyectos DAG por agentes persistentes de catálogo, descubrimiento dinámico de capacidades, delegación paralela y verificación independiente.

## Capacidades

- Agentes de catálogo para investigación, navegación, archivos, software, Office, A2UI, agenda, APIs, MCP y verificación.
- Herramientas nativas para filesystem, web, cron, CLI, agentes, A2UI, Office y APIs.
- 25 skills incluidas y descubrimiento bajo demanda con `search_knowledge`.
- Proveedores locales y remotos, selección de modelo por agente y herencia desde el coordinador.
- Webchat, Telegram, Discord, Slack y WhatsApp.
- MCP con sincronización de herramientas, hot reload y leases por ejecución.
- Tareas durables, reintentos, proof packets, artefactos verificables y observabilidad causal.
- Panel interactivo basado en A2UI v0.9, reuniones y centro de mando Office3D.

La experiencia visual se divide en dos superficies sin solapamientos:

- `/office`: Oficina 3D para observar agentes, delegaciones y actividad.
- `/a2ui`: Panel interactivo para formularios, dashboards, confirmaciones y
  resultados generados por agentes.

El Canvas clásico y su ruta `/canvas` fueron retirados.

El [inventario generado](docs/reference/inventario.md) contiene la lista exacta de herramientas, skills, agentes, versiones y exports públicos.

## Inicio rápido

Requisitos para desarrollar desde el repositorio:

- Bun 1.3.x
- Git

```bash
git clone https://github.com/johpaz/hive.git
cd hive
bun install
bun run hive onboard
bun run hive start
```

El gateway escucha por defecto en `127.0.0.1:18790`. El onboarding crea la configuración, registra el modelo principal y abre la interfaz web.

Instalación global:

```bash
bun add --global @johpaz/hive-agents@1.0.0
hive onboard
hive start
```

Docker:

```bash
docker run --name hive \
  -p 18790:18790 \
  -v hive-data:/root/.hive \
  -e HIVE_HOST=0.0.0.0 \
  johpaz/hive:1.0.0
```

Consulta la [guía de instalación](docs/guides/instalacion.md) para binarios, actualización y migración.

## Comandos esenciales

```bash
hive onboard
hive start
hive status
hive chat
hive agents list
hive doctor
hive stop
```

La [referencia del CLI](docs/reference/cli.md) describe todos los comandos disponibles.

## Cómo funciona

Cada turno comienza con siete herramientas esenciales. El coordinador busca capacidades adicionales en HiveDB, selecciona un agente adecuado y delega una subtarea con criterios de aceptación. El agente recibe únicamente sus herramientas, skills, modelo, workspace y recursos autorizados. Las tareas efectuales pueden pasar por un verificador independiente antes de que el coordinador sintetice la respuesta.

```text
Usuario/canal
      │
      ▼
Gateway ──► coordinador ──► descubrimiento
                         ├─► agentes de catálogo
                         ├─► herramientas / MCP
                         └─► verificación y proof packet
                                      │
                                      ▼
                             HiveDB + artefactos
```

Lee la [arquitectura](docs/architecture/overview.md) y el [ciclo de ejecución](docs/architecture/runtime.md) para más detalle.

## Configuración y seguridad

Los datos viven en `~/.hive` o en el directorio indicado por `HIVE_HOME`. Los secretos se cargan desde variables de entorno o `HIVE_HOME/.env`; no deben almacenarse en el repositorio.

Hive genera un token al primer arranque y lo guarda con permisos restringidos en `HIVE_HOME/.auth_token`. Toda API protegida acepta `Authorization: Bearer <token>`. La UI también puede habilitar credenciales de correo y contraseña.

- [Configuración](docs/guides/configuracion.md)
- [Seguridad](docs/guides/seguridad.md)
- [Canales](docs/guides/canales.md)
- [MCP](docs/reference/mcp.md)

## Desarrollo

```bash
bun run lint
bun run test
bun run test:ui
bun run docs:check
bun run build
```

Antes de enviar cambios consulta [CONTRIBUTING.md](CONTRIBUTING.md). La documentación completa está indexada en [docs/README.md](docs/README.md).

## Migración a 1.0

Haz una copia de `HIVE_HOME`, instala 1.0.0 y ejecuta:

```bash
hive migrate
hive doctor
```

Los agentes de catálogo se reconcilian al arrancar. Los datos de usuario se conservan, mientras que las capacidades retiradas dejan de sembrarse. Revisa las incompatibilidades y equivalencias en [CHANGELOG_v1.0.0.md](CHANGELOG_v1.0.0.md).

## Licencia

[MIT](LICENSE)
