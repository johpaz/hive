# Hive v0.0.30 - Release Notes

## Release Date
2026-04-22

## Resumen de Cambios

### 🚀 Nuevas Funcionalidades

#### 1. Sistema de Búsqueda FTS5 Unificado
- **FTS5 (Full-Text Search)** ahora indexa: tools, skills, playbook, mcp_tools
- Búsqueda bilingüe ES→EN automática (traduce español a inglés si hay pocos resultados)
- threshholds diferenciados:
  - tools: -30 (antes -100)
  - skills: -15
  - playbook: -10

#### 2. MCP Tools Persistence
- Tablas `mcp_tools` + `mcp_tools_fts` para persistir herramientas MCP
- Sincronización automática: `syncMCPToolsToDB()` + `syncMCPToolsToFTS()`
- Limpieza al desconectar: `clearMCPToolsFromDB()`
- hot-reload vigila cambios en servidores MCP

#### 3. Descubrimiento Dinámico de Herramientas
- Solo 4 tools en contexto inicial: search_knowledge, save_note, notify, report_progress
- Herramientas se descubren vía `search_knowledge(type="mcp", query="...")`
- Inyección dinámica en agent-loop cuando search_knowledge retorna tools
- MCP tools se activan dinámicamente, no estáticas en contexto

#### 4. Skills con Schema Completo
- 9 columnas nuevas en tabla `skills`:
  - description (TEXT)
  - version (TEXT)
  - version_num (INTEGER)
  - author (TEXT)
  - icon (TEXT)
  - permissions (TEXT)
  - dependencies (TEXT)
  - preferred_agents (TEXT)
- FTS5 incluye `description` con peso alto (5.0)

### 📦 Archivos Nuevos/Creados

| Archivo | Descripción |
|--------|--------------|
| `packages/core/src/mcp/tool-sync.ts` | Sync de herramientas MCP a BD y FTS5 |
| `tests/test_mcp_tools_persistence.ts` | Tests de persistencia MCP (35 tests) |
| `tests/fts5-schema-v0_28-test.ts` | Tests FTS5 skills schema (28 tests) |
| `packages/skills/src/bundled/search_knowledge/busqueda_fts5/SKILL.md` | Skill de discovery |
| `packages/skills/src/bundled-data.generated.ts` | Bundle regenerado de skills |

### 🔧 Archivos Modificados

| Paquete | Archivo | Cambio |
|---------|---------|--------|
| core | storage/schema.ts | +mcp_tools + mcp_tools_fts tables |
| core | storage/onboarding.ts | Migración v0.0.29, v0.0.30, v0.0.31 |
| core | storage/seed.ts | Skills schema v0.0.28, reseed MCP tools |
| core | agent/context-compiler.ts | MCP dinámico, skills mínimos, Canvas entfernt |
| core | agent/agent-loop.ts | Dynamic tool injection für MCP |
| core | agent/skill-selector.ts | FTS5 weights |
| core | tool-selector.ts | Threshold -30 |

### 🗄️ Migraciones de Base de Datos

| Versión | Descripción |
|---------|-------------|
| v0.0.28 | Skills schema expandido + description in FTS5 |
| v0.0.29 | mcp_tools + mcp_tools_fts tables + re-seed skills |
| v0.0.30 | NVIDIA NIM provider + 12 free models |
| v0.0.31 | Reduced system_prompt + skills sync |

### 📉 Reducciones

| Métrica | Antes | Después | Reducción |
|--------|-------|----------|-----------|
| System prompt | ~5,200 tokens | ~620 tokens | 88% |
| Canvas docs inyectados | ~3,000 tokens | 0 | 100% |
| Tools en contexto | 52 | 4 + discovery | 92% |
| Skills en contexto | ~35 | 3 + discovery | 91% |

### ⚠️ Breaking Changes

1. **MCP Tools**: Ya no están estáticas en contexto. Usar `search_knowledge(type="mcp", query="...")` para descubrir
2. **Skills**: Schema expandido - necesario migration v0.0.28
3. **System Prompt**: Reducido - necesario migration v0.0.31

### 🧪 Tests

- `tests/test_mcp_tools_persistence.ts`: 35/35 ✅
- `tests/fts5-schema-v0_28-test.ts`: 28/28 ✅

### 🔑 Notas de Upgrade

```bash
# Para actualizar usuarios existentes:
# 1. Ejecutar migrate - el sistema ejecuta automáticamente v0.0.31
# 2. Regenerar bundle: bun packages/skills/scripts/generate-bundle.ts

# Verificar estado:
sqlite3 hive.db "SELECT name, length(system_prompt) FROM agents WHERE role='coordinator'"
# Debe mostrar ~2465 chars (~616 tokens)
```