# Benchmark: Skills Loading — HiveDB (actual) vs SQLite (histórico)

## Medición actual — HiveDB (2026-07-23)

Re-corrida contra el motor actual con `scripts/bench-skills-hivedb.ts` — instancia HiveDB
`:memory:`, seed real completo (mismo path que un boot real del gateway: `ensureHiveDb()`),
promedio de 20 corridas en caliente por operación.

**Motor:** `@johpaz/hive-db` — redb (KV) + tantivy (BM25 full-text) + hnsw (vectores)
**Catálogo seedeado:** 64 tools, 29 skills, 114 modelos, 16 providers, 8 reglas de playbook
**Boot + seed completo:** 32.46ms

### Tiempos

| Operación | Promedio | Min | Max |
|-----------|----------|-----|-----|
| `getSkillByName()` — 1 skill | 0.09ms | 0.06ms | 0.16ms |
| `getAllSkillsFromDB()` — 29 skills | 0.91ms | 0.71ms | 1.72ms |
| `getMinimalSkills()` — 4 skills (`canvas_report`, `capability_discovery`, `memory_manager`, `task_orchestrator`) | 0.89ms | 0.71ms | 1.32ms |
| `searchCapabilities()` BM25 (tantivy), k=10 | 0.13ms | 0.07ms | 0.89ms |

### Tokens

| Métrica | Tokens |
|---------|--------|
| 29 skills (catálogo completo, body incluido) | 13,891 |
| 4 skills mínimas (body completo) | 1,976 |
| 4 skills mínimas (solo metadata: nombre + descripción) | 104 |

**Notas:**
- El catálogo real hoy tiene **29 skills** (no 35 como en el benchmark SQLite de 2026-04-22) y **4 skills mínimas siempre cargadas** (no 3) — `capability_discovery` se agregó al set mínimo desde entonces.
- Todos los tiempos son sub-milisegundo incluso para el catálogo completo; el discovery BM25 vía tantivy (0.13ms avg) es comparable o más rápido que el FTS5 de SQLite medido en el benchmark histórico (~2ms) sobre un catálogo más chico.
- **Control disco vs memoria**: la misma corrida contra una instancia HiveDB real en disco (no `:memory:`) dio `getAllSkillsFromDB()` = 1.31ms avg (vs 0.96ms en memoria) — la diferencia entre disco y memoria es marginal, así que no explica por sí sola la mejora frente a los ~7ms del benchmark SQLite viejo. El tamaño de catálogo tampoco (29 vs 35 skills es solo ~17% menos ítems). Dicho esto, **no es una comparación controlada uno-a-uno**: se desconoce el hardware/carga del sistema del benchmark de abril 2026, y el código SQLite ya no existe para re-correrlo bajo las mismas condiciones — la dirección (más rápido, no regresión) es clara, la magnitud exacta no tiene ese nivel de rigor.
- Reproducir: `bun run scripts/bench-skills-hivedb.ts` (agregar `HIVE_DB_PATH=/ruta` para correr contra disco en vez de `:memory:`)

---

## Benchmark histórico — SQLite vs YAML (obsoleto)

> ⚠️ **Documento histórico.** Todo lo que sigue es de 2026-04-22, cuando Hive todavía usaba
> SQLite (`~/.hive/data/hive.db`) como storage. Hive migró después a HiveDB (arriba). Ni
> `storage/sqlite.ts` ni los tests referenciados abajo (`tests/yaml-vs-sqlite-benchmark.test.ts`,
> `tests/context-inference*.test.ts`) existen ya en el repo. Se conserva solo como referencia
> histórica de metodología y para comparar contra la medición actual de arriba.

**Fecha:** 2026-04-22  
**Agente:** Bee (coordinator)  
**BD:** `~/.hive/data/hive.db` (SQLite — motor reemplazado desde entonces por HiveDB)

---

## Resumen Ejecutivo

| Métrica | Hive (SQLite) | Externo (YAML) | Ventaja |
|---------|---------------|-----------------|---------|
| Load 1 skill | **0.8ms** | ~1-5ms | 🟢 SQLite |
| Load all (35 skills) | **7ms** | ~10-50ms | 🟢 SQLite |
| FTS5 discovery | **~2ms** | ~5-20ms | 🟢 SQLite |
| Tokens en contexto | **8k** (7 skills) | ~500-5k+ | 🟡 Similar |

---

## Tiempos Reales Medidos

### SQLite (Hive)

| Operación | Tiempo | Notas |
|-----------|--------|-------|
| SQL SELECT 1 skill | **0.8ms** | |
| SQL SELECT all (35 skills) | **7.1ms** | |
| FTS5 search | **2.0ms** | |
| getMinimalSkills() | **2.1ms** | 3 skills |

### YAML (Simulado/Referencia)

| Operación | Tiempo Estimado | Notas |
|-----------|-----------------|-------|
| fs.readFileSync | ~42µs | Simulado |
| YAML parse frontmatter | ~476µs | |
| Parse real YAML | ~1-5ms | Según tamaño |

---

## TOKENS - Resultados Reales

### Hive (SQLite) - MEDIDOS

| Métrica | Tokens | Notas |
|----------|--------|-------|
| 35 skills (BD completa) | **22,000 tokens** | Todas las skills |
| 7 skills (contexto) | **8,000 tokens** | Las que se cargan |
| Tier 1 (minimal 3) | **82 tokens** | Solo metadata |

### Externo (YAML) - REFERENCIA

| Tier | Tokens/Skill | Referencia |
|------|-------------|------------|
| Tier 1 (metadata) | ~50 | Agent Skills Std |
| Tier 2 (full body) | 500-5,000 | Según contenido |
| Tier 3 (resources) | 2,000+ | Si tiene refs |

---

## Comparativa con Benchmarks Externos

| Proyecto | Storage | Token Reduction | Método |
|---------|---------|-----------------|--------|
| **Hive (nuestro)** | SQLite | - | FTS5 discovery |
| Agent Skills Standard | YAML | 10x (5k→500) | Tier 1/2/3 |
| CrewAI | YAML | 91% (3.3k→278) | read_file() |
| Anthropic | YAML | 98.7% (150k→2k) | Progressive |

---

## Tabla Comparativa Final

```
+---------------------+----------------+------------------+------------+
| Métrica            | Hive (SQLite) | Externo (YAML)  | Ganador   |
+---------------------+----------------+------------------+------------+
| Load 1 skill       | 0.8ms        | 1-5ms          | SQLite   |
| Load all (35)      | 7ms           | 10-50ms        | SQLite   |
| FTS5 discovery     | 2ms           | 5-20ms         | SQLite   |
| Tokens/metadata    | 30/skill     | 50/skill       | SQLite   |
| Tokens/contexto    | 8k (7skills) | 500-5k+/skill  | Similar  |
| Parsing overhead   | None          | YAML parse     | SQLite   |
+---------------------+----------------+------------------+------------+
```

---

## Análisis de Tokens

### Hive (Nuestro):
- **22k tokens** = 35 skills en BD completa
- **8k tokens** = 7 skills en contexto activo
- **82 tokens** = 3 minimal skills (Tier 1)

### Externo (YAML):
- **50 tokens** = Tier 1 metadata (por skill)
- **500-5k tokens** = Tier 2 full body (por skill)
- **2k+ tokens** = Tier 3 resources

---

## Conclusiones

1. **Hive (SQLite) es más rápido** en carga que YAML
   - No hay overhead de parse de YAML
   - SQL SELECT es más directo (~0.8ms vs ~1-5ms)

2. **FTS5 discovery es eficiente**
   - ~2ms para búsqueda
   - Comparable o mejor que soluciones YAML (~5-20ms)

3. **Tokens: Similar enfoque de tiering**
   - Hive: minimal skills + discovered
   - YAML: Tier 1/2/3
   - Ambos cargan solo lo necesario

4. **Ventajas de SQLite:**
   - No necesita filesystem
   - Queries indexadas con FTS5
   - Transacciones ACID

---

## Tests Disponibles (histórico — ya no existen)

```bash
# Benchmark completo
bun test tests/yaml-vs-sqlite-benchmark.test.ts

# Test de timing
bun test tests/context-inference-timing.test.ts

# Test de inferencia
bun test tests/context-inference.test.ts
```

Para la medición actual, usar en cambio: `bun run scripts/bench-skills-hivedb.ts` (ver arriba).

---

*Generado automaticamente - Test suite: `tests/yaml-vs-sqlite-benchmark.test.ts`*
*Fecha: 2026-04-22*