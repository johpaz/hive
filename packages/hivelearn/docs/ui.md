# UI — Arquitectura Frontend de HiveLearn

La interfaz de HiveLearn es una SPA React integrada en el monorepo. Usa React Flow para el canvas de nodos, Zustand para el estado global y el protocolo A2UI para renderizar el contenido de cada nodo.

---

## Pantallas (Screens)

El store controla la navegación entre pantallas mediante el campo `screen`:

```
provider-select → profile → goal → loading → canvas → evaluation → result
```

| Screen | Componente | Descripción |
|--------|------------|-------------|
| `provider-select` | `ProviderSelectScreen` | Selección de provider LLM + modelo |
| `profile` | `ProfileScreen` | Formulario del perfil del alumno |
| `goal` | `GoalScreen` | Input de la meta de aprendizaje |
| `loading` | `LoadingScreen` | Progress del enjambre en tiempo real |
| `canvas` | `CanvasScreen` | Grafo de nodos React Flow + panel lateral |
| `evaluation` | `EvaluationScreen` | Evaluación final (5 preguntas) |
| `result` | `ResultScreen` | Resultados + XP + logros + rating modal |

---

## Store — `lessonStore.ts`

Store central de Zustand con persist en localStorage (`hivelearn-session-v1`).

### Estado principal

```ts
interface LessonState {
  screen: Screen
  sessionId: string | null
  perfil: StudentProfile | null
  meta: string
  program: LessonProgram | null

  // Progreso del swarm
  swarmProgress: SwarmProgress | null
  agentStatuses: Record<string, AgentStatus>
  coordinatorState: CoordinatorState

  // Progreso del alumno
  nodoActualId: string | null
  selectedNodeId: string | null   // nodo abierto en panel lateral
  xpTotal: number
  logrosDesbloqueados: string[]
  nodosCompletados: string[]

  // Gamificación
  vidas: number
  racha: number
  xpFloat: XpFloat | null        // animación flotante de XP

  // Evaluación
  respuestasEvaluacion: Record<number, string | number>
  puntajeEvaluacion: number | null
  lastFeedback: FeedbackOutput | null
}
```

### Acciones clave

```ts
completarNodo(nodoId, xpGanado)    // marca completado, desbloquea siguiente
selectNode(nodeId)                  // abre panel lateral
responderEvaluacion(idx, respuesta) // guarda respuesta en evaluación final
showXpFloat(nodeId, xp)            // anima +XP flotante 1.4s
reset()                            // limpia todo para nueva sesión
```

### Persistencia

Solo se persisten los campos necesarios para restaurar sesión activa:
`screen`, `program`, `sessionId`, `curriculoId`, `perfil`, `meta`, `xpTotal`, `nodosCompletados`, `nodoActualId`, `selectedProviderId`, `selectedModelId`, `vidas`, `racha`, `logrosDesbloqueados`, `swarmProgress`, `agentStatuses`.

---

## Canvas Screen

`CanvasScreen.tsx` — Vista principal con el grafo de nodos.

### Estructura

```
CanvasScreen
├── ReactFlow (grafo de nodos)
│   └── NodoLessonNode (por cada nodo del programa)
│       └── BaseNode (wrapper con estado/color)
│           └── NodeCard (contenido resumido del nodo)
│
├── Panel lateral (si selectedNodeId !== null)
│   └── NodeContentPopover
│       ├── NodeContentRenderer (renderizado visual del contenido)
│       └── MicroEvalSection (micro-quiz del nodo)
│
├── VisionAttentionMonitor (componente invisible)
│   └── Captura webcam cada 10s → /api/hivelearn/vision
│
└── AttentionLostOverlay (si score < 40 por 2 ciclos)
    └── "¿Sigues ahí? 👀" + botón Continuar
```

### Tipos de nodo en el grafo

Los nodos usan colores según `tipoPedagogico`:

| tipoPedagogico | Color base |
|----------------|------------|
| `concept` | Azul |
| `exercise` | Verde |
| `quiz` | Amarillo |
| `challenge` | Naranja |
| `milestone` | Morado |
| `evaluation` | Rojo |

Estados:
- `bloqueado` → opaco, sin interacción
- `disponible` → activo, click abre panel
- `completado` → verde, checkmark

---

## NodeContentPopover

`NodeContentPopover.tsx` — Panel lateral que muestra el contenido rico del nodo.

### Flujo de interacción

1. Alumno hace click en un nodo `disponible`
2. Se abre el panel con `NodeContentRenderer` mostrando el contenido
3. Si el nodo tiene `microEval`, se muestra la pregunta de verificación
4. Alumno responde → POST `/api/hivelearn/feedback`
5. FeedbackAgent califica → se muestra feedback motivador + XP ganado
6. Si correcto: `completarNodo()` → nodo pasa a `completado`, siguiente se desbloquea

### Manejo de `play_audio`

Si el nodo es `audio_ai`, el panel tiene un botón "▶ Escuchar" que dispara la acción `play_audio`:

```ts
if (name === 'play_audio') {
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(context.narration_text ?? '')
  const speedMap = { slow: 0.8, normal: 1.0, fast: 1.3 }
  utt.rate = speedMap[context.speed ?? 'normal'] ?? 1.0
  utt.lang = 'es-ES'
  window.speechSynthesis.speak(utt)
}
```

---

## NodeContentRenderer

`NodeContentRenderer.tsx` — Renderiza el contenido rico de un nodo según su tipo.

### Prioridad de renderizado

```
1. milestone → MilestoneCard (celebración con 🏆)
2. tipoVisual === 'gif_guide' + gifFrames → GifCard
3. tipoVisual === 'image_ai' + imagen → ImageCard
4. tipoVisual === 'audio_ai' + audio → AudioCard
5. tipoPedagogico === 'exercise' + ejercicio → EjercicioCard
6. tipoPedagogico === 'quiz' + quiz → QuizInfoCard
7. tipoPedagogico === 'challenge' + reto → RetoCard
8. tipoVisual === 'code_block' + codigo → CodigoCard
9. tipoVisual === 'svg_diagram' + svg → SVGCard
10. tipoVisual === 'infographic' + infografia → InfografiaCard
11. tipoVisual === 'chart' + infografia → ChartCard
12. tipoVisual === 'animated_card' + explicacion → AnimatedCard
13. explicacion → ExplicacionCard (default)
14. Fallback → JSON raw
```

---

## A2UI — Protocolo de Contenido

`src/ui/a2ui/nodeToA2UI.ts` — Convierte un `NodoLesson` en un stream de mensajes A2UI (surfaceUpdate + dataModelUpdate + beginRendering).

### Superficie por tipo de nodo

Cada nodo genera una superficie A2UI independiente con ID `node-{nodo.id}`. El contenido se renderiza según `tipoPedagogico` + `tipoVisual`:

| Tipo | Componentes A2UI generados |
|------|---------------------------|
| `concept` + `text_card` | Column → Text (título) + Text (explicación) + Card (ejemplo) |
| `concept` + `code_block` | Column → Text + Code block pre-formateado |
| `quiz` | Column → Text (pregunta) + MultipleChoice |
| `exercise` | Column → Text (enunciado) + TextField (respuesta) |
| `challenge` | Column → Text (reto) + List (pasos) + TextField |
| `audio_ai` | Column → Card (ícono 🎧 + narración) + Button (play_audio) |
| `milestone` | Column → Text grande + Icon (🏆) + Text XP |

### Acción `submit_answer`

Todos los nodos con micro-eval generan un Button con acción `submit_answer`:

```json
{
  "action": {
    "name": "submit_answer",
    "context": [
      { "key": "nodoId", "value": { "literalString": "nodo-2" } },
      { "key": "respuesta", "value": { "path": "/answer/text" } }
    ]
  }
}
```

El `NodeContentPopover` intercepta esta acción y llama a `/api/hivelearn/feedback`.

---

## VisionAttentionMonitor

`src/ui/components/VisionAttentionMonitor.tsx` — Monitoreo de atención vía webcam.

```ts
interface Props {
  sessionId: string
  onAttentionLost: () => void    // callback cuando score < 40 por 2 ciclos
  onAttentionRestored: () => void
}
```

- Captura frame del video cada 10s con `canvas.toDataURL('image/jpeg', 0.7)`
- Convierte a base64 y POST a `/api/hivelearn/vision`
- Mantiene contador de ciclos bajos consecutivos
- Muestra indicador visual: 🟢 enfocado / 🟡 distraído / 🔴 ausente

---

## RatingModal

`src/ui/screens/RatingModal.tsx` — Modal de calificación post-evaluación.

- Aparece 1.2s después de mostrar `ResultScreen` (via `useEffect`)
- 5 estrellas interactivas
- Textarea opcional para comentario
- POST a `/api/hivelearn/rate`
- Se cierra automáticamente 1.8s después de enviar

---

## LoadingScreen

`LoadingScreen.tsx` — Pantalla de progreso del enjambre.

Muestra en tiempo real:
- Porcentaje de progreso (barra)
- Agente activo actual
- Mensaje descriptivo de la etapa
- Animación de abejas 🐝

Recibe eventos via el hook `useLessonSwarm` que conecta al WebSocket `/hivelearn-events`.

---

## Hooks

| Hook | Descripción |
|------|-------------|
| `useLessonSwarm` | Conecta WS `/hivelearn-events`, actualiza store con progreso |
| `useEvaluation` | Gestiona estado de evaluación final, calcula puntaje, POST `complete-session` |
| `useNodeInteraction` | Lógica de click en nodos, apertura de panel, micro-eval |
| `useGamification` | Controla vidas, racha, XP float, logros |
