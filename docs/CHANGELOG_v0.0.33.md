# Hive v0.0.33 - Release Notes

## Release Date
2026-05-11

## Resumen Ejecutivo

Esta versión se enfoca en **estabilidad del tool calling** en proveedores OpenAI-compatibles y **gestión de contexto** para evitar desbordamiento de tokens:

1. **Provider Refactoring**: `openai-compat.ts` dividido en 9 archivos individuales por proveedor
2. **Tool Calling Fixes**: Inyección dinámica de herramientas con fallback para nombres legacy
3. **Context Overflow Management**: Compactación automática + cálculo de `max_tokens` basado en `contextWindow`
4. **Local LLM Manager**: Soporte nativo para Gemma 4 (2B/4B) con descarga automática
5. **Piper TTS**: Nuevo proveedor local de texto-a-voz
6. **TTS Relocation**: Migración de `packages/tts` standalone a `packages/core/src/gateway/tts/`

---

## 🚨 Cambios Mayores

### 1. Provider Refactoring — OpenAI Compat

El monolítico `openai-compat.ts` (231 líneas) fue dividido en **9 archivos individuales** para mejor mantenibilidad:

| Archivo | Provider | Líneas |
|---------|----------|--------|
| `openai.ts` | OpenAI | 5 |
| `groq.ts` | Groq | 5 |
| `mistral.ts` | Mistral | 5 |
| `openrouter.ts` | OpenRouter | 5 |
| `deepseek.ts` | DeepSeek | 8 |
| `kimi.ts` | Kimi (Moonshot) | 8 |
| `qwen.ts` | Qwen (DashScope) | 5 |
| `nvidia.ts` | NVIDIA NIM | 5 |
| `local-llama.ts` | Local llama.cpp | 37 |

La lógica compartida quedó en `openai-compat-base.ts`. Cada provider puede sobrescribir hooks:
- `needsReasoningRoundtrip()` — DeepSeek, Kimi (preservan `reasoning_content`)
- `injectToolsIntoPrompt()` — Local Llama (tools en system prompt)
- `isLocalProvider()` — Local Llama
- `beforeCall()` — Local Llama (auto-start server)

### 2. Local LLM Manager

Nuevo sistema para correr modelos localmente sin dependencias externas:

- **Manager**: `packages/core/src/gateway/llm-local/manager.ts` — ciclo de vida completo (descarga, inicio, monitoreo)
- **Auto-download**: `downloader.ts` — descarga desde HuggingFace con barra de progreso
- **Modelos soportados**: Gemma 4 2B (`e2b_Q4_K_XL`), Gemma 4 4B (`e4b_Q4_K_XL`), Gemma 4 4B Vision (`e4b_vision`)
- **STT local**: Transcripción con Gemma 4 via `local_stt`
- **Server dedicado**: llama.cpp server en `localhost:8081/v1`
- **REST API**: `GET /api/llm-local/models`, `POST /api/llm-local/start`, `POST /api/llm-local/stop`

### 3. TTS Relocation

El paquete `packages/tts` (anteriormente standalone) fue movido a `packages/core/src/gateway/tts/`:

- **10 archivos movidos** manteniendo git history (renames)
- **Piper TTS**: Nuevo proveedor de texto-a-voz local, multi-idioma
- **Integración directa** con el gateway, sin servidor externo

---

## 🚀 Nuevas Funcionalidades

### 1. Gestión de Contexto y Tokens

**`resolveProviderConfig`** ahora carga `contextWindow` desde la tabla `models`:

```typescript
const modelRow = db.query("SELECT context_window FROM models WHERE id = ?").get(modelId)
return { ..., contextWindow: modelRow?.context_window }
```

**`max_tokens` automático** en `openai-compat-base.ts`:
- Reserva 15% del context window para output (cap 8192)
- Evita el error "requested 0 output tokens" de NVIDIA/Mistral

**Context Compiler** (`context-compiler.ts`):
- Compactación dinámica basada en `contextWindow * 0.70` (antes hardcoded 6000)
- System prompt truncado a 8000 chars (antes ilimitado)
- Log de presupuesto de tokens: `est.tokens: sys=2000 msgs=190000 tools=1000 total=193000/202752 (95%)`
- Default: `DEFAULT_CONTEXT_WINDOW = 128000`

**Compaction** (`compaction.ts`):
- Threshold dinámico: `contextWindow * 0.25`
- Default subido de 6000 a 32000

### 2. Retry por Context Overflow

En `openai-compat-base.ts`, cuando la API retorna HTTP 400 con "context length" o "input_tokens":

1. **Compacta mensajes**: reduce a 33% del histórico
2. **Reduce output budget**: `max_tokens = min(original, 4096)`
3. **Reintenta** automáticamente

```typescript
// Antes: error 400 → crash
// Ahora: compacta 42 → 14 msgs, reduce max_tokens, retry
```

### 3. Tool Calling — Inyección Robusta

**Fallback para nombres legacy** en `agent-loop.ts`:
```typescript
// Si "cron_create" no existe en allTools, prueba "cron.create"
const altName = found.name.includes(".")
  ? found.name.replace(/\./g, "_")
  : found.name.replace(/_/g, ".")
```

**`searchKnowledgeTool` protegido** contra `query` undefined:
```typescript
if (!query) return { query, type, tools: [], skills: [], playbook: [], toolsmcp: [] }
```

**FTS5 sync** evita duplicar tools legacy (e.g. `cron_create` cuando `cron.create` ya existe en el catálogo).

**`codebridge_feedback`** agregado al `CORE_TOOL_CATALOG` para búsqueda FTS5.

---

## 📦 Archivos Nuevos/Creados

| Archivo | Descripción |
|---------|-------------|
| `packages/core/src/agent/llm-providers/openai.ts` | OpenAI provider class |
| `packages/core/src/agent/llm-providers/groq.ts` | Groq provider class |
| `packages/core/src/agent/llm-providers/mistral.ts` | Mistral provider class |
| `packages/core/src/agent/llm-providers/openrouter.ts` | OpenRouter provider class |
| `packages/core/src/agent/llm-providers/deepseek.ts` | DeepSeek provider class |
| `packages/core/src/agent/llm-providers/kimi.ts` | Kimi provider class |
| `packages/core/src/agent/llm-providers/qwen.ts` | Qwen provider class |
| `packages/core/src/agent/llm-providers/nvidia.ts` | NVIDIA provider class |
| `packages/core/src/agent/llm-providers/local-llama.ts` | Local Llama provider class |
| `packages/core/src/agent/llm-providers/openai-compat-base.ts` | Base class for all OpenAI-compat providers |
| `packages/core/src/gateway/llm-local/manager.ts` | Local LLM lifecycle manager |
| `packages/core/src/gateway/llm-local/downloader.ts` | HuggingFace model auto-download |
| `packages/core/src/gateway/llm-local/server.ts` | llama.cpp server wrapper |
| `packages/core/src/gateway/llm-local/detector.ts` | Model file detection |
| `packages/core/src/gateway/llm-local/models.ts` | Model definitions (Gemma 4) |
| `packages/core/src/gateway/llm-local/client.ts` | Local LLM HTTP client |
| `packages/core/src/gateway/llm-local/index.ts` | Module barrel |
| `packages/core/src/gateway/routes/llm-local.ts` | REST API for local LLM |
| `packages/core/src/storage/migrate.ts` | Database migration utilities |
| `packages/hive-ui/src/modules/providers/LocalLLMCard.tsx` | Local LLM UI card |
| `docs/GUIA-SERVIDOR.md` | Server setup guide |
| `docs/CHANGELOG_v0.0.33.md` | Este archivo |

---

## 🔧 Archivos Modificados

### Core — Tool Calling & LLM

| Archivo | Cambio |
|---------|--------|
| `agent/llm-client.ts` | +`contextWindow` field, provider factory refactor, `loadProviderApiKey` |
| `agent/llm-providers/interface.ts` | `OPENAI_COMPAT_BASE_URLS` actualizado, `local-llama` puerto 8081 |
| `agent/llm-providers/openai-compat-base.ts` | (nuevo) Base class with context overflow retry + auto max_tokens |
| `agent/agent-loop.ts` | Tool injection fallback legacy names + warning si no encuentra executor |
| `agent/context-compiler.ts` | Compaction dinámica por contextWindow, system prompt truncation, token budget log |
| `agent/compaction.ts` | Threshold dinámico por modelo (25% de contextWindow) |
| `agent/tool-selector.ts` | +`codebridge_feedback` en catalog, FTS5 merge salta legacy names |
| `tools/core/index.ts` | `searchKnowledgeTool` protegido contra query undefined |

### Core — Almacenamiento y Seed

| Archivo | Cambio |
|---------|--------|
| `storage/seed.ts` | Cron tools unificados (cron_create → cron.create), +local STT, +Piper TTS, +Gemma 4 models |
| `storage/onboarding.ts` | Refactor importante |
| `storage/crypto.ts` | Refactor + `loadProviderApiKey` |

### Core — Canales

| Archivo | Cambio |
|---------|--------|
| `channels/whatsapp.ts` | Mejoras en manejo de grupos y multimedia |
| `channels/slack.ts` | Soporte multimodal |
| `channels/telegram.ts` | Soporte imágenes y documentos |
| `channels/discord.ts` | Soporte attachments |
| `channels/manager.ts` | Refactor |
| `channels/base.ts` | Actualizaciones |

### Core — Gateway

| Archivo | Cambio |
|---------|--------|
| `gateway/initializer.ts` | Nuevo flujo de inicialización |
| `gateway/server.ts` | Nuevas rutas |
| `gateway/routes/providers.ts` | Sync models mejorado |
| `gateway/routes/channels.ts` | Channel config unificado |
| `gateway/routes/agents.ts` | Mejoras en CRUD |
| `gateway/routes/mcp.ts` | Refactor |
| `gateway/routes/tts-local.ts` | Integración con Piper TTS |
| `gateway/routes/voice.ts` | Refactor |
| `gateway/routes/cron-api.ts` | Mejoras menores |
| `gateway/routes/config.ts` | Mejoras menores |

### Hive UI

| Archivo | Cambio |
|---------|--------|
| `modules/channels/shared/ChannelConfigDialog.tsx` | Refactor mayor (+275 líneas) |
| `modules/providers/tabs/TextModelsTab.tsx` | Integración con local LLM |
| `modules/agent-config/user/UserProfileEditor.tsx` | Mejoras |
| `modules/layout/HiveSidebar.tsx` | Ajustes |
| `pages/SettingsPage.tsx` | Refactor |
| `stores/useGlobalConfigStore.ts` | +125 líneas, local LLM state |
| `stores/userStore.ts` | Mejoras |
| `types/channels.ts` | Actualizaciones |

### Tests

| Archivo | Cambio |
|---------|--------|
| `tests/test_mcp_flow.ts` | Actualizaciones |

---

## 🗑️ Archivos Eliminados

| Archivo | Razón |
|---------|-------|
| `packages/core/src/agent/llm-providers/openai-compat.ts` | Dividido en 9 providers individuales |
| `packages/tts/tsconfig.json` | TTS migrado a core/gateway |
| `packages/hive-ui/src/modules/channels/connected/*` (8 archivos) | Reemplazado por ChannelConfigDialog unificado |
| `packages/hive-ui/src/modules/agent-config/whatsapp/*` (2 archivos) | Integrado en panel de canales |
| `packages/sdk/**/*` | SDK package removido del monorepo |
| `V0.0.31.md` | Release notes consolidados |

---

## 🐛 Fixes Notables

- **Context overflow**: Error `400 You passed N input tokens` ya no crashea — compacta y reintenta automáticamente
- **Tool injection fallback**: Tools encontradas via `search_knowledge` con nombres legacy (e.g. `cron_create`) ahora se resuelven correctamente a `cron.create`
- **search_knowledge crash**: Cuando el LLM llama `search_knowledge({})` sin `query`, retorna vacío en vez de crash con `TypeError`
- **FTS5 duplicados**: Tools legacy en la DB ya no contaminan el índice FTS5
- **Local Llama port**: Corregido de 8080 a 8081

---

## 📊 Estadísticas del Cambio

| Métrica | Cantidad |
|---------|----------|
| Archivos nuevos | 22 |
| Archivos modificados | ~45 |
| Archivos eliminados/renombrados | ~20 |
| Archivos movidos (TTS) | 10 |
| Nuevos providers | 1 (Piper TTS) |
| Modelos locales nuevos | 4 (Gemma 4) |
| Líneas agregadas | 4,296 |
| Líneas eliminadas | 1,809 |

---

## 🔑 Notas de Upgrade

```bash
# Actualizar dependencias
bun install

# Las migraciones de BD se aplican automáticamente
# No se requiere intervención manual

# Para usar el Local LLM Manager:
# 1. Ve a Settings → Providers → Local LLM
# 2. Selecciona un modelo Gemma 4
# 3. Hive descarga el modelo automáticamente (~2-4GB)
# 4. El servidor llama.cpp se inicia automáticamente

# Para usar Piper TTS local:
# 1. Configura Piper en Settings → Voice
# 2. Selecciona voz en español (es_MX-claude-14947-epoch-high)
```

---

## 🔗 Enlaces Relacionados

- **Issue tracker**: https://github.com/johpaz/hive/issues
- **Documentación**: https://github.com/johpaz/hive/tree/master/docs

---

**Versión anterior**: v0.0.32
**Próxima versión**: v0.0.34 (en desarrollo)
