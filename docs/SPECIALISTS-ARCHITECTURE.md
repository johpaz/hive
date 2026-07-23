# Arquitectura de especialistas de Hive

## Objetivo

Hive conserva un único coordinador visible para el usuario y materializa especialistas dormidos únicamente cuando una subtarea los necesita. Las plantillas viven en HiveDB, se recuperan mediante el índice híbrido y ejecutan el Native Agent Loop existente. El worker libre continúa como fallback.

El catálogo runtime de referencia contiene 73 tools nativas y, después de esta implementación, 33 skills. Hive no incluye servidores MCP de negocio por defecto: acepta servidores `stdio`, `sse` y `websocket` configurados por el usuario.

## Fase 1 — Catálogo de capacidades

| Dominio real | Capacidades | Destino |
|---|---|---|
| Investigación web | búsqueda y fetch ligero | `web_researcher` |
| Navegación renderizada | navegación, click, escritura, extracción, scripts, espera y captura | `browser_operator` |
| Workspace | siete operaciones seguras de filesystem | `workspace_file_operator` |
| Software | shell dentro del workspace y filesystem | `software_engineer` |
| Office | lectura/escritura de PDF, DOCX, XLSX y PPTX | `office_document_specialist` |
| Presentación | Canvas clásico | `canvas_presenter` |
| Interfaces | superficies A2UI v0.9 | `a2ui_builder` |
| Agenda | ocho operaciones cron | `schedule_automation_specialist` |
| Reuniones | sesión, segmentos, cierre e informe | `meeting_scribe` |
| Voz | STT y TTS | `voice_audio_specialist` |
| APIs | requests REST | `api_operator` |
| Servicios externos | tools MCP descubiertas | `mcp_integration_operator` |
| Aceptación | checks y readbacks independientes | `acceptance_verifier` |

Memoria simple, descubrimiento, proyectos, agentes, bus, notificaciones y progreso pertenecen al coordinador. Combinaciones raras o sin coincidencia suficiente usan el worker libre.

## Fase 2 — Contrato de las plantillas

Las trece plantillas se definen en `agent/specialist-catalog.ts`. Cada descripción es una sola línea clasificable por un modelo pequeño y cada `system_prompt_addon` contiene:

1. Rol.
2. Información recibida.
3. Flujo numerado.
4. Prohibiciones.
5. Entrega estructurada con `status`, `what_was_done`, `artifacts`, `evidence`, `risks` y `question`.
6. Criterio de calidad.

Un especialista nunca conversa con el usuario, delega, amplía el alcance ni utiliza tools fuera de su allowlist. `canvas_ask` y `canvas_confirm` permanecen en el coordinador.

Los modelos se resuelven por capacidades activas. Software prefiere `code + function_calling`; el verificador prefiere `reasoning + function_calling` y, si es posible, otra familia de modelo. Ambos vuelven al modelo general cuando la instalación local no ofrece una alternativa.

Se añadieron las skills `workspace_file_operator`, `software_engineering`, `mcp_lazy_operator` y `acceptance_verification`. Los metadatos antiguos de filesystem y CLI usan ahora IDs nativos vigentes.

## Fase 3 — HiveDB

`db.collection<SpecialistDoc>("specialists")` guarda identidad, prompt, señales de routing, allowlist, skills, MCP, scope, política de modelo, aceptación por defecto, fuente, versión, contadores ACE y estado.

El seed usa IDs estables y `putIfAbsent`; un boot posterior nunca pisa cambios del usuario o del ACE. Los índices escalares son `active` y `source`.

El índice de capacidades acepta `type="specialist"`:

- `name`: nombre e ID.
- `tags`: ejemplos, exclusiones, tools y skills.
- `body`: descripción enrutable.

El prompt completo no se indexa. `searchSpecialists()` usa BM25/híbrido y corte relativo al mejor resultado.

`VerificationDoc` registra run, task, ejecutor, objetivo, criterios, veredicto, intento y epochs. Un `ProofPacketDoc` exitoso requiere `verification_id` apuntando a un veredicto independiente `verified`.

## Fase 4 — Routing

El Context Compiler inyecta al coordinador solo `id: descripción`. Las reglas son:

- Resolver conversación y tareas simples directamente.
- Descomponer únicamente por dominios, efectos o dependencias reales.
- Delegar con `specialist_id`, subtarea acotada, contexto mínimo, aceptación y MCP específicos.
- Usar worker libre si no existe coincidencia clara.
- Convertir `needs_input` en una pregunta del coordinador.
- No prometer éxito de una delegación o efecto sin verificación.

`task_delegate` acepta `specialist_id` o el `worker_id` legado. La primera forma materializa la plantilla; la segunda preserva compatibilidad.

## Fase 5 — Despertar, verificar y dormir

`SpecialistRuntimeManager` expande comodines contra el catálogo real, valida skills, resuelve modelo, materializa un `AgentDoc` estable por usuario/coordinador/workspace y adquiere leases MCP.

El contexto de un especialista contiene únicamente su system prompt, skills explícitas, tools permitidas y MCP de la tarea. El descubrimiento dinámico no puede escapar del conjunto de executors filtrado.

Los workers se reutilizan durante cinco minutos sin compartir historial entre tareas. Un MCP se desconecta dos minutos después del último lease. `MCPClientManager.initialize()` registra servidores sin conectarlos; una conexión global requiere opt-in explícito.

Flujo de cumplimiento:

```text
coordinador → ejecutor → acceptance_verifier
                           ├─ verified → proof packet → respuesta
                           ├─ rejected → reintento acotado
                           └─ needs_evidence → evidencia o duda al coordinador
```

El verificador solo recibe objetivo, criterios, entrega, trazas y artefactos. Su allowlist excluye escritura, shell, clicks, formularios, creación y eliminación. Tres rechazos agotan por defecto los reintentos lógicos; el sistema informa incumplimiento en lugar de éxito.

Runs y jobs siguen usando checkpoints, leases, idempotencia y epochs existentes. Diferentes especialistas pueden correr bajo el límite global; un resultado compuesto se completa solo cuando todas sus dependencias requeridas están verificadas.

## Fase 6 — ACE

Las trazas incluyen `specialist_id`. La compuerta independiente incrementa `helpful_count` o `harmful_count` con el veredicto de aceptación global, no por cada tool call ni por la mera ausencia de excepciones en el ejecutor.

El Curator:

- Desactiva una plantilla cuando `harmful_count > helpful_count` y existen al menos tres resultados dañinos.
- Propone `create_specialist` después de cinco ejecuciones exitosas recurrentes de un worker libre.
- Propone `move_tool` ante tres fallos repetidos de una misma tool en una especialidad.
- Nunca cambia permisos automáticamente.
- Sincroniza de nuevo el índice tras cambios.

Las propuestas viven en `specialistProposals` con evidencia, confianza y estado. Las reflexiones que afectan agentes materializados producen reglas aplicables a `specialist:<id>`; el Context Compiler inyecta reglas globales y las de la especialidad activa.

## Orden de implantación y pruebas

1. Persistencia e índice.
2. Plantillas y skills.
3. Routing y materialización.
4. MCP lazy y ciclo de vida.
5. Verificador y proof packets fail-closed.
6. ACE.

Las pruebas cubren seed idempotente, búsqueda, loadouts read-only, materialización estable, aislamiento, catálogo de routing y la imposibilidad de crear una prueba exitosa sin verificación.
