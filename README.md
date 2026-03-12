# Hive 🐝

> Tu colmena de agentes IA. Local-first. Multi-canal. Open source. Construido desde Colombia para el mundo.

[![npm version](https://img.shields.io/npm/v/@johpaz/hive)](https://www.npmjs.com/package/@johpaz/hive)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm downloads](https://img.shields.io/npm/dm/@johpaz/hive)](https://www.npmjs.com/package/@johpaz/hive)
[![Hecho en Colombia 🇨🇴](https://img.shields.io/badge/Hecho%20en-Colombia-brightgreen)](https://github.com/johpaz/hive)

---

## ¿Qué es Hive?

Hive es un Gateway de IA Orquestado — un Enjambre de Agentes Especializados que trabajan juntos bajo la coordinación de un gateway central. A diferencia de un asistente personal único, Hive implementa una arquitectura de enjambre donde múltiples agentes especializados trabajan en equipo.

**El problema que resolvemos**: Necesitas un asistente de IA que funcione en múltiples canales (Telegram, Discord, WhatsApp), que pueda ejecutar tareas automáticamente, que respete tu privacidad con datos locales, y que sea extensible con herramientas propias.

---

## Por dentro

51.937 líneas de TypeScript. Sin frameworks de agentes. Sin LangChain. Sin abstracciones intermedias. Todo construido desde cero sobre Bun + SQLite.

```
Language          files     blank   comment      code
─────────────────────────────────────────────────────
TypeScript          434      7671      2683     51937   ← motor, gateway, canales, UI
Markdown             45      2225         0      8233
JSON                 15         5         0       575
CSS                   1       141        29       450
YAML                  2        35        11       197
Shell                 2        14         5        61
Dockerfile            1        19        10        38
─────────────────────────────────────────────────────
TOTAL               504     10119      2741     61546
```

La imagen Docker pesa ~120 MB. El bundle npm pesa ~12 MB. El binario standalone ~50 MB. Todo el runtime cabe en una Raspberry Pi Zero 2W con 512 MB de RAM.

---

## Instalación

### Prerequisito — Bun

Hive requiere [Bun](https://bun.sh) como runtime para las opciones de binario y npm. Docker no lo requiere.

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # o reinicia la terminal
bun --version      # verifica que quedó instalado
```

---

Elige la opción que mejor se adapte a tu caso:

| | Docker | Binario | npm / bun |
|---|---|---|---|
| Requiere | Docker | Bun | Bun |
| Setup | 1 comando | descarga + ejecuta | `bun install -g @johpaz/hive` |
| Actualizar | `docker compose pull` | descarga nueva versión | `bun install -g @johpaz/hive` |
| Ideal para | Raspberry Pi, VPS, laptop vieja, VM | uso personal, USB | desarrolladores |
| Abre navegador | automático (con GUI) / por IP (headless) | automático | automático |
| Tamaño | ~120 MB imagen | ~50 MB | ~12 MB bundle |

---

### Opción 1 — Docker (Recomendada para servidores y VPS)

La forma más rápida. Sin instalar Node, Bun ni dependencias. Solo necesitas Docker.

#### Laptop, PC o VM con interfaz gráfica

Un solo comando que levanta todo y abre el navegador automáticamente:

```bash
curl -O https://raw.githubusercontent.com/johpaz/hive/master/docker-compose.yml
curl -O https://raw.githubusercontent.com/johpaz/hive/master/hive-docker.sh
chmod +x hive-docker.sh
./hive-docker.sh
```

El script levanta el contenedor, espera a que el gateway esté listo y abre el navegador directamente en `/setup` (primera vez) o en el dashboard (si ya está configurado).

#### Raspberry Pi, VPS o servidor headless

Sin interfaz gráfica, usa Docker Compose directamente:

```bash
curl -O https://raw.githubusercontent.com/johpaz/hive/master/docker-compose.yml
docker compose up -d
```

Luego accede desde cualquier equipo en la misma red usando la IP del servidor:

```
http://<ip-del-servidor>:18790
```

Para conocer la IP del servidor:

```bash
ip a | grep "inet " | grep -v 127.0.0.1
```

> **Raspberry Pi tip:** si usas el mismo Pi para todo, `http://raspberrypi.local:18790` suele funcionar sin necesitar la IP.

**Con un solo comando** (sin Compose):

```bash
docker run -d \
  -p 18790:18790 \
  -v hive-data:/root/.hive \
  --name hive \
  --restart unless-stopped \
  johpaz/hive:latest
```

**Variables de entorno disponibles:**

| Variable | Default | Descripción |
|----------|---------|-------------|
| `HIVE_HOST` | `0.0.0.0` | Interfaz de red donde escucha el gateway |
| `HIVE_PORT` | `18790` | Puerto del gateway |
| `HIVE_AUTH_TOKEN` | — | Token de autenticación (opcional) |
| `HIVE_LOG_LEVEL` | `info` | Nivel de logs (`debug`, `info`, `warn`, `error`) |

**Actualizar a la última versión:**

```bash
docker compose pull        # descarga la imagen más reciente de Docker Hub
docker compose up -d       # reinicia el contenedor con la nueva imagen
```

Los datos (BD, config, logs) se persisten en el volumen `hive-data` — actualizar no borra tu configuración.

**Ver logs en tiempo real:**

```bash
docker compose logs -f hive
```

---

### Opción 2 — Binario standalone (Sin dependencias)

Descarga un ejecutable único para tu plataforma. No requiere Node, Bun ni Docker. Al ejecutarlo, **el navegador se abre automáticamente** en `/setup` (primera vez) o en el dashboard.

| Plataforma | Descarga |
|------------|----------|
| Linux x64 | [hive-v1.7.2-linux-x64](https://github.com/johpaz/hive/releases/latest/download/hive-v1.7.2-linux-x64) |
| Linux ARM64 | [hive-v1.7.2-linux-arm64](https://github.com/johpaz/hive/releases/latest/download/hive-v1.7.2-linux-arm64) |
| macOS Intel | [hive-v1.7.2-macos-x64](https://github.com/johpaz/hive/releases/latest/download/hive-v1.7.2-macos-x64) |
| macOS Apple Silicon | [hive-v1.7.2-macos-arm64](https://github.com/johpaz/hive/releases/latest/download/hive-v1.7.2-macos-arm64) |
| Windows x64 | [hive-v1.7.2-windows-x64.exe](https://github.com/johpaz/hive/releases/latest/download/hive-v1.7.2-windows-x64.exe) |

**Instalación en Linux / macOS:**

```bash
# 1. Descargar binario (ajusta la URL a tu plataforma)
curl -L -o hive https://github.com/johpaz/hive/releases/latest/download/hive-v1.7.2-linux-x64
chmod +x hive

# 2. Descargar la UI
curl -L https://github.com/johpaz/hive/releases/latest/download/ui-dist.tar.gz | tar -xz
mkdir -p ~/.hive/ui && mv ui-dist/* ~/.hive/ui/

# 3. Ejecutar — el navegador se abre automáticamente
./hive start
```

**Instalación en Windows:**

```powershell
# 1. Descargar hive-v1.7.2-windows-x64.exe desde el link de arriba
# 2. Descargar ui-dist.tar.gz y extraer en %USERPROFILE%\.hive\ui\
# 3. Ejecutar
.\hive-v1.7.2-windows-x64.exe start
```

**¿Dónde se guardan los datos?**

Todos los datos (base de datos, configuración, logs) se guardan en `~/.hive/` por defecto:

```
~/.hive/
├── data/
│   └── hive.db        ← base de datos SQLite (agentes, conversaciones, config)
├── ui/                ← archivos de la interfaz web
├── logs/
│   └── gateway.log
└── gateway.pid
```

La UI se sirve desde `~/.hive/ui/`. Puedes apuntar a una ruta alternativa con la variable `HIVE_UI_DIR`.

**Variables de entorno:**

| Variable | Default | Descripción |
|----------|---------|-------------|
| `HIVE_HOME` | `~/.hive` | Directorio raíz de datos |
| `HIVE_PORT` | `18790` | Puerto del gateway |
| `HIVE_HOST` | `127.0.0.1` | Interfaz de red |
| `HIVE_UI_DIR` | `~/.hive/ui` | Ruta alternativa para la UI |

---

### Uso portable — USB o disco externo

El binario standalone es ideal para llevarlo en una USB. Tu agente viaja contigo con toda su memoria, historial y configuración.

**Estructura recomendada en la USB:**

```
/usb/
├── hive                  ← binario ejecutable
├── ui/                   ← archivos de la interfaz web (copiar de ui-dist/)
└── datos/                ← directorio de datos (se crea automáticamente)
    ├── data/hive.db
    └── ...
```

**Preparar la USB (desde tu máquina):**

```bash
# Copiar binario
cp hive-v1.7.2-linux-x64 /media/usb/hive
chmod +x /media/usb/hive

# Copiar UI
cp -r ui-dist/* /media/usb/ui/

# (Opcional) Copiar datos existentes
cp -r ~/.hive/data /media/usb/datos/
```

**Ejecutar en cualquier equipo Linux:**

```bash
HIVE_HOME=/media/usb/datos HIVE_UI_DIR=/media/usb/ui /media/usb/hive start
```

El navegador se abre automáticamente. Si es la primera vez en ese equipo, muestra el wizard de setup. Si ya tienes datos en la USB, carga tu agente directamente.

**En macOS:**

```bash
HIVE_HOME=/Volumes/USB/datos HIVE_UI_DIR=/Volumes/USB/ui /Volumes/USB/hive start
```

**Backup de datos:**

```bash
# Hacer backup de la BD
cp ~/.hive/data/hive.db ~/backup-hive-$(date +%Y%m%d).db

# Restaurar
cp ~/backup-hive-20260310.db ~/.hive/data/hive.db
```

---

### Opción 3 — bun (Para desarrolladores)

> Requiere Bun instalado — ver prerequisito al inicio de esta sección.

**Instalación global:**

```bash
bun install -g @johpaz/hive
```

> Si instalas con `npm install -g @johpaz/hive` también funciona, pero igualmente necesitas Bun instalado — el CLI lo usa como runtime.

**Iniciar:**

```bash
hive start
```

El navegador se abre automáticamente en `http://localhost:18790`. Si es la primera vez, redirige a `/setup` para configurar tu agente.

**Configurar desde terminal** (sin browser):

```bash
hive onboard
```

**Comandos útiles:**

```bash
hive status          # estado del gateway
hive logs --follow   # logs en tiempo real
hive stop            # detener el gateway
hive doctor          # diagnóstico del sistema
```

**Actualizar a la última versión:**

```bash
bun install -g @johpaz/hive   # instala la versión más reciente
hive stop && hive start        # reinicia el gateway
```

**Modo desarrollo** (hot-reload + Vite, para contribuir al proyecto):

```bash
git clone https://github.com/johpaz/hive.git && cd hive
bun install
bun run dev
```

---

## Los Cuatro Pilares

| Pilar | Descripción |
|-------|-------------|
| **Tools** | Herramientas nativas: navegador, sistema de archivos, cron, canvas. |
| **Skills** | Habilidades incluidas: búsqueda web, shell, memoria, HTTP client, file manager. |
| **MCP** | Compatible con Model Context Protocol para extender funcionalidades. |
| **Ética** | Límites claros definidos en ETHICS.md — tu agente siempre sabe qué puede y qué no puede hacer. |

---

## Arquitectura técnica

Hive usa un **Native Agent Loop** propio — sin dependencias de LangGraph ni LangChain. Todo corre sobre Bun + SQLite con cero abstracciones intermedias.

### Loop principal

```
mensaje entrante
  → Context Compiler (compileContext)
      → callLLM()
          → [executeTool() → callLLM()]*
              → respuesta al usuario
```

---

### FASE 3 — Context Compiler

El Context Compiler es el componente central del motor. Se ejecuta antes de cada llamada al modelo y ensambla una "vista mínima" del contexto consultando SQLite directamente. Implementa cuatro estrategias de Context Engineering:

**3.1 — Selección de historial (SELECCIONAR)**
- Conversaciones cortas (< 20 mensajes): pasa todos los mensajes
- Conversaciones largas: usa el resumen de la tabla `summaries` + los últimos N mensajes recientes
- Nunca pasa la conversación cruda completa a modelos con ventana chica

**3.2 — Scratchpad (ESCRIBIR)**
- Carga las notas persistentes del thread actual desde la tabla `scratchpad`
- Las inyecta en el system prompt como "Información conocida sobre esta conversación"
- El agente puede escribir al scratchpad usando la tool `save_note(key, value)`

**3.3 — Playbook del ACE (SELECCIONAR)**
- Busca con FTS5 en la tabla `playbook` usando keywords del mensaje del usuario
- Inyecta máximo 5 reglas relevantes (`active=1`, `helpful_count > harmful_count`)
- Las reglas son aprendidas automáticamente por el Curator del ACE

**3.4 — Selección de tools en tres niveles (SELECCIONAR)**

| Nivel | Operación |
|-------|-----------|
| 1 — Catálogo | `collectNativeTools()` + tools de MCP activos |
| 2 — Agente | `filterToolsByAgent()` — filtra por `tools_json` del agente. `NULL` = todas permitidas |
| 3 — Turno | `selectToolLoadout()` — ALWAYS_INCLUDE + scoring por keywords del mensaje (máx. 20) |

El límite de 20 tools por turno es crítico para modelos locales con recursos limitados. Las tools del `ALWAYS_INCLUDE` siempre están disponibles sin consumir slots opcionales: `cron_add/list/remove/edit`, `project_create/task_create/task_update`, `read/write/edit`, `save_note`, `notify`, `report_progress`, `create_agent`.

**3.5 — Ética (capa constitucional)**
- Carga todas las reglas de la tabla `ethics` — sin filtrar, sin comprimir
- Siempre es el primer bloque del system prompt, en toda llamada al modelo

**Orden de ensamblaje del contexto:**

```
[system prompt]
  1. Reglas de ética (completas, siempre)
  2. Identidad del agente (agents.system_prompt + description)
  3. Hive Capabilities Manifest (hive_capabilities table)
  4. Perfil del usuario (users table)
  5. Reglas del playbook relevantes (FTS5, máx. 5)
  6. Notas del scratchpad (filtradas por thread_id)
  7. Entorno (agent_id, thread_id, fecha/hora local)

[messages]
  8. Resumen del historial (si la conversación es larga)
  9. Mensajes recientes (últimos N)

[tools]
  10. Tools filtradas en tres niveles
```

---

### FASE 4 — Proyectos, Tareas y Workers

El Coordinador puede descomponer problemas complejos en proyectos con tareas paralelas ejecutadas por workers autónomos.

**4.1 — Decisión simple vs proyecto**

El modelo decide en su system prompt:
- **Tarea simple** → el Coordinador la resuelve directamente o despacha a un worker existente
- **Tarea compleja** → crea un proyecto con subtareas y dependencias

**4.2 — Creación de proyecto y asignación de workers**

1. `project_create` — registra el objetivo del proyecto
2. `task_create` — crea cada subtarea con dependencias
3. `find_agent` — busca por FTS5 sobre `name+description` del agente vs la tarea
   - Si existe un worker compatible → `assign_task`
   - Si no → `create_agent` con system prompt y tools necesarios, luego `assign_task`

**4.3 — Ejecución respetando dependencias**

- Tareas sin dependencias (o con dependencias ya `completed`) se ejecutan primero
- Tareas independientes entre sí corren en paralelo (`Promise.all`)
- Si una tarea falla: el Coordinador puede reintentar, reasignar a otro agente, o marcar el proyecto como `failed`

**4.4 — Contexto aislado por worker (AISLAR)**

Cada worker recibe **solo** lo necesario para su tarea:
- Reglas de ética + su system prompt propio
- Descripción de la tarea asignada
- Resultados de las tareas de las que depende

El worker **no** recibe la conversación completa del usuario. Esto mantiene el contexto mínimo y evita contaminación entre agentes.

---

### FASE 5 — ACE (Adaptive Context Engine)

El ACE convierte a Hive en un sistema que aprende automáticamente de sus propias ejecuciones.

**5.1 — Tracer (Generator)**

Después de cada ejecución se guarda automáticamente en la tabla `traces`:
- Qué agente, qué tool, qué recibió, qué produjo
- Si fue exitoso, cuánto tardó, cuántos tokens consumió

Pasivo — no agrega latencia al usuario.

**5.2 — Reflector (análisis periódico)**

Se ejecuta en segundo plano, nunca en el flujo del usuario:
- Trigger: cada 20 trazas nuevas, o por cron periódico
- Le pide al modelo que analice las trazas: patrones de éxito, fallos repetidos, oportunidades de mejora
- Guarda los insights en la tabla `reflections` (incluyendo `ethics_violation` con prioridad máxima)

**5.3 — Curator (playbook + poda de agentes)**

Transforma insights en reglas operativas:
- Si ya existe una regla similar → incrementa `helpful_count` o `harmful_count`
- Si es nueva → la inserta con `confidence` proporcional a cuántas trazas la respaldan
- Si `harmful_count > helpful_count` → marca la regla como `active=0`
- Si hay reglas duplicadas o contradictorias → fusiona o poda

Poda de agentes:
- Workers sin actividad por más de 14 días → `status='archived'`
- Workers con tasa de fallo alta → `archived` + regla en playbook explicando por qué fallaba
- Workers duplicados (skills similares) → archiva el menos exitoso

**Ciclo completo del ACE:**

```
Agentes ejecutan tareas
  → trazas en SQLite
      → Reflector analiza periódicamente
          → Curator actualiza playbook + poda agentes
              → Context Compiler inyecta reglas
                  → Agentes ejecutan mejor la próxima vez
```

---

### FASE 6 — Compaction (compresión de historial)

Mantiene el contexto dentro del presupuesto de tokens del modelo.

**Compresión de conversación (COMPRIMIR)**
- Trigger: cuando el token count acumulado del thread supera el 60% de la ventana del modelo
- Toma todos los mensajes excepto los últimos 5
- El modelo los resume preservando: datos del usuario, decisiones tomadas, resultados de tools, contexto para continuar
- El resumen se guarda en la tabla `summaries`; los mensajes originales permanecen como historial

**Tool result clearing**
- Resultados de tools con más de N turnos de antigüedad → reemplazados por un resumen corto
- Reduce tokens sin perder el registro de que la tool se ejecutó

---

### Providers LLM soportados

Hive llama directamente a los SDKs oficiales de cada provider:

| Provider | SDK | Modelos ejemplo |
|----------|-----|-----------------|
| Google Gemini | `@google/genai` | gemini-2.5-flash, gemini-2.0-flash |
| Anthropic | `@anthropic-ai/sdk` | claude-sonnet-4-6, claude-opus-4-6 |
| OpenAI | `openai` | gpt-4o, gpt-4.1 |
| Groq | `openai` (compat) | llama-3.3-70b, mixtral-8x7b |
| Mistral AI | `openai` (compat) | mistral-large, codestral |
| DeepSeek | `openai` (compat) | deepseek-chat, deepseek-reasoner |
| Kimi (Moonshot) | `openai` (compat) | moonshot-v1-8k, moonshot-v1-128k |
| Ollama | `openai` (compat) | llama3, qwen2.5, etc. |
| OpenRouter | `openai` (compat) | cualquier modelo de la plataforma |

### Onboarding → System Prompt

Al completar el onboarding, el campo `agents.system_prompt` se genera automáticamente con el nombre, descripción y tono del agente. El tono puede ser: `friendly`, `professional`, `direct` o `casual`.

---

## Desarrollo

```bash
# Clonar el repo
git clone https://github.com/johpaz/hive.git
cd hive

# Instalar dependencias
bun install

# Modo desarrollo
bun run dev
```

---

## Contribuir

¿Quieres agregar una nueva funcionalidad? Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para saber exactamente dónde hacer tu cambio.

| Tipo de cambio | Ubicación |
|---------------|-----------|
| Canal nuevo | `packages/core/src/channels/` + registrar en `manager.ts` |
| Tool nativa | `packages/core/src/tools/` + registrar en `native-tools.ts` |
| Skill nueva | `packages/skills/src/` |
| MCP nuevo | `packages/core/src/mcp/` |
| Capability en el manifest | tabla `hive_capabilities` vía `seed.ts` |
| Mejora al CLI | `packages/cli/src/commands/` |

Todo en un PR. Una revisión. Un merge.

---

## Links

- 🌐 [hiveagents.io](https://hiveagents.io)
- 💬 [Discord](https://discord.gg/hive)
- 📱 [Telegram](https://t.me/hive_agents)

---

## Licencia

MIT © 2024-2026 Hive Team — Construido con ❤️ desde Colombia
