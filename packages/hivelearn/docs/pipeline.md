# Pipeline DAG — Enjambre de Agentes

HiveLearn usa un grafo dirigido acíclico (DAG) para coordinar 16 agentes especializados que generan una lección completa de forma paralela y ordenada.

---

## Fases del Pipeline

```
TIER 0 (secuencial, maxWorkers=1)
┌─────────────┐    ┌─────────────┐    ┌─────────────────┐
│ ProfileAgent│───►│ IntentAgent │───►│ StructureAgent  │
│  (perfil)   │    │  (tema/slug)│    │  (N nodos JSON) │
└─────────────┘    └─────────────┘    └─────────────────┘
                                               │
                         ┌─────────────────────┘
                         ▼
TIER 1 (paralelo, maxWorkers=HIVELEARN_MAX_CONCURRENT_WORKERS)
┌──────────────────────────────────────────────────────────┐
│  Por cada nodo del currículo:                            │
│  content-nodo-0 (ExplanationAgent)                       │
│  visual-nodo-0  (CodeAgent / SVGAgent / AudioAgent ...)  │
│  content-nodo-1 (QuizAgent)                              │
│  visual-nodo-1  (InfographicAgent)                       │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
                         │
TIER 2 (paralelo, tras todos los content/visual nodes)
┌──────────────────┐    ┌──────────────────────┐
│ GamificationAgent│    │ EvaluationAgent       │
│  (XP, logros)    │    │  (5 preguntas finales)│
└──────────────────┘    └──────────────────────┘
                         │
POST (revisión sincrónica)
┌─────────────────────────────────────────────────────────┐
│ Coordinator Review                                       │
│  - recibe LessonProgram ensamblado + raw outputs        │
│  - valida coherencia pedagógica avanzada:               │
│    • Claridad, adecuación a edad, ejemplos concretos    │
│    • Progresión lógica, engagement, cobertura temática  │
│  - redistribuye XP para totalizar exactamente 100 pts   │
│    • Retos/evaluaciones: 20-30 XP                       │
│    • Conceptos/ejercicios: 10-20 XP                     │
│    • Bienvenida/milestones: 5-10 XP                     │
│  - aplica correcciones menores (títulos, XP)            │
│  - suggestedRetries: re-ejecuta nodos con contenido     │
│    vacío o incoherente (máx 3, vía HiveLearnExecutor)  │
│  - re-ensambla el programa si hubo retries              │
│  - logging detallado de decisiones y validaciones       │
└─────────────────────────────────────────────────────────┘
```

---

## Agentes (16 en total)

### Tier 0 — Análisis y Estructura

| ID | Agente | Tool | Descripción |
|----|--------|------|-------------|
| `hl-profile-agent` | **ProfileAgent** | `clasificar_intencion` | Construye `PerfilAdaptacion` (tono, nodos recomendados, estilo) |
| `hl-intent-agent` | **IntentAgent** | `clasificar_intencion` | Extrae tema, nivel detectado, `topicSlug`, confianza |
| `hl-structure-agent` | **StructureAgent** | `disenar_estructura` | Diseña el array de nodos con `tipoPedagogico` + `tipoVisual` |

### Tier 1 — Contenido Pedagógico (por nodo)

Cada nodo tiene hasta 2 agentes: **content** (pedagógico) + **visual** (asset).

**Agentes de contenido** (según `tipoPedagogico`):

| tipoPedagogico | Agente | Tool | Output en `NodoContenido` |
|----------------|--------|------|--------------------------|
| `concept` | ExplanationAgent | `generar_explicacion` | `contenido.explicacion` |
| `exercise` | ExerciseAgent | `generar_ejercicio` | `contenido.ejercicio` |
| `quiz` | QuizAgent | `generar_quiz` | `contenido.quiz` |
| `challenge` | ChallengeAgent | `generar_reto` | `contenido.reto` |
| `milestone` | ExplanationAgent | `generar_explicacion` | `contenido.explicacion` |
| `evaluation` | EvaluationAgent | `generar_evaluacion` | `contenido.evaluacion` |

**Agentes visuales** (según `tipoVisual`, solo si no es `text_card`):

| tipoVisual | Agente | Tool | Output en `NodoContenido` |
|------------|--------|------|--------------------------|
| `code_block` | CodeAgent | `generar_codigo` | `contenido.codigo` |
| `svg_diagram` | SVGAgent | `generar_svg` | `contenido.svg` |
| `gif_guide` | GifAgent | `generar_frames_gif` | `contenido.gifFrames` |
| `infographic` | InfographicAgent | `generar_infografia` | `contenido.infografia` |
| `image_ai` | ImageAgent | `generar_imagen` | `contenido.imagen` |
| `audio_ai` | AudioAgent | `generar_audio` | `contenido.audio` |

### Tier 2 — Finalización

| ID | Agente | Tool | Output |
|----|--------|------|--------|
| `hl-gamification-agent` | **GamificationAgent** | *(JSON libre)* | `program.gamificacion` |
| `hl-evaluation-agent` | **EvaluationAgent** | `generar_evaluacion` | `program.evaluacion` |

### Post — Revisión

| ID | Agente | Tool | Descripción |
|----|--------|------|-------------|
| `hl-coordinator-agent` | **Coordinator** | `revisar_programa` | Valida coherencia, aplica correcciones |

### Feedback (on-demand, no en el DAG)

| ID | Agente | Tool | Trigger |
|----|--------|------|---------|
| `hl-feedback-agent` | **FeedbackAgent** | `calificar_respuesta` | Llamado por `/api/hivelearn/feedback` al responder un micro-quiz |

---

## Tools Passthrough

Todos los agentes de contenido usan **tools passthrough**: la tool simplemente devuelve sus parámetros como output estructurado.

```ts
// Ejemplo — generar_audio
export const generarAudioTool: Tool = {
  name: 'generar_audio',
  execute: async (params) => ({ ok: true, output: params }),
}
```

Esto permite al LLM estructurar su respuesta en JSON sin lógica adicional en el servidor.

---

## DAGScheduler

`src/scheduler/dag/DAGScheduler.ts` — Ejecutor de grafos con:

- **Dependencias topológicas**: un nodo solo se ejecuta cuando todos sus `deps` están completos
- **Concurrencia configurable**: `maxConcurrentWorkers` (default: 2 en Tier 1)
- **Reintentos**: `maxRetries` por nodo (default: 2)
- **Timeout**: configurable por nodo (30s-120s según complejidad)
- **Propagación de fallos**: si un nodo crítico falla, sus dependientes se marcan `failed`

### Estados de un nodo DAG

```
pending → running → completed
                 └→ failed (con retry) → failed (definitivo)
```

---

## HiveLearnExecutor

`src/agent/executor.ts` — implementa `ITaskExecutor` para el DAGScheduler.

**Antes de llamar al LLM:**
1. Extrae metadatos del `taskDescription` via regex: `Concepto: "..."`, `Nivel: ...`, `Rango edad: ...`
2. Consulta `nodeCache` (tabla `hl_node_cache`): si hay cache válida, retorna directo
3. Si no hay cache, llama a `runHiveLearnAgent()`

**Después de la respuesta:**
1. Guarda el output en `hl_session_agent_outputs` (trazabilidad)
2. Guarda en `hl_node_cache` para reutilizar en sesiones futuras
3. Registra duración y status (`ok` / `failed`)

---

## Orchestrator

`src/swarm/orchestrator.ts` — Ensambla el `LessonProgram` final desde los outputs del DAG.

### `buildNodosBase(structureResult, perfil)`
Parsea el JSON del StructureAgent y crea el array de `NodoLesson` con estado inicial `bloqueado` (excepto el primero: `disponible`).

### `enriquecerNodos(nodos, dagResult)`
Mapea cada `content-nodo-N` y `visual-nodo-N` del DAG result al campo correcto de `NodoContenido`:

```ts
// content → según tipoPedagogico
'concept'    → contenido.explicacion
'exercise'   → contenido.ejercicio
'quiz'       → contenido.quiz
'challenge'  → contenido.reto

// visual → según tipoVisual
'code_block'  → contenido.codigo
'svg_diagram' → contenido.svg
'audio_ai'    → contenido.audio
// ...
```

### `buildLessonProgram(opts)`
Combina nodos enriquecidos + gamificación + evaluación + intent (tema/slug) en el `LessonProgram` final.

---

## Adaptación por Perfil del Alumno

| Campo | Niño (nino) | Adolescente | Adulto |
|-------|-------------|-------------|--------|
| Nodos recomendados | 5 | 8 | 10 |
| Tono | amigable | motivador | técnico |
| Tipos visuales preferidos | gif_guide, infographic | code_block, svg_diagram | code_block, audio_ai |

El **StructureAgent** recibe el perfil completo y decide los `tipoPedagogico` y `tipoVisual` de cada nodo.

---

## Loop de Aprendizaje

Antes de construir el DAG, `HiveLearnSwarm` consulta `hl_node_effectiveness` para el tema actual:

```ts
const efectividad = persistence.getTopicEffectiveness(intentSlug)
// → { nodosConMasFallas: ['quiz', 'challenge'], nivelPromedioAprobacion: 68 }
```

Esta información se inyecta en el `taskDescription` del StructureAgent, que puede ajustar la estructura (más nodos de práctica si hay alta tasa de error en ese tipo).
