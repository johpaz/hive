# Manual de Usuario: Ejecución Paralela de Herramientas con Bun Workers

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Qué cambia para el usuario](#qué-cambia-para-el-usuario)
3. [Cómo funciona](#cómo-funciona)
4. [Configuración](#configuración)
5. [Herramientas nativas, MCP y RPC al proceso principal](#herramientas-nativas-mcp-y-rpc-al-proceso-principal)
6. [Orden de resultados y compatibilidad con modelos](#orden-de-resultados-y-compatibilidad-con-modelos)
7. [Timeouts, errores y cancelación](#timeouts-errores-y-cancelación)
8. [Cómo verificar que está funcionando](#cómo-verificar-que-está-funcionando)
9. [Resolución de problemas](#resolución-de-problemas)
10. [Preguntas frecuentes](#preguntas-frecuentes)

---

## Introducción

Hive ahora puede ejecutar varias llamadas a herramientas en paralelo cuando el modelo pide más de una herramienta en el mismo turno. Esto se hace mediante un pool persistente de **Bun Workers**.

Antes, si el modelo pedía tres herramientas, Hive las ejecutaba una por una:

```text
tool A -> tool B -> tool C -> siguiente llamada al modelo
```

Ahora, Hive agenda el lote completo y ejecuta las herramientas al mismo tiempo cuando es posible:

```text
tool A ┐
tool B ├─> resultados ordenados -> siguiente llamada al modelo
tool C ┘
```

El objetivo principal es reducir la latencia en turnos donde el agente necesita consultar varias fuentes, leer varios archivos, buscar información o combinar herramientas independientes.

---

## Qué cambia para el usuario

### Beneficios visibles

- Las respuestas pueden llegar más rápido cuando el agente usa varias herramientas en un mismo turno.
- Las herramientas lentas ya no bloquean necesariamente a las demás.
- Si una herramienta falla, las demás pueden terminar normalmente.
- El agente mantiene el mismo formato de conversación y los mismos pasos visibles de `tool_call` y `tool_result`.

### Lo que no cambia

- No cambia la forma de hablar con el agente.
- No cambia el nombre ni el uso de las herramientas.
- No cambia el orden en que los resultados se entregan al modelo.
- No se ejecutan varios turnos de conversación del mismo usuario al mismo tiempo; la mejora aplica al lote de herramientas dentro de un turno.

---

## Cómo funciona

Cuando el modelo devuelve una respuesta con varias `tool_calls`, Hive hace lo siguiente:

1. Emite un paso `tool_call` por cada herramienta solicitada.
2. Envía todas las herramientas del lote al scheduler de Workers.
3. Ejecuta en paralelo las herramientas que pueden correr dentro de un Worker.
4. Para herramientas que dependen de estado vivo del proceso principal, usa RPC interno al hilo principal.
5. Recoge todos los resultados.
6. Entrega y persiste los resultados en el mismo orden en que el modelo los pidió.
7. Hace la siguiente llamada al modelo con todos los resultados ya disponibles.

Arquitectura simplificada:

```text
LLM
 │
 │ devuelve varias tool_calls
 ▼
agent-loop
 │
 │ executeToolBatch(...)
 ▼
tool-runtime scheduler
 │
 ├─ Bun Worker 1 -> herramienta reconstruible
 ├─ Bun Worker 2 -> herramienta reconstruible
 ├─ Bun Worker 3 -> herramienta reconstruible
 └─ Bun Worker N -> RPC al proceso principal si hace falta
                         │
                         ▼
                    MCP / Canvas / Browser / Cron / estado vivo
```

---

## Configuración

La configuración vive bajo `tools.workerPool`.

Valores por defecto:

```ts
tools: {
  workerPool: {
    enabled: true,
    maxWorkers: Math.min(4, availableParallelism()),
    toolTimeoutMs: 300000,
    parallelToolCalls: true,
  }
}
```

### Campos disponibles

| Campo | Tipo | Valor por defecto | Descripción |
|-------|------|-------------------|-------------|
| `enabled` | boolean | `true` | Activa o desactiva el runtime de Workers. |
| `maxWorkers` | number | `min(4, CPUs)` | Número máximo de Workers persistentes. |
| `toolTimeoutMs` | number | `300000` | Tiempo máximo por herramienta, en milisegundos. |
| `parallelToolCalls` | boolean | `true` | Permite ejecutar en paralelo las herramientas del mismo turno. |

### Desactivar ejecución paralela

Para volver al comportamiento secuencial, configura:

```ts
tools: {
  workerPool: {
    enabled: false
  }
}
```

También puedes mantener el runtime activo pero desactivar el paralelismo:

```ts
tools: {
  workerPool: {
    enabled: true,
    parallelToolCalls: false
  }
}
```

### Ajustar el número de Workers

Para máquinas pequeñas:

```ts
tools: {
  workerPool: {
    maxWorkers: 2
  }
}
```

Para servidores con más CPU, puedes subirlo con cuidado:

```ts
tools: {
  workerPool: {
    maxWorkers: 6
  }
}
```

Recomendación práctica: empieza con el default. Subir `maxWorkers` ayuda solo si tus herramientas son independientes y realmente pueden correr en paralelo sin saturar disco, red o APIs externas.

---

## Herramientas nativas, MCP y RPC al proceso principal

Todas las llamadas a herramientas pasan por el scheduler. Sin embargo, no todas se ejecutan completamente dentro del Worker.

### Herramientas reconstruibles en Worker

Las herramientas nativas que se pueden reconstruir con `createAllTools(config)` pueden ejecutarse dentro del Worker.

Ejemplos típicos:

- Herramientas de filesystem.
- Herramientas web simples.
- Lectura o escritura de documentos cuando no dependen de estado vivo del proceso principal.

### Herramientas que usan RPC al proceso principal

Algunas herramientas dependen de objetos vivos que no se pueden transferir por `postMessage`, como conexiones MCP, WebSockets, estado del navegador, scheduler de cron o canvas interactivo.

En esos casos, el Worker recibe el trabajo, pero solicita al proceso principal ejecutar la parte que necesita estado vivo.

Ejemplos:

- Herramientas MCP descubiertas dinámicamente.
- Herramientas de navegador (`browser_navigate`, `browser_click`, etc.).
- Herramientas de Canvas y A2UI.
- Herramientas Cron.
- Notificaciones y progreso.
- Delegación de tareas a otros agentes.
- Voz.

Esto permite mantener una regla simple:

> Toda herramienta entra por el scheduler; si no es seguro reconstruirla en Worker, se resuelve por RPC al proceso principal.

---

## Orden de resultados y compatibilidad con modelos

Aunque las herramientas terminen en distinto orden, Hive conserva el orden original de `response.tool_calls`.

Ejemplo:

```text
El modelo pide:
1. fs_read
2. web_search
3. search_knowledge

Terminan:
web_search primero
search_knowledge segundo
fs_read tercero

Hive entrega al modelo:
1. resultado de fs_read
2. resultado de web_search
3. resultado de search_knowledge
```

Esto es importante porque proveedores como OpenAI y Anthropic esperan que los resultados de herramientas correspondan correctamente con sus `tool_call_id`.

La persistencia en historial también respeta ese mismo orden.

---

## Timeouts, errores y cancelación

### Timeout por herramienta

Cada herramienta tiene un límite de tiempo definido por `toolTimeoutMs`.

Si una herramienta excede ese tiempo:

- Se marca como error de timeout.
- No cancela automáticamente las demás herramientas del lote.
- El Worker afectado se reinicia para evitar que quede ocupado con trabajo viejo.

### Errores aislados

Si una herramienta falla:

- Hive devuelve un resultado de error para esa herramienta.
- Las demás herramientas siguen ejecutándose.
- El modelo recibe todos los resultados disponibles y puede decidir cómo continuar.

### Cancelación

Si el usuario o el sistema aborta la ejecución:

- Los trabajos pendientes se marcan como abortados.
- Los trabajos en ejecución se interrumpen desde la perspectiva del scheduler.
- El lote devuelve resultados de abort para las herramientas no completadas.

---

## Cómo verificar que está funcionando

### 1. Ejecutar los tests enfocados

```bash
bun test tests/tool-runtime.test.ts
```

El test valida:

- Ejecución paralela real.
- Preservación de orden.
- Errores aislados.
- RPC al proceso principal.
- Timeout.
- Abort.

### 2. Revisar typecheck del core

```bash
bunx tsc --noEmit -p packages/core/tsconfig.json --rootDir .
```

### 3. Revisar logs del agente

Durante una conversación con varias herramientas, deberías ver logs similares a:

```text
[agent-loop] Tool web_search completed in 812ms
[agent-loop] Tool fs_read completed in 34ms
[agent-loop] Tool search_knowledge completed in 91ms
```

El orden de los logs puede reflejar la finalización real, pero los resultados enviados al modelo se ordenan por el orden original del lote.

### 4. Probar con una instrucción que use varias herramientas

Ejemplo:

```text
Busca en mi workspace los archivos de configuración, revisa el README y consulta qué herramientas existen para navegador.
```

El modelo puede pedir varias herramientas en el mismo turno. Si lo hace, Hive las ejecutará por lote.

---

## Resolución de problemas

### El agente no parece más rápido

Posibles causas:

- El modelo está pidiendo una sola herramienta por turno.
- Las herramientas dependen de un mismo recurso lento, como red, API externa o disco.
- `parallelToolCalls` está desactivado.
- `maxWorkers` está configurado en `1`.
- La latencia dominante está en la llamada al modelo, no en las herramientas.

### Una herramienta falla con timeout

Qué revisar:

- Aumenta `toolTimeoutMs` si la herramienta normalmente tarda más.
- Verifica si la API externa está lenta.
- Revisa si la herramienta espera interacción del usuario, como algunos flujos de Canvas.

Ejemplo:

```ts
tools: {
  workerPool: {
    toolTimeoutMs: 600000
  }
}
```

### Una herramienta MCP no debe ejecutarse dentro del Worker

Las herramientas MCP no se transfieren al Worker como conexión viva. El Worker solicita la ejecución por RPC al proceso principal, donde vive el `MCPClientManager`.

Si una herramienta MCP falla:

- Revisa que el servidor MCP esté conectado.
- Revisa que la herramienta aparezca en el catálogo MCP.
- Revisa logs del servidor MCP.
- Confirma que `search_knowledge(type="mcp")` puede descubrirla si no está en el loadout actual.

### Veo resultados en orden diferente en logs

Eso puede ser normal. Los logs pueden aparecer según el momento en que cada herramienta termina. Lo importante es que los mensajes `tool` persistidos y enviados al modelo se mantengan en el orden de `response.tool_calls`.

### Quiero desactivar Workers temporalmente

Usa:

```ts
tools: {
  workerPool: {
    enabled: false
  }
}
```

Esto conserva la compatibilidad y vuelve a ejecución secuencial.

---

## Preguntas frecuentes

### ¿El agente siempre ejecuta herramientas en paralelo?

No. Solo cuando el modelo devuelve varias herramientas en el mismo turno y `parallelToolCalls` está activo.

### ¿Esto ejecuta varias conversaciones al mismo tiempo?

No. Esta mejora aplica al lote de herramientas dentro de una misma respuesta del modelo.

### ¿Puede una herramienta fallida cancelar todo el lote?

No por defecto. Cada herramienta produce su propio resultado. Si una falla, las demás pueden completar.

### ¿MCP corre dentro del Worker?

No directamente. Las conexiones MCP viven en el proceso principal. El Worker usa RPC interno para pedir la ejecución.

### ¿Puedo subir `maxWorkers` sin límite?

No es recomendable. Más Workers pueden aumentar consumo de CPU, memoria, presión sobre disco y rate limits de APIs externas. El default `min(4, CPUs)` es conservador.

### ¿Dónde está implementado?

Archivos principales:

- `packages/core/src/tool-runtime/index.ts`
- `packages/core/src/tool-runtime/tool-worker.ts`
- `packages/core/src/agent/agent-loop.ts`
- `packages/core/src/config/loader.ts`
- `tests/tool-runtime.test.ts`

