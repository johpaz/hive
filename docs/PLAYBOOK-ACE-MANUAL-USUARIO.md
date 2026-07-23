# Manual de Usuario: Playbook del ACE (Adaptive Context Engine)

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [¿Qué es el Playbook?](#qué-es-el-playbook)
3. [¿Qué es el ACE?](#qué-es-el-ace)
4. [¿Por qué se usa el Playbook?](#por-qué-se-usa-el-playbook)
5. [Arquitectura del Ciclo ACE](#arquitectura-del-ciclo-ace)
6. [Schema de la Base de Datos](#schema-de-la-base-de-datos)
7. [Categorías de Reglas](#categorías-de-reglas)
8. [El Ciclo de Vida de una Regla](#el-ciclo-de-vida-de-una-regla)
9. [Selección de Reglas con FTS5](#selección-de-reglas-con-fts5)
10. [Inyección en el System Prompt](#inyección-en-el-system-prompt)
11. [Dónde se Usa en el Sistema](#dónde-se-usa-en-el-sistema)
12. [Reglas Iniciales (Seed)](#reglas-iniciales-seed)
13. [Flujo de Datos Completo](#flujo-de-datos-completo)
14. [Configuración y Constantes](#configuración-y-constantes)
15. [Herramienta search_knowledge](#herramienta-search_knowledge)
16. [Interacción con el Context Compiler](#interacción-con-el-context-compiler)
17. [Relación con Otros Componentes](#relación-con-otros-componentes)
18. [Resolución de Problemas](#resolución-de-problemas)
19. [Preguntas Frecuentes](#preguntas-frecuentes)
20. [Glosario](#glosario)

---

## Introducción

Este manual cubre el sistema de **Playbook** de Hive, componente central del **ACE (Adaptive Context Engine)** — el mecanismo de auto-aprendizaje que permite a los agentes mejorar su comportamiento con el tiempo sin intervención manual.

El Playbook es un conjunto **evolutivo de reglas de comportamiento** almacenado en HiveDB, aprendido automáticamente a partir de las trazas de ejecución del agente, que se inyecta en el system prompt en tiempo de ejecución mediante búsqueda de texto completo BM25 (tantivy).

---

## ¿Qué es el Playbook?

El **Playbook** es una colección de documentos HiveDB (`playbook`) que contiene **reglas de comportamiento** aprendidas por el propio sistema a partir de la experiencia. Cada regla captura un patrón detectado durante la ejecución del agente:

- Qué herramientas funcionan mejor para ciertas tareas
- Qué errores se repiten y cómo evitarlos
- Qué operaciones son lentas y cómo optimizarlas
- Cómo estructurar mejor la creación de agentes worker
- Cómo mejorar la calidad de las respuestas

A diferencia de las **Skills** (instrucciones escritas manualmente por el usuario), las reglas del Playbook se **generan y mantienen automáticamente**. El sistema observa su propia ejecución, detecta patrones, y los convierte en reglas que guían futuras ejecuciones.

---

## ¿Qué es el ACE?

El **ACE (Adaptive Context Engine)** es el sistema de auto-aprendizaje de Hive. Está compuesto por tres etapas que operan en ciclo continuo:

| Etapa | Componente | Función |
|-------|-----------|---------|
| 1 | **Tracer** | Registra cada ejecución del agente como una traza |
| 2 | **Reflector** | Analiza las trazas y detecta patrones |
| 3 | **Curator** | Convierte los patrones en reglas del Playbook |

El Playbook es el **producto final** del ACE — el conocimiento acumulado que retroalimenta al agente.

---

## ¿Por qué se usa el Playbook?

### Problemas que resuelve

1. **Memoria entre sesiones**: Sin el Playbook, cada llamada al LLM parte de cero. El Playbook permite al agente "aprender de la experiencia" — errores, operaciones lentas y patrones exitosos se recuerdan e inyectan como reglas.

2. **Gestión del presupuesto de tokens**: El Context Compiler tiene una ventana de contexto limitada. El Playbook usa FTS5 para inyectar solo las **5 reglas más relevantes** por turno, manteniendo el prompt eficiente sin sacrificar conocimiento acumulado.

3. **Auto-corrección sin intervención manual**: Cuando una herramienta falla consistentemente o un enfoque es contraproducente, el Curator marca la regla como inactiva (`active = 0`). El sistema deja automáticamente de sugerir malos enfoques.

4. **Transferencia de conocimiento a Workers**: Cuando el Coordinator genera un agente worker, el Playbook proporciona guía de comportamiento compartida. Los workers reciben las mismas reglas relevantes (según su tarea), asegurando consistencia en el enjambre.

5. **Consistencia de comportamiento**: Las 5 categorías del Playbook cubren los puntos de decisión más importantes del agente, proporcionando guardarrails sin necesidad de codificar el comportamiento.

### El Playbook en la estrategia de Context Engineering

El Playbook implementa la estrategia **APRENDER** dentro del framework de 5 estrategias del Context Compiler:

| Estrategia | Componente | Descripción |
|-----------|-----------|-------------|
| SELECCIONAR | Historial + Tool Loadout | Seleccionar solo historial y herramientas relevantes |
| ESCRIBIR | Scratchpad | Escribir notas fuera de la ventana de contexto |
| **APRENDER** | **Playbook** | **Aprender de los patrones de ejecución** |
| COMPRIMIR | Compaction | Resumir mensajes antiguos para ahorrar tokens |
| AISLAR | Contexto aislado de workers | Dar a los workers contexto mínimo |

---

## Arquitectura del Ciclo ACE

### Etapa 1 — Tracer (Generador de datos)

**Archivo**: `packages/core/src/agent/tracer.ts`

El Tracer registra **cada ejecución** del agente (llamadas a herramientas, llamadas al LLM) como una traza en la tabla `traces`:

```typescript
export interface TraceInput {
  threadId: string
  agentId: string
  agentName: string
  toolUsed?: string | null
  inputSummary: string
  outputSummary: string
  success: boolean
  errorMessage?: string | null
  durationMs?: number
  tokensUsed?: number
}
```

Características clave:
- **Fire-and-forget**: No bloquea el agent loop. Los errores se capturan silenciosamente.
- **Trigger automático**: Después de cada 20 trazas nuevas, invoca al Reflector.

### Etapa 2 — Reflector (Analizador de patrones)

**Archivo**: `packages/core/src/agent/reflector.ts`

El Reflector se activa cuando se acumulan suficientes trazas nuevas (mínimo 10, máximo 30 por ciclo). Usa **análisis heurístico local** (no requiere llamada al LLM) para detectar patrones:

| Tipo de Patrón | Lógica de Detección |
|----------------|---------------------|
| `failure_pattern` | Una herramienta falla 3+ veces recientemente |
| `optimization` | Una herramienta toma >5000ms consistentemente (3+ veces) |
| `success_pattern` | Una herramienta con 90%+ de éxito en 5+ llamadas |
| `optimization` (tokens) | Múltiples llamadas usando >4000 tokens cada una |
| `ethics_violation` | Categoría reservada para violaciones éticas |

Los insights se guardan en la tabla `reflections` con campos: `trace_ids`, `insight_type`, `description`, `affected_tools`, `affected_agents`, `confidence`.

### Etapa 3 — Curator (Gestor del Playbook)

**Archivo**: `packages/core/src/agent/curator.ts`

El Curator convierte las reflexiones en reglas del Playbook. Opera **solo con ediciones incrementales** — nunca reescribe todo el Playbook:

1. **Nuevos insights → nuevas reglas**: Inserta una nueva fila en la tabla `playbook` con `helpful_count = 1`
2. **Patrones repetidos → refuerzo**: Si ya existe una regla similar (verificado por primeros 60 caracteres), incrementa `helpful_count`
3. **Reglas contradichas → penalización**: Reglas que demuestran ser perjudiciales reciben `harmful_count` incrementado
4. **Reglas malas → poda**: Reglas donde `harmful_count > helpful_count` y `harmful_count >= 3` se marcan como `active = 0`
5. **Workers inactivos → archivo + nota**: Workers inactivos por 14+ días se archivan y se agrega una regla al Playbook explicando por qué

El Curator también mapea los tipos de insight a categorías del Playbook:

```typescript
function mapInsightTypeToCategory(type: string) {
  const map = {
    success_pattern: "tool_selection",
    failure_pattern: "error_avoidance",
    optimization: "optimization",
    ethics_violation: "error_avoidance",
  }
  return map[type] ?? "optimization"
}
```

---

## Schema de la Base de Datos

**Archivo**: `packages/core/src/storage/schema.ts`

```sql
CREATE TABLE IF NOT EXISTS playbook (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    rule                  TEXT NOT NULL,
    category              TEXT NOT NULL CHECK(category IN 
      ('tool_selection','response_quality','error_avoidance','optimization','agent_creation')),
    applicable_to         TEXT,       -- JSON array de contextos
    helpful_count         INTEGER NOT NULL DEFAULT 0,
    harmful_count         INTEGER NOT NULL DEFAULT 0,
    source_reflection_id  INTEGER REFERENCES reflections(id) ON DELETE SET NULL,
    active                INTEGER NOT NULL DEFAULT 1,
    created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE VIRTUAL TABLE IF NOT EXISTS playbook_fts USING fts5(
    rule,
    category,
    applicable_to
);
```

### Decisiones de diseño

| Aspecto | Decisión | Razón |
|---------|----------|-------|
| Categorías | 5 categorías fijas con `CHECK` | Cubre los puntos de decisión más importantes |
| Feedback loop | `helpful_count` vs `harmful_count` | Determina la calidad de la regla sin intervención |
| Soft delete | `active = 0` en lugar de `DELETE` | Reglas archivadas permanecen para análisis |
| FTS5 search | Tabla virtual `playbook_fts` | Búsqueda de texto completo con ranking BM25 |
| Origen rastreable | `source_reflection_id` → `reflections` | Cada regla tiene trazabilidad hasta las trazas originales |

---

## Categorías de Reglas

El Playbook organiza las reglas en 5 categorías:

| Categoría | Descripción | Ejemplo |
|-----------|-------------|---------|
| `tool_selection` | Qué herramienta usar para cada situación | "Para buscar noticias, usa `web_search` con filtros de fecha" |
| `response_quality` | Cómo mejorar la calidad de las respuestas | "Incluye ejemplos concretos al explicar conceptos técnicos" |
| `error_avoidance` | Qué errores evitar y cómo prevenirlos | "Confirma antes de ejecutar comandos shell destructivos" |
| `optimization` | Cómo optimizar operaciones | "Divide tareas grandes en pasos atómicos independientes" |
| `agent_creation` | Cómo crear y delegar a agentes worker | "Proporciona descripciones claras con resultados esperados al delegar" |

---

## El Ciclo de Vida de una Regla

```
[1] Detección
    El Reflector analiza trazas y detecta un patrón
         ↓
[2] Creación
    El Curator crea una nueva regla en `playbook`
    helpful_count = 1, active = 1
         ↓
[3] Selección
    El Context Compiler selecciona la regla vía FTS5
    cuando el mensaje del usuario es relevante
         ↓
[4] Inyección
    La regla se inyecta en el system prompt (máx 5 por turno)
         ↓
[5] Validación
    Si el patrón se repite → helpful_count++
    Si la regla causa problemas → harmful_count++
         ↓
[6] Poda o Refuerzo
    Si harmful_count > helpful_count Y harmful_count >= 3 → active = 0
    Si helpful_count crece → la regla persiste y se refuerza
```

---

## Selección de Reglas con FTS5

**Archivo**: `packages/core/src/agent/playbook-selector.ts`

La función `selectPlaybookRules(message)` selecciona reglas relevantes en 4 pasos:

### Paso 1 — Extracción de keywords

```typescript
const keywords = message.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")  // Elimina sintaxis FTS5
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5)
```

Se extraen hasta 5 palabras clave del mensaje del usuario, eliminando caracteres especiales que podrían romper la consulta FTS5.

### Paso 2 — Construcción de consulta FTS5

```typescript
const ftsQuery = keywords.join(" OR ")
```

Las keywords se combinan con `OR` para búsqueda amplia.

### Paso 3 — Búsqueda con ranking BM25

```sql
SELECT rowid, bm25(playbook_fts) as score
FROM playbook_fts
WHERE playbook_fts MATCH ?
ORDER BY score ASC
LIMIT ?
```

BM25 asigna puntajes negativos (más negativo = más relevante). Solo se seleccionan las mejores.

### Paso 4 — Filtro y join con tabla principal

- Se filtra por umbral de relevancia (`score >= -10`)
- Se hace join con la tabla `playbook` para obtener datos completos
- Solo reglas con `active = 1` y `helpful_count > harmful_count`
- Máximo 5 reglas por turno

---

## Inyección en el System Prompt

El Playbook ocupa la **posición 5** en la jerarquía del system prompt:

```
[system prompt]
  1. Reglas de ética (completas, siempre)           — ethics table
  2. Identidad del agente                           — agents table
  3. Hive Capabilities Manifest                     — hive_capabilities table
  4. Perfil del usuario                             — users table
  5. Reglas del playbook relevantes (FTS5, max 5)  — playbook table
  6. Notas del scratchpad (filtradas por thread_id) — scratchpad table
  7. Entorno (agent_id, thread_id, fecha/hora)
  8. Skills activas
  9. Proyectos activos (coordinator only)

[messages]
  8. Resumen del historial
  9. Mensajes recientes

[tools]
  10. Tools filtradas en tres niveles
```

Esta posición estratégica — después de ética e identidad, pero antes del scratchpad — asegura que las reglas de comportamiento tengan **alta prioridad** para moldear las respuestas del agente.

---

## Dónde se Usa en el Sistema

### 1. Context Compiler (Inyección principal)

**Archivo**: `packages/core/src/agent/context-compiler.ts`

En la compilación de contexto, el system prompt incluye instrucciones que dirigen al agente al Playbook:

```typescript
`Usá \`search_knowledge\` solo para:\n` +
`- Skills (instrucciones de tareas complejas): type="skills"\n` +
`- Playbook (buenas prácticas): type="playbook"\n` +
`- Herramientas nativas específicas: type="tools"\n`
```

### 2. Gateway Startup (Inicialización)

**Archivo**: `packages/core/src/gateway/initializer.ts`

Al iniciar el gateway, se sincronizan todos los índices FTS5:

```typescript
await Promise.all([
  syncToolsToFTS(),
  syncSkillsToFTS(),
  syncPlaybookToFTS()  // Sincroniza Playbook → playbook_fts
]);
```

### 3. Agent Loop (Enriquecimiento en tiempo de ejecución)

**Archivo**: `packages/core/src/agent/agent-loop.ts`

Cuando el agente usa `search_knowledge` y el resultado contiene reglas del Playbook, el agent loop enriquece el resultado:

```typescript
if (foundPlaybook.length > 0) {
    const section = foundPlaybook
        .map((p: any) => `- [${p.category ?? "general"}] ${p.rule}`)
        .join("\n")
    extras.push(`\n\n--- PLAYBOOK RULES ---\n${section}`)
}
```

### 4. Herramienta search_knowledge (Búsqueda directa)

**Archivo**: `packages/core/src/tools/core/index.ts`

El agente puede buscar explícitamente en el Playbook usando la herramienta `search_knowledge` con `type="playbook"`.

### 5. Bootstrap de HiveDB

**Archivo**: `packages/core/src/storage/bootstrap.ts`

HiveDB no tiene migraciones de columnas SQL — `ensureHiveDb()` corre en cada boot del gateway, asegura que los índices de cada colección existan y re-siembra los catálogos estáticos (`storage/seed.ts`) de forma idempotente. No hay un paso equivalente a `ALTER TABLE`.

### 6. Comando CLI migrate

**Archivo**: `packages/cli/src/commands/migrate.ts`

`hive migrate` fuerza un re-seed manual (útil si se actualizó el paquete pero el seed automático no llegó a aplicarse). Rastrea el conteo de reglas del Playbook antes y después vía la colección HiveDB:

```typescript
const col = await import("@johpaz/hive-agents-core/storage/hive").then(m => m.col)
const playbookBefore = await (await col("playbook")).count()
// ... ensureHiveDb() re-siembra los catálogos ...
const playbookAfter = await (await col("playbook")).count()
// Reportar delta
```

### 7. SDK Export

**Archivo**: `packages/sdk/src/agents/index.ts`

El selector de Playbook se exporta para uso externo:

```typescript
export { selectPlaybookRules } from "@johpaz/hive-agents-core/agent/playbook-selector"
```

---

## Reglas Iniciales (Seed)

**Archivo**: `packages/core/src/storage/seed.ts`

En el primer inicio, se siembran 8 reglas iniciales que proporcionan guía básica al agente:

| # | Regla | Categoría | Aplicable a |
|---|-------|-----------|-------------|
| 1 | Para buscar noticias recientes, usa `web_search` con filtros de fecha en lugar de `http_client` genérico | `tool_selection` | web_search, news |
| 2 | Siempre confirma con el usuario antes de ejecutar comandos shell que modifiquen archivos o el estado del sistema | `error_avoidance` | exec, shell, terminal |
| 3 | Para consultas de código, incluye la habilidad shell junto con `file_manager` para un flujo de desarrollo completo | `optimization` | code, development |
| 4 | Al crear proyectos, divide las tareas en pasos atómicos que puedan ejecutarse independientemente | `agent_creation` | project_management, tasks |
| 5 | Guarda las preferencias importantes del usuario en el scratchpad usando `save_note` para persistencia entre sesiones | `optimization` | user_preferences, memory |
| 6 | Cuando una herramienta falla, reintenta una vez con parámetros modificados antes de reportar fallo al usuario | `error_avoidance` | *(todas)* |
| 7 | Para tareas de análisis de datos, usa formato estructurado TOON para la salida y reducir uso de tokens | `optimization` | data, analysis |
| 8 | Al delegar a workers, proporciona descripciones claras de tareas con resultados esperados | `agent_creation` | delegation, workers |

Estas reglas sirven como punto de partida. A medida que el agente ejecuta tareas, el ACE genera nuevas reglas basadas en patrones reales de uso.

---

## Flujo de Datos Completo

```
Mensaje del usuario llega
    |
    v
Context Compiler (compileContext)
    |-- Selecciona reglas relevantes vía selectPlaybookRules(message)
    |-- Reglas inyectadas como sección 5 del system prompt:
    |   "5. Reglas del playbook relevantes (FTS5, max 5)"
    |
    v
Agent Loop ejecuta
    |-- Cada llamada a herramienta es trazada por el Tracer
    |-- Si el agente llama search_knowledge, reglas se enriquecen en el resultado
    |
    v
Cada 20 trazas:
    |-- Reflector analiza patrones en las trazas
    |-- Produce insights en la tabla `reflections`
    |
    v
Curator procesa reflexiones:
    |-- Crea nuevas reglas del Playbook o refuerza existentes
    |-- Poda reglas donde harmful_count > helpful_count
    |-- Archiva workers inactivos, anotando en el Playbook
    |
    v
Próxima compilación de contexto:
    |-- Reglas nuevas/actualizadas disponibles vía FTS5
    |-- Mejores reglas inyectadas = mejor comportamiento del agente
```

---

## Configuración y Constantes

| Constante | Valor | Archivo | Descripción |
|-----------|-------|---------|-------------|
| `MAX_RULES_PER_TURN` | 5 | `playbook-selector.ts` | Máximo de reglas inyectadas por turno |
| `MIN_RELEVANCE_THRESHOLD` | -10 | `playbook-selector.ts` | Umbral BM25 para filtrar reglas irrelevantes |
| `REFLECTOR_TRACE_THRESHOLD` | 20 | `tracer.ts` | Trazas necesarias para activar el Reflector |
| `CURATOR_MIN_TRACES` | 10 | `reflector.ts` | Mínimo de trazas para análisis por ciclo |
| `CURATOR_MAX_TRACES` | 30 | `reflector.ts` | Máximo de trazas analizadas por ciclo |
| `FAILURE_THRESHOLD` | 3 | `reflector.ts` | Fallos para detectar `failure_pattern` |
| `SLOW_THRESHOLD_MS` | 5000 | `reflector.ts` | Duración para detectar `optimization` (lentitud) |
| `HIGH_TOKEN_THRESHOLD` | 4000 | `reflector.ts` | Tokens para detectar `optimization` (tokens) |
| `SUCCESS_RATE_THRESHOLD` | 0.9 | `reflector.ts` | Tasa de éxito para `success_pattern` |
| `MIN_SUCCESS_CALLS` | 5 | `reflector.ts` | Llamadas mínimas para validar `success_pattern` |
| `PRUNE_HARMFUL_MIN` | 3 | `curator.ts` | `harmful_count` mínimo para poda |
| `ARCHIVE_INACTIVE_DAYS` | 14 | `curator.ts` | Días de inactividad para archivar workers |

---

## Herramienta search_knowledge

**Archivo**: `packages/core/src/tools/core/index.ts`

El agente puede buscar explícitamente en el Playbook usando la herramienta `search_knowledge`:

### Parámetros

| Parámetro | Tipo | Valores | Descripción |
|-----------|------|---------|-------------|
| `query` | string | *(cualquiera)* | Término de búsqueda |
| `type` | string | `"all"`, `"tools"`, `"skills"`, `"playbook"` | Tipo de conocimiento a buscar |
| `limit` | number | *(default: 5)* | Máximo de resultados |

### Ejemplo de uso (por el agente)

```json
{
  "tool": "search_knowledge",
  "input": {
    "query": "error shell comando",
    "type": "playbook",
    "limit": 3
  }
}
```

### Respuesta

```json
{
  "playbook": [
    {
      "id": 2,
      "rule": "Siempre confirma con el usuario antes de ejecutar comandos shell...",
      "category": "error_avoidance",
      "applicable_to": "[\"exec\", \"shell\", \"terminal\"]",
      "helpful_count": 5,
      "harmful_count": 0,
      "active": 1,
      "rank": -2.34
    }
  ]
}
```

---

## Interacción con el Context Compiler

El Context Compiler es el componente que ensambla el prompt completo del agente. El Playbook interactúa con él en dos momentos:

### 1. Compilación automática (sección 5 del prompt)

Cada vez que se compila el contexto para una llamada al LLM, el selector del Playbook ejecuta:

```
selectPlaybookRules(mensaje_del_usuario)
  → Extrae keywords del mensaje
  → Busca en playbook_fts con FTS5 + BM25
  → Filtra por relevancia y calidad (active=1, helpful > harmful)
  → Retorna máximo 5 reglas
```

Las reglas se inyectan como una sección numerada dentro del system prompt.

### 2. Enriquecimiento vía search_knowledge

Si el agente decide usar la herramienta `search_knowledge` durante la ejecución, el agent loop enriquece el resultado de la herramienta:

```
search_knowledge(query, type="playbook")
  → Resultados de FTS5
  → Agent loop intercepta y formatea:
    "--- PLAYBOOK RULES ---
     - [error_avoidance] Siempre confirma con el usuario...
     - [optimization] Para consultas de código..."
```

---

## Relación con Otros Componentes

### Playbook vs Scratchpad

| Aspecto | Playbook | Scratchpad |
|---------|----------|------------|
| **Origen** | Auto-generado por ACE | Escrito por el agente |
| **Contenido** | Reglas de comportamiento | Notas y datos persistentes |
| **Selección** | FTS5 por relevancia al mensaje | Filtrado por `thread_id` |
| **Persistencia** | Permanente (hasta poda) | Permanente (hasta eliminación) |
| **Categorías** | 5 fijas | Sin categorías |
| **Posición en prompt** | Sección 5 | Sección 6 |

### Playbook vs Skills

| Aspecto | Playbook | Skills |
|---------|----------|--------|
| **Origen** | Auto-generado por ACE | Creadas manualmente por el usuario |
| **Formato** | Reglas cortas en colección HiveDB | Instrucciones en Markdown |
| **Propósito** | Mejorar comportamiento general | Guiar tareas específicas |
| **Búsqueda** | FTS5 automática | FTS5 vía `search_knowledge` |
| **Actualización** | Automática por Curator | Manual por el usuario |

### Playbook vs Ethics

El Playbook (sección 5) se inyecta **después** de las reglas de ética (sección 1). Las reglas de ética son inmutables y siempre completas. El Playbook es mutable y seleccionado dinámicamente. Las reglas de ética siempre tienen prioridad sobre las del Playbook.

---

## Resolución de Problemas

### El agente no parece usar las reglas del Playbook

**Causa probable**: Las reglas pueden no ser relevantes para el contexto actual. El selector FTS5 solo inyecta reglas cuando el mensaje del usuario contiene keywords que coinciden.

**Solución**: Verifica que existen reglas activas:
```bash
hive migrate  # Muestra conteo de reglas del Playbook
```

### Las reglas no se actualizan

**Causa probable**: No se han acumulado suficientes trazas para activar el Reflector (necesita mínimo 20 trazas nuevas desde el último ciclo).

**Solución**: Usa el agente normalmente. Después de ~20 interacciones con herramientas, el ciclo ACE se activará automáticamente.

### Regla incorrecta en el Playbook

**Causa probable**: Una regla fue generada a partir de patrones incompletos o atípicos.

**Solución**: El sistema se auto-corrige. Si la regla causa problemas, su `harmful_count` aumentará. Después de 3+ penalizaciones con `harmful_count > helpful_count`, la regla se desactiva automáticamente.

### Búsqueda FTS5 no funciona

**Causa probable**: El índice FTS5 puede estar desincronizado con la tabla principal.

**Solución**: Reinicia el gateway. En el inicio, `syncPlaybookToFTS()` reconstruye el índice FTS5 desde la tabla `playbook` en una transacción atómica.

---

## Preguntas Frecuentes

### ¿Puedo agregar reglas manualmente al Playbook?

No directamente. El Playbook se alimenta exclusivamente del ciclo ACE (Tracer → Reflector → Curator). Si necesitas agregar instrucciones manuales, usa el sistema de **Skills**, que está diseñado para instrucciones escritas por el usuario.

### ¿Cuántas reglas puede tener el Playbook?

No hay límite duro. Sin embargo, solo se inyectan **5 reglas por turno**, seleccionadas por relevancia FTS5. Reglas inactivas (`active = 0`) permanecen en la base de datos para análisis pero no se inyectan.

### ¿El Playbook funciona con todos los modelos de LLM?

Sí. El Playbook es independiente del modelo. Las reglas se inyectan como texto en el system prompt, que cualquier modelo puede procesar.

### ¿Las reglas del Playbook se comparten entre agentes?

Sí. La tabla `playbook` es global. Todos los agentes (coordinator y workers) consultan las mismas reglas, aunque la selección FTS5 filtra por relevancia al contexto específico de cada agente.

### ¿Qué pasa si elimino la base de datos?

El Playbook se pierde. Al reiniciar, se ejecutan las migraciones y se siembran las 8 reglas iniciales. El ciclo ACE recomenzará la acumulación de conocimiento desde cero.

### ¿El ciclo ACE consume tokens del LLM?

No. El Reflector usa **análisis heurístico local** — no hace llamadas al LLM. Solo lee la colección `traces` y escribe en `reflections` y `playbook`. Todo es procesamiento local en HiveDB.

---

## Glosario

| Término | Definición |
|---------|------------|
| **ACE** | Adaptive Context Engine — sistema de auto-aprendizaje de Hive |
| **Playbook** | Tabla de reglas de comportamiento aprendidas automáticamente |
| **Tracer** | Componente que registra trazas de ejecución del agente |
| **Reflector** | Componente que analiza trazas y detecta patrones |
| **Curator** | Componente que convierte reflexiones en reglas del Playbook |
| **BM25** | Algoritmo de ranking del índice de búsqueda de texto completo (tantivy, vía HiveDB) |
| **BM25** | Algoritmo de ranking para búsqueda de texto completo |
| **Traza (Trace)** | Registro de una ejecución individual del agente |
| **Reflexión (Reflection)** | Insight generado por el Reflector a partir de trazas |
| **Regla (Rule)** | Instrucción de comportamiento en el Playbook |
| **Poda (Pruning)** | Desactivación automática de reglas perjudiciales |
| **Seed** | Reglas iniciales sembradas en el primer inicio |
| **Soft delete** | Marcar como inactivo en lugar de eliminar |
