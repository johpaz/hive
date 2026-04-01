# Proyectos y Delegación de Tareas - Guía Completa

## Visión General

Hive utiliza un sistema de **proyectos y tareas** para coordinar múltiples agentes workers en trabajos complejos. El **agente coordinador** (role='coordinator') es responsable de:

1. Crear proyectos con múltiples tareas
2. Delegar tareas a workers especializados
3. Monitorear el progreso
4. Consolidar resultados

---

## Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                    COORDINADOR (Bee)                            │
│  role='coordinator' | status='idle' | tools: todas              │
│                                                                 │
│  - Recibe solicitud del usuario                                 │
│  - Crea proyecto con project_create                             │
│  - Delega tareas con delegate_task                              │
│  - Consolidar resultados con project_done                       │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │  ai_researcher  │ │social_media_... │ │  email_manager  │
    │  role='worker'  │ │  role='worker'  │ │  role='worker'  │
    │  tools: web_*   │ │  tools: write   │ │  tools: email   │
    │  contexto:      │ │  contexto:      │ │  contexto:      │
    │  aislado        │ │  aislado        │ │  aislado        │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   AGENT BUS     │
                    │  (pub/sub)      │
                    │                 │
                    │ - task_started  │
                    │ - task_complete │
                    │ - task_failed   │
                    │ - help_request  │
                    └─────────────────┘
```

---

## Flujo Completo Paso a Paso

### Paso 1: Evaluación de la Tarea

El coordinador debe evaluar si la solicitud requiere un proyecto:

**Tarea SIMPLE (1-2 pasos)** → Ejecutar directamente
```
Usuario: "Busca el precio de BTC"
Coordinador: Ejecuta web_search directamente
```

**Tarea COMPLEJA (3+ pasos, múltiples especialistas)** → Crear proyecto
```
Usuario: "Crea un sistema de contenido diario sobre IA"
Coordinador: Crea proyecto con 3 tareas para 3 workers
```

---

### Paso 2: Creación del Proyecto

**Herramienta:** `project_create`

```json
{
  "name": "Sistema de Contenido IA Diario",
  "description": "Automatización diaria de investigación y generación de contenido",
  "type": "content",
  "tasks": [
    {
      "name": "Investigación diaria de IA",
      "description": "Buscar tendencias de IA en la web"
    },
    {
      "name": "Creación de contenido social",
      "description": "Generar posts para LinkedIn e Instagram"
    },
    {
      "name": "Email resumen",
      "description": "Compilar y enviar newsletter semanal"
    }
  ]
}
```

**Respuesta:**
```json
{
  "success": true,
  "projectId": "05e281bf86ec442d",
  "taskIds": [6, 7, 8],
  "message": "Proyecto creado con 3 tarea(s)"
}
```

---

### Paso 3: Búsqueda de Workers Existentes

**Herramienta:** `find_agent`

Antes de crear workers, buscar si ya existen:

```json
{
  "tool": "find_agent",
  "arguments": {
    "query": "investigación web búsqueda tendencias"
  }
}
```

**Respuesta:**
```json
{
  "agents": [
    {
      "id": "888931df52e8a1041464e609936dee42",
      "name": "ai_researcher",
      "description": "Especialista en buscar y resumir tendencias",
      "tools_json": ["web_search", "web_fetch", "save_note"]
    }
  ]
}
```

---

### Paso 4: Delegación de Tareas (¡CRÍTICO!)

**Herramienta:** `delegate_task`

Esta es la herramienta que **ACTIVA** el worker. Sin ella, las tareas permanecen en `pending`.

```json
{
  "tool": "delegate_task",
  "arguments": {
    "task_id": 6,
    "worker_id": "888931df52e8a1041464e609936dee42",
    "task_instructions": "Busca las 5 tendencias de IA más importantes de hoy 7 de marzo 2026 usando web_search. Enfócate en LLM y agentes de IA. Incluye título, descripción y fuente de cada una.",
    "project_id": "05e281bf86ec442d"
  }
}
```

**Qué sucede internamente:**

1. ✅ Verifica que el worker existe y está habilitado
2. ✅ Actualiza tarea: `status='in_progress'`, `agent_id=<worker_id>`
3. ✅ Notifica vía Agent Bus: `worker:task_started`
4. ✅ **Ejecuta el worker con contexto aislado** (runAgentIsolated)
5. ✅ Worker recibe solo:
   - Su system prompt específico
   - Las tools asignadas en `tools_json`
   - Las instrucciones de la tarea
   - **NO** ve la conversación completa del usuario
6. ✅ Worker ejecuta y retorna resultado
7. ✅ Actualiza tarea: `status='completed'`, `progress=100`, `result=<output>`
8. ✅ Notifica vía Agent Bus: `worker:task_completed`
9. ✅ Recalcula progreso del proyecto
10. ✅ Actualiza canvas con nuevo estado

**Respuesta exitosa:**
```json
{
  "ok": true,
  "task_id": 6,
  "worker_id": "888931df52e8a1041464e609936dee42",
  "worker_name": "ai_researcher",
  "result": "1. Integración de agentes con el mundo físico...\n2. Frameworks de construcción de agentes...\n...",
  "project_progress": 50
}
```

**Respuesta con error:**
```json
{
  "ok": false,
  "task_id": 6,
  "worker_id": "888931df52e8a1041464e609936dee42",
  "error": "Worker timeout after 120s"
}
```

---

### Paso 5: Monitoreo del Progreso

**Herramienta:** `get_task_status`

```json
{
  "tool": "get_task_status",
  "arguments": {
    "project_id": "05e281bf86ec442d"
  }
}
```

**Respuesta:**
```json
{
  "ok": true,
  "task_count": 3,
  "tasks": [
    {
      "id": 6,
      "name": "Investigación diaria de IA",
      "status": "completed",
      "progress": 100,
      "agent_name": "ai_researcher",
      "result": "..."
    },
    {
      "id": 7,
      "name": "Creación de contenido social",
      "status": "in_progress",
      "progress": 50,
      "agent_name": "social_media_writer"
    },
    {
      "id": 8,
      "name": "Email resumen",
      "status": "pending",
      "progress": 0,
      "agent_name": null
    }
  ]
}
```

---

### Paso 6: Manejo de Errores

Si un worker falla:

**Opción A: Reintentar con el mismo worker**
```json
{
  "tool": "delegate_task",
  "arguments": {
    "task_id": 7,
    "worker_id": "e362ff788c18dfa12e2e0fa50e16f1a3",
    "task_instructions": "Reintentar: Genera 3 posts para LinkedIn...",
    "project_id": "05e281bf86ec442d"
  }
}
```

**Opción B: Reasignar a otro worker**
```json
{
  "tool": "delegate_task",
  "arguments": {
    "task_id": 7,
    "worker_id": "nuevo_worker_id",
    "task_instructions": "Genera 3 posts para LinkedIn...",
    "project_id": "05e281bf86ec442d"
  }
}
```

**Opción C: Marcar tarea como fallida y continuar**
```json
{
  "tool": "task_update",
  "arguments": {
    "task_id": 8,
    "status": "failed",
    "error": "Email service unavailable"
  }
}
```

---

### Paso 7: Finalización del Proyecto

**Herramienta:** `project_done`

Cuando todas las tareas están completas:

```json
{
  "tool": "project_done",
  "arguments": {
    "projectId": "05e281bf86ec442d",
    "summary": "Proyecto completado exitosamente. Se generaron 5 tendencias de IA, 3 posts para LinkedIn, 3 ideas para Instagram, y 1 newsletter enviado a 150 suscriptores."
  }
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Proyecto marcado como completado"
}
```

---

## Agent Bus - Comunicación entre Workers

El **Agent Bus** es un sistema pub/sub que permite a los workers comunicarse sin pasar por el coordinador.

### Eventos Disponibles

| Evento | Cuándo usar | Datos |
|--------|-------------|-------|
| `worker:task_started` | Al comenzar tarea | workerId, taskId, projectId |
| `worker:task_completed` | Al completar tarea | workerId, taskId, result |
| `worker:task_failed` | Al fallar tarea | workerId, taskId, error |
| `worker:help_request` | Solicitar ayuda | fromWorkerId, request, requiredSkill |
| `worker:help_response` | Responder ayuda | toWorkerId, fromWorkerId, response |
| `message:custom` | Mensaje personalizado | fromWorkerId, toWorkerId, topic, content |

### Tools del Agent Bus

**1. `publish_to_bus`** - Publicar mensaje

```json
{
  "tool": "publish_to_bus",
  "arguments": {
    "message_type": "task_status",
    "content": "Investigación completada. 5 tendencias encontradas.",
    "task_id": 6,
    "topic": "research"
  }
}
```

**2. `get_bus_messages`** - Leer mensajes no leídos

```json
{
  "tool": "get_bus_messages",
  "arguments": {
    "limit": 50,
    "event_type": "help_request"
  }
}
```

**3. `get_project_updates`** - Actualizaciones del proyecto

```json
{
  "tool": "get_project_updates",
  "arguments": {
    "project_id": "05e281bf86ec442d",
    "limit": 20
  }
}
```

---

## Patrones de Uso

### Patrón 1: Delegación Secuencial

Cuando las tareas tienen dependencias:

```
1. delegate_task(task_id=1, worker=researcher)
   └─> Esperar completado
2. delegate_task(task_id=2, writer, "Usa resultados de tarea 1")
   └─> Esperar completado
3. delegate_task(task_id=3, email_manager, "Usa resultados de tarea 2")
   └─> project_done()
```

### Patrón 2: Delegación en Paralelo

Cuando las tareas son independientes:

```
1. delegate_task(task_id=1, worker_a)
2. delegate_task(task_id=2, worker_b)  // Sin esperar tarea 1
3. delegate_task(task_id=3, worker_c)  // Sin esperar tarea 2
   └─> Esperar todas
   └─> project_done()
```

### Patrón 3: Worker con Dependencias Externas

Cuando un worker necesita resultados de otro:

```
Worker A (researcher):
  1. Ejecuta web_search
  2. publish_to_bus(message_type="result_share", content=results, topic="research")

Worker B (writer):
  1. get_bus_messages(event_type="message", topic="research")
  2. Usa resultados para generar contenido
```

---

## Mejores Prácticas

### 1. Instrucciones Claras

❌ **Mal:**
```
"Busca información de IA"
```

✅ **Bien:**
```
"Busca las 5 tendencias de IA más importantes de las últimas 24 horas. 
Enfócate en LLM y agentes autónomos. 
Para cada tendencia incluye: título, descripción (2-3 líneas), fuente (URL o nombre).
Usa web_search con filtro de fecha: 'last day'."
```

### 2. Mínimo Privilegio

Asigna solo las tools necesarias:

```json
{
  "name": "ai_researcher",
  "tools_json": ["web_search", "web_fetch", "save_note"]
  // NO incluir: exec, filesystem_write, etc.
}
```

### 3. Timeout y Reintentos

- **Timeout por defecto:** 120 segundos
- **Reintentos:** Máximo 3 antes de marcar como fallida
- **Backoff:** 5 segundos entre reintentos

### 4. Validación de Resultados

Usa `task_evaluate` para calidad crítica:

```json
{
  "tool": "task_evaluate",
  "arguments": {
    "task_id": 6,
    "criteria": [
      "Contiene mínimo 5 tendencias",
      "Cada tendencia tiene fuente verificable",
      "Fuentes son de las últimas 24 horas"
    ],
    "auto_update": true,
    "evaluation_notes": "Revisado por coordinador"
  }
}
```

---

## Tabla de Herramientas

| Herramienta | Categoría | Uso |
|-------------|-----------|-----|
| `project_create` | projects | Crear proyecto con tareas |
| `project_update` | projects | Actualizar progreso |
| `project_done` | projects | Marcar completado |
| `project_fail` | projects | Marcar fallido |
| `task_create` | projects | Agregar tarea existente |
| `task_update` | projects | Actualizar estado tarea |
| `task_evaluate` | projects | Evaluar calidad |
| `delegate_task` | agents | **DELEGAR Y ACTIVAR WORKER** |
| `get_task_status` | agents | Ver estado tareas |
| `find_agent` | agents | Buscar workers existentes |
| `create_agent` | agents | Crear nuevo worker |
| `archive_agent` | agents | Archivar worker |
| `publish_to_bus` | core | Publicar en Agent Bus |
| `get_bus_messages` | core | Leer mensajes del bus |
| `get_project_updates` | core | Actualizaciones proyecto |

---

## Ejemplo Completo

```
Usuario: "Crea contenido diario sobre IA para redes"

Coordinador:
1. find_agent(query="investigación web")
   → Encuentra: ai_researcher (888931df...)
   
2. find_agent(query="contenido social media")
   → Encuentra: social_media_writer (e362ff78...)

3. project_create({
     "name": "Contenido IA Diario",
     "type": "content",
     "tasks": [
       {"name": "Investigación", "description": "Buscar tendencias"},
       {"name": "Contenido", "description": "Generar posts"}
     ]
   })
   → projectId: "abc123", taskIds: [1, 2]

4. delegate_task({
     "task_id": 1,
     "worker_id": "888931df...",
     "task_instructions": "Busca 5 tendencias de IA de hoy...",
     "project_id": "abc123"
   })
   → ai_researcher ejecuta web_search
   → Resultado: 5 tendencias encontradas
   → task.status = "completed", project.progress = 50%

5. delegate_task({
     "task_id": 2,
     "worker_id": "e362ff78...",
     "task_instructions": "Usa resultados de tarea 1 para generar 3 posts...",
     "project_id": "abc123"
   })
   → social_media_writer ejecuta
   → Resultado: 3 posts generados
   → task.status = "completed", project.progress = 100%

6. project_done({
     "projectId": "abc123",
     "summary": "5 tendencias investigadas, 3 posts generados"
   })
   → Proyecto completado
```

---

## Solución de Problemas

### Problema: Tarea permanece en `pending`

**Causa:** No se usó `delegate_task`

**Solución:**
```json
{
  "tool": "delegate_task",
  "arguments": {
    "task_id": <id>,
    "worker_id": "<worker_id>",
    "task_instructions": "..."
  }
}
```

### Problema: Worker falla constantemente

**Causas posibles:**
1. Instructions poco claras
2. Tools insuficientes
3. Timeout muy corto

**Solución:**
1. Revisar logs: `SELECT error FROM tasks WHERE status='failed'`
2. Mejorar instrucciones
3. Verificar tools asignadas

### Problema: Progreso del proyecto > 100%

**Causa:** Bug en cálculo de progreso

**Solución:**
```sql
UPDATE projects SET progress = 100 WHERE id = '<project_id>';
```

---

## Referencias

- **Schema:** `packages/core/src/storage/schema.ts`
- **Delegate Tool:** `packages/core/src/tools/delegate-task.ts`
- **Agent Bus:** `packages/core/src/events/agent-bus.ts`
- **Prompt Builder:** `packages/core/src/agent/prompt-builder.ts`
