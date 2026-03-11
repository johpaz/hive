# MCP Search Tests

Tests para validar la búsqueda de herramientas MCP y su disponibilidad directa.

## Arquitectura Actual (Direct Connection)

**Las herramientas MCP están directamente disponibles** para el agente sin necesidad de búsqueda.

**Flujo:**
1. El usuario configura un servidor MCP (ej: `email-gmail`)
2. El MCP se conecta y sincroniza sus herramientas
3. **Todas las herramientas MCP se incluyen automáticamente** en el loadout del agente
4. El agente puede usarlas directamente sin `search_knowledge`

**Ventajas:**
- ✅ Sin latencia de búsqueda
- ✅ Sin tokens extra para búsqueda
- ✅ Experiencia de usuario más simple
- ✅ Las herramientas MCP son ciudadanas de primera clase

**Desventajas:**
- ⚠️ Consume más tokens del contexto (todas las herramientas MCP están siempre presentes)

## Problema Histórico Resuelto

**Síntoma original:** El MCP `email-gmail` estaba conectado con 23 herramientas, pero el agente no podía usarlas porque:
1. Las herramientas MCP se filtraban y no llegaban al LLM
2. El agente tenía que "buscar" las herramientas con `search_knowledge`
3. La búsqueda FTS5 no funcionaba correctamente para multi-término

**Causa raíz:**
1. **Arquitectura incorrecta**: MCP tools se filtraban como las nativas
2. **FTS5 pattern para múltiples palabras**: Usaba `"email send"` (frase exacta) en lugar de `email* AND send*`
3. **Descripciones enriquecidas incompletas**: Faltaban keywords como "smtp", "mail", "inbox"

**Fixes aplicados:**
1. **Conexión directa**: Todas las herramientas MCP se incluyen automáticamente
2. **FTS5 pattern**: Ahora usa `email* AND send*` para búsquedas multi-palabra (por si se usa search_knowledge)
3. **Keywords enriquecidas**: Se agregan keywords específicas por tipo de herramienta
```

## Tests

### Test de Diagnóstico

**Archivo:** `tests/test_mcp_search.ts`

Propósito: Diagnosticar el problema exacto de búsqueda FTS5

**Ejecutar:**
```bash
bun tests/test_mcp_search.ts
```

**Qué valida:**
- Inserción correcta de herramientas MCP en FTS5
- Búsquedas con múltiples términos ("email send")
- Búsquedas con keywords específicas ("smtp mail send")
- JOIN entre `tools_mcp_fts5` y `tools_mcp`

### Test de Validación

**Archivo:** `tests/test_mcp_search_validation.ts`

Propósito: Validar que el tool `search_knowledge` real funciona correctamente

**Ejecutar:**
```bash
bun tests/test_mcp_search_validation.ts
```

**Qué valida:**
- Búsqueda "email send" → encuentra `send_email`
- Búsqueda "smtp mail send" → encuentra `send_email`
- Búsqueda "html email" → encuentra `send_html_email`
- Búsqueda "get inbox emails" → encuentra `get_emails`

## Resultados Esperados

Todas las búsquedas multi-término ahora funcionan:

| Búsqueda | Antes | Después |
|----------|-------|---------|
| "email send" | 0 resultados | ✅ 2+ resultados |
| "smtp mail send" | 0 resultados | ✅ 2+ resultados |
| "html email" | 0 resultados | ✅ 2+ resultados |
| "get inbox emails" | 0 resultados | ✅ 1+ resultados |
| "gmail" | ✅ 3 resultados | ✅ 3 resultados |
| "send" | ✅ 2 resultados | ✅ 2 resultados |

## Comandos Útiles

```bash
# Ejecutar test de diagnóstico
bun tests/test_mcp_search.ts

# Ejecutar test de validación
bun tests/test_mcp_search_validation.ts

# Ejecutar tests existentes (filtrar conversational)
bun test -t "Conversational" tests/tool-selector.test.ts
```

## Referencias

- [FTS5 Query Syntax](https://www.sqlite.org/fts5.html#full_text_query_syntax)
- `packages/core/src/tools/core/index.ts` - search_knowledge tool
- `packages/core/src/agent/tool-selector.ts` - syncMCPToolsToFTS
