# 🐝 Hive CLI - Guía de Comandos

Documentación completa de los comandos del CLI de Hive, tu colmena de agentes IA.

---

## 📋 Índice

1. [Introducción](#introducción)
2. [Comandos de Configuración](#configuración)
3. [Gestión del Gateway](#gateway)
4. [Interacción con Agentes](#interacción)
5. [Gestión de Agentes](#agentes)
6. [Servidores MCP](#mcp)
7. [Skills](#skills)
8. [Configuración del Sistema](#configuración-del-sistema)
9. [Sesiones y Cron Jobs](#sesiones-y-cron-jobs)
10. [Comandos de Sistema](#sistema)
11. [Flujos de Trabajo Comunes](#flujos-comunes)

---

## Introducción

El CLI de Hive permite gestionar tu colmena de agentes IA desde la terminal. Todos los comandos siguen el patrón:

```bash
hive <comando> [subcomando] [opciones]
```

### Obtener ayuda

```bash
hive --help        # Mostrar ayuda general
hive -h            # Versión corta
hive <comando>     # Sin subcomando muestra ayuda específica
```

---

## Configuración {#configuración}

### `hive onboard`

**Propósito**: Asistente interactivo de configuración inicial.

**Cuándo usarlo**: 
- Primera vez que instalas Hive
- Necesitas reconfigurar desde cero
- Quieres cambiar proveedor LLM, canales o habilidades

**Qué hace**:
- Guía paso a paso para configurar:
  - Nombre del agente y perfil de usuario
  - Proveedor LLM (Anthropic, OpenAI, Gemini, etc.)
  - API keys
  - Canales (Telegram, Discord, WebChat)
  - Skills iniciales
  - Ética y personalidad del agente
- Crea la base de datos en `~/.hive/data/hive.db`
- Genera archivos de configuración

**Ejemplo**:
```bash
hive onboard
```

---

### `hive dev`

**Propósito**: Modo desarrollo con configuración aislada.

**Cuándo usarlo**:
- Estás desarrollando Hive
- Quieres probar configuraciones sin afectar tu setup principal
- Necesitas un entorno de pruebas rápido

**Qué hace**:
- Usa `~/.hive-dev` en lugar de `~/.hive`
- Ejecuta `onboard` si es la primera vez
- Inicia el Gateway con hot-reload
- No modifica tu configuración real

**Ejemplo**:
```bash
hive dev
```

**Variables de entorno**:
- `HIVE_HOME=$HOME/.hive-dev`
- `HIVE_DEV=true`

---

### `hive doctor`

**Propósito**: Diagnóstico y auto-reparación del sistema.

**Cuándo usarlo**:
- Hive no funciona como esperas
- Quieres verificar el estado del sistema
- Necesitas identificar problemas de configuración

**Qué verifica**:
- ✅ Runtime (Bun, Node.js)
- ✅ Directorio Hive
- ✅ Base de datos
- ✅ Configuración del Gateway
- ✅ Proveedor LLM
- ✅ Workspace
- ✅ Estado del Gateway

**Ejemplo**:
```bash
hive doctor
```

**Salida típica**:
```
🐝 Hive Doctor — Diagnóstico del sistema

Runtime
  ✅ Bun: v1.0.0
  ✅ Node.js: v20.0.0 (para MCP servers)

Sistema
  ✅ Directorio Hive: /home/user/.hive
  ✅ Base de Datos: hive.db presente

Configuración
  ✅ Gateway Config: cargada
  ✅ Proveedor LLM: anthropic

Gateway
  ✅ Estado: corriendo

✅ Todo en orden
```

---

## Gateway {#gateway}

### `hive start`

**Propósito**: Iniciar el Hive Gateway.

**Cuándo usarlo**:
- Quieres activar tu colmena de agentes
- Necesitas que los agentes estén disponibles para canales

**Opciones**:
- `--daemon` - Ejecutar en segundo plano

**Ejemplos**:
```bash
# Iniciar en foreground
hive start

# Iniciar en background (daemon)
hive start --daemon
```

**Notas**:
- En modo daemon, los logs se guardan en `~/.hive/logs/gateway.log`
- El Gateway escucha en `http://127.0.0.1:18790` por defecto
- Abre automáticamente el navegador en la UI

---

### `hive stop`

**Propósito**: Detener el Gateway.

**Cuándo usarlo**:
- Quieres apagar la colmena
- Necesitas reiniciar el Gateway
- Vas a hacer cambios de configuración

**Ejemplo**:
```bash
hive stop
```

---

### `hive status`

**Propósito**: Ver el estado del Gateway y configuración.

**Cuándo usarlo**:
- Quieres verificar si el Gateway está corriendo
- Necesitas ver el PID del proceso
- Quieres confirmar la configuración actual

**Opciones**:
- `--json` - Salida en formato JSON

**Ejemplo**:
```bash
hive status
```

**Salida típica**:
```
🐝 Hive Gateway Status

Estado:      ✅ Corriendo
PID:         12345
Puerto:      18790
Host:        127.0.0.1
Modelo:      anthropic / claude-sonnet-4-6
Home:        /home/user/.hive
Logs:        /home/user/.hive/logs/gateway.log
```

---

### `hive reload`

**Propósito**: Recargar configuración sin reiniciar el Gateway.

**Cuándo usarlo**:
- Cambiaste configuración manualmente
- Añadiste un servidor MCP
- Modificaste variables de entorno

**Ejemplo**:
```bash
hive reload
```

**Nota**: Envía señal `SIGHUP` al proceso del Gateway.

---

## Interacción {#interacción}

### `hive chat`

**Propósito**: Chat interactivo en terminal con un agente.

**Cuándo usarlo**:
- Quieres chatear directamente desde la terminal
- Estás depurando un agente
- Prefieres terminal sobre UI web

**Opciones**:
- `--agent <id>` - Especificar agente (default: `main`)

**Comandos del chat**:
- `/exit` o `/quit` - Salir del chat
- `/new` - Nueva sesión
- `/help` - Mostrar ayuda

**Ejemplos**:
```bash
# Chat con agente principal
hive chat

# Chat con agente específico
hive chat --agent work
```

**Ejemplo de sesión**:
```
🐝 Chat con agente: main
   Escribe /exit para salir, /new para nueva sesión

> Hola, ¿puedes ayudarme con un análisis de datos?

🤖 Pensando...

¡Claro! Puedo ayudarte a analizar datos. ¿Qué tipo de análisis necesitas?
```

---

### `hive logs`

**Propósito**: Ver logs del Gateway.

**Cuándo usarlo**:
- Estás depurando un problema
- Quieres ver la actividad reciente
- Necesitas rastrear el comportamiento de un agente

**Opciones**:
- `--follow` o `-f` - Seguir logs en tiempo real
- `--level <nivel>` - Filtrar por nivel (INFO, ERROR, WARN)
- `--agent <id>` - Filtrar por agente
- `--clear` - Limpiar logs

**Ejemplos**:
```bash
# Ver últimas 100 líneas
hive logs

# Seguir en tiempo real
hive logs --follow

# Filtrar por nivel ERROR
hive logs --level ERROR

# Logs de un agente específico
hive logs --agent work
```

---

### `hive message send`

**Propósito**: Enviar mensaje a un canal específico.

**Cuándo usarlo**:
- Quieres enviar mensajes programáticamente
- Estás integrando Hive con scripts externos
- Necesitas notificar a través de canales

**Opciones requeridas**:
- `--to <id>` - ID del destinatario
- `--content <texto>` - Contenido del mensaje

**Opciones opcionales**:
- `--channel <nombre>` - Canal específico (default: `default`)

**Ejemplos**:
```bash
# Enviar mensaje por Telegram
hive message send --to 123456789 --channel telegram --content "Hola desde Hive"

# Enviar a Discord
hive message send --to 987654321 --channel discord --content "Recordatorio: reunión a las 3pm"
```

**Nota**: El Gateway debe estar corriendo.

---

### `hive agent run`

**Propósito**: Ejecutar un agente con un mensaje específico.

**Cuándo usarlo**:
- Quieres ejecutar una tarea específica
- Necesitas automatizar acciones del agente
- Estás creando scripts con Hive

**Opciones**:
- `--message <texto>` - Mensaje para el agente (requerido)
- `--thinking <nivel>` - Nivel de razonamiento: `low`, `medium`, `high`
- `--tools <lista>` - Tools a usar (default: `all`)
- `--agent <id>` - Agente específico (default: `main`)
- `--wait` - Esperar respuesta completa

**Ejemplos**:
```bash
# Ejecutar con mensaje
hive agent run --message "Analiza el archivo README.md"

# Con nivel de razonamiento alto
hive agent run --message "Resuelve este problema complejo" --thinking high

# Esperar respuesta en terminal
hive agent run --message "Genera un reporte" --wait

# Agente específico
hive agent run --agent work --message "Revisa mis emails"
```

**Salida con --wait**:
```
Conectando con el agente...
Conectado

[Tool: file_read]

El archivo README.md contiene la documentación del proyecto...
```

---

## Agentes {#agentes}

### `hive agents list`

**Propósito**: Listar todos los agentes configurados.

**Cuándo usarlo**:
- Quieres ver qué agentes tienes
- Necesitas verificar IDs de agentes
- Estás auditando tu configuración

**Opciones**:
- `--bindings` - Mostrar bindings asociados

**Ejemplo**:
```bash
hive agents list
```

**Salida**:
```
🐝 Agentes:

  main (default)
    Nombre:     Hive
    Workspace:  /home/user/.hive/agents/main/workspace

  work
    Nombre:     Work Assistant
    Workspace:  /home/user/.hive/agents/work/workspace
```

---

### `hive agents create`

**Propósito**: Crear un nuevo agente con el sistema lifecycle.

**Cuándo usarlo**:
- Quieres añadir un agente especializado
- Necesitas un agente para un propósito específico

**Qué hace**:
- Crea estructura de directorios
- Genera archivos SOUL.md, ETHICS.md, USER.md
- Inicializa estado del agente

**Ejemplo**:
```bash
hive agents create
```

**Proceso interactivo**:
```
Agent name: research-assistant
Purpose: Investigar temas académicos y científicos

✅ Agent created: research-assistant (agent-abc123)
   Workspace: /home/user/.hive/agents/agent-abc123
```

---

### `hive agents add`

**Propósito**: Crear agente (método legacy).

**Cuándo usarlo**:
- Manteniendo compatibilidad con configuraciones antiguas
- Prefieres el método simple

**Ejemplo**:
```bash
hive agents add work
```

---

### `hive agents tree`

**Propósito**: Mostrar jerarquía de agentes.

**Cuándo usarlo**:
- Tienes múltiples agentes relacionados
- Quieres ver la estructura de agentes
- Necesitas entender relaciones padre-hijo

**Ejemplo**:
```bash
hive agents tree
```

**Salida**:
```
🌳 Agent Hierarchy:

🟢 Hive (agent-main123...)
  🟢 Work Assistant (agent-work456...)
  💤 Research Bot (agent-res789...)
```

**Leyenda**:
- 🟢 Activo
- 💤 Hibernado
- ⚫ Terminado

---

### `hive agents hibernate`

**Propósito**: Poner un agente en estado hibernado.

**Cuándo usarlo**:
- Quieres pausar un agente temporalmente
- Necesitas liberar recursos
- El agente no se usa frecuentemente

**Ejemplo**:
```bash
hive agents hibernate agent-abc123
```

---

### `hive agents wake`

**Propósito**: Reactivar un agente hibernado.

**Cuándo usarlo**:
- Quieres volver a usar un agente hibernado
- Necesitas el agente para una tarea específica

**Ejemplo**:
```bash
hive agents wake agent-abc123
```

---

### `hive agents terminate`

**Propósito**: Terminar un agente permanentemente.

**Cuándo usarlo**:
- Ya no necesitas un agente
- Quieres eliminar un agente del sistema

**Opciones**:
- `--cascade` - Terminar también agentes hijos

**Ejemplo**:
```bash
hive agents terminate agent-abc123
hive agents terminate agent-abc123 --cascade
```

---

### `hive agents remove`

**Propósito**: Eliminar un agente (legacy).

**Cuándo usarlo**:
- Eliminando agentes creados con `agents add`

**Ejemplo**:
```bash
hive agents remove work
```

---

### `hive agents logs`

**Propósito**: Ver logs de un agente específico.

**Cuándo usarlo**:
- Estás depurando un agente
- Quieres ver la actividad de un agente

**Ejemplo**:
```bash
hive agents logs agent-abc123
```

---

## MCP {#mcp}

### `hive mcp list`

**Propósito**: Listar servidores MCP configurados.

**Cuándo usarlo**:
- Quieres ver qué servidores MCP tienes
- Necesitas verificar configuración de MCP

**Ejemplo**:
```bash
hive mcp list
```

**Salida**:
```
🔌 Servidores MCP:

  filesystem
    Estado:   ✅ Activo
    Comando:  npx -y @modelcontextprotocol/server-filesystem /home/user/docs

  database
    Estado:   ✅ Activo
    Comando:  npx -y @modelcontextprotocol/server-postgres postgres://localhost
```

---

### `hive mcp add`

**Propósito**: Añadir un servidor MCP.

**Cuándo usarlo**:
- Quieres conectar una nueva herramienta externa
- Necesitas acceso a archivos, bases de datos, etc.

**Ejemplo**:
```bash
hive mcp add
```

**Proceso interactivo**:
```
Nombre del servidor MCP: filesystem
Comando para ejecutar: npx
Argumentos: -y @modelcontextprotocol/server-filesystem /home/user/docs

✅ Servidor MCP "filesystem" añadido
```

**Nota**: Usa la UI o API del gateway para persistir en BD.

---

### `hive mcp test`

**Propósito**: Verificar conexión con un servidor MCP.

**Cuándo usarlo**:
- Acabas de añadir un servidor MCP
- El servidor no responde como esperas
- Quieres confirmar que está funcionando

**Ejemplo**:
```bash
hive mcp test filesystem
```

**Salida**:
```
🔌 Probando conexión con filesystem...
✅ Servidor filesystem responde
```

---

### `hive mcp tools`

**Propósito**: Listar tools disponibles de un servidor MCP.

**Cuándo usarlo**:
- Quieres saber qué herramientas ofrece un servidor
- Necesitas descubrir capacidades de un MCP

**Ejemplo**:
```bash
hive mcp tools filesystem
```

---

### `hive mcp remove`

**Propósito**: Eliminar un servidor MCP.

**Cuándo usarlo**:
- Ya no necesitas un servidor MCP
- El servidor está causando problemas

**Ejemplo**:
```bash
hive mcp remove filesystem
```

---

## Skills {#skills}

### `hive skills list`

**Propósito**: Listar skills instaladas.

**Cuándo usarlo**:
- Quieres ver qué skills tienes disponibles
- Necesitas verificar skills instaladas

**Ejemplo**:
```bash
hive skills list
```

**Salida**:
```
📚 Skills instaladas:

  Bundled (incluidas):
    • Web Search (web-search)
      Search the web using multiple search engines
    • Shell (shell)
      Ejecutar comandos
    • File Manager (file_manager)
      Operaciones de archivos
    • HTTP Client (http_client)
      Peticiones HTTP
    • Memory (memory)
      Memoria persistente

  Managed (instaladas):
    • Custom Skill
      Skill personalizada instalada manualmente
```

---

### `hive skills search`

**Propósito**: Buscar skills disponibles.

**Cuándo usarlo**:
- Quieres encontrar una skill específica
- Exploras habilidades disponibles

**Ejemplo**:
```bash
hive skills search web
```

**Salida**:
```
🔍 Buscando: "web"

  web-search
    Web Search
    Search the web using multiple search engines
    Tipo: bundled
```

---

### `hive skills install`

**Propósito**: Instalar una skill.

**Cuándo usarlo**:
- Quieres añadir nueva funcionalidad
- Encontraste una skill que necesitas

**Ejemplo**:
```bash
hive skills install custom-skill
```

---

### `hive skills remove`

**Propósito**: Eliminar una skill.

**Cuándo usarlo**:
- Ya no usas una skill
- Quieres limpiar espacio

**Ejemplo**:
```bash
hive skills remove custom-skill
```

---

### `hive skills update`

**Propósito**: Actualizar skills instaladas.

**Cuándo usarlo**:
- Quieres tener las últimas versiones
- Hay bug fixes o nuevas features

**Ejemplo**:
```bash
hive skills update
```

---

## Configuración del Sistema {#configuración-del-sistema}

### `hive config show`

**Propósito**: Mostrar configuración actual (redactada).

**Cuándo usarlo**:
- Quieres ver tu configuración
- Necesitas verificar valores
- Estás depurando problemas de config

**Ejemplo**:
```bash
hive config show
```

**Salida** (secrets redactados):
```json
{
  "name": "Hive",
  "gateway": {
    "port": 18790,
    "host": "127.0.0.1"
  },
  "models": {
    "defaultProvider": "anthropic",
    "defaults": {
      "anthropic": "claude-sonnet-4-6"
    }
  },
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "botToken": "***REDACTED***",
          "dmPolicy": "open"
        }
      }
    }
  }
}
```

---

## Sesiones y Cron Jobs {#sesiones-y-cron-jobs}

### `hive sessions list`

**Propósito**: Listar sesiones de chat.

**Cuándo usarlo**:
- Quieres ver historial de conversaciones
- Necesitas encontrar una sesión específica

**Ejemplo**:
```bash
hive sessions list
```

**Salida**:
```
📋 Sesiones:

  session-abc123
    Última actividad: 12/03/2026 10:30:45
    Mensajes: 25

  session-def456
    Última actividad: 11/03/2026 15:20:10
    Mensajes: 12
```

---

### `hive sessions view`

**Propósito**: Ver transcripción de una sesión.

**Cuándo usarlo**:
- Quieres revisar una conversación pasada
- Necesitas recuperar información de una sesión

**Ejemplo**:
```bash
hive sessions view session-abc123
```

**Salida**:
```
📜 Sesión: session-abc123

👤 Usuario:
  ¿Puedes ayudarme con Python?

🤖 Agente:
  ¡Claro! ¿Qué necesitas hacer con Python?

👤 Usuario:
  Quiero analizar datos de un CSV

🤖 Agente:
  Puedo ayudarte con pandas...
```

---

### `hive sessions prune`

**Propósito**: Eliminar sesiones antiguas (>7 días).

**Cuándo usarlo**:
- Quieres liberar espacio
- Necesitas limpiar sesiones viejas

**Ejemplo**:
```bash
hive sessions prune
```

**Salida**:
```
✅ Sesiones eliminadas: 5
```

---

### `hive cron list`

**Propósito**: Listar cron jobs configurados.

**Cuándo usarlo**:
- Quieres ver tareas programadas
- Necesitas verificar schedules

**Ejemplo**:
```bash
hive cron list
```

**Salida**:
```
⏰ Cron Jobs:

  daily-report
    Estado:    ✅ Activo
    Schedule:  0 9 * * *
    Comando:   hive chat --agent work 'Genera el reporte diario'
    Última:    2026-03-12 09:00:00

  weekly-backup
    Estado:    ✅ Activo
    Schedule:  0 2 * * 0
    Comando:   hive agent run --message "Backup de datos"
```

---

### `hive cron add`

**Propósito**: Añadir un cron job.

**Cuándo usarlo**:
- Quieres automatizar una tarea
- Necesitas ejecutar algo periódicamente

**Ejemplo**:
```bash
hive cron add
```

**Proceso interactivo**:
```
ID del cron job: daily-standup
Schedule (cron expression): 0 9 * * *
Comando a ejecutar: hive agent run --message "Genera standup report" --wait

✅ Cron job "daily-standup" creado
```

**Formato cron**:
```
┌───────────── minuto (0 - 59)
│ ┌───────────── hora (0 - 23)
│ │ ┌───────────── día del mes (1 - 31)
│ │ │ ┌───────────── mes (1 - 12)
│ │ │ │ ┌───────────── día de la semana (0 - 6)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

---

### `hive cron remove`

**Propósito**: Eliminar un cron job.

**Cuándo usarlo**:
- Ya no necesitas una tarea programada
- El job está causando problemas

**Ejemplo**:
```bash
hive cron remove daily-standup
```

---

### `hive cron logs`

**Propósito**: Ver logs de cron jobs.

**Cuándo usarlo**:
- Quieres ver ejecución de jobs
- Estás depurando un cron

**Ejemplo**:
```bash
hive cron logs
```

---

## Sistema {#sistema}

### `hive security audit`

**Propósito**: Auditoría de seguridad del sistema.

**Cuándo usarlo**:
- Quieres verificar seguridad de tu Hive
- Necesitas identificar vulnerabilidades
- Auditoría periódica recomendada

**Qué verifica**:
- 🔒 Red (bind, puerto, token)
- 🔒 Permisos de archivos
- 🔒 API keys (hardcoded vs env vars)
- 🔒 MCP servers (fuentes conocidas)
- 🔒 Skills de terceros

**Ejemplo**:
```bash
hive security audit
```

**Salida**:
```
🔒 Hive Security Audit

Red
  ✅ Gateway bind: 127.0.0.1 (loopback)
  ✅ Puerto: 18790 (no expuesto externamente)
  ✅ Token bearer: configurado

Archivos
  ✅ auth-profiles.json permisos: 600 (seguro)
  ⚠️  .env permisos: 644 — ejecuta: chmod 600 ~/.hive/.env

Configuración
  ✅ API keys: en variables de entorno

MCP
  ✅ Servidores: 2 configurado(s)
  ✅ Servidor 'filesystem': fuente conocida

Skills
  ✅ Skills de terceros: ninguna instalada

📊 Resumen: 10 checks, 0 errores, 1 advertencias
```

---

### `hive install-service`

**Propósito**: Instalar Hive como servicio systemd.

**Cuándo usarlo**:
- Quieres que Hive inicie automáticamente
- Estás en Linux con systemd
- Necesitas Hive como servicio del sistema

**Ejemplo**:
```bash
hive install-service
```

**Salida**:
```
🔧 Instalando servicio systemd para Hive...

✅ Archivo de servicio creado: /home/user/.config/systemd/user/hive.service

Recargando systemd...
Habilitando servicio...

✅ Servicio instalado correctamente.

Comandos disponibles:
  systemctl --user start hive    # Iniciar
  systemctl --user stop hive     # Detener
  systemctl --user status hive   # Ver estado
  journalctl --user -u hive -f   # Ver logs
```

---

### `hive update`

**Propósito**: Actualizar Hive a la última versión.

**Cuándo usarlo**:
- Quieres las últimas features
- Hay bug fixes importantes
- Mantener tu Hive actualizado

**Ejemplo**:
```bash
hive update
```

**Salida**:
```
🔄 Actualizando Hive...

Actualizando @johpaz/hive-cli...
✅ @johpaz/hive-cli actualizado

✅ Hive actualizado. Ejecuta 'hive --version' para verificar.
```

---

## Flujos Comunes {#flujos-comunes}

### 🚀 Primeros Pasos

```bash
# 1. Instalar Hive (ver README)
# 2. Configurar inicialmente
hive onboard

# 3. Iniciar Gateway
hive start

# 4. Verificar estado
hive status

# 5. Chatear
hive chat
```

### 🔧 Desarrollo

```bash
# Modo desarrollo (aislado)
hive dev

# En otra terminal, probar cambios
hive chat

# Ver logs en tiempo real
hive logs --follow
```

### 🤖 Crear Agente Especializado

```bash
# Crear nuevo agente
hive agents create

# Configurar propósito
# Nombre: research-bot
# Propósito: Investigar temas científicos

# Verificar creación
hive agents tree

# Probar agente
hive chat --agent agent-abc123
```

### 📅 Automatizar Tareas

```bash
# Añadir cron job diario
hive cron add
# ID: daily-briefing
# Schedule: 0 8 * * *
# Comando: hive agent run --message "Genera briefing diario" --wait

# Verificar
hive cron list

# Ver logs de ejecución
hive cron logs
```

### 🔌 Conectar Herramientas MCP

```bash
# Añadir servidor de archivos
hive mcp add
# Nombre: documents
# Comando: npx
# Args: -y @modelcontextprotocol/server-filesystem ~/docs

# Probar conexión
hive mcp test documents

# Ver tools disponibles
hive mcp tools documents
```

### 🛡️ Mantenimiento

```bash
# Diagnóstico completo
hive doctor

# Auditoría de seguridad
hive security audit

# Limpiar sesiones viejas
hive sessions prune

# Ver logs de errores
hive logs --level ERROR
```

### 📊 Monitoreo

```bash
# Estado del Gateway
hive status

# Logs en tiempo real
hive logs --follow

# Ver sesiones activas
hive sessions list

# Ver agentes
hive agents list
```

---

## Referencia Rápida

| Categoría | Comandos |
|-----------|----------|
| **Setup** | `onboard`, `dev`, `doctor` |
| **Gateway** | `start`, `stop`, `status`, `reload` |
| **Chat** | `chat`, `message send`, `agent run` |
| **Agentes** | `agents list/create/add/tree/hibernate/wake/terminate` |
| **MCP** | `mcp list/add/test/tools/remove` |
| **Skills** | `skills list/search/install/remove/update` |
| **Config** | `config show` |
| **Sesiones** | `sessions list/view/prune` |
| **Cron** | `cron list/add/remove/logs` |
| **Sistema** | `logs`, `security audit`, `install-service`, `update` |

---

## Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `HIVE_HOME` | Directorio de configuración | `~/.hive` |
| `HIVE_DEV` | Modo desarrollo | `false` |
| `HIVE_GATEWAY_CHILD` | Proceso hijo del Gateway | `false` |

---

## Soporte

- 📖 Documentación: [GitHub](https://github.com/johpaz/hive/docs)
- 🐛 Issues: [GitHub Issues](https://github.com/johpaz/hive/issues)
- 💬 Comunidad: [Discussions](https://github.com/johpaz/hive/discussions)

---

**Versión**: 1.7.2  
**Última actualización**: Marzo 2026
