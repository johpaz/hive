# Changelog — Hive 1.1.1

Fecha: 2026-10-20

Hive 1.1.1 guarda la llave maestra de los secretos en el llavero del sistema operativo en lugar de un archivo en disco. También suma agentes de código externos (Claude Code, Codex, OpenCode y Kimi) y un segundo navegador headless, Obscura, y deja que Jev tenga un oráculo alterno, Kev. Corrige además la detección de Chrome para el navegador integrado.

## Añadido

- **Agentes de código externos**: nuevo especialista `external_code_agent` y herramienta `code_agent_run`, que delegan una tarea de programación a Claude Code, Codex, OpenCode o Kimi.
  - Cada CLI corre sin supervisión en un `git worktree` temporal creado desde HEAD, así que no ve cambios sin commitear y nunca modifica el workspace. La herramienta devuelve el resumen, los archivos cambiados, el diff y un archivo `.patch` para revisar y aplicar.
  - A los CLI externos solo llegan las claves de su propio proveedor: el resto de variables de entorno con `TOKEN`, `SECRET`, `PASSWORD` o `KEY` se descarta.
  - La aceptación de la entrega exige un patch existente y no vacío; una entrega que dice haber terminado sin un diff real se rechaza.
  - Nueva skill `external_code_agent`. Si un CLI no está instalado o falla por autenticación o crédito, el agente prueba con otro.
- **Obscura, navegador headless**: 37 herramientas `obscura_*` que manejan el binario [Obscura](https://obscura.sh) como servidor MCP por stdio, sin Chromium y con una sesión viva.
  - Los elementos se referencian por ref (`e3`), que entregan `obscura_snapshot` y `obscura_interactive_elements`, en lugar de selectores frágiles.
  - Incluye lectura en Markdown, enlaces, detección y llenado de formularios, extracción estructurada, pestañas, cookies, estado de sesión, PDF y captura de pantalla.
  - Habla MCP 2.0 (`server/discover`) y vuelve al `initialize` clásico si el servidor aún no lo soporta. Si el proceso muere, la siguiente llamada lo relanza.
  - El binario se busca en `OBSCURA_PATH`, en el `PATH` y en `~/.hive/bin/` (después `~/.hivecode/bin/`). Se ajusta con `OBSCURA_STEALTH`, `OBSCURA_PROXY`, `OBSCURA_USER_AGENT` y `OBSCURA_ALLOW_PRIVATE_NETWORK`.
  - Nueva skill `obscura_browser`. El operador de navegador usa Obscura para leer, extraer datos y llenar formularios, y deja Chrome (`browser_*`) para lo visual.
- **Kev, oráculo alterno de Jev**: si el proveedor **HiveAgents LLM** está activo con su clave y su host responde `ready` en `GET /api/decisions/status`, las decisiones van primero a `POST /v1/systemone` de `llm.hiveagents.io`. Si Kev falla, Jev sigue con OpenRouter y, si tampoco responde, el turno usa la selección clásica.
  - El dashboard y la Oficina 3D muestran el nombre del oráculo que está decidiendo (Kev o Jev). Las decisiones de Kev se registran con costo $0.
  - Se activa y desactiva desde **Providers → HiveAgents LLM**.
- **Documentación de Jev** en [`docs/internals/jev.md`](docs/internals/jev.md), con una guía para agentes de código externos y para Obscura en la referencia.

## Cambiado

- **La llave maestra va al llavero del sistema operativo** (libsecret en Linux, Keychain en macOS, Credential Manager en Windows). Se resuelve en este orden:
  1. `HIVE_MASTER_KEY`, si está definida.
  2. El llavero del SO. Un `~/.hive/.master.key` de una versión anterior se mueve ahí al primer arranque, y el archivo se borra solo después de leer la llave de vuelta del llavero y comprobar que es idéntica.
  3. `~/.hive/.master.key` (0600), solo donde no hay llavero (Linux sin libsecret/D-Bus, Docker).
- La entrada del llavero lleva un hash del directorio de datos (`master-key:<hash de HIVE_HOME>`), así una segunda instancia o un perfil distinto nunca adopta la llave de otra.
- `ensureSecretsBackend()` es ahora asíncrono y reporta de dónde salió la llave (`env`, `keychain`, `file` o `none`).
- **HiveDB 0.6.1** (antes 0.5.1).
- El catálogo pasa de 8 a **9 agentes especializados**, de 61 a **99 herramientas** y de 25 a **26 skills**.
- El asistente de instalación (`hive onboard`) lista los agentes de código externos en lugar de "Code Bridge".
- Documentación actualizada a la versión 1.1 (README, arquitectura, seguridad, configuración, agentes, CLI, skills e inventario).

## Corregido

- **El navegador integrado no arrancaba con algunos Chrome.** Bun elegía por su cuenta un Chrome que no podía iniciar (el wrapper de flatpak, por ejemplo). Ahora usa el mismo Chrome que Hive ya detectó.
- **Detección de Chrome.** Se prueban primero Chrome y Chromium de flatpak y el Chromium que deja Playwright en `~/.cache/ms-playwright` (o `PLAYWRIGHT_BROWSERS_PATH`); Edge y Brave van al final, porque Brave falla al arrancar con Bun ("Failed to spawn Chrome").
- **Ventana de 780×493 en algunos Chrome (131, por ejemplo)**, que ignoraban el tamaño pedido. El tamaño se fija tras la primera operación, cuando Chrome ya creó la pestaña.
- **La suite de pruebas cerraba el Chrome de todo el proceso.** Un `Bun.WebView.closeAll()` en `computer-use-input` dejaba sin vista a los archivos que corrían después ("Chrome process closed the pipe").
- La validación de las respuestas del oráculo de decisiones es la misma para todos los backends y acepta preguntas de tipo `score`.

## Notas de seguridad

- **Antes de actualizar, copia tu llave**: `cp ~/.hive/.master.key ~/.hive/.master.key.bak`. Si el llavero de tu sesión no persiste entre reinicios (un llavero de sesión que se descarta al cerrarla), la llave migrada se perdería junto con tus API keys. Tras reiniciar el gateway, comprueba que el archivo desapareció; cierra sesión, vuelve a entrar y verifica que las claves siguen disponibles. Si algo falla, restaura la copia y Hive vuelve a usarla.
- **Con Kev activo**, los extractos de la conversación que Jev enviaba a OpenRouter viajan a `llm.hiveagents.io`. El detalle está en [Seguridad](docs/guides/seguridad.md#datos-enviados-a-jev).
- Los agentes de código externos ejecutan CLI sin supervisión: revisa siempre el diff antes de aplicar un patch.
