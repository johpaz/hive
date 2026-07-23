# Sistema de Notas — Scratchpad

## ¿Qué es el Scratchpad?

El **scratchpad** es el sistema de notas persistentes del agente. Es una colección de documentos HiveDB (`scratchpad`) que actúa como memoria de trabajo: el agente puede escribir y leer notas que **sobreviven a la compresión del contexto** de conversación.

A diferencia del historial de mensajes (que se comprime o trunca cuando crece), las notas del scratchpad se inyectan siempre en el system prompt en cada turno, garantizando que el agente nunca "olvide" información clave que él mismo decidió guardar.

---

## Forma del documento (colección HiveDB `scratchpad`)

`packages/core/src/agent/conversation-store.ts`:

```typescript
interface ScratchpadDoc {
  threadId: string
  key: string
  value: string
  source: string | null
  createdAt: number
  updatedAt: number
  seq: number   // contador monotónico — desempate entre notas guardadas en el mismo tick de reloj
}
```

Cada documento se guarda con `id = "<threadId>:<key>"` — así listar las notas de un thread es un prefix scan (`col.scan({ prefix: \`${threadId}:\` })`), sin necesitar un índice secundario. Si el agente guarda una nota con la misma clave dos veces, la segunda sobreescribe la primera (upsert, vía `col.put()`).

---

## Cómo el agente escribe notas — Tool `save_note`

El agente usa la herramienta nativa `save_note` para escribir en el scratchpad.

**Definición:**
```
Nombre:     save_note
Descripción: Save a note to the scratchpad (survives context compression).
Parámetros:
  key       (string, requerido)  — Clave única para identificar la nota
  value     (string, requerido)  — Contenido de la nota
  thread_id (string, opcional)   — ID del thread; usa el thread actual si se omite
```

**Ejemplo de uso por el agente:**
```json
{
  "key": "preferencia_usuario",
  "value": "El usuario prefiere respuestas en español y sin emojis."
}
```

La herramienta ejecuta un `INSERT OR REPLACE` sobre la tabla `scratchpad`, marcando `source = 'agent'` y actualizando `updated_at`.

---

## Cómo el agente lee notas — Context Compiler

Las notas **no requieren que el agente las pida explícitamente**. El `context-compiler.ts` las carga automáticamente al inicio de cada turno (STEP-2 del pipeline de ensamblado del system prompt).

```
Pipeline de context-compiler:
  1. Ethics
  2. ← SCRATCHPAD: getScratchpad(threadId) → todas las notas del thread actual
  3. Agent identity
  4. Hive Capabilities
  5. User profile
  6. Playbook rules
  7. Environment
```

Las notas se inyectan como una sección `# SCRATCHPAD (Persistent Notes)` en el system prompt, en formato TOON (clave-valor comprimido):

```
# SCRATCHPAD (Persistent Notes)
preferencia_usuario: El usuario prefiere respuestas en español y sin emojis.
tarea_pendiente: Revisar el archivo de configuración de Telegram antes del próximo turno.
```

El agente ve esta sección en cada mensaje y puede actuar sobre ella.

---

## Funciones internas (conversation-store.ts)

| Función | Descripción |
|---------|-------------|
| `saveScratchpadNote(threadId, key, value, source?)` | Upsert de una nota |
| `getScratchpad(threadId)` | Obtiene todas las notas de un thread (ordenadas por `updated_at DESC`) |
| `deleteScratchpadNote(threadId, key)` | Elimina una nota específica |

---

## API REST

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `GET /api/notes` | GET | Devuelve las últimas 50 notas de todos los threads, ordenadas por `updated_at DESC` |
| `PUT /api/notes` (interno) | POST | Upsert manual de una nota por `threadId` + clave `'note'` |

La respuesta de `GET /api/notes` tiene el formato:
```json
{
  "notes": [
    {
      "id": 1,
      "thread_id": "abc123",
      "key": "preferencia_usuario",
      "value": "El usuario prefiere respuestas en español.",
      "source": "agent",
      "created_at": 1741785600,
      "updated_at": 1741789200
    }
  ]
}
```

---

## Visualización en la UI — NotesPanel

El componente `NotesPanel.tsx` muestra las notas del scratchpad en tiempo real:

- **Título**: campo `key` de la nota
- **Contenido**: campo `value` (truncado a 3 líneas)
- **Badge**: últimos 8 caracteres del `thread_id` (identifica de qué conversación proviene)
- **Fecha**: `updated_at` convertido a fecha local

La UI se refresca llamando a `fetchNotes()` al montar el componente.

---

## Diferencia con el historial de mensajes

| | Historial (`conversations`) | Scratchpad (`scratchpad`) |
|---|---|---|
| **Qué almacena** | Todos los mensajes del chat | Notas clave elegidas por el agente |
| **Sobrevive compresión** | No (se comprime/trunca) | Sí (siempre en el system prompt) |
| **Quién escribe** | Sistema (automático) | El agente (tool `save_note`) |
| **Granularidad** | Por mensaje | Por clave única |
| **Alcance** | Por thread | Por thread |

---

## Casos de uso típicos

- **Preferencias del usuario** detectadas en la conversación: idioma, tono, horarios.
- **Contexto de tareas largas**: pasos completados, archivos modificados, URLs relevantes.
- **Decisiones tomadas**: qué proveedor de LLM usar, configuraciones aprobadas por el usuario.
- **Recordatorios entre sesiones**: pendientes que el agente quiere retomar al reanudar la conversación.
- **Estado de proyectos**: resumen del estado actual cuando el historial ya fue comprimido.
