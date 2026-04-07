# HiveLearn — Documentación General

HiveLearn es el módulo de aprendizaje adaptativo del ecosistema Hive. Genera lecciones personalizadas mediante un enjambre de 16 agentes de IA que trabajan en paralelo, usando **Gemma 4** como modelo base (vía Ollama) y una UI interactiva en React Flow.

---

## Índice

- [Arquitectura](#arquitectura)
- [Pipeline DAG](./pipeline.md) — enjambre de agentes, fases, dependencias
- [API Gateway](./api.md) — endpoints compartidos con el gateway principal
- [Base de Datos](./database.md) — tablas SQLite, migraciones, persistencia
- [UI](./ui.md) — pantallas, store, componentes A2UI

---

## Arquitectura

```
packages/hivelearn/
├── src/
│   ├── index.ts              ← Punto de entrada, initHiveLearn()
│   ├── types.ts              ← Tipos centrales del dominio
│   ├── agent/
│   │   ├── executor.ts       ← HiveLearnExecutor (cache + traza)
│   │   ├── runner.ts         ← runHiveLearnAgent()
│   │   ├── prompts.ts        ← System prompts por agente
│   │   └── tool-map.ts       ← Tools asignadas a cada agente
│   ├── agents/
│   │   ├── registry.ts       ← AGENT_IDS + registro en DB
│   │   └── prompts/          ← Prompts detallados por agente
│   ├── swarm/
│   │   ├── HiveLearnSwarm.ts ← Orquestador principal
│   │   ├── orchestrator.ts   ← buildLessonProgram(), enriquecerNodos()
│   │   └── presets/
│   │       └── HiveLearnPreset.ts ← buildBaseDAG(), buildFullDAG()
│   ├── scheduler/
│   │   └── dag/              ← DAGScheduler, TaskGraph, TaskNode
│   ├── persistence/
│   │   └── LessonPersistence.ts ← CRUD de sesiones, outputs, respuestas
│   ├── cache/
│   │   ├── NodeCache.ts      ← Cache por concepto/nivel/edad
│   │   └── CacheInvalidator.ts
│   ├── tools/                ← Tools passthrough por agente
│   │   ├── content/          ← generar-explicacion, quiz, código, audio...
│   │   ├── evaluation/       ← generar-evaluacion, calificar-respuesta
│   │   ├── profile/          ← clasificar-intencion
│   │   └── coordinator/      ← revisar-programa
│   ├── llm/                  ← Providers LLM (Gemini, Ollama, Anthropic, OpenAI)
│   ├── events/
│   │   └── swarm-events.ts   ← hlSwarmEmitter (EventEmitter interno)
│   └── ui/                   ← Componentes React (ver ui.md)
├── db/
│   └── migrations/
│       ├── 001_hivelearn.sql ← Tablas base
│       └── 002_agent_outputs.sql ← Trazabilidad + respuestas alumno
└── docs/                     ← Esta carpeta
```

---

## Integración con el Gateway

HiveLearn se integra con `packages/core` de dos formas:

### 1. Inicialización (`initializer.ts`)

```ts
import { initHiveLearn } from '@johpaz/hivelearn'
await initHiveLearn()
```

`initHiveLearn()` ejecuta en orden:
1. Migraciones SQLite (`001_hivelearn.sql`, `002_agent_outputs.sql`)
2. Upsert del provider Ollama + modelo Gemma 4 en la DB del core
3. Registro de los 16 agentes del enjambre en la tabla `agents`
4. Verificación de disponibilidad de Ollama (no crítico)

### 2. Endpoints REST + WebSocket (`server.ts`)

El gateway expone todos los endpoints bajo `/api/hivelearn/` y el WebSocket `/hivelearn-events`. Ver [API Gateway](./api.md) para el detalle completo.

---

## Modelo de IA

HiveLearn usa **Gemma 4** exclusivamente, en dos variantes:
- **`gemma4:2b`** (E2B) — agentes rápidos (content, visual, evaluation)
- **`gemma4:8b`** (E4B) — coordinador y agentes complejos (opcional, configurable)

El modelo se sirve localmente via **Ollama** en `http://localhost:11434` (configurable con `HIVELEARN_OLLAMA_URL`).

Gemma 4 soporta input multimodal: texto, imágenes (base64), audio e imagen de webcam.

---

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `HIVELEARN_OLLAMA_URL` | `http://localhost:11434` | URL base de Ollama |
| `HIVELEARN_MODEL` | `gemma4:2b` | Modelo para agentes de contenido |
| `HIVELEARN_COORDINATOR_MODEL` | `gemma4:2b` | Modelo para el coordinador |
| `HIVELEARN_MAX_CONCURRENT_WORKERS` | `2` | Workers paralelos en Tier 1 |
| `HIVELEARN_DEBUG_DAG` | `false` | Logs verbosos del DAGScheduler |

---

## Flujo de Alto Nivel

```
Frontend (React)
    │
    ├─ POST /api/hivelearn/generate ──► HiveLearnSwarm.run()
    │       │
    │       ├─ Tier 0 (secuencial):  ProfileAgent → IntentAgent → StructureAgent
    │       │
    │       ├─ Tier 1 (paralelo×N):  ContentAgent + VisualAgent por cada nodo
    │       │
    │       ├─ Tier 2 (paralelo):    GamificationAgent + EvaluationAgent
    │       │
    │       └─ Coordinator Review:   revisa coherencia + aplica correcciones
    │
    ├─ WS /hivelearn-events ──► SSE de progreso en tiempo real
    │
    ├─ POST /api/hivelearn/feedback ──► FeedbackAgent → califica respuesta
    │
    ├─ POST /api/hivelearn/vision ──► Gemma 4 vision → análisis de atención
    │
    └─ POST /api/hivelearn/rate ──► guarda rating de la sesión
```
