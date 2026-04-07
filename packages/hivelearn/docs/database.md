# Base de Datos — HiveLearn

HiveLearn usa la misma instancia SQLite del core Hive (`getDb()` de `@johpaz/hive-agents-core/storage/sqlite`). Las tablas propias se crean mediante migraciones en `db/migrations/`.

---

## Migraciones

### `001_hivelearn.sql` — Tablas base

#### `hl_sessions`

Registro de cada sesión de aprendizaje.

```sql
CREATE TABLE IF NOT EXISTS hl_sessions (
  session_id          TEXT    PRIMARY KEY,
  alumno_id           TEXT    NOT NULL,
  tema                TEXT,
  rango_edad          TEXT,
  nivel_previo        TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  puntaje_evaluacion  INTEGER,
  xp_total            INTEGER DEFAULT 0,
  logros_json         TEXT,
  rating              INTEGER,          -- 1-5 estrellas (agrega 002)
  rating_comentario   TEXT              -- comentario libre  (agrega 002)
);
```

#### `hl_curricula`

Currículo generado (LessonProgram completo en JSON).

```sql
CREATE TABLE IF NOT EXISTS hl_curricula (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL REFERENCES hl_sessions(session_id),
  alumno_id   TEXT    NOT NULL,
  tema        TEXT,
  program_json TEXT   NOT NULL,  -- LessonProgram serializado
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_curricula_session ON hl_curricula(session_id);
CREATE INDEX IF NOT EXISTS idx_curricula_alumno  ON hl_curricula(alumno_id);
```

#### `hl_node_cache`

Cache de outputs de agentes por concepto + nivel + edad. Evita llamadas repetidas al LLM para el mismo concepto.

```sql
CREATE TABLE IF NOT EXISTS hl_node_cache (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_type   TEXT    NOT NULL,        -- ej: "hl-explanation-agent"
  concepto_slug TEXT   NOT NULL,        -- slug del concepto
  nivel        TEXT    NOT NULL,        -- basico|intermedio|avanzado
  rango_edad   TEXT    NOT NULL,        -- nino|adolescente|adulto
  output_json  TEXT    NOT NULL,
  hit_count    INTEGER DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,                    -- NULL = no expira
  UNIQUE(agent_type, concepto_slug, nivel, rango_edad)
);
```

#### `hl_node_effectiveness`

Efectividad de cada tipo de nodo por concepto. Se actualiza con cada respuesta del alumno.

```sql
CREATE TABLE IF NOT EXISTS hl_node_effectiveness (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id             TEXT    NOT NULL,
  tipo_pedagogico     TEXT,
  total_intentos      INTEGER DEFAULT 0,
  intentos_correctos  INTEGER DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(node_id)
);
```

---

### `002_agent_outputs.sql` — Trazabilidad y respuestas

#### `hl_session_agent_outputs`

Output raw de cada agente por sesión. Permite auditoría completa del enjambre.

```sql
CREATE TABLE IF NOT EXISTS hl_session_agent_outputs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  agent_id    TEXT    NOT NULL,         -- ej: "hl-explanation-agent"
  task_id     TEXT    NOT NULL,         -- ej: "content-nodo-2", "visual-nodo-3"
  output_json TEXT,                     -- output raw del agente (puede ser null si falló)
  duration_ms INTEGER,                  -- duración de la llamada LLM
  status      TEXT    NOT NULL DEFAULT 'ok',  -- 'ok' | 'failed'
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sao_session ON hl_session_agent_outputs(session_id);
```

#### `hl_student_responses`

Respuestas del alumno a micro-quizzes y ejercicios. Base para el loop de aprendizaje.

```sql
CREATE TABLE IF NOT EXISTS hl_student_responses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL,
  node_id         TEXT    NOT NULL,
  attempt_num     INTEGER NOT NULL DEFAULT 1,
  tipo_pedagogico TEXT,
  respuesta_texto TEXT,                 -- Respuesta del alumno (texto libre o índice)
  feedback_json   TEXT,                 -- JSON completo del FeedbackAgent
  xp_awarded      INTEGER DEFAULT 0,
  es_correcto     INTEGER DEFAULT 0,    -- 0 | 1
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sr_session ON hl_student_responses(session_id);
CREATE INDEX IF NOT EXISTS idx_sr_node    ON hl_student_responses(node_id);
```

---

## LessonPersistence

`src/persistence/LessonPersistence.ts` — Capa de acceso a datos para HiveLearn.

### Métodos principales

```ts
class LessonPersistence {
  // Sesiones
  createSession(sessionId, alumnoId, tema, rangoEdad, nivelPrevio): void
  completeSession(sessionId, puntaje, xpTotal, logrosJson): void
  rateSession(sessionId, rating, comentario?): void
  getSession(sessionId): SessionRow | null
  getSessions(limit?): SessionRow[]
  deleteSession(sessionId): void

  // Currículo
  saveCurriculum(sessionId, alumnoId, tema, program): number

  // Trazabilidad de agentes
  saveAgentOutput(sessionId, agentId, taskId, outputJson, durationMs, status): void
  getAgentOutputs(sessionId): AgentOutputRow[]

  // Respuestas del alumno
  saveStudentResponse(sessionId, nodeId, tipoPedagogico, respuesta, feedbackJson, xpAwarded, esCorrecto): void
  getStudentResponses(sessionId): StudentResponseRow[]

  // Efectividad de nodos
  updateNodeEffectiveness(nodeId, tipoPedagogico, esCorrecto): void
  getTopicEffectiveness(topicSlug): {
    nodosConMasFallas: string[]
    nivelPromedioAprobacion: number
  }

  // Métricas
  getMetrics(): { totalSessions, completedSessions, avgPuntaje, topTopics }

  // Config/providers
  getProviders(): ProviderRow[]
  getAgentsConfig(): AgentConfigRow[]
}
```

---

## Relación con Tablas del Core

HiveLearn comparte la misma DB del core y registra sus agentes en la tabla `agents` del core:

```sql
-- Tabla del core, usada por HiveLearn
SELECT * FROM agents WHERE id LIKE 'hl-%';
-- id, name, role, provider_id, model_id, system_prompt, workspace, ...
```

El `registerHiveLearnAgents()` hace `INSERT OR REPLACE INTO agents (...)` para cada uno de los 16 agentes al iniciar el módulo.

Los providers Ollama también se registran en la tabla `llm_providers` del core:

```sql
SELECT * FROM llm_providers WHERE id = 'ollama-local';
-- id, name, base_url, api_key, ...
```

---

## Diagrama Entidad-Relación

```
hl_sessions ──< hl_curricula        (1 sesión → 1 currículo)
hl_sessions ──< hl_session_agent_outputs  (1 sesión → N outputs de agentes)
hl_sessions ──< hl_student_responses      (1 sesión → N respuestas del alumno)
hl_student_responses ──► hl_node_effectiveness  (actualiza al guardar respuesta)
```
