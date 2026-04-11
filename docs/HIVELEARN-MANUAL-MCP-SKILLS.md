# Manual de Usuario: MCP y Skills en Hive

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Servidor MCP](#servidor-mcp)
   - [¿Qué es MCP?](#qué-es-mcp)
   - [Arquitectura del Sistema MCP](#arquitectura-del-sistema-mcp)
   - [Gestión de Servidores MCP](#gestión-de-servidores-mcp)
   - [Transportes Soportados](#transportes-soportados)
   - [Herramientas MCP](#herramientas-mcp)
3. [Sistema de Skills](#sistema-de-skills)
   - [¿Qué son las Skills?](#qué-son-las-skills)
   - [Arquitectura del Sistema de Skills](#arquitectura-del-sistema-de-skills)
   - [Tipos de Skills](#tipos-de-skills)
   - [Descubrimiento y Ejecución](#descubrimiento-y-ejecución)
4. [Interfaz de Usuario](#interfaz-de-usuario)
   - [Panel de Servidores MCP](#panel-de-servidores-mcp)
   - [Explorador de Herramientas MCP](#explorador-de-herramientas-mcp)
   - [Gestor de Skills](#gestor-de-skills)
5. [Línea de Comandos (CLI)](#línea-de-comandos-cli)
   - [Comandos MCP](#comandos-mcp)
   - [Comandos de Skills](#comandos-de-skills)
6. [Configuración Avanzada](#configuración-avanzada)
7. [Creación de Skills Personalizadas](#creación-de-skills-personalizadas)
8. [Conexión de Servidores MCP Externos](#conexión-de-servidores-mcp-externos)
9. [Preguntas Frecuentes](#preguntas-frecuentes)
10. [Glosario](#glosario)

---

## Introducción

Este manual cubre dos de los sistemas más potentes del ecosistema Hive: el protocolo **MCP (Model Context Protocol)** y el sistema de **Skills (Habilidades)**. Juntos, permiten extender las capacidades de la IA de Hive de manera modular y escalable.

---

## Servidor MCP

### ¿Qué es MCP?

**MCP (Model Context Protocol)** es un protocolo estándar que permite conectar modelos de IA con servicios externos a través de **herramientas (tools)** y **recursos (resources)**. En Hive, MCP actúa como un puente entre el agente de IA y servicios externos como bases de datos, APIs, sistemas de archivos, y más.

### Características Principales

- **Conexión en tiempo real**: Los servidores MCP se conectan directamente al agente de IA
- **Múltiples transportes**: Soporta STDIO, SSE (Server-Sent Events) y WebSocket
- **Descubrimiento automático**: Las herramientas se detectan automáticamente al conectar
- **Recarga en caliente**: Los servidores se pueden agregar o eliminar sin reiniciar el sistema
- **Ejecución segura**: Las herramientas se ejecutan en contextos aislados con permisos controlados

### Arquitectura del Sistema MCP

El sistema MCP en Hive sigue una arquitectura de **Conexión Directa**:

```
┌─────────────────────────────────────────────────────────┐
│                    Agente de IA (LLM)                     │
│         (lee herramientas MCP como definiciones)         │
└──────────────────────┬──────────────────────────────────┘
                       │ Llama a herramienta
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Context Compiler (agent-loop)                │
│   Registra herramientas MCP como ContextTool ejecutables │
└──────────────────────┬──────────────────────────────────┘
                       │ Ejecuta tool.execute()
                       ▼
┌─────────────────────────────────────────────────────────┐
│              MCPClientManager (singleton)                 │
│   Routing de llamadas al servidor MCP apropiado          │
└──────────────────────┬──────────────────────────────────┘
                       │ Transporte (stdio/sse/websocket)
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Servidor MCP Externo                         │
│   (ej: base de datos, API, sistema de archivos, etc.)    │
└─────────────────────────────────────────────────────────┘
```

**Puntos clave**:
- Las herramientas MCP **NO se almacenan en la base de datos**
- Se cargan **en tiempo de ejecución** desde los servidores conectados
- Cada servidor mantiene su propia lista de herramientas
- El `MCPClientManager` gestiona todas las conexiones

### Gestión de Servidores MCP

#### Tabla de Base de Datos: `mcp_servers`

Cada servidor MCP se configura con:

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `id` | TEXT | Identificador único (nombre) | `filesystem-server` |
| `transport` | TEXT | Tipo de transporte | `stdio`, `sse`, `websocket` |
| `command` | TEXT | Comando de ejecución (solo stdio) | `npx` |
| `args` | TEXT | Argumentos (JSON array) | `["-y", "@modelcontextprotocol/server-filesystem"]` |
| `url` | TEXT | URL del servidor (solo sse/websocket) | `http://localhost:3001/sse` |
| `headers` | TEXT | Cabeceras HTTP (encriptadas) | `{"Authorization": "Bearer ..."}` |
| `enabled` | INTEGER | 1=habilitado, 0=deshabilitado | 1 |
| `active` | INTEGER | 1=conectado actualmente, 0=desconectado | 1 |
| `builtin` | INTEGER | 1=servidor integrado, 0=externo | 0 |
| `status` | TEXT | Estado actual | `connected`, `disconnected`, `error`, `connecting` |
| `tools_count` | INTEGER | Número de herramientas detectadas | 12 |

#### Estados del Servidor

| Estado | Icono | Significado |
|--------|-------|-------------|
| `connected` | 🟢 | Servidor conectado y herramientas disponibles |
| `disconnected` | ⚪ | Servidor desconectado |
| `connecting` | 🟡 | En proceso de conexión |
| `error` | 🔴 | Error de conexión o configuración |

### Transportes Soportados

#### 1. STDIO (Entrada/Salida Estándar)

**Uso**: Ejecuta un proceso local y comunica mediante stdin/stdout.

**Configuración típica**:
```json
{
  "name": "filesystem-mcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
}
```

**Ventajas**:
- Ideal para herramientas locales
- Sin necesidad de servidor HTTP
- Aislamiento natural

**Ejemplos comunes**:
- Acceso al sistema de archivos
- Ejecución de comandos
- Herramientas de desarrollo local

#### 2. SSE (Server-Sent Events)

**Uso**: Conecta a un servidor HTTP que emite eventos SSE.

**Configuración típica**:
```json
{
  "name": "database-mcp",
  "transport": "sse",
  "url": "http://localhost:3001/sse",
  "headers": {
    "Authorization": "Bearer your-token-here"
  }
}
```

**Ventajas**:
- Comunicación unidireccional servidor → cliente
- Baja latencia
- Ideal para notificaciones en tiempo real

#### 3. WebSocket

**Uso**: Conexión bidireccional persistente.

**Configuración típica**:
```json
{
  "name": "realtime-mcp",
  "transport": "websocket",
  "url": "ws://localhost:3002/ws"
}
```

**Ventajas**:
- Comunicación bidireccional completa
- Ideal para datos en tiempo real
- Baja sobrecarga de protocolo

### Herramientas MCP

#### ¿Qué es una Herramienta MCP?

Una herramienta MCP es una **función ejecutable** que el agente de IA puede invocar. Cada herramienta tiene:

- **Nombre**: Identificador único dentro del servidor
- **Descripción**: Explicación de lo que hace
- **Parámetros**: Schema JSON de entrada (JSON Schema)
- **Función de ejecución**: Lógica que procesa la llamada

#### Ejemplo de Herramienta

Una herramienta de lectura de archivos:

```json
{
  "name": "read_file",
  "description": "Lee el contenido de un archivo",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Ruta absoluta del archivo"
      }
    },
    "required": ["path"]
  }
}
```

#### Herramientas Comunes por Categoría

**Sistema de Archivos**:
- `read_file` - Leer archivo
- `write_file` - Escribir archivo
- `list_directory` - Listar directorio
- `delete_file` - Eliminar archivo

**Base de Datos**:
- `query` - Ejecutar consulta SQL
- `insert` - Insertar registro
- `update` - Actualizar registro
- `delete` - Eliminar registro

**Web**:
- `search` - Buscar en internet
- `fetch_url` - Obtener contenido de URL
- `screenshot` - Captura de pantalla

---

## Sistema de Skills

### ¿Qué son las Skills?

Las **Skills (Habilidades)** son **conjuntos de instrucciones en formato Markdown** que se inyectan en el prompt del sistema para guiar al agente de IA en tareas específicas. A diferencia de las herramientas MCP, las Skills **no son código ejecutable**, sino **guías de comportamiento** que el LLM lee y sigue.

### Características Principales

- **Instrucciones estructuradas**: Formato markdown con YAML frontmatter
- **Activación por triggers**: Patrones de texto que activan la skill automáticamente
- **Búsqueda semántica**: Sistema FTS5 para descubrir skills relevantes
- **Multi-fuente**: Skills empaquetadas, gestionadas por DB, o desde directorios personalizados
- **Workflows definidos**: Pasos secuenciales que el agente debe seguir
- **Asociación con herramientas**: Cada skill puede vincularse a herramientas específicas

### Arquitectura del Sistema de Skills

#### Estructura de una Skill (`SKILL.md`)

Cada skill se define en un archivo `SKILL.md` con esta estructura:

```markdown
---
name: nombre-de-la-skill
description: Descripción breve de lo que hace esta skill
version: 1.0.0
author: Tu Nombre
icon: 🚀
category: categoría
tools: tool1, tool2, tool3
triggers: trigger1, trigger2, trigger3
permissions: read, write
dependencies: otra-skill
preferred_agents: general-purpose, Explore
---

# Nombre de la Skill

## Descripción
Descripción detallada de la skill...

## Cuándo Usar
- Situación 1
- Situación 2

## Instrucciones

1. **Paso 1**: Descripción del primer paso
2. **Paso 2**: Descripción del segundo paso
3. **Paso 3**: Descripción del tercer paso

## Ejemplos

### Ejemplo 1
**Usuario**: "Texto de ejemplo del usuario"
**Comportamiento esperado**: Lo que debería pasar

### Ejemplo 2
**Usuario**: "Otro texto"
**Comportamiento esperado**: Resultado esperado
```

#### Campos del Frontmatter YAML

| Campo | Tipo | Requerido | Descripción | Ejemplo |
|-------|------|-----------|-------------|---------|
| `name` | string | ✅ | Identificador único | `web-research` |
| `description` | string | ✅ | Descripción breve | "Busca información en la web" |
| `version` | string | Opcional | Versión de la skill | `1.0.0` |
| `author` | string | Opcional | Autor | `@johnpaz` |
| `icon` | string | Opcional | Emoji/icono | 🌐 |
| `category` | string | ✅ | Categoría | `web`, `filesystem`, `codebridge` |
| `tools` | string | Opcional | IDs de herramientas (comma-separated) | `search, fetch_url` |
| `triggers` | string | Opcional | Patrones de activación | `/search, buscar, encontrar` |
| `permissions` | string | Opcional | Permisos requeridos | `read, write` |
| `dependencies` | string | Opcional | Skills requeridas | `memory_manager` |
| `preferred_agents` | string | Opcional | Agentes preferidos | `general-purpose, Explore` |

#### Campos Avanzados

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `steps` | array | Pasos secuenciales del workflow |
| `rules` | array | Reglas de ejecución |
| `output_format` | object | Estructura de salida esperada |
| `examples` | array | Ejemplos de uso |

### Tipos de Skills

#### 1. Skills Empaquetadas (Bundled)

Skills que vienen con Hive por defecto, ubicadas en `packages/skills/src/bundled/`:

| Categoría | Skills Incluidas |
|-----------|-----------------|
| **agents** | Gestión de sub-agentes |
| **canvas** | Generación de UI con A2UI |
| **cli** | Comandos de línea de comandos |
| **codebridge** | Ejecución de código aislado |
| **cron** | Tareas programadas |
| **filesystem** | Operaciones de archivos |
| **office** | Documentos (PDF, Excel, Word) |
| **projects** | Gestión de proyectos |
| **voice** | Síntesis de voz |
| **web** | Búsqueda y scraping web |

#### 2. Skills Gestionadas por Base de Datos

Skills creadas por el usuario y almacenadas en la tabla `skills`:

- Se pueden crear/editar desde la UI
- Se buscan mediante FTS5 por relevancia
- Se pueden activar/desactivar individualmente

#### 3. Skills de Directorio Extra

Skills cargadas desde directorios externos configurables:

- Útiles para desarrollo de nuevas skills
- Se cargan automáticamente al inicio

#### 4. Skills de Workspace

Skills en el directorio de trabajo del usuario:

- **Máxima prioridad** en el sistema
- Específicas del proyecto actual
- Sobrescriben skills empaquetadas con mismo nombre

### Descubrimiento y Ejecución

El sistema de skills usa un mecanismo de **doble descubrimiento**:

#### Paso 1: Coincidencia Explícita por Triggers

Cada skill define `triggers` (patrones de activación). Si el mensaje del usuario contiene un trigger:

```
Mensaje del usuario: "/search cómo funciona React"
                        ↓
Trigger detectado: "/search"
                        ↓
Skill activada: web-research (confianza ALTA)
```

**Ventaja**: Activación inmediata y precisa.

#### Paso 2: Búsqueda Semántica FTS5

Si no hay triggers, se usa el índice FTS5:

1. **Extracción de palabras clave** del mensaje del usuario
2. **Eliminación de stopwords** (palabras comunes sin valor semántico)
3. **Búsqueda con prefijo** en el índice FTS5
4. **Puntuación con `bm25()`** ponderada:
   - Triggers: **peso 5.0** (más importante)
   - Nombre: **peso 3.0**
   - Otros campos: **peso 1.0**
5. **Filtrado por relevancia**: Solo skills con score > umbral mínimo
6. **Límite**: Máximo **4 skills** por turno

**Ejemplo**:
```
Mensaje: "necesito crear un PDF con los datos"
                        ↓
Keywords: ["crear", "PDF", "datos"]
                        ↓
Skills encontradas: 
  - office:pdf (score: 12.5)
  - filesystem:export (score: 8.3)
```

#### Paso 3: Skills Mínimas (Siempre Cargadas)

Tres skills **nunca se excluyen**, independientemente del mensaje:

| Skill | Herramienta Asociada | Propósito |
|-------|---------------------|-----------|
| `memory_manager` | `save_note` | Gestión de memoria a largo plazo |
| `canvas_report` | `report_progress` | Reportes de progreso en UI |
| `task_orchestrator` | `notify` | Coordinación de agentes |

#### Ejemplo de Inyección en el Prompt

Una skill descubierta se inyecta así:

```markdown
## Available Skills

### web-research
Busca información en la web usando herramientas de búsqueda.
Tools: search, fetch_url
Triggers: /search, buscar, encontrar

[Contenido completo de la skill - primeros 500 caracteres...]
```

---

## Interfaz de Usuario

### Panel de Servidores MCP

**Acceso**: `Menú → Configuración → Servidores MCP`

#### Vista de Lista de Servidores

Muestra una tabla con:

| Columna | Descripción |
|---------|-------------|
| **Nombre** | Identificador del servidor |
| **Estado** | Icono de estado (🟢/🔴/🟡/⚪) |
| **Transporte** | Tipo (stdio/sse/websocket) |
| **Herramientas** | Número de herramientas disponibles |
| **Acciones** | Botones de conectar/desconectar/editar/eliminar |

#### Formulario de Agregar Servidor

Campos del formulario:

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| **Nombre** | Texto | Identificador único | `mi-servidor-db` |
| **Transporte** | Select | `stdio`, `sse`, `websocket` | `sse` |
| **Comando** | Texto | Comando (solo stdio) | `python` |
| **Argumentos** | Texto (JSON) | Args como array JSON | `["server.py", "--port", "3001"]` |
| **URL** | Texto | URL (solo sse/websocket) | `http://localhost:3001/sse` |
| **Headers** | Texto (JSON) | Cabeceras HTTP | `{"Authorization": "Bearer ..."}` |

**Botones**:
- **Guardar**: Crea/actualiza el servidor
- **Probar Conexión**: Verifica que el servidor responda
- **Cancelar**: Descarta cambios

### Explorador de Herramientas MCP

**Acceso**: Desde el panel de servidores, clic en **"Ver Herramientas"**

#### Vista de Herramientas

Para cada servidor conectado, muestra:

**Tarjeta de Herramienta**:
```
┌─────────────────────────────────────────────┐
│ 📖 read_file                                │
│                                             │
│ Lee el contenido de un archivo              │
│                                             │
│ Parámetros:                                 │
│   • path (string, requerido)                │
│     Ruta absoluta del archivo               │
│                                             │
│ [Probar Herramienta]                        │
└─────────────────────────────────────────────┘
```

#### Diálogo de Prueba de Herramienta

Al hacer clic en **"Probar Herramienta"**:

1. **Formulario de entrada**: Campos generados dinámicamente según el schema
2. **Botón Ejecutar**: Envía la llamada al servidor
3. **Resultado**: Muestra la respuesta en formato JSON
4. **Logs**: Muestra errores o advertencias

### Gestor de Skills

**Acceso**: `Menú → Configuración → Skills`

#### Pestañas del Gestor

1. **Lista de Skills**: Todas las skills activas
2. **Crear Skill**: Editor de nueva skill
3. **Instalar Skill**: Importar desde archivo o URL

#### Lista de Skills

Cada skill muestra:

| Campo | Visualización |
|-------|---------------|
| **Icono** | Emoji del frontmatter |
| **Nombre** | Nombre de la skill |
| **Categoría** | Badge de color según categoría |
| **Versión** | Número de versión |
| **Herramientas** | Lista de tools asociados |
| **Triggers** | Lista de triggers |
| **Estado** | Activo ✅ / Desactivado ❌ |
| **Acciones** | Editar, Activar/Desactivar, Eliminar |

#### Editor de Skills

Formulario completo con:

**Campos básicos**:
- Nombre (slug)
- Descripción
- Versión
- Categoría (dropdown)
- Icono (emoji picker)

**Campos avanzados**:
- Tools (input con autocompletado)
- Triggers (input multiple)
- Preferred agents (input multiple)

**Editor de contenido**:
- Área de texto grande para el markdown de la skill
- Preview en tiempo real
- Validación de sintaxis

**Botones**:
- **Guardar**: Crea/actualiza skill
- **Vista previa**: Muestra cómo se verá
- **Validar**: Verifica estructura del frontmatter

#### Skill Installer

Para instalar skills externas:

1. **Fuente**:
   - URL de archivo SKILL.md
   - Archivo local (drag & drop)
   - Texto pegado manualmente

2. **Validación automática**:
   - Verifica frontmatter YAML
   - Chequea campos requeridos
   - Detecta errores de sintaxis

3. **Instalación**:
   - Muestra preview de la skill
   - Permite editar antes de guardar
   - Asocia herramientas si es necesario

---

## Línea de Comandos (CLI)

### Comandos MCP

Acceso: `hive mcp <subcomando>`

#### `hive mcp list`

Lista todos los servidores MCP configurados:

```
Servidores MCP configurados:

  🟢 filesystem-server     stdio      12 herramientas
  🟢 database-server       sse        8 herramientas
  ⚪ search-server         sse        0 herramientas (desconectado)
  🔴 api-server            websocket  Error: connection refused

Total: 4 servidores (2 conectados, 1 desconectado, 1 error)
```

#### `hive mcp add <nombre>`

Agrega un nuevo servidor MCP:

```bash
# Modo interactivo
hive mcp add mi-servidor

# Con argumentos
hive mcp add filesystem \
  --transport stdio \
  --command npx \
  --args '["-y", "@modelcontextprotocol/server-filesystem", "/path"]'
```

**Opciones**:

| Opción | Descripción | Ejemplo |
|--------|-------------|---------|
| `--transport` | Tipo de transporte | `stdio`, `sse`, `websocket` |
| `--command` | Comando (solo stdio) | `python` |
| `--args` | Argumentos JSON | `'["--port", "3001"]'` |
| `--url` | URL (solo sse/ws) | `http://localhost:3001/sse` |
| `--headers` | Headers JSON | `'{"Auth": "Bearer ..."}'` |

#### `hive mcp test <nombre>`

Prueba la conexión con un servidor:

```
Probando servidor: filesystem-server

  Transport: stdio
  Command:   npx
  Args:      ["-y", "@modelcontextprotocol/server-filesystem"]

  Conexión: ✅ Exitosa
  Herramientas detectadas: 12

  Herramientas:
    • read_file
    • write_file
    • list_directory
    • delete_file
    ...
```

#### `hive mcp tools <nombre>`

Lista las herramientas de un servidor:

```
Herramientas de filesystem-server:

  📖 read_file
     Lee el contenido de un archivo
     Parámetros: path (string, requerido)

  ✏️ write_file
     Escribe contenido en un archivo
     Parámetros: path (string), content (string)

  📁 list_directory
     Lista archivos en un directorio
     Parámetros: path (string)

  ...
```

#### `hive mcp remove <nombre>`

Elimina un servidor MCP:

```bash
hive mcp remove filesystem-server

¿Estás seguro de que deseas eliminar 'filesystem-server'? (y/N): y
✅ Servidor 'filesystem-server' eliminado correctamente
```

### Comandos de Skills

#### `hive skills list`

Lista todas las skills:

```
Skills instaladas:

  🌐 web-research            web          v1.0.0   ✅ Activa
  📄 pdf-generator           office       v2.1.0   ✅ Activa
  📁 filesystem              filesystem   v1.5.0   ✅ Activa
  🎨 canvas-ui               canvas       v1.0.0   ❌ Desactivada

Total: 4 skills (3 activas, 1 desactivada)
```

#### `hive skills update`

Actualiza las skills empaquetadas en la base de datos:

```
Actualizando skills empaquetadas...

  ✅ Agregada: voice-synthesis
  🔄 Actualizada: web-research (v1.0.0 → v1.1.0)
  ⏭️  Sin cambios: pdf-generator

Skills sincronizadas: 15
```

#### `hive skills search <término>`

Busca skills por término (usa FTS5):

```
Búsqueda: "pdf"

  📄 pdf-generator           office
     Genera documentos PDF desde datos
     Triggers: /pdf, generar pdf, crear documento
     Tools: generate_pdf, export_data

  📊 report-builder          office
     Crea reportes con tablas y gráficos
     Triggers: reporte, informe
     Tools: generate_pdf, create_chart
```

#### `hive skills show <nombre>`

Muestra detalles de una skill:

```
Skill: web-research

  Nombre:      web-research
  Descripción: Busca información en la web
  Categoría:   web
  Versión:     1.0.0
  Autor:       @johnpaz
  Icono:       🌐
  
  Triggers:    /search, buscar, encontrar
  Tools:       search, fetch_url
  Agents:      general-purpose, Explore
  
  Descripción completa:
  Esta skill permite buscar información en internet...
  [contenido completo]
```

---

## Configuración Avanzada

### Variables de Entorno

| Variable | Tipo | Valor por Defecto | Descripción |
|----------|------|-------------------|-------------|
| `HIVE_MCP_ENABLED` | boolean | `true` | Habilitar sistema MCP |
| `HIVE_MCP_RELOAD_INTERVAL` | number | `2000` | Intervalo de hot-reload (ms) |
| `HIVE_SKILLS_ENABLED` | boolean | `true` | Habilitar sistema de skills |
| `HIVE_SKILLS_EXTRA_DIRS` | string | `""` | Rutas extra de skills (separadas por `:`) |
| `HIVE_MCP_MAX_CONCURRENT` | number | `10` | Máximo de herramientas MCP ejecutándose en paralelo |
| `HIVE_SKILLS_MIN_RELEVANCE` | number | `-15` | Umbral mínimo de relevancia FTS5 |

### Ejemplo de `.env` para MCP

```bash
# MCP habilitado
HIVE_MCP_ENABLED=true

# Hot-reload cada 3 segundos
HIVE_MCP_RELOAD_INTERVAL=3000

# Directorios extra de skills
HIVE_SKILLS_EXTRA_DIRS=/home/user/my-skills:/opt/hive-skills

# Umbral de relevancia más estricto
HIVE_SKILLS_MIN_RELEVANCE=-10
```

### Configuración de Servidores en `config.json`

Alternativa a la base de datos:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        "transport": "stdio"
      },
      "database": {
        "url": "http://localhost:3001/sse",
        "transport": "sse",
        "headers": {
          "Authorization": "Bearer your-secret-token"
        }
      }
    }
  }
}
```

---

## Creación de Skills Personalizadas

### Guía Paso a Paso

#### Paso 1: Estructura del Archivo

Crea un archivo `SKILL.md`:

```bash
mkdir mi-skill
cd mi-skill
touch SKILL.md
```

#### Paso 2: Frontmatter

Define los metadatos:

```yaml
---
name: mi-skill-ejemplo
description: Descripción clara de lo que hace esta skill
version: 1.0.0
author: Tu Nombre
icon: 🎯
category: projects
tools: tool1, tool2
triggers: /mi-trigger, palabra clave
preferred_agents: general-purpose
---
```

#### Paso 3: Contenido Markdown

Escribe las instrucciones:

```markdown
# Mi Skill Ejemplo

## Cuándo Usar

Usa esta skill cuando:
- El usuario quiera hacer X
- Se necesite realizar Y

## Instrucciones

1. **Paso 1**: Primero haz esto
   - Sub-paso 1.1
   - Sub-paso 1.2

2. **Paso 2**: Luego haz esto

3. **Paso 3**: Finalmente

## Ejemplos

### Ejemplo 1
**Usuario**: "Quiero hacer algo específico"
**Comportamiento esperado**: Deberías ejecutar el paso 1, 2, 3
```

#### Paso 4: Probar la Skill

**Opción A - Directorio Extra**:
```bash
export HIVE_SKILLS_EXTRA_DIRS=/ruta/a/mi-skill
hive start
```

**Opción B - Interfaz Web**:
1. Ve a Skills → Instalar Skill
2. Arrastra tu archivo `SKILL.md`
3. Revisa la vista previa
4. Haz clic en Instalar

**Opción C - CLI**:
```bash
hive skills install ./mi-skill/SKILL.md
```

### Mejores Prácticas

#### ✅ Hacer

- **Sé específico en la descripción**: El LLM usa esto para decidir
- **Define triggers claros**: Patrones únicos que no causen falsos positivos
- **Estructura con pasos numerados**: El LLM sigue instrucciones secuenciales mejor
- **Incluye ejemplos**: 2-3 ejemplos mínimos cubren la mayoría de casos
- **Prueba extensivamente**: Verifica que se activa solo cuando debe

#### ❌ No Hacer

- **Triggers demasiado genéricos**: Evita palabras comunes como "el", "hacer"
- **Instrucciones ambiguas**: "Haz algo útil" no es suficiente
- **Demasiados pasos**: Mantén workflows bajo 10 pasos
- **Dependencias circulares**: Skill A depende de B, B depende de A
- **Duplicar skills empaquetadas**: Mejor extiende o modifica con otro nombre

### Ejemplo Completo: Skill de Generación de Reportes

```markdown
---
name: reporte-semanal
description: Genera reportes semanales con métricas del proyecto
version: 1.0.0
author: @johnpaz
icon: 📊
category: projects
tools: query_db, generate_pdf, send_email
triggers: /reporte, reporte semanal, generar informe
preferred_agents: general-purpose
---

# Reporte Semanal

## Cuándo Usar

- Usuario solicita explícitamente un "reporte semanal"
- Usuario menciona "resumen de la semana" o "informe semanal"
- Trigger detectado: `/reporte`

## Instrucciones

1. **Recopilar métricas**
   
   Usa `query_db` para obtener:
   ```sql
   SELECT COUNT(*) as total_commits 
   FROM commits 
   WHERE date >= date('now', '-7 days')
   ```

2. **Generar PDF**
   
   Usa `generate_pdf` con la estructura:
   - Título: "Reporte Semanal - [fecha]"
   - Sección 1: Actividad de código (commits, PRs)
   - Sección 2: Issues completados
   - Sección 3: Próximos objetivos

3. **Enviar por email** (opcional)
   
   Si el usuario proporciona email, usa `send_email`:
   - Para: email del usuario
   - Asunto: "Tu reporte semanal"
   - Adjunto: PDF generado

## Formato de Salida

El reporte debe incluir:
- Resumen ejecutivo (2-3 oraciones)
- Métricas cuantitativas (tablas)
- Gráficos de tendencia
- Recomendaciones para la próxima semana

## Ejemplos

### Ejemplo 1: Comando directo
**Usuario**: "/reporte"
**Comportamiento**: Genera reporte y muestra en chat

### Ejemplo 2: Solicitud natural
**Usuario**: "Necesito el reporte de esta semana"
**Comportamiento**: Detecta "reporte" y "semana", ejecuta skill

### Ejemplo 3: Con envío por email
**Usuario**: "Genera el reporte semanal y envíalo a user@example.com"
**Comportamiento**: Genera PDF y envía por email
```

---

## Conexión de Servidores MCP Externos

### Ejemplo 1: Servidor de Base de Datos PostgreSQL

#### Servidor MCP (`server.js`):

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "pg";
const { Pool } = pkg;

const server = new McpServer({
  name: "postgres-mcp",
  version: "1.0.0"
});

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "mi_base",
  user: "usuario",
  password: "secreto"
});

server.tool(
  "query",
  "Ejecuta una consulta SQL",
  { sql: { type: "string", description: "Consulta SQL" } },
  async ({ sql }) => {
    try {
      const result = await pool.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }]
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

#### Configuración en Hive:

```bash
hive mcp add postgres-db \
  --transport stdio \
  --command node \
  --args '["/ruta/al/server.js"]'
```

### Ejemplo 2: Servidor Web con SSE

#### Servidor MCP (`server.py`):

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Weather API")

@mcp.tool()
def get_weather(city: str) -> str:
    """Obtiene el clima actual para una ciudad"""
    # Simulación - en producción usar API real
    return f"El clima en {city} es soleado, 25°C"

if __name__ == "__main__":
    mcp.run(transport="sse", host="0.0.0.0", port=8000)
```

#### Configuración en Hive:

```bash
# Inicia el servidor Python
python server.py &

# Configura en Hive
hive mcp add weather-api \
  --transport sse \
  --url http://localhost:8000/sse
```

### Ejemplo 3: Servidor con WebSocket

#### Configuración:

```json
{
  "name": "realtime-collab",
  "transport": "websocket",
  "url": "ws://localhost:3002/mcp",
  "headers": {
    "Authorization": "Bearer your-jwt-token"
  }
}
```

### Diagnóstico de Problemas de Conexión

#### El servidor no se conecta

**Síntomas**: Estado 🔴 `error`

**Pasos de diagnóstico**:

1. **Verifica que el proceso esté corriendo**:
   ```bash
   # Para stdio
   ps aux | grep nombre-del-comando
   
   # Para sse/websocket
   curl http://localhost:3001/sse
   ```

2. **Revisa logs del servidor**:
   ```bash
   # Ejecuta manualmente para ver errores
   npx -y @modelcontextprotocol/server-filesystem /tmp
   ```

3. **Verifica configuración**:
   ```bash
   hive mcp test nombre-servidor
   ```

4. **Comprueba firewall**:
   ```bash
   # Puerto abierto?
   netstat -tuln | grep 3001
   ```

#### Herramientas no aparecen

**Síntomas**: Estado 🟢 pero `tools_count: 0`

**Causas comunes**:
- Servidor MCP no registra herramientas correctamente
- Versión incompatible del SDK de MCP
- Error silencioso en inicialización

**Solución**:
```bash
# Revisa la implementación del servidor
# Debe incluir registro de herramientas

# Verifica logs de Hive
tail -f logs/hive.log | grep MCP
```

---

## Preguntas Frecuentes

### MCP

**¿Cuál es la diferencia entre MCP y Skills?**

| Aspecto | MCP | Skills |
|---------|-----|--------|
| **Naturaleza** | Código ejecutable | Instrucciones de texto |
| **Ejecución** | Funciones reales | Guías para el LLM |
| **Almacenamiento** | Servidores externos | Base de datos / archivos |
| **Uso** | Acciones concretas | Comportamiento del agente |

**¿Puedo usar un servidor MCP remoto?**

Sí, siempre que sea accesible vía HTTP(S). Configura el transporte `sse` o `websocket` con la URL completa.

**¿Los servidores MCP se ejecutan en un sandbox?**

Depende del transporte:
- **STDIO**: Se ejecutan como procesos hijos (aislamiento parcial)
- **SSE/WebSocket**: Servicios externos (aislamiento de red)

**¿Cuántos servidores MCP puedo conectar?**

No hay límite硬性, pero se recomienda:
- **Máximo práctico**: 10-15 servidores
- **Herramientas totales**: < 100 para mantener el contexto manejable

**¿Puedo crear mi propio servidor MCP?**

¡Absolutamente! Usa el SDK oficial:
- **Node.js**: `@modelcontextprotocol/sdk`
- **Python**: `mcp`
- Sigue el protocolo estándar MCP

### Skills

**¿Cómo sé si mi skill se está activando?**

Revisa los logs del agente:
```
[SKILL] Trigger detectado: '/search' → web-research
[SKILL] FTS5 match: pdf-generator (score: 12.5)
```

**¿Por qué mi skill no se activa?**

Causas comunes:
1. **Triggers muy específicos**: Amplía los patrones
2. **Score FTS5 bajo**: Mejora nombre y descripción
3. **Skill desactivada**: Verifica `active: 1` en DB
4. **Conflicto con otra skill**: Otra skill tiene mayor score

**¿Puedo desactivar el sistema de skills?**

Sí, establece `HIVE_SKILLS_ENABLED=false` en `.env`.

**¿Las skills afectan el rendimiento?**

Mínimamente:
- **Búsqueda FTS5**: < 10ms
- **Inyección en prompt**: Aumenta ~500-1000 tokens
- **Impacto en LLM**: Depende del modelo, generalmente < 5%

**¿Cómo debuggeo una skill?**

1. **Muestra la skill**:
   ```bash
   hive skills show nombre-skill
   ```

2. **Prueba el trigger**:
   Envía un mensaje que contenga exactamente el trigger.

3. **Revisa el contexto**:
   Los logs muestran qué skills se inyectaron en el prompt.

**¿Puedo compartir skills con otros?**

Sí, las skills son archivos markdown portables:
- Comparte el archivo `SKILL.md`
- Usa GitHub/GitLab para versionado
- Crea un repositorio de skills de la comunidad

### Integración

**¿Puedo usar MCP y Skills juntos?**

¡Sí! De hecho, es la configuración recomendada:
- **Skills** guían al agente en el comportamiento
- **MCP** provee las herramientas ejecutables

**Ejemplo de flujo combinado**:

```
Usuario: "/search cómo conectar a PostgreSQL"
                ↓
Skill activada: web-research (trigger: /search)
                ↓
Skill instruye: "Busca información usando herramientas web"
                ↓
Agente usa: search (MCP tool de web-server)
                ↓
Resultado: Información mostrada al usuario
```

**¿Cómo veo qué herramientas MCP están disponibles?**

```bash
# Todas las herramientas
hive mcp tools --all

# De un servidor específico
hive mcp tools nombre-servidor
```

**¿Las skills se actualizan automáticamente?**

Solo las empaquetadas con `hive skills update`. Las creadas por el usuario son estáticas hasta que las edites.

---

## Glosario

| Término | Definición |
|---------|------------|
| **MCP** | Model Context Protocol, estándar para conectar IA con servicios |
| **Servidor MCP** | Proceso que expone herramientas y recursos via MCP |
| **Herramienta (Tool)** | Función ejecutable que el agente de IA puede invocar |
| **Transporte** | Medio de comunicación (stdio, SSE, WebSocket) |
| **Skill** | Habilidad: instrucciones en markdown para guiar al agente |
| **Trigger** | Patrón de texto que activa una skill explícitamente |
| **FTS5** | Full-Text Search versión 5, sistema de búsqueda semántica de SQLite |
| **Frontmatter** | Metadata YAML al inicio de un archivo SKILL.md |
| **Context Compiler** | Componente que construye el prompt del sistema |
| **Agent Loop** | Ciclo de razonamiento del agente de IA |
| **Hot Reload** | Recarga en caliente de servidores sin reiniciar |
| **Singleton** | Patrón de diseño: una única instancia global |
| **BM25** | Algoritmo de ranking para búsqueda de texto completo |
| **STDIO** | Standard Input/Output, comunicación por consola |
| **SSE** | Server-Sent Events, flujo unidireccional servidor→cliente |

---

## Apéndice: Referencia Rápida

### Comandos Más Usados

```bash
# MCP
hive mcp list                    # Listar servidores
hive mcp add nombre --transport stdio --command cmd  # Agregar
hive mcp test nombre             # Probar conexión
hive mcp tools nombre            # Ver herramientas
hive mcp remove nombre           # Eliminar servidor

# Skills
hive skills list                 # Listar skills
hive skills search término       # Buscar skill
hive skills show nombre          # Ver detalles
hive skills update               # Actualizar empaquetadas
```

### Endpoints de API REST

**MCP**:
| Método | Ruta | Acción |
|--------|------|--------|
| GET | `/api/mcp/servers` | Listar servidores |
| POST | `/api/mcp/servers` | Crear servidor |
| GET | `/api/mcp/servers/:id` | Ver detalles |
| PUT | `/api/mcp/servers/:id` | Actualizar |
| DELETE | `/api/mcp/servers/:id` | Eliminar |
| POST | `/api/mcp/servers/:id/toggle` | Conectar/desconectar |
| GET | `/api/mcp/servers/:id/tools` | Ver herramientas |

**Skills**:
| Método | Ruta | Acción |
|--------|------|--------|
| GET | `/api/skills` | Listar skills |
| POST | `/api/skills` | Crear skill |
| GET | `/api/skills/:id` | Ver detalles |
| PUT | `/api/skills/:id` | Actualizar |
| DELETE | `/api/skills/:id` | Eliminar |
| POST | `/api/skills/:id/toggle` | Activar/desactivar |
| GET | `/api/skills/search?q=` | Buscar por texto |

### Esquema de Base de Datos

**Tabla `mcp_servers`**:
```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  transport TEXT NOT NULL,
  command TEXT,
  args TEXT,
  url TEXT,
  headers TEXT,
  enabled INTEGER DEFAULT 1,
  active INTEGER DEFAULT 0,
  builtin INTEGER DEFAULT 0,
  status TEXT DEFAULT 'disconnected',
  tools_count INTEGER DEFAULT 0
);
```

**Tabla `skills`**:
```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tools TEXT,
  triggers TEXT,
  body TEXT NOT NULL,
  version TEXT,
  active INTEGER DEFAULT 1
);
```

**Tabla FTS5 `skills_fts`**:
```sql
CREATE VIRTUAL TABLE skills_fts USING fts5(
  id, name, category, tools, triggers, body,
  tokenize='unicode61'
);
```

---

**Última actualización**: Abril 2026  
**Versión del Manual**: 1.0  
**Versión de Hive**: Compatible con Hive v2.x
