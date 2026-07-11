# CHANGELOG v0.0.41 — Hive

## ⚠️ Breaking: SQLite queda completamente reemplazado por HiveDB — sin migración de datos

Esta versión termina lo que empezó como migración puntual de búsqueda (FTS5→HiveDB) y del motor
de colecciones (probado primero en `scratchpad`): **ya no queda una sola tabla SQLite en Hive.**
Las ~30 entidades de la app —`users`, `providers`, `models`, `agents`, `channels`,
`conversations`, `summaries`, `scratchpad`, `skills`, `tools`, `ethics`, `mcpServers`,
`mcpTools`, `traces`, `playbook`, `cronJobs`, `projects`, `tasks`, `agentBusMessages`,
`meetingSessions`, tokens de auth, registros de uso, etc. (ver `storage/collections.ts`)— corren
ahora sobre colecciones de documentos de HiveDB (`@johpaz/hive-db`: redb + tantivy + hnsw_rs).
`packages/core/src/storage/schema.ts` y `storage/sqlite.ts` fueron eliminados del repo.

**No hay ruta de migración automática desde el `hive.db` (SQLite) de instalaciones anteriores.**
El bootstrap nuevo (`storage/bootstrap.ts`) lo deja explícito en su propio comentario: *"A
brand-new install never has legacy SQLite data to migrate"* — no existe un import de datos
viejos. Cualquier instalación existente que actualice arranca con la base HiveDB vacía (solo el
seed por defecto: catálogo de providers/modelos/tools/skills/ética) y el `hive.db` anterior
queda en disco sin usarse, ignorado por completo por el código nuevo.

**Por qué se acepta ahora:** la distribución todavía tiene pocos usuarios activos, y mantener un
importador para ~30 formas de tabla distintas —de un esquema que probablemente va a seguir
moviéndose mientras HiveDB madura— es mucho más costoso que pedirle a los pocos usuarios
actuales que reinstalen. Es la ventana más barata para hacer este corte limpio.

**Si actualizás desde una versión anterior:**
- Backup de `~/.hive/data/hive.db` antes de actualizar si te interesa conservar algo del
  historial — no hay forma de reimportarlo automáticamente, pero el archivo queda intacto por si
  se arma un importador manual más adelante.
- Vas a tener que recorrer el wizard de Setup de nuevo (providers, agente, canales, voz).
- Agentes, conversaciones y configuración de providers/keys de la instalación anterior no
  aparecen — es un estado nuevo, no un upgrade en el sentido tradicional.

---

## Resumen

Esta versión reemplaza **FTS5 de SQLite por HiveDB** (`@johpaz/hive-db`, motor Rust embebido propio) como motor de búsqueda de capacidades del agente (tools, skills, playbook, MCP), con soporte real de español (acentos, stemming) y parsing tolerante a texto crudo. Sobre ese mismo motor se estrena el nuevo tier de **colecciones de documentos** de HiveDB — probado primero en `scratchpad` y luego extendido al resto de la base (ver sección de arriba), completando la salida de SQLite. También se **elimina por completo el soporte de LLM local** (`llama-server`), se **consolida HiveAgents a un solo modelo** (Qwen-AgentWorld, optimizado para agentes/tool-use), se reescribe la **resolución de providers de voz** (STT/TTS) para que dependa de la base de datos en vez de adivinar por el nombre del modelo, y se retiran los **modelos/providers hardcodeados como fallback** (`gpt-4o`, `gpt-4o-mini`, `whisper-large-v3-turbo`, `gemini-2.0-flash`...) en favor de resolución real contra la base de datos en creación de agentes, compactación de contexto, reuniones y OCR.

---

## Búsqueda de Capacidades: Migración de FTS5 (SQLite) a HiveDB

### Por qué

FTS5 no tenía stemming ni manejo real de acentos en español (parcheado con wildcards y un diccionario ES→EN a mano), no soportaba delete/upsert limpio (el índice se reconstruía completo en cada sync), y los umbrales de relevancia eran negativos y ajustados a ojo. El motor propio **HiveDB** (`@johpaz/hive-db`, Rust: `redb` + `tantivy` BM25 + `hnsw_rs` + RRF, binding `napi-rs`) resuelve las tres cosas.

### Motor (hiveBD, paquete `@johpaz/hive-db`)

- Analyzer español `es_folded`: minúsculas → plegado de acentos → stemming Snowball, aplicado ANTES del stemmer ("transacción" ≈ "transaccion", "pagos" ≈ "pago").
- Esquema multi-campo con pesos: `name` (4.0) > `tags` (3.0) > `body` (2.0).
- `upsertDoc` / `upsertBatch` / `deleteDoc` / `deleteByFilter` / `clearIndex` — soporte real de delete/upsert (antes solo existía `indexDoc`, ahora deprecado).
- Parsing tolerante: comillas sin cerrar, operadores, `¿?` — el texto crudo del usuario nunca lanza error.
- Semántica de scores: BM25 crudo (solo texto) / similitud coseno (solo vector) / RRF (híbrido) — siempre positivo, mayor = mejor.
- `HiveDB.open(":memory:")` para tests; dimensión de vector configurable por base (`OpenOptions.vectorDimension`).

### Integración en Hive

- **Nuevos módulos:** `packages/core/src/storage/hivedb.ts` (singleton `getSearchDb()`), `packages/core/src/agent/capability-search.ts` (capa única de búsqueda: convención de ids `tool:`/`skill:`/`playbook:`/`mcp:`, filtro por `type`, corte relativo de relevancia `score ≥ 0.3 × top` — nunca un umbral absoluto).
- `tool-selector.ts`, `skill-selector.ts`, `playbook-selector.ts` reescritos: `selectTools`/`selectSkills`/`selectPlaybookRules` ahora **async**, usan `searchCapabilities` en vez de construir queries FTS5 a mano.
- `mcp/tool-sync.ts`: sync de herramientas MCP reescrito sobre `deleteByFilter` + `upsertBatch`.
- `tools/core/index.ts`: `search_knowledge` reescrito sobre la nueva capa; se conserva el diccionario ES→EN (el stemming no traduce entre idiomas) hasta que HiveDB tenga embeddings.
- `gateway/initializer.ts`: abre HiveDB antes de sincronizar tools/skills/playbook/MCP.

### Fix: nombres de herramientas MCP contaminaban la búsqueda

Reportado en producción: buscar una palabra genérica devolvía el catálogo entero (~60 tools) de un servidor MCP con nombre genérico como "herramientas administrativas".

- **Causa 1:** el `server_name` se indexaba como texto buscable en `tags`.
- **Causa 2:** `mcpToolFullName` truncaba el string combinado desde el final al pasar 64 caracteres, cortando el nombre distintivo de la tool en vez del prefijo del servidor.
- **Fix:** el `server_name` ya no es texto buscable (el prefijo en el *id* sigue siendo necesario para unicidad de function names); `mcpToolFullName` ahora acorta el prefijo del SERVIDOR (mínimo 8 caracteres) para que el nombre de la tool siempre sobreviva intacto; nombres camelCase (`crearEvento`) se indexan también separados (`crear Evento`); `mcpToolId` delega en `mcpToolFullName` para que nunca diverjan.
- **Migración `v0.0.43`** recompila los ids de `mcp_tools` ya almacenados con el nuevo algoritmo.

### Limpieza

- `storage/schema.ts`: eliminadas las 4 tablas virtuales `tools_fts` / `skills_fts` / `playbook_fts` / `mcp_tools_fts` y sus índices.
- `storage/seed.ts`: ya no crea ni sincroniza triggers/tablas FTS5 (incluye fix de un bug que solo se manifestaba en instalaciones nuevas: `seedAllData()` todavía escribía en `playbook_fts`, inexistente tras el schema nuevo).
- Retirados los tests obsoletos de FTS5 (`test_fts5_query.ts`, `test_fts5_db.ts`, `fts5-improvement-test.ts`, `verify_fts_robust.ts`, `test_mcp_fts5.ts`, `test_search_knowledge.ts`, `test_mcp_search.ts`, `test_mcp_search_validation.ts`) → nuevo `tests/hivedb-search.test.ts` (9 tests de integración sobre índice `:memory:`).
- `docs/ARCHITECTURE.md`, `docs/SKILLS-MANUAL-USUARIO.md`: referencias a FTS5 actualizadas a HiveDB.

### Complemento: el propio agente seguía "pensando" en FTS5

La migración de motor había quedado completa en el código, pero no en lo que el agente lee de
sí mismo en cada turno — el skill core que enseña a usar `search_knowledge` seguía nombrado y
redactado para el motor viejo, con una instrucción de comportamiento que dejó de ser cierta.

- **Bug de comportamiento real, no solo cosmético**: el skill siempre-cargado `busqueda_fts5`
  instruía *"AND entre palabras no encuentra nada"* — cierto para FTS5 (que ANDea términos
  bareword por defecto), pero falso para HiveDB: se verificó contra el motor
  (`hiveBD/crates/hivedb-index/src/text.rs`) que los términos se combinan con `Occur::Should`
  (OR), rankeados por BM25. El agente venía recibiendo una regla activamente incorrecta sobre
  su propia herramienta de descubrimiento en cada conversación.
- Renombrado el skill `busqueda_fts5` → `capability_discovery` (carpeta, `name` del frontmatter,
  y las dos listas `MINIMAL_SKILL_NAMES` en `skill-selector.ts`/`context-compiler.ts`); corregida
  la guía de comportamiento: una frase de varias palabras ya no falla, solo diluye precisión
  frente a una keyword única.
- Comentarios de código que describían el matching actual como "FTS5" (`tool-selector.ts`,
  `skill-selector.ts`, `tools/core/index.ts`) actualizados a "BM25".
- `docs/AGENT_LOOP_CONTEXT_COMPILER.md` y `README.md`: reescritas las secciones específicas de
  FTS5 (selectores, umbrales, esquema de índice) para reflejar el índice único de HiveDB y el
  corte relativo de relevancia (`0.3 × mejor score`, no los umbrales absolutos negativos viejos:
  `-30`/`-15`). Señalado (no reescrito) que ambos documentos aún describen el resto de la capa de
  storage como si fuera SQLite —incluyendo referencias a `storage/schema.ts`/`storage/sqlite.ts`,
  que ya no existen— como deuda documental pendiente más allá del alcance de FTS5.

---

## Colecciones de Documentos en HiveDB: Motor General + Caso Detallado `scratchpad`

### Motor: Gate G10 (hiveBD, `@johpaz/hive-db@0.2.0`)

Cuarto tier de almacenamiento junto al event-log, la memoria semántica y la working memory: CRUD mutable de documentos JSON sobre `redb` — la pieza que permitió reemplazar por completo las tablas relacionales de SQLite (ver el aviso de breaking change al inicio del documento: la migración terminó cubriendo las ~30 entidades de la app, no solo `scratchpad`).

- **Versionado optimista:** `put(id, doc, { expectedVersion })` — `expectedVersion: 0` crea solo si no existe; falla con `version conflict` si no coincide.
- **Índices secundarios de igualdad**, opcionalmente `unique`, con backfill automático al crearse.
- **Scan** con `prefix` / `offset` / `limit` / `reverse`.
- **Batches atómicos** multi-colección (`ColOp::Put | Delete`), todo o nada.
- API TypeScript: `db.collection<T>(name)` → `.put/.get/.delete/.scan/.count/.createIndex/.findBy`; `db.batch(ops)`.
- Publicado en npm como `@johpaz/hive-db@0.2.0` (junto con G9, distribución multiplataforma con `@napi-rs/cli`: 6 targets).

### Bootstrap general: `storage/bootstrap.ts` reemplaza `initializeDatabase()` + `seedAllData()` + `runStartupMigrations()`

Con la salida completa de SQLite ya no hace falta una lista de migraciones version-gated: `ensureHiveDb()` abre la base, asegura los índices secundarios de cada colección (~30 entradas en `INDEXES`, cubriendo las relaciones que antes eran foreign keys — `models.provider_id`, `agents.user_id`, `tasks.project_id`, etc.) y reseedea los catálogos estáticos en cada boot vía `putIfAbsent`, para no pisar `enabled`/`active` que el usuario ya haya tocado.

### Caso detallado — `scratchpad`: primer módulo migrado a mano, documentado como referencia del patrón

`scratchpad` fue el primer módulo migrado fuera de SQLite (se descartó `tool_cache` como candidata inicial: existía en el schema pero no tenía ningún código que la usara), y quedó documentado en detalle porque el mismo patrón se aplicó después al resto de las colecciones:

- **Diseño:** `id = "<threadId>:<key>"` — listar las notas de un hilo es un `scan({ prefix })`, sin necesitar índice secundario.
- `packages/core/src/agent/conversation-store.ts`: `saveScratchpadNote` / `getScratchpad` / `deleteScratchpadNote` ahora async sobre `HiveDB.collection("scratchpad")`; nueva `listAllScratchpadNotes` para el panel admin.
- Desempate de orden por `seq` monotónico por proceso: dos notas guardadas en el mismo tick de reloj (fácil con llamadas `await` rápidas) ya no quedan en orden ambiguo — mejora real sobre el comportamiento anterior en SQLite, donde `ORDER BY updated_at DESC` tenía la misma ambigüedad silenciosa en empates.
- Call sites actualizados a `await`: `context-compiler.ts` (inyección de notas al system prompt), `tools/core/index.ts` (tool `save_note`, ahora delega en `saveScratchpadNote` en vez de duplicar el SQL), `gateway/routes/chat.ts` (`/api/notes`, `handleGetNotes`/`handleUpdateNote`).
- Contrato de API sin cambios para el frontend: `listAllScratchpadNotes` devuelve el mismo shape snake_case + epoch-segundos que antes (`packages/hive-ui/src/types/notes-crons.ts` solo cambia `id: number` → `string`; `NotesPanel.tsx` no requirió cambios).
- Tests nuevos: `tests/scratchpad.test.ts` (7 tests de integración).

---

## HiveAgents: Modelo Único + Validación de API Key

### Consolidación a Qwen-AgentWorld

El catálogo de 9 variantes GGUF (Qwen3.6, Gemma 4, Qwopus3.6 en varias cuantizaciones) se reduce a un solo modelo recomendado: `Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf`, optimizado para agentes, tool-use y MCP (contexto 200K, antes 50K).

- `packages/core/src/storage/seed.ts`: catálogo de modelos HiveAgents reducido a esta única entrada.
- `packages/core/src/agent/llm-providers/hiveagents.ts`: nueva detección `_isAgentWorld()`; el control de thinking vía `chat_template_kwargs.enable_thinking` ahora aplica a Gemma 4 **y** Qwen-AgentWorld.
- `packages/cli/src/commands/onboard.ts`: wizard de CLI actualizado al modelo único.
- `API.md`: reescrito — nueva sección "Tool Calls desde el frontend" con el flujo completo y un gotcha crítico documentado sobre `max_tokens`; ejemplos reales de streaming con tool calls y formato de historial de mensajes; sección de modelo y rendimiento con el razonamiento de por qué un solo modelo.

### Validación de API key / estado del servicio

- `gateway/routes/setup.ts`: `handleVerifyProvider` ahora hace un chequeo real contra `HIVEAGENTS_BASE_URL/api/status` con la API key, distinguiendo 401/403 (key inválida) de otros errores de conexión — antes HiveAgents no se validaba en absoluto.
- `hive-ui/modules/agents/ModelSelector.tsx`: `hiveagents` se trata igual que `ollama` para el chequeo de "tiene API key" en el selector (no bloquea la UI esperando una key que no aplica de la misma forma).

---

## Remoción Completa de Local LLM (`llama-server`)

Se elimina el subsistema completo que gestionaba descarga, detección y arranque de modelos GGUF locales vía `llama-server` (~2500 líneas):

- **Backend:** `packages/core/src/gateway/llm-local/{client,detector,downloader,index,manager,models,server}.ts`, `packages/core/src/gateway/routes/llm-local.ts`, `packages/core/src/agent/llm-providers/local-llama.ts`.
- **Frontend:** `packages/hive-ui/src/modules/providers/LocalLLMCard.tsx`, `packages/hive-ui/src/modules/providers/tabs/TextModelsTab.tsx`, `packages/hive-ui/src/lib/models.ts`, el slice `LocalLLMState`/`LocalLLMStatus` completo de `useGlobalConfigStore.ts`.
- **Docs:** `docs/LOCAL-LLM-SETUP.md` eliminado.
- **Migración `v0.0.41`**: desvincula agentes con `provider_id = 'local-llama'` (los deja sin provider/modelo asignado en vez de dejar una referencia rota), borra sus modelos y el provider de la tabla `providers`.

HiveAgents (modelo remoto vía Cloudflare) es ahora la única vía para correr el modelo recomendado sin depender de una API key de terceros.

---

## Fin de los Fallbacks Hardcodeados: Resolución de Modelo por Defecto desde la BD

Varios puntos del código caían silenciosamente en un provider/modelo fijo (`"openai"` + `"gpt-4o"`/`"gpt-4o-mini"`, `"whisper-large-v3-turbo"`, `"gemini-2.0-flash"`, `"claude-haiku-4-5-20251001"`) cuando no se especificaba uno — funcionaba solo por casualidad si ese provider en particular estaba configurado, y fallaba en silencio o contra el provider equivocado si no.

- **Nuevo `getDefaultLLM()`** en `packages/core/src/agent/llm-client.ts`: resuelve `{ provider, model }` desde la BD — primero el agente `coordinator`, si no el primer modelo LLM activo de un provider activo; `null` si no hay nada configurable (instalación nueva antes del setup).
- **`agent/compaction.ts`**: `compactThread` (resumen de contexto) usaba `openai`/`gpt-4o-mini` como fallback fijo cuando no encontraba el agente coordinador; ahora usa `getDefaultLLM()` y lanza error explícito si no hay ningún LLM configurado, en vez de intentar llamar a un provider sin key.
- **`gateway/routes/agents.ts`**: `handleCreateAgent` ya no asume `"openai"`/`"gpt-4o"` cuando el request no trae `providerId`/`modelId`.
- **`gateway/routes/meeting.ts`**: `handleCreateMeeting` resuelve el modelo STT por defecto contra el primer modelo `stt` activo en la BD en vez de asumir `"whisper-large-v3-turbo"` siempre disponible.
- **`multimodal/vision-service.ts`**: nuevo `getVisionModel(providerId, fallback)` — OCR con OpenAI/Gemini/Anthropic usa el modelo con capability `vision`/`ocr` configurado en la BD para ese provider, con el literal anterior solo como último recurso.
- **Bug real destapado por este cambio**: `hive-ui/pages/SetupPage.tsx` guardaba `sttProvider: "groq-whisper"` / `"openai-whisper"` como valores por defecto del wizard — ids que **nunca coincidían** con ningún modelo real (`voice/index.ts` esperaba `whisper-large-v3-turbo`/`whisper-1`), así que cualquier instalación nueva que aceptara el default del wizard tenía transcripción de voz rota desde el día uno. Corregido a los ids reales.
- **Fix relacionado en `storage/seed.ts`**: `seedAllData()` corre en **cada arranque** y borra + reinserta `models` con `PRAGMA foreign_keys = OFF` (para no romper por agentes que referencian filas viejas). Eso significa que cualquier agente apuntando a un modelo que sale del catálogo entre versiones — como las 8 variantes GGUF de HiveAgents retiradas en esta misma release — quedaba con un `agents.model_id` colgante que ninguna migración limpiaba. Se agregó un `UPDATE agents SET model_id = NULL WHERE model_id NOT IN (SELECT id FROM models)` justo después del re-seed de modelos, para que sea un invariante que se autorepara en cada boot (no solo para este caso puntual). Verificado con `tests/seed-dangling-model.test.ts`.

---

## Voz (STT/TTS): Resolución Basada en Base de Datos

Antes, `VoiceService.transcribe()`/`speak()` adivinaban el provider por prefijos del `modelId` (`modelId.startsWith("whisper")`, `"eleven"`, `"tts-"`...) y **caían silenciosamente a Groq/ElevenLabs** ante cualquier modelo no reconocido — un fallback peligroso que podía enrutar audio al provider equivocado sin avisar.

- `packages/core/src/voice/index.ts`: nuevo `getModelProvider()` resuelve el provider real desde las tablas `models`/`providers`; si el modelo no está en la BD, cae a `getFirstActiveVoiceModel()` (primer modelo STT/TTS activo) con warning explícito en logs; si no hay ningún modelo activo del tipo pedido, lanza error claro en vez de adivinar.
- `packages/core/src/gateway/routes/voice.ts`: la lista de providers de voz ya no es un array hardcodeado — se deriva de qué providers tienen modelos `stt`/`tts` en la BD (`getVoiceProviderIds()`); providers locales (Piper, por capability `"local"`) se detectan por BD en vez de estar hardcodeados como siempre-configurados.
- Nuevo campo `category` en `providers` (`'llm' | 'stt' | 'tts'`) — seed.ts marca `elevenlabs`/`piper` como `'tts'` (migración `v0.0.41` corrige los ya existentes).
- `packages/hive-ui/src/types/providers.ts`: `Provider.category` expuesto al frontend.

---

## UI: Reorganización de Providers

- `ProvidersPage.tsx`: la pestaña "Texto" (que mezclaba providers LLM con el downloader de modelos locales) se elimina; queda una pestaña "Providers" genérica filtrada por `category === 'llm'` (`ProviderList.tsx`).
- `ChannelConfigDialog.tsx`, `VoiceProvidersPanel.tsx`, `VoiceProvidersTab.tsx`: actualizados a la resolución de providers de voz basada en BD.
- Nuevo `packages/hive-ui/src/lib/capabilities.ts`: `parseCapabilities()` extraído como helper compartido (antes duplicado en `VisionModelsTab.tsx` y otros).

---

## Migraciones de Base de Datos (histórico, previo al corte final a HiveDB)

Estos pasos corrieron sobre el `runStartupMigrations()` de SQLite **durante la transición**,
antes del corte final descrito arriba. Con `storage/schema.ts`/`storage/sqlite.ts` eliminados y
`runStartupMigrations()` reemplazado por `storage/bootstrap.ts`, ya no existen ni corren — quedan
acá como registro de lo que pasó con el esquema viejo en el camino hacia HiveDB.

| Versión | Qué hacía |
|---|---|
| `v0.0.41` | Desvincula agentes de `local-llama`, borra sus modelos/provider; corrige categoría de `elevenlabs`/`piper` a `tts`. |
| `v0.0.42` | Dropea triggers `skills_ai/au/ad` y las 4 tablas virtuales FTS5 (orden importa: los triggers deben ir primero). |
| `v0.0.43` | Recalcula ids de `mcp_tools` con el `mcpToolFullName` corregido (prefijo de servidor acortado, no el nombre de la tool). |
| `v0.0.44` | Dropea la tabla `scratchpad` (notas ahora en HiveDB; sin migración de datos). |

Todas corrían de forma idempotente vía `schema_migrations`, en cada arranque.

---

## Otros Cambios

- `packages/core/package.json`: nueva dependencia `@johpaz/hive-db@^0.2.0`.
- `packages/hive-ui/src/lib/constants.ts`: removida constante `DEFAULT_MODEL = "gpt-4"` sin uso.
- `bun.lock`: `@johpaz/hive-agents-mcp`/`@johpaz/hive-agents-skills` de `workspace:*` a `^0.0.40` (versión fijada del monorepo).
- `docs/DOCUMENTO-EXPLICATIVO-COMPONENTES.md`: referencias a `local-llama`/`LocalLLMCard`/`/api/llm-local` retiradas (consistente con la remoción del provider).
- `docs/AGENT_FORM_FILL_EVAL.md` eliminado (el test `tests/agent-form-fill-eval.test.ts` y su fixture siguen intactos, solo se retiró la doc standalone — sin otras referencias en el repo).
- `CHANGELOG_v0.0.39.md` eliminado del repo — no se encontró la razón en el diff ni referencias rotas resultantes; si fue accidental, avisar para restaurarlo desde `git show 83527d8:CHANGELOG_v0.0.39.md`.
