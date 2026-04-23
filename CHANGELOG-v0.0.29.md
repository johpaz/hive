# Changelog — v0.0.29

> Cambios pendientes de commit respecto a v0.0.28 (`e2ab974`)
> Fecha: 2026-04-23

---

## Resumen ejecutivo

Esta versión introduce **detención de generación en tiempo real** (botón Stop), **streaming nativo en los adaptadores Anthropic y OpenAI-compatible**, soporte de **Extended Thinking para Claude 4.x**, corrección del bug de **tracking de tokens siempre en cero**, y múltiples mejoras de robustez en todos los adaptadores LLM.

---

## Nuevas funcionalidades

### Botón Stop — Cancelar generación en tiempo real

**Archivos:** `gateway/server.ts`, `gateway/slash-commands.ts`, `hive-ui/chat/ChatContainer.tsx`, `hive-ui/chat/ChatInput.tsx`

- El `ChatInput` ahora muestra un botón **Stop** (cuadrado rojo) en lugar del botón de envío mientras el agente está generando.
- Al presionarlo, envía un mensaje WebSocket `{ type: "stop", sessionId }` al servidor.
- El servidor llama a `laneQueue.cancel(sessionId)`, que aborta la tarea activa via `AbortSignal`.
- El servidor responde confirmando con `{ type: "status", status: { state: "cancelled" } }`.
- El `AbortSignal` se propaga desde el WebSocket hasta el `AgentLoop` y llega al `callLLM`, interrumpiendo la llamada al LLM en el próximo punto de control.
- Nuevos tipos en el protocolo WebSocket: `"stop"` en `InboundMessage` y `"progress"` en `OutboundMessage`.

### Streaming nativo en Anthropic

**Archivo:** `agent/llm-providers/anthropic.ts`

- El adaptador ahora usa `client.messages.stream()` en lugar de `client.messages.create()`.
- Los tokens llegan al usuario en tiempo real mientras Claude genera, sin esperar a que termine la respuesta completa.
- Los tool_calls se acumulan correctamente desde los eventos `input_json_delta` del stream.
- La interfaz `LLMResponse` no cambia — compatible con el resto del sistema.

### Streaming en adaptador OpenAI-compatible

**Archivo:** `agent/llm-providers/openai-compat.ts`

- Cuando hay un callback `onToken` activo, se usa `create({ stream: true })` automáticamente.
- Los tool_calls se acumulan por índice desde los `delta.tool_calls` de cada chunk, incluyendo proveedores como Groq, Mistral, DeepSeek, OpenRouter y Kimi.
- El método `_streamCall()` encapsula la lógica de streaming sin romper el path no-streaming.

### Extended Thinking para Claude 3.7+ / Claude 4.x

**Archivo:** `agent/llm-providers/anthropic.ts`

- Nuevo campo `thinking?: { enabled: boolean; budget_tokens?: number }` en `LLMCallOptions`.
- Cuando está habilitado y el modelo lo soporta (Claude Sonnet 4.6, Opus 4.6, Opus 4.7, Haiku 4.5, claude-3-7-sonnet, etc.), se añade `thinking: { type: "enabled", budget_tokens }` al body de la petición.
- El contenido del pensamiento extendido llega como eventos `thinking_delta` en el stream y se retorna en el nuevo campo `thinking_content` de `LLMResponse`.
- Modelos que no soportan thinking no reciben el parámetro — la detección es automática por nombre de modelo.

---

## Correcciones de bugs

### Bug: Usage de tokens siempre retornaba cero

**Archivos:** `agent/agent-loop.ts`, `agent/providers/index.ts`

- **Causa:** `AgentRunner.generate()` en `providers/index.ts` hardcodeaba `{ promptTokens: 0, completionTokens: 0, totalTokens: 0 }` sin leer los valores reales.
- **Fix:** El `runAgent` generator ahora emite un chunk final `{ usage: { input_tokens, output_tokens } }` con los totales acumulados durante la ejecución. El `AgentRunner` los captura y los expone correctamente.
- Ahora cualquier caller de `AgentRunner.generate()` recibe el conteo real de tokens consumidos.

### Bug: DeepSeek `reasoning_content` se eliminaba antes de enviar al modelo

**Archivo:** `agent/llm-providers/openai-compat.ts`

- **Causa:** Solo los providers Kimi preservaban `reasoning_content` en el historial de mensajes. DeepSeek Reasoner también necesita este campo para mantener coherencia de contexto entre turnos con tool calls.
- **Fix:** La condición `needsReasoningRoundtrip` ahora incluye `provider === "deepseek"` además de `isKimi`.

### Bug: API key faltante enviaba string `"missing-api-key"` a providers reales

**Archivo:** `agent/llm-providers/openai-compat.ts`

- **Causa:** Si no había API key configurada y el provider no era local, se enviaba el literal `"missing-api-key"`, produciendo un error 401 confuso.
- **Fix:** Ahora lanza `Error("API key missing for provider: X. Configure it in Settings → Providers.")` de forma inmediata y descriptiva.

### Bug: Nombre de herramienta MCP usaba campo inexistente `full_name`

**Archivo:** `agent/agent-loop.ts`

- **Causa:** Al inyectar herramientas MCP descubiertas via `search_knowledge`, se usaba `found.full_name || found.tool_name`. El campo `full_name` no existe en el resultado de FTS5, causando lookup fallido en algunos casos.
- **Fix:** Simplificado a `found.tool_name` directamente.

---

## Mejoras de adaptadores LLM

### Anthropic — `max_tokens` default aumentado

- El valor por defecto pasa de `8192` a **`16384`** tokens.
- Claude 4.x soporta hasta 32k tokens de output; el valor anterior truncaba respuestas largas de forma silenciosa.

### Anthropic — `JSON.parse` protegido con try/catch

- La conversión de argumentos de tool_use (`JSON.parse(tc.function.arguments)`) ahora está en try/catch.
- Si los argumentos vienen malformados, retorna `{}` en lugar de lanzar una excepción no controlada que cortaría el loop del agente.

### Gemini — `thoughtsTokenCount` capturado en usage

- Los modelos Gemini 2.5+ retornan `usageMetadata.thoughtsTokenCount` para tokens de razonamiento interno.
- Ahora se captura y se expone en `usage.thinking_tokens` de `LLMResponse`.

### Gemini — Safety blocks manejados explícitamente

- Si Gemini bloquea una respuesta por filtros de seguridad (`finishReason === "SAFETY"`), en lugar de retornar contenido vacío silenciosamente, ahora retorna el mensaje `"[Response blocked by Gemini safety filters]"` con `stop_reason: "stop"`.
- El log incluye el nombre del modelo para facilitar diagnóstico.

### Gemini — Log de agotamiento de constraint loop

- El bucle de enforcement de invariantes tiene un safety limit de 10 iteraciones.
- Antes terminaba silenciosamente si se agotaba. Ahora emite `log.error(...)` explícito.

### Ollama — OOM detection más robusta

- La detección de crash por Out of Memory ahora incluye `|| error.status === 500` además del string match `"model runner has unexpectedly stopped"`.
- Si Ollama cambia el mensaje de error en versiones futuras, el fallback sin tools sigue funcionando.

---

## Cambios de tipos / interfaz

### `LLMCallOptions` (nuevo)
```typescript
signal?: AbortSignal                                    // Cancela la request HTTP al LLM
thinking?: { enabled: boolean; budget_tokens?: number } // Extended thinking (Anthropic)
```

### `LLMResponse` (nuevo/modificado)
```typescript
usage?: { input_tokens: number; output_tokens: number; thinking_tokens?: number }  // thinking_tokens añadido
thinking_content?: string  // Contenido del pensamiento extendido de Anthropic
reasoning_content?: string // Documentado también para DeepSeek (no solo Kimi)
```

### `StreamChunk` (nuevo campo)
```typescript
usage?: { input_tokens: number; output_tokens: number }  // Emitido al final del runAgent
```

### `InboundMessage` / `OutboundMessage`
```typescript
InboundMessage.type  += "stop"      // Nuevo tipo de mensaje para detener generación
OutboundMessage.type += "progress"  // Nuevo tipo para mensajes de progreso
```

---

## Mejoras de DX / observabilidad

- **Provider desconocido:** `getProvider()` ahora emite `log.warn` si recibe un provider no reconocido antes de hacer fallback a `OpenAICompatProvider`.
- **Error logging:** Los errores de `callLLM` ahora incluyen el objeto `err` completo (con stack trace), no solo el mensaje.
- **Detección IPv6 localhost:** `isLocal` en OpenAI-compat ahora también detecta `::1` además de `localhost` y `127.0.0.1`.

---

## Archivos modificados

| Archivo | Tipo de cambio |
|---------|---------------|
| `packages/core/src/agent/llm-client.ts` | Tipos nuevos en `LLMCallOptions`/`LLMResponse`, warning provider, fix log |
| `packages/core/src/agent/agent-loop.ts` | AbortSignal, usage chunk final, fix MCP tool name, `StreamChunk.usage` |
| `packages/core/src/agent/providers/index.ts` | Fix usage=0, acumular tokens reales del stream |
| `packages/core/src/agent/llm-providers/anthropic.ts` | Streaming, extended thinking, max_tokens 16384, JSON.parse protegido |
| `packages/core/src/agent/llm-providers/openai-compat.ts` | Streaming, DeepSeek reasoning, fail-fast API key, IPv6 |
| `packages/core/src/agent/llm-providers/gemini.ts` | thoughtsTokenCount, safety block, constraint log |
| `packages/core/src/agent/llm-providers/ollama.ts` | OOM detection robusta |
| `packages/core/src/gateway/server.ts` | Handler WebSocket `stop`, propagación de `signal` a `generate()` |
| `packages/core/src/gateway/slash-commands.ts` | Tipos `"stop"` e `"progress"` en InboundMessage/OutboundMessage |
| `packages/hive-ui/src/modules/chat/ChatContainer.tsx` | `onStop` handler → envía mensaje `stop` por WebSocket |
| `packages/hive-ui/src/modules/chat/ChatInput.tsx` | Botón Stop (cuadrado rojo) durante streaming, prop `onStop` |
