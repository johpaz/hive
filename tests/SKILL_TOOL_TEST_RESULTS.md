# Test Results: Skill + Tool Integration

## 📊 Resumen Ejecutivo

Los tests validaron el flujo completo de búsqueda e inyección de skills y tools en el contexto del agente.

### Resultados

| Test | Estado | Descripción |
|------|--------|-------------|
| 1. BD + FTS5 Sync | ✅ | 63 tools, 29 skills en FTS5 |
| 2. Tool Search | ❌ | `selectTools` no retorna como se esperaba |
| 3. Skill Search (semántico) | ❌ | `code_generate` no se encuentra semánticamente |
| 4. Skill Search (trigger) | ✅ | `code_generate` se activa con trigger "generá código" |
| 5. Context Injection | ❌ | Skill no se inyecta porque no se activó |
| 6. Full Flow | ❌ | Herramientas encontradas, skills no |

---

## 🔍 Hallazgos Clave

### 1. Triggers Explícitos Funcionan Perfectamente

```
✅ "generá código" → code_generate (trigger match)
✅ "debugueá este error" → code_debug (trigger match)
✅ "refactorizá el código" → code_refactor (trigger match)
✅ "revisá el código" → code_review (trigger match)
```

**Conclusión:** El sistema de triggers explícitos es 100% efectivo cuando el usuario usa las palabras clave exactas.

---

### 2. Búsqueda Semántica FTS5 Tiene Problemas

```
❌ "generar código API REST" → code_delegator, code_refactor (NO code_generate)
❌ "generá código para un endpoint de usuarios" → voice_output, code_review (NO code_generate)
```

**Problema:** El FTS5 bm25() scoring no prioriza `code_generate` para mensajes sobre "generar código".

**Causa Raíz:**
- El cuerpo de la skill (`body`) tiene mucho texto de documentación
- Los triggers están en un campo separado (`triggers`)
- FTS5 indexa todo junto, diluyendo la relevancia de keywords clave

---

### 3. compileContext Inyecta Skills Descubiertas

Cuando `selectSkills` encuentra una skill:

```typescript
// En context-compiler.ts STEP-10d
for (const skill of allSkills) {
  skillsSection += `## ${skill.name}\n`
  skillsSection += `${skill.body.substring(0, 500)}...\n`
}
systemPrompt += skillsSection
```

**Funciona correctamente** cuando la skill se descubre. El problema es la descubierta, no la inyección.

---

### 4. Tools vs Skills - Mecanismos Diferentes

| Aspecto | Tools | Skills |
|---------|-------|--------|
| **Búsqueda** | `selectTools()` FTS5 | `selectSkills()` FTS5 + Triggers |
| **Inyección** | `tools: LLMToolDef[]` | `systemPrompt` (texto) |
| **LLM las usa** | Directamente (ejecuta) | Como guía (lee instrucciones) |
| **Trigger matching** | ❌ No tiene | ✅ Sí tiene |
| **Conversacional filter** | ✅ Sí | ✅ Sí |

---

## 🐛 Issues Identificados

### Issue 1: FTS5 Scoring para Skills

**Problema:** `code_generate` no se encuentra para "generar código API REST"

**Posibles soluciones:**

1. **Boost en triggers**: Ponderar más el campo `triggers` en FTS5
   ```sql
   -- Actualmente: bm25(skills_fts)
   -- Podría ser: bm25(skills_fts, 1.0, 2.0, 1.0, 1.0, 3.0, 1.0)
   -- Column weights: id, name, category, tools, triggers, body
   ```

2. **Agregar keywords al body**: Incluir variaciones en el cuerpo
   ```markdown
   triggers:
     - "generá código"
     - "crear código"
     - "generar código"  ← Agregar infinitivos
   ```

3. **Umbral más bajo**: Reducir `MIN_RELEVANCE_THRESHOLD` de `-5` a `-10`

---

### Issue 2: selectTools Usa CORE_TOOL_CATALOG

**Problema:** `selectTools()` usa un catálogo hardcoded, no las tools reales de la BD.

```typescript
export function selectTools(
    userMessage: string,
    fullToolList: ToolDescriptor[] = CORE_TOOL_CATALOG,  // ← Hardcoded
    ...
)
```

**Impacto:** Las tools nativas como `codebridge_launch` no se encuentran vía FTS5.

**Solución:** Pasar las tools reales desde `compileContext`:

```typescript
// En context-compiler.ts
const allTools = createAllTools(config)
const toolsForLLM = selectTools(userMessage, allTools, 10)
```

---

## ✅ Lo Que Funciona Bien

### 1. Trigger Matching (100% efectivo)

```typescript
// En skill-selector.ts
function matchTriggers(message: string, triggersJson: string | null): boolean {
    const triggers: string[] = triggersJson.split(",")
    return triggers.some(trigger =>
        message.toLowerCase().includes(trigger.toLowerCase())
    )
}
```

**Por qué funciona:** Búsqueda directa de substring, sin FTS5.

---

### 2. Minimal Skills (siempre disponibles)

```typescript
const MINIMAL_SKILL_NAMES = new Set([
  "memory_manager",
  "canvas_report", 
  "task_orchestrator",
])

// En context-compiler.ts
minimalSkills = getMinimalSkills()  // Query directa a DB
```

**Por qué funciona:** No depende de FTS5, es query directa por nombre.

---

### 3. Conversacional Filter

```
✅ "hola" → []
✅ "gracias" → []
✅ "cómo estás" → []
```

**Por qué funciona:** Patrones regex + stopwords, muy robusto.

---

## 📋 Recomendaciones

### Prioridad Alta

1. **Agregar triggers en infinitivo** a las skills de codebridge:
   ```markdown
   triggers:
     - "generá código"
     - "generar código"  ← Agregar
     - "crear código"    ← Agregar
   ```

2. **Reducir MIN_RELEVANCE_THRESHOLD** de `-5` a `-8`:
   ```typescript
   const MIN_RELEVANCE_THRESHOLD = -8  // Era -5
   ```

3. **Pasar tools reales a selectTools** desde compileContext:
   ```typescript
   const allTools = createAllTools(config)
   const toolsForLLM = selectTools(userMessage, allTools, 10)
   ```

### Prioridad Media

4. **FTS5 column weights** para priorizar triggers:
   ```typescript
   const ftsResults = db.query(`
     SELECT id, bm25(skills_fts, 1.0, 2.0, 1.0, 1.0, 3.0, 1.0) as bm25_score
     FROM skills_fts
     WHERE skills_fts MATCH ?
   `)
   // Weights: id=1, name=2, category=1, tools=1, triggers=3, body=1
   ```

5. **Log de skills disponibles** en compileContext:
   ```typescript
   log.info(`[context-compiler] Skills: ${allSkills.map(s => s.name).join(", ")}`)
   ```

---

## 🧪 Test Completo

Para ejecutar los tests:

```bash
# Skill Selector (básico)
bun run tests/skill-selector-test.ts

# Skill + Tool Integration (avanzado)
bun run tests/skill-tool-integration-test.ts
```

---

**Fecha:** 2026-03-27  
**Tester:** Hive Team  
**BD:** `.hive-dev/data/hive.db`  
**Skills:** 29 (4 codebridge)  
**Tools:** 63
