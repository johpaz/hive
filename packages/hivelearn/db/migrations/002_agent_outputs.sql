-- HiveLearn Schema v2 — Trazabilidad de outputs por agente + respuestas del alumno

-- Output raw de cada agente del enjambre por sesión
CREATE TABLE IF NOT EXISTS hl_session_agent_outputs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  agent_id    TEXT    NOT NULL,
  task_id     TEXT    NOT NULL,
  output_json TEXT,
  duration_ms INTEGER,
  status      TEXT    NOT NULL DEFAULT 'ok',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sao_session ON hl_session_agent_outputs(session_id);
CREATE INDEX IF NOT EXISTS idx_sao_task    ON hl_session_agent_outputs(session_id, task_id);

-- Respuestas del alumno a quizzes, ejercicios y retos
CREATE TABLE IF NOT EXISTS hl_student_responses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL,
  node_id         TEXT    NOT NULL,
  attempt_num     INTEGER NOT NULL DEFAULT 1,
  tipo_pedagogico TEXT,
  respuesta_texto TEXT,
  feedback_json   TEXT,
  xp_awarded      INTEGER DEFAULT 0,
  es_correcto     INTEGER DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sr_session ON hl_student_responses(session_id);
CREATE INDEX IF NOT EXISTS idx_sr_node    ON hl_student_responses(node_id);

-- Rating del alumno al finalizar la lección (1-5 estrellas)
ALTER TABLE hl_sessions ADD COLUMN rating INTEGER DEFAULT NULL;
ALTER TABLE hl_sessions ADD COLUMN rating_comentario TEXT DEFAULT NULL;
