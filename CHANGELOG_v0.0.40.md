# CHANGELOG v0.0.40 — Hive

## Resumen

Esta versión introduce **HiveAgents LLM**, un nuevo provider cloud con modelos GGUF locales servidos vía `https://llm.hiveagents.io`, incluyendo carga remota de modelos, control de thinking/reasoning y compatibilidad WAF. También mejora la **robustez del agente** con detección de atascos (`stuck-loop`) y timeouts de reloj, renova la experiencia de **procesos en WebChat** con eventos `process` en tiempo real, y añade el primer **test end-to-end de llenado de formularios** para validar flujos reales del agente.

---

## Nuevo Provider: HiveAgents LLM

### Implementación

- **Nuevo provider:** `packages/core/src/agent/llm-providers/hiveagents.ts`
- **Registro en motor:** `packages/core/src/agent/llm-client.ts`, `packages/core/src/agent/llm-providers/interface.ts`, `packages/core/src/agent/providers/index.ts`
- **Config por defecto:** `packages/core/src/config/loader.ts`
- **Seed de datos:** `packages/core/src/storage/seed.ts`
- **Migración de onboarding:** `packages/core/src/storage/onboarding.ts`

### Capacidades

- **API OpenAI-compatible** en `https://llm.hiveagents.io/v1`.
- **Carga remota de modelos GGUF** vía `POST /api/load` con polling de estado.
- **Auto-carga defensiva:** si el modelo no está cargado antes de inferir, se carga automáticamente.
- **Strip de headers fingerprint** (`x-stainless-*`, `user-agent`) para evitar bloqueos de Cloudflare WAF.
- **Fallback a tool calls como texto** (`<tool_call>`) cuando el backend no soporta native tool calling.
- **Control de thinking/reasoning:**
  - Qwen3: inyección de `/no_think`.
  - Gemma 4: `chat_template_kwargs.enable_thinking`.

### Modelos disponibles

| ID | Nombre | Capacidades |
|---|---|---|
| `Qwen3.6-35B-A3B-UD-Q6_K.gguf` | Qwen3.6 35B MoE (Recomendado) | chat, streaming, reasoning |
| `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` | Qwen3.6 35B MoE (Q4_K_M) | chat, streaming, reasoning |
| `Qwen3.6-27B-UD-Q4_K_XL.gguf` | Qwen3.6 27B + MTP | chat, streaming, reasoning |
| `Qwen3-Coder-Next-UD-Q4_K_M.gguf` | Qwen3 Coder Next | chat, streaming, code |
| `Qwopus3.6-27B-v2-MTP-Q6_K.gguf` | Qwopus3.6 27B v2 (Q6_K) | chat, streaming, reasoning |
| `Qwopus3.6-27B-v2-MTP-Q4_K_S.gguf` | Qwopus3.6 27B v2 (Q4_K_S) | chat, streaming, reasoning |
| `gemma-4-31B-it-UD-Q4_K_XL.gguf` | Gemma 4 31B Dense | chat, streaming |
| `gemma-4-26B-A4B-it-UD-Q4_K_M.gguf` | Gemma 4 26B MoE | chat, streaming |
| `gemma-4-12b-it-UD-Q4_K_XL.gguf` | Gemma 4 12B Dense | chat, streaming |

### Gateway

- `POST /api/providers/hiveagents/load-model` — carga un modelo GGUF.
- `GET /api/providers/hiveagents/model-status` — consulta estado de carga.

### UI

- `packages/hive-ui/src/modules/agents/ModelSelector.tsx` muestra loader y toasts mientras carga el modelo, con polling hasta 5 minutos.
- `packages/hive-ui/src/stores/useGlobalConfigStore.ts` añade `loadHiveAgentsModel` y `getHiveAgentsModelStatus`.
- `packages/hive-ui/src/lib/models.ts` expone los modelos HiveAgents.
- `packages/hive-ui/src/modules/agent-config/details/AgentDetailsEditor.tsx` trata a `hiveagents` como provider sin API key local requerida.

### CLI

- `packages/cli/src/commands/onboard.ts` incluye `hiveagents` en el wizard, con modelos, base URL y test de conexión a `/health`.

---

## Robustez del Agente: Anti-Atasco y Timeouts

### Stuck-Loop Detector refactorizado

- **Archivo:** `packages/core/src/agent/stuck-loop.ts`
- Distingue entre `kind: "loop"` y `kind: "stall"`.
- Añade historial de progreso (`progressHistory`) con `recordProgress` y `checkProgress`.
- Exporta `getInterventionMessage` con mensajes en español y niveles `WARNING` / `CRITICAL`.

### Agent Loop mejorado

- **Archivo:** `packages/core/src/agent/agent-loop.ts`
- **Timeout de reloj real** (`max_wall_clock_ms`, default 5 min): si se excede, responde al usuario y rompe el loop.
- Integración con `StuckLoopDetector`: registra tool calls, inyecta advertencias y rompe en caso crítico.
- **Stall detection**: detecta iteraciones consecutivas sin herramientas de progreso (`browser_type`, `browser_click`, `browser_navigate`) y advierte/rompe tras 3/5 iteraciones.
- Soporte para `onToken`, `onStep` y `extraTools` (usado por tests/evals).
- Flag `streamed` en `StreamChunk` para evitar doble callback de tokens.

---

## Eventos de Proceso (`process`) en WebChat

### Backend

- **Archivos:** `packages/core/src/channels/base.ts`, `packages/core/src/gateway/slash-commands.ts`, `packages/core/src/gateway/server.ts`
- Nuevo tipo de mensaje `process` con campos `processKind`, `processStatus`, `label`, `detail`, `summary`, `messageId`.
- `createWebChatProcessReporter` envía eventos `process` por WebSocket, reemplazando los mensajes `progress` antiguos.
- Asigna `messageId` consistente a mensajes y streams; envía `done`/`error` al finalizar.

### Frontend

- **Tipos:** `packages/hive-ui/src/types/chat.ts` añade `MessageProcess`, `MessageProcessItem`, `MessageProcessKind`, `MessageProcessStatus`.
- **Hook:** `packages/hive-ui/src/hooks/useChatStreaming.ts` mantiene chunks de streaming y eventos de proceso en el mismo mensaje del asistente.
- **Componente:** `packages/hive-ui/src/modules/chat/ChatMessage.tsx` añade `ProcessBlock`: UI colapsable con estados `thinking` / `done` / `error`.
- **Página:** `packages/hive-ui/src/pages/WebChatPage.tsx` se suscribe a eventos `process`.

---

## Mejoras en Providers OpenAI-Compatible

- **Archivo:** `packages/core/src/agent/llm-providers/openai-compat-base.ts`
- Nuevo método `resolveOpenAIClient` para permitir que providers personalicen el cliente OpenAI.
- Nuevo hook `modifyRequestBody` para inyectar campos específicos del provider (usado por Gemma 4 `extra_body`).
- `extractToolCallsFromText` más robusto: soporta arrays, formato `{ function: { name, arguments } }`, bloques markdown ```json``` y parámetros sueltos.

---

## Mejoras en Compilación de Contexto

- **Archivo:** `packages/core/src/agent/context-compiler.ts`
- Valida nombres sanitizados de herramientas MCP con regex `^[a-zA-Z0-9_-]{1,64}$`.
- Omite tools con nombres no soportados por los LLM providers en lugar de romper el loadout.

---

## Correcciones de Bugs

- **Cloudflare WAF bloqueaba requests de OpenAI SDK:** resuelto en `HiveAgentsProvider` eliminando headers `x-stainless-*` y `user-agent`.
- **Doble invocación de `onToken`:** corregida con flag `streamed` en `StreamChunk`.
- **Tools MCP con nombres inválidos:** ahora se omiten en lugar de romper el loadout.

---

## Documentación

- `API.md` reescrito como manual de integración de HiveAgents LLM API:
  - Quick start, autenticación, carga/descarga de modelos, streaming.
  - Ejemplos en Python, TypeScript, curl y LangChain.
  - Sección de thinking/reasoning para Qwen3 y Gemma 4.
  - Tabla de modelos con benchmarks y notas técnicas sobre Vulkan/AMD.
- `README.md`:
  - Cambia descripción de “Gateway de IA Orquestado” a “Agent Harness”.
  - Normaliza términos `gateway` → `harness`.
  - Actualiza enlaces de Discord y Telegram.
  - Elimina la sección “FASE 4 — Proyectos, Tareas y Workers”.
- `docs/AGENT_FORM_FILL_EVAL.md`: documentación del nuevo test end-to-end de llenado de formulario GoFest 2026.

---

## Tests

- `tests/agent-form-fill-eval.test.ts`:
  - Test end-to-end real contra servidor local.
  - Usa `AgentLoop`, `BrowserService` y base de datos reales.
  - Verifica navegación, llenado de campos, contexto de tarea y ausencia de atascos.
  - Gate con variable `AGENT_FORM_EVAL=1`.
- `tests/fixtures/gofest-form.html`:
  - Formulario mock de registro GoFest 2026 con validación y persistencia de datos en `window.__hiveFormData`.
- `packages/hive-ui/src/hooks/useChatStreaming.test.tsx`:
  - Test unitario que verifica que eventos de proceso y contenido streamado se mantienen en el mismo mensaje del asistente.

---

## Otros Cambios

- `packages/hive-ui/tsconfig.app.json`: añade `"ignoreDeprecations": "6.0"`.
- Mejoras de accesibilidad en `ChatMessage.tsx`: `type="button"` y `aria-label` en botones.
