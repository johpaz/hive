# MCP Direct Connection - Arquitectura Simplificada

## Resumen

**Las herramientas MCP están directamente disponibles** para el agente sin guardarse en la base de datos.

## Arquitectura

### Antes (Con Tablas DB)

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server → tools_mcp table → tools_mcp_fts5 → Búsqueda    │
└─────────────────────────────────────────────────────────────┘
```

**Problemas:**
- Duplicación de datos (MCP server + DB)
- Sincronización compleja
- Queries FTS5 innecesarias
- Schema sobrecargado

### Ahora (Direct Connection)

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server → MCP Manager → context-compiler → Agente        │
└─────────────────────────────────────────────────────────────┘
```

**Beneficios:**
- ✅ Single source of truth (MCP server)
- ✅ Sin sincronización DB
- ✅ Sin tablas tools_mcp ni tools_mcp_fts5
- ✅ Schema simplificado
- ✅ Tools siempre actualizadas (desde origen)

## Schema de Base de Datos

### Tablas Eliminadas

```sql
-- ELIMINADA: tools_mcp
-- Las herramientas ya no se guardan en DB

-- ELIMINADA: tools_mcp_fts5
-- FTS5 no es necesario sin búsqueda
```

### Tablas Conservadas

```sql
-- mcp_servers: Solo configuración de servidores
CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  transport   TEXT NOT NULL,
  command     TEXT,
  args        TEXT,
  env_encrypted TEXT,
  env_iv      TEXT,
  headers_encrypted TEXT,
  headers_iv  TEXT,
  url         TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 0,
  builtin     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'disconnected',
  tools_count INTEGER DEFAULT 0
);
```

**Nota:** `tools_count` es solo informativo (se actualiza al conectar).

## Flujo de Herramientas MCP

```
1. Usuario configura MCP server en DB (mcp_servers)
   ↓
2. hot-reload detecta server nuevo
   ↓
3. MCP Manager se conecta al server
   ↓
4. MCP Manager obtiene herramientas del server
   ↓
5. context-compiler carga herramientas en runtime
   ↓
6. Agente recibe herramientas directamente
```

## Cambios en el Código

### Eliminados

| Archivo | Eliminado |
|---------|-----------|
| `tools_mcp` table | ✅ |
| `tools_mcp_fts5` table | ✅ |
| `syncMCPToolsToFTS()` | ✅ |
| `removeMCPToolsFromFTS()` | ✅ |
| `handleToggleMCPTool()` | ✅ |
| `handleDeleteMCPTool()` | ✅ |
| `type=toolsmcp` en search_knowledge | ✅ |

### Modificados

| Archivo | Cambio |
|---------|--------|
| `context-compiler.ts` | Carga MCP tools directamente del MCP Manager |
| `hot-reload.ts` | Solo trackea servidores, no herramientas |
| `mcp.ts` (routes) | Get tools desde MCP Manager, no DB |
| `search_knowledge` | Sin type=toolsmcp |

## API

### GET /api/mcp/servers

```json
{
  "servers": [
    {
      "id": "email-gmail",
      "name": "Email Gmail",
      "status": "connected",
      "tools_count": 23
    }
  ]
}
```

### GET /api/mcp/servers/:id/tools

```json
{
  "tools": [
    {
      "name": "send_email",
      "description": "Send an email...",
      "inputSchema": {...}
    }
  ]
}
```

**Nota:** Las herramientas se cargan desde MCP Manager en runtime, no desde DB.

## Migración

### Para Usuarios Existentes

Las tablas `tools_mcp` y `tools_mcp_fts5` pueden eliminarse:

```sql
DROP TABLE IF EXISTS tools_mcp;
DROP TABLE IF EXISTS tools_mcp_fts5;
```

**Nota:** Los datos se pierden pero no importan - las herramientas se cargan desde los servidores MCP.

### Para Nuevos MCPs

1. Crear servidor en DB:
```sql
INSERT INTO mcp_servers (id, name, transport, command, enabled)
VALUES ('email-gmail', 'Email Gmail', 'stdio', 'node email-gmail.js', 1);
```

2. hot-reload detecta y conecta automáticamente

3. Herramientas disponibles inmediatamente para agentes

## Tests

```bash
bun tests/test_mcp_direct_connection.ts
```

**Valida:**
- ✅ tools_mcp table eliminada
- ✅ tools_mcp_fts5 table eliminada
- ✅ mcp_servers table existe
- ✅ search_knowledge sin type=toolsmcp
- ✅ MCP tools disponibles directamente

## Consideraciones

### Tokens

- **Antes:** Tools en DB + FTS5 + búsqueda = ~2000 tokens extra
- **Ahora:** Tools directas = ~15,000 tokens (descripciones completas)

**Optimizaciones futuras:**
- Tool descriptions comprimidas
- Lazy loading por contexto
- Tool grouping

### Performance

- **Antes:** Query DB + FTS5 + sync = ~50ms
- **Ahora:** Carga directa = ~5ms

### Mantenimiento

- **Antes:** Sync DB ↔ MCP server compleja
- **Ahora:** Single source of truth (MCP server)

## Referencias

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [context-compiler.ts](../packages/core/src/agent/context-compiler.ts)
- [hot-reload.ts](../packages/core/src/mcp/hot-reload.ts)
