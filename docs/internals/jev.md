# Jev — plano de decisión

Jev decide **qué entra al prompt** del modelo principal en cada turno. No redacta
respuestas ni argumentos de herramientas: responde preguntas cerradas ("¿este
mensaje hace falta?", "¿qué especialista conviene?") sobre la API Decisions de
OpenRouter, y el runtime arma el contexto con esas respuestas. El modelo de texto
de cada agente sigue haciendo todo lo demás.

Es opcional. **Sin una clave de OpenRouter activa, Jev no existe** y Hive usa el
compilador y el loop clásicos sin ninguna diferencia.

La configuración para el usuario está en
[Configuración → Decisiones con Jev](../guides/configuracion.md#decisiones-con-jev)
y los datos que viajan a OpenRouter en
[Seguridad → Datos enviados a Jev](../guides/seguridad.md#datos-enviados-a-jev).

---

## Activación

`getJevKey()` (`packages/core/src/agent/jev-decisions.ts`) devuelve la clave solo
si el proveedor `openrouter` está **habilitado y activo**. La clave sale de la
guardada en **Proveedores → OpenRouter** o, en su defecto, de
`OPENROUTER_API_KEY`. Sin clave, todas las funciones de Jev devuelven `null` antes
de hacer ninguna llamada de red.

| Constante | Valor |
|---|---|
| Endpoint | `https://openrouter.ai/api/alpha/decisions` |
| Modelo | `typesafe/jev-1.13` (`modelType: "decision"` en el catálogo) |
| Timeout por decisión | 3 s |
| Cooldown | 60 s tras 3 fallos seguidos, o de inmediato ante `401`/`403` |

### Backends: Kev primero, Jev de respaldo

`askJev` prueba dos backends con la misma forma de pregunta (`choice`, `noul` y `score`):

1. **Kev** (`https://llm.hiveagents.io/v1/systemone`, Bearer de HiveAgents), solo si el proveedor `hiveagents` está habilitado y activo y `GET /api/decisions/status` devuelve `ready: true` (cacheado 30 s). Costo 0. 3 fallos seguidos, o `401`/`403`, lo dejan en cooldown 60 s.
2. **Jev** en OpenRouter, como se describe arriba.

Si Kev no está listo o falla, la misma decisión se reintenta en Jev; sin ninguno, flujo clásico. `getJevStatus().backend` indica cuál respondió por última vez. `hasDecisionBackend()` es la guarda que usan los planificadores.

El modelo de decisión se siembra en el catálogo para tener su tarifa, pero se
excluye de `getDefaultLLM`, de `get_available_models` y de los selectores de la
UI: ningún agente puede elegirlo como modelo de texto.

## Tipos de pregunta

Cada llamada envía un `state` (extractos recortados del turno) y un conjunto de
preguntas:

- **`noul`**: probabilidad entre 0 y 1 de que algo haga falta.
- **`choice`**: una opción entre varias, con su confianza.

`askJev()` valida cada respuesta (opción existente, números finitos entre 0 y 1).
Una respuesta inválida cuenta como fallo y el turno sigue por el flujo clásico.

## Los tres puntos de decisión

### 1. Contexto del turno — `planJevContext`

Lo llama `compileContext` (`context-compiler.ts`) antes de la primera llamada al
modelo. Pregunta por:

| Candidato | Pregunta | Se conserva si |
|---|---|---|
| Mensajes anteriores del historial | `history_<i>` | probabilidad ≥ 0,35 |
| Herramientas no esenciales + las que encuentra `searchCapabilities` (máx. 24) | `tool_<nombre>` | ≥ 0,35 |
| Skills activas con cuerpo (máx. 8) | `skill_<id>` | ≥ 0,35 |
| Notas del scratchpad (últimas 16) | `note_<clave>` | ≥ 0,35 |
| Reglas del playbook ACE (máx. 8) | `rule_<id>` | ≥ 0,35 |
| Especialista (solo el coordinador, máx. 16) | `agent` (`choice`) | confianza ≥ 0,7 y distinto de `coordinator` |

Reglas que no dependen de Jev:

- Los **últimos 4 mensajes** siempre entran (los dos últimos intercambios llevan
  los referentes inmediatos: "hazlo otra vez", "el anterior").
- También entran siempre los mensajes con contenido multimodal y los eventos
  internos `<hive:internal_event`.
- Una respuesta del asistente viaja con el turno de usuario que respondió:
  Gemini descarta en silencio un turno del modelo sin usuario previo.
- Las herramientas esenciales (`MINIMAL_TOOLS`) nunca se preguntan.
- Solo se ofrecen herramientas MCP de servidores encendidos, conectados y
  permitidos para ese agente.

Con plan de Jev, el catálogo completo de especialistas se sustituye por un roster
compacto y las skills elegidas se incluyen con su cuerpo. Lo omitido se puede
recuperar con `conversation_read`, limitado al hilo actual.

### 2. Entre iteraciones — `planJevIteration`

Lo llama el loop (`agent-loop.ts`) antes de cada llamada al modelo cuando ya hay
resultados de herramientas. Solo actúa si los resultados anteriores al último
suman al menos **4.000 caracteres**; por debajo, la latencia cuesta más de lo que
se ahorra.

- `result_<i>` (hasta 8 resultados viejos): con probabilidad < 0,35 el contenido
  se reemplaza por `[Previous tool result omitted from this call]`. El último
  resultado nunca se omite.
- `action` (`choice`): `continue`, `delegate`, `discover` o `finish`. Exige
  confianza ≥ 0,7 (≥ 0,85 para `finish`). Según la acción se restringen las
  herramientas de esa llamada: `finish` quita todas, `delegate` deja
  `task_delegate`, `agent_find` y `search_knowledge`, `discover` deja solo
  `search_knowledge`. Si el último resultado fue un error, `finish` se convierte
  en `continue`.

### 3. Paralelismo — `jevWantsParallel`

Ante un lote de 2 o más tool calls, solo pregunta si todas son lecturas conocidas
(`fs_read`, `web_search`, `memory_search`, etc.) o todas son `task_delegate` a
especialistas **distintos con workspaces distintos**. Cualquier otra mezcla corre
en serie sin consultar a Jev. Con la pregunta `independent`, el lote va en
paralelo si la probabilidad es ≥ 0,8.

## Mapa del enjambre

`describeSwarmCapabilities` arma en cada turno la lista de especialistas
habilitados (los del catálogo y los creados con `agent_create`) con sus
herramientas y servidores MCP, y el estado de cada servidor:

| Estado | Significado |
|---|---|
| `activo` | Conectado |
| `disponible` | Encendido; se conecta en el primer uso |
| `apagado` | Desactivado por el usuario |

Un especialista con un MCP apagado **sigue siendo elegible**: Jev nombra al
indicado y el compilador agrega la sección *Especialista recomendado — MCP
apagado*, que le indica al coordinador no delegar y pedirle al usuario que
encienda el servidor en **Ajustes → Entorno → MCP Servers**. Ningún agente
enciende un MCP por su cuenta.

Los workers delegados también usan Jev para su propio contexto e iteraciones,
pero sin la pregunta de especialista.

## Fallos

Jev nunca bloquea un turno. Cualquier timeout, error HTTP, respuesta inválida o
excepción devuelve `null` y el turno sigue con la selección clásica. Tras 3 fallos
seguidos entra en cooldown de 60 s; una clave rechazada (`401`/`403`) entra en
cooldown de inmediato. Al guardar, activar o desactivar OpenRouter se reinicia el
estado (`resetJevStatus`).

Un turno reanudado (`resume`) no consulta a Jev (`skipJev`).

## Métricas y ahorro

Cada decisión servida:

- Registra su uso en `recordUsage` con el proveedor `openrouter` y el modelo de Jev.
- Se publica con `emitJevDecision`: evento `canvas:jev_decision` para la Oficina
  3D y `recordJevDecision` para los rollups del dashboard.

El ahorro en tokens es una **estimación**: caracteres que habría enviado el flujo
clásico menos los del plan de Jev (historial, herramientas, catálogo de
especialistas, reglas, notas y skills), divididos entre 4. El valor en dólares
usa la tarifa de entrada del modelo del agente asesorado; un modelo sin tarifa en
el catálogo cuenta $0. El costo de Jev sale de `usage.cost` de OpenRouter o,
si falta, de USD 0,042 por millón de tokens de entrada.

| Superficie | Qué muestra |
|---|---|
| **Proveedores → OpenRouter** | Estado `activo`, `desactivado` o `usando flujo clásico`, con el último error |
| **Dashboard → Uso y Costos de API** | Decisiones, costo, tokens evitados y ahorro neto por agente (`GET /api/usage-stats?hours=N` → `jev`) |
| **Oficina 3D** | Cristal violeta sobre el coordinador que lanza un rayo al agente asesorado |

## Archivos

| Pieza | Archivo |
|---|---|
| Cliente, clave, estado, cooldown, métricas | `packages/core/src/agent/jev-decisions.ts` |
| Preguntas y aplicación de respuestas | `packages/core/src/agent/jev-planner.ts` |
| Integración con el contexto | `packages/core/src/agent/context-compiler.ts` |
| Integración con el loop | `packages/core/src/agent/agent-loop.ts` |
| Rollups de uso | `packages/core/src/storage/usage.ts` |
| Estado en la API de proveedores | `packages/core/src/gateway/routes/providers.ts` |
| Dashboard | `packages/hive-ui/src/components/JevUsageBlock.tsx` |
| Oficina 3D | `packages/hive-ui/src/modules/office3d/scene/JevOracle.tsx`, `hud/JevPanel.tsx` |
| Pruebas | `tests/jev-decisions.test.ts` |

## Otros hosts

`@johpaz/hive-sdk` 0.5.1 incluye el mismo motor con la clave inyectable
(`jev: { apiKey } | false`) y el estado separado por inquilino; Hive Cloud lo usa
con la cascada de credenciales workspace → organización. Con un inquilino activo,
el SDK nunca usa `OPENROUTER_API_KEY` del entorno.
