# API Gateway — Endpoints de HiveLearn

Todos los endpoints son servidos por `packages/core/src/gateway/server.ts` y se exponen bajo el prefijo `/api/hivelearn/`.

---

## WebSocket — Eventos en Tiempo Real

### `WS /hivelearn-events?sessionId=<id>`

Stream de eventos SSE del enjambre durante la generación de la lección.

**Query params:**
- `sessionId` — identificador de sesión (formato: `{nombre}_{YYYYMMDDHHmmss}`)

**Eventos emitidos:**

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `agent_started` | `{ agentId, agentName }` | Un agente comenzó a ejecutarse |
| `agent_completed` | `{ agentId, agentName, durationMs }` | Agente terminó con éxito |
| `agent_failed` | `{ agentId, agentName, error }` | Agente falló (con reintentos) |
| `progress` | `{ etapa, agenteActivo, porcentaje, mensaje }` | Progreso global del swarm |
| `lesson_ready` | `{ program: LessonProgram }` | Lección completa lista |
| `error` | `{ message }` | Error fatal |

Los eventos se generan desde `hlSwarmEmitter` (EventEmitter interno de HiveLearn) y se mapean al WebSocket del gateway.

---

## Endpoints REST

### `POST /api/hivelearn/generate`

Genera una lección completa para el alumno.

**Body:**
```ts
{
  providerId: string        // ID del provider LLM (ej: "ollama-local")
  modelId?: string          // Modelo específico (ej: "gemma4:2b")
  perfil: {
    alumnoId: string        // UUID del alumno
    nombre: string          // Nombre para el sessionId
    rangoEdad: 'nino' | 'adolescente' | 'adulto'
    nivelPrevio: 'basico' | 'intermedio' | 'avanzado'
    estilo: 'visual' | 'auditivo' | 'kinestesico' | 'lectura'
    tiempoSesion: number    // minutos
  }
  meta: string              // Meta de aprendizaje en lenguaje natural
}
```

**Respuesta:** Stream de eventos WebSocket (no retorna JSON directo — la lección llega vía WS `lesson_ready`).

**Efectos secundarios:**
- Crea registro en `hl_sessions`
- Guarda currículo en `hl_curricula`
- Registra output de cada agente en `hl_session_agent_outputs`

---

### `POST /api/hivelearn/feedback`

Envía la respuesta del alumno a un micro-quiz y obtiene feedback del FeedbackAgent.

**Body:**
```ts
{
  sessionId?: string        // Para persistir la respuesta
  nodoId: string            // ID del nodo (ej: "nodo-2")
  concepto: string          // Concepto que se evalúa
  respuesta: string         // Respuesta del alumno (texto libre o índice)
  rangoEdad: string         // Para adaptar el feedback
  tipoPedagogico: string    // Para que el agente sepa el contexto
}
```

**Respuesta:**
```ts
{
  correcto: boolean
  xpGanado: number          // 20 (correcto) | 5 (parcial) | 0 (incorrecto)
  mensaje: string           // Feedback motivador
  razonamiento: string      // Por qué es correcto/incorrecto
  pista?: string            // Si es incorrecto, pista para el alumno
}
```

**Efectos secundarios:**
- Guarda en `hl_student_responses`
- Actualiza `hl_node_effectiveness` (tasa de aciertos por tipo de nodo)

---

### `POST /api/hivelearn/vision`

Analiza una imagen de webcam con Gemma 4 multimodal para detectar el nivel de atención del alumno.

**Body:**
```ts
{
  sessionId: string
  imageBase64: string       // JPEG en base64 (del componente VisionAttentionMonitor)
}
```

**Respuesta:**
```ts
{
  attention: 'focused' | 'distracted' | 'away'
  score: number             // 0-100 (100 = completamente enfocado)
}
```

Usa `runHiveLearnAgent` con el ProfileAgent y un system prompt especializado en análisis visual.

---

### `POST /api/hivelearn/complete-session`

Marca una sesión como completada con los resultados finales de evaluación.

**Body:**
```ts
{
  sessionId: string
  puntajeEvaluacion: number // 0-100
  xpTotal: number
  logrosJson: string        // JSON.stringify(string[])
}
```

**Respuesta:** `{ ok: true }`

---

### `POST /api/hivelearn/rate`

Guarda la calificación del alumno sobre la lección (1-5 estrellas).

**Body:**
```ts
{
  sessionId: string
  rating: 1 | 2 | 3 | 4 | 5
  comentario?: string
}
```

**Respuesta:** `{ ok: true }`

---

### `GET /api/hivelearn/sessions`

Lista todas las sesiones de aprendizaje del gateway.

**Respuesta:**
```ts
{
  sessions: Array<{
    session_id: string
    alumno_id: string
    tema: string
    rango_edad: string
    created_at: string
    completed_at: string | null
    puntaje_evaluacion: number | null
    xp_total: number | null
    rating: number | null
  }>
}
```

---

### `GET /api/hivelearn/sessions/:id/outputs`

Retorna la traza completa de outputs de cada agente para una sesión.

**Respuesta:**
```ts
{
  outputs: Array<{
    agent_id: string
    task_id: string           // ej: "content-nodo-2", "visual-nodo-3"
    output_json: string
    duration_ms: number
    status: 'ok' | 'failed'
    created_at: string
  }>
}
```

---

### `GET /api/hivelearn/sessions/:id/responses`

Retorna las respuestas del alumno registradas en una sesión.

**Respuesta:**
```ts
{
  responses: Array<{
    node_id: string
    attempt_num: number
    tipo_pedagogico: string
    respuesta_texto: string
    feedback_json: string
    xp_awarded: number
    es_correcto: number       // 0 | 1
    created_at: string
  }>
}
```

---

### `DELETE /api/hivelearn/sessions/:id`

Elimina una sesión y sus datos asociados.

**Respuesta:** `{ ok: true }`

---

### `GET /api/hivelearn/metrics`

Retorna métricas globales del sistema.

**Respuesta:**
```ts
{
  totalSessions: number
  completedSessions: number
  avgPuntaje: number
  topTopics: Array<{ tema: string; count: number }>
}
```

---

### `GET /api/hivelearn/config`

Verifica la configuración actual (provider, modelo, Ollama disponible).

**Respuesta:**
```ts
{
  providers: Array<{ id: string; name: string; base_url: string }>
  currentModel: string
  ollamaAvailable: boolean
}
```

---

### `POST /api/hivelearn/config`

Actualiza el provider y modelo activo para todos los agentes del enjambre.

**Body:**
```ts
{
  providerId: string
  modelId: string
}
```

**Respuesta:** `{ ok: true }`

**Efectos:** Llama a `updateHiveLearnAgentsProviderModel()` que hace `UPDATE agents SET provider_id, model_id WHERE id IN (...)` en batch.

---

### `GET /api/hivelearn/agents`

Lista los agentes registrados del enjambre.

**Respuesta:**
```ts
{
  agents: Array<{
    id: string
    name: string
    provider_id: string
    model_id: string
  }>
}
```

---

## Exports del módulo `@johpaz/hivelearn`

El gateway importa lo siguiente de HiveLearn:

```ts
import {
  HiveLearnSwarm,           // Orquestador principal
  LessonPersistence,        // CRUD de sesiones y persistencia
  hlSwarmEmitter,           // EventEmitter para SSE de progreso
  runHiveLearnAgent,        // Runner individual de agentes
  AGENT_IDS,                // IDs de los 16 agentes
  AGENT_PROMPTS,            // System prompts por agente
  calificarRespuestaTool,   // Tool de calificación para FeedbackAgent
  updateHiveLearnAgentsProviderModel,  // Actualizar modelo en batch
  nodeCache,                // Cache por concepto/nivel
  cacheInvalidator,         // Invalidador de cache
} from '@johpaz/hivelearn'
```
