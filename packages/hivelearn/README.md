# HiveLearn — Módulo de Aprendizaje Adaptativo

HiveLearn es el módulo de aprendizaje adaptativo del ecosistema Hive. Genera lecciones personalizadas mediante un enjambre de 16 agentes de IA que trabajan en paralelo, usando **Gemma 4** como modelo base (vía Ollama) y una UI interactiva en React Flow.

## Características Principales

### 1. Enjambre de 16 Agentes Especializados
- **ProfileAgent** — Construye perfil de adaptación
- **IntentAgent** — Extrae tema, nivel y tono de la meta
- **StructureAgent** — Diseña el esqueleto del programa
- **ExplanationAgent** — Genera explicaciones concisas
- **ExerciseAgent** — Crea ejercicios prácticos
- **QuizAgent** — Genera preguntas de quiz
- **ChallengeAgent** — Diseña retos prácticos
- **CodeAgent** — Genera bloques de código
- **SVGAgent** — Genera diagramas SVG
- **GifAgent** — Genera frames de animación
- **InfographicAgent** — Crea infografías
- **ImageAgent** — Genera imágenes educativas
- **AudioAgent** — Genera narración educativa
- **GamificationAgent** — Asigna XP y logros
- **EvaluationAgent** — Genera evaluación final
- **FeedbackAgent** — Feedback motivador

### 2. Redistribución Dinámica de XP
El coordinador asegura que el XP total sea exactamente **100 puntos**:
- GamificationAgent asigna XP inicial
- Coordinador redistribuye completamente según criterio pedagógico
- Considera: tipo de nodo, dificultad, tiempo de sesión, nivel del alumno
- Retos y evaluaciones ganan más XP (20-30 puntos)
- Conceptos y ejercicios ganan XP medio (10-20 puntos)
- Bienvenida y milestones ganan menos XP (5-10 puntos)

### 3. Validación Pedagógica Avanzada
Validación después de cada agente con criterios:
- **Claridad**: ¿El contenido es fácil de entender?
- **Adecuación a edad**: ¿El tono y complejidad son apropiados?
- **Ejemplos concretos**: ¿Hay ejemplos prácticos y relevantes?
- **Progresión lógica**: ¿Los nodos siguen una secuencia coherente?
- **Engagement**: ¿El contenido es motivador?
- **Cobertura temática**: ¿Se cubren todos los aspectos importantes?

### 4. Consideración de Tiempo de Sesión
- **15 minutos**: 3-4 nodos (contenido esencial, conciso)
- **30 minutos**: 5-7 nodos (contenido completo, equilibrado)
- **45 minutos**: 8-10 nodos (contenido profundo, detallado)

### 5. Logging Detallado
- Logging estructurado de validaciones y decisiones
- Timestamp, agente, tipo validación, resultado, métricas
- Trazabilidad completa del proceso de generación

## Instalación

```bash
# Instalar dependencias
bun install

# Ejecutar tests
bun test

# Ejecutar tests de integración (requiere Ollama)
bun test packages/hivelearn/tests/hivelearn-integration.test.ts
```

## Uso Básico

```typescript
import { HiveLearnSwarm } from '@johpaz/hivelearn'

const swarm = new HiveLearnSwarm({
  onProgress: (progress) => {
    console.log(`${progress.porcentaje}% - ${progress.mensaje}`)
  },
})

const program = await swarm.run({
  alumnoId: 'alumno-123',
  nombre: 'Juan',
  edad: 12,
  rangoEdad: 'nino',
  tiempoSesion: 30,
  nivelPrevio: 'principiante',
  estilo: 'balanceado',
  sesionesTotal: 1,
  xpAcumulado: 0,
  nivelActual: 'principiante',
}, 'Aprender los conceptos básicos de JavaScript')

console.log(`Lección generada: ${program.nodos.length} nodos, ${program.gamificacion.xpRecompensa} XP total`)
```

## Arquitectura

```
packages/hivelearn/
├── src/
│   ├── agent/
│   │   ├── validation/          ← Validación pedagógica avanzada
│   │   │   └── pedagogical-validation.ts
│   │   ├── agent-loop.ts        ← Loop de agente con validación
│   │   ├── executor.ts          ← Executor con contexto de validación
│   │   └── runner.ts            ← Runner con contexto de validación
│   ├── swarm/
│   │   ├── HiveLearnSwarm.ts    ← Orquestador principal con redistribución XP
│   │   └── orchestrator.ts      ← buildLessonProgram() con redistribución XP
│   ├── tools/
│   │   └── coordinator/
│   │       └── revisar-programa.tool.ts ← Tool con campos de redistribución XP
│   └── tests/                   ← Tests de integración
│       ├── hivelearn-integration.test.ts
│       ├── hivelearn-validation.test.ts
│       └── coordinator-review.test.ts
└── docs/                        ← Documentación detallada
```

## Tests

### Tests de Integración
Verifican que el sistema completo funcione correctamente:
- Generación de lecciones para 15, 30, 45 minutos
- Contenido visual (SVG, GIF) cuando tipoVisual != text_card
- Generación de retos cuando tipoPedagogico == challenge
- Extracción correcta del tema
- XP total = 100 después de redistribución

### Tests de Validación
Verifican la validación pedagógica avanzada:
- Validación por tipo de agente
- Criterios pedagógicos avanzados
- Adecuación a edad
- Complejidad de contenido

### Tests de Coordinador
Verifican la redistribución de XP:
- Revisión de XP total
- Redistribución completa según criterio pedagógico
- Logging detallado de decisiones

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `HIVELEARN_OLLAMA_URL` | `http://localhost:11434` | URL base de Ollama |
| `HIVELEARN_MODEL` | `gemma4:2b` | Modelo para agentes |
| `HIVELEARN_COORDINATOR_MODEL` | `gemma4:2b` | Modelo para coordinador |
| `HIVELEARN_MAX_CONCURRENT_WORKERS` | `2` | Workers paralelos |
| `HIVELEARN_DEBUG_DAG` | `false` | Logs verbosos DAG |
| `HIVELEARN_LOG_LEVEL` | `info` | Nivel de logging |

## Documentación Detallada

- [Arquitectura General](./docs/README.md)
- [Pipeline DAG](./docs/pipeline.md)
- [API Gateway](./docs/api.md)
- [Base de Datos](./docs/database.md)
- [UI](./docs/ui.md)

## Licencia

MIT