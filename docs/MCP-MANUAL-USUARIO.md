# Manual de Usuario: Servidores MCP en Hive

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [¿Qué es MCP?](#qué-es-mcp)
3. [Arquitectura del Sistema MCP](#arquitectura-del-sistema-mcp)
4. [Gestión de Servidores MCP](#gestión-de-servidores-mcp)
5. [Transportes Soportados](#transportes-soportados)
6. [Herramientas MCP](#herramientas-mcp)
7. [Interfaz de Usuario](#interfaz-de-usuario)
8. [Línea de Comandos (CLI)](#línea-de-comandos-cli)
9. [Configuración Avanzada](#configuración-avanzada)
10. [Conexión de Servidores Externos](#conexión-de-servidores-externos)
11. [Resolución de Problemas](#resolución-de-problemas)
12. [Preguntas Frecuentes](#preguntas-frecuentes)
13. [Glosario](#glosario)

---

## Introducción

Este manual cubre el sistema **MCP (Model Context Protocol)** de Hive, que permite conectar el agente de IA con servicios externos de manera modular y segura. Aprenderás a gestionar servidores MCP, explorar herramientas y solucionar problemas comunes.

---

## ¿Qué es MCP?

**MCP (Model Context Protocol)** es un protocolo estándar que permite conectar modelos de IA con servicios externos a través de **herramientas (tools)** y **recursos (resources)**.

En Hive, MCP actúa como un **puente** entre el agente de IA y servicios externos como:
- Bases de datos (PostgreSQL, MySQL, MongoDB)
- APIs REST y GraphQL
- Sistemas de archivos
- Herramientas de desarrollo (linters, test runners)
- Servicios de búsqueda web
- Cualquier servicio que implemente el protocolo MCP

### Características Principales

- **Conexión en tiempo real**: Los servidores se conectan directamente al agente de IA
- **Múltiples transportes**: Soporta STDIO, SSE (Server-Sent Events) y WebSocket
- **Descubrimiento automático**: Las herramientas se detectan automáticamente al conectar
- **Recarga en caliente**: Los servidores se pueden agregar o eliminar sin reiniciar el sistema
- **Ejecución segura**: Las herramientas se ejecutan en contextos aislados con permisos controlados

---

## Arquitectura del Sistema MCP

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
- **Hot Reload**: El sistema detecta cambios en la configuración cada 2 segundos

---

## Gestión de Servidores MCP

### Tabla de Base de Datos: `mcp_servers`

Cada servidor MCP se configura con los siguientes campos:

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
| `status` | TEXT | Estado actual | `connected`, `disconnected`, `error` |
| `tools_count` | INTEGER | Número de herramientas detectadas | 12 |

### Estados del Servidor

| Estado | Icono | Significado | Acción |
|--------|-------|-------------|--------|
| `connected` | 🟢 | Servidor conectado y herramientas disponibles | Ninguna |
| `disconnected` | ⚪ | Servidor desconectado | Haz clic en "Conectar" |
| `connecting` | 🟡 | En proceso de conexión | Espera unos segundos |
| `error` | 🔴 | Error de conexión o configuración | Revisa logs y configuración |

### Operaciones Básicas

#### Agregar un Servidor

**Desde la Interfaz Web**:

1. Navega a **Configuración → Servidores MCP**
2. Haz clic en **"Agregar Servidor"**
3. Completa el formulario:
   - **Nombre**: Identificador único
   - **Transporte**: `stdio`, `sse`, o `websocket`
   - **Comando y Argumentos** (para stdio)
   - **URL** (para sse/websocket)
   - **Headers** (opcional, se encriptan)
4. Haz clic en **"Guardar y Conectar"**

**Desde la CLI**:

```bash
# Servidor con STDIO
hive mcp add filesystem \
  --transport stdio \
  --command npx \
  --args '["-y", "@modelcontextprotocol/server-filesystem", "/path"]'

# Servidor con SSE
hive mcp add database \
  --transport sse \
  --url http://localhost:3001/sse \
  --headers '{"Authorization": "Bearer token"}'

# Servidor con WebSocket
hive mcp add realtime \
  --transport websocket \
  --url ws://localhost:3002/ws
```

#### Conectar/Desconectar un Servidor

**Interfaz Web**:
- Botón de toggle en la tarjeta del servidor

**CLI**:
```bash
hive mcp toggle nombre-servidor
```

#### Editar un Servidor

1. Haz clic en el **icono de edición** (✏️)
2. Modifica los campos necesarios
3. Guarda cambios (la conexión se reinicia automáticamente)

#### Eliminar un Servidor

**Interfaz Web**:
- Botón **Eliminar** → Confirmar

**CLI**:
```bash
hive mcp remove nombre-servidor
```

⚠️ **Advertencia**: Eliminar un servidor desconectará todas sus herramientas inmediatamente.

---

## Transportes Soportados

### 1. STDIO (Entrada/Salida Estándar)

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
- ✅ Ideal para herramientas locales
- ✅ Sin necesidad de servidor HTTP
- ✅ Aislamiento natural del proceso

**Ejemplos comunes**:
- Acceso al sistema de archivos
- Ejecución de comandos
- Herramientas de desarrollo local (linters, formatters)

### 2. SSE (Server-Sent Events)

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
- ✅ Comunicación unidireccional servidor → cliente
- ✅ Baja latencia
- ✅ Ideal para notificaciones en tiempo real

**Casos de uso**:
- APIs de bases de datos
- Servicios de búsqueda
- Notificaciones push

### 3. WebSocket

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
- ✅ Comunicación bidireccional completa
- ✅ Ideal para datos en tiempo real
- ✅ Baja sobrecarga de protocolo

**Casos de uso**:
- Colaboración en tiempo real
- Streaming de datos
- Chat y mensajería

---

## Herramientas MCP

### ¿Qué es una Herramienta MCP?

Una herramienta MCP es una **función ejecutable** que el agente de IA puede invocar. Cada herramienta tiene:

- **Nombre**: Identificador único dentro del servidor
- **Descripción**: Explicación de lo que hace
- **Parámetros**: Schema JSON de entrada (JSON Schema)
- **Función de ejecución**: Lógica que procesa la llamada

### Ejemplo de Herramienta

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

### Herramientas Comunes por Categoría

#### Sistema de Archivos

| Herramienta | Descripción | Parámetros |
|-------------|-------------|------------|
| `read_file` | Leer archivo | `path` (string) |
| `write_file` | Escribir archivo | `path`, `content` |
| `list_directory` | Listar directorio | `path` |
| `delete_file` | Eliminar archivo | `path` |

#### Base de Datos

| Herramienta | Descripción | Parámetros |
|-------------|-------------|------------|
| `query` | Ejecutar consulta SQL | `sql` (string) |
| `insert` | Insertar registro | `table`, `data` |
| `update` | Actualizar registro | `table`, `data`, `where` |
| `delete` | Eliminar registro | `table`, `where` |

#### Web

| Herramienta | Descripción | Parámetros |
|-------------|-------------|------------|
| `search` | Buscar en internet | `query` (string) |
| `fetch_url` | Obtener contenido de URL | `url` (string) |
| `screenshot` | Captura de pantalla | `url`, `viewport` |

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

Para cada servidor conectado, muestra tarjetas de herramientas:

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

---

## Línea de Comandos (CLI)

### `hive mcp list`

Lista todos los servidores MCP configurados:

```
Servidores MCP configurados:

  🟢 filesystem-server     stdio      12 herramientas
  🟢 database-server       sse        8 herramientas
  ⚪ search-server         sse        0 herramientas (desconectado)
  🔴 api-server            websocket  Error: connection refused

Total: 4 servidores (2 conectados, 1 desconectado, 1 error)
```

### `hive mcp add <nombre>`

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

### `hive mcp test <nombre>`

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

### `hive mcp tools <nombre>`

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

### `hive mcp remove <nombre>`

Elimina un servidor MCP:

```bash
hive mcp remove filesystem-server

¿Estás seguro de que deseas eliminar 'filesystem-server'? (y/N): y
✅ Servidor 'filesystem-server' eliminado correctamente
```

---

## Configuración Avanzada

### Variables de Entorno

| Variable | Tipo | Valor por Defecto | Descripción |
|----------|------|-------------------|-------------|
| `HIVE_MCP_ENABLED` | boolean | `true` | Habilitar sistema MCP |
| `HIVE_MCP_RELOAD_INTERVAL` | number | `2000` | Intervalo de hot-reload (ms) |
| `HIVE_MCP_MAX_CONCURRENT` | number | `10` | Máximo de herramientas MCP ejecutándose en paralelo |

### Configuración en `config.json`

Alternativa a la base de datos para servidores estáticos:

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

## Conexión de Servidores Externos

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

---

## Resolución de Problemas

### El servidor no se conecta

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

### Herramientas no aparecen

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

### Error al ejecutar herramienta

**Síntomas**: La herramienta existe pero falla al ejecutarse

**Soluciones**:

1. **Verificar parámetros**: Asegurar que todos los requeridos están presentes
2. **Revisar permisos**: Algunas herramientas requieren autenticación
3. **Validar entrada**: Probar con parámetros mínimos

### Logs y Depuración

```bash
# Logs en tiempo real
tail -f logs/mcp.log

# Logs de un servidor específico
hive mcp logs my-server --follow

# Modo debug
export HIVE_DEBUG_MCP=true
hive restart
```

---

## Preguntas Frecuentes

### General

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

### Rendimiento

**¿Cuántos servidores MCP puedo conectar?**

No hay límite硬性, pero se recomienda:
- **Mínimo**: 2-3 servidores esenciales
- **Recomendado**: 5-7 servidores
- **Máximo práctico**: ~15 servidores (depende de hardware)

**¿Las herramientas MCP ralentizan el agente?**

Ligeramente. Cada herramienta añade una definición al contexto (~100-200 tokens). Con 50 herramientas = ~10,000 tokens extra.

### Seguridad

**¿Las credenciales de MCP están seguras?**

Sí, los headers se **encriptan** antes de almacenarse en la base de datos.

**¿Las herramientas MCP pueden acceder a mi sistema?**

Depende de qué herramientas implemente el servidor MCP. Revisa siempre la documentación del servidor antes de conectarlo.

### Desarrollo

**¿Cómo creo un servidor MCP propio?**

1. Usa el SDK de MCP: `@modelcontextprotocol/sdk` (Node.js) o `mcp` (Python)
2. Implementa el protocolo (stdio, SSE, o WebSocket)
3. Define tus herramientas con esquemas JSON
4. Registra el servidor en Hive

---

## Glosario

| Término | Definición |
|---------|------------|
| **MCP** | Model Context Protocol, estándar para conectar IA con servicios |
| **Servidor MCP** | Proceso que expone herramientas y recursos via MCP |
| **Herramienta (Tool)** | Función ejecutable que el agente de IA puede invocar |
| **Transporte** | Medio de comunicación (stdio, SSE, WebSocket) |
| **Context Compiler** | Componente que construye el prompt del sistema |
| **Agent Loop** | Ciclo de razonamiento del agente de IA |
| **Hot Reload** | Recarga en caliente de servidores sin reiniciar |
| **Singleton** | Patrón de diseño: una única instancia global |
| **STDIO** | Standard Input/Output, comunicación por consola |
| **SSE** | Server-Sent Events, flujo unidireccional servidor→cliente |
| **WebSocket** | Protocolo de comunicación bidireccional sobre TCP |

---

## Apéndice: Referencia Rápida

### Comandos Más Usados

```bash
hive mcp list                    # Listar servidores
hive mcp add nombre --transport stdio --command cmd  # Agregar
hive mcp test nombre             # Probar conexión
hive mcp tools nombre            # Ver herramientas
hive mcp remove nombre           # Eliminar servidor
hive mcp toggle nombre           # Conectar/desconectar
```

### Endpoints de API REST

| Método | Ruta | Acción |
|--------|------|--------|
| GET | `/api/mcp/servers` | Listar servidores |
| POST | `/api/mcp/servers` | Crear servidor |
| GET | `/api/mcp/servers/:id` | Ver detalles |
| PUT | `/api/mcp/servers/:id` | Actualizar |
| DELETE | `/api/mcp/servers/:id` | Eliminar |
| POST | `/api/mcp/servers/:id/toggle` | Conectar/desconectar |
| GET | `/api/mcp/servers/:id/tools` | Ver herramientas |

### Esquema de Base de Datos

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

---

**Última actualización**: Abril 2026  
**Versión del Manual**: 1.0  
**Versión de Hive**: Compatible con Hive v2.x
