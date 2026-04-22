# Plan: Arreglar WebChat - Tool Results, Procesos Huerfanos, Limite de Mensajes

## Problema 1: Se muestran resultados crudos de herramientas en vez de narraciones

### Diagnostico

El flujo actual del WebChat (WebSocket) en `server.ts:2594-2617` tiene un `onStep` handler que:

1. **Para `text` step**: Solo hace `log.debug()` — NO envia nada al frontend. El usuario NUNCA ve la narracion del agente.
2. **Para `tool_call` step**: Solo hace `log.debug()` — NO envia la narracion de la herramienta. El usuario NO ve "Buscando en la web...".
3. **Para `tool_result` step**: Solo envia al frontend si el resultado tiene `_sendToUser` o `status` — envia el resultado CRUDO (`📊 ${userMessage}`) como un mensaje de tipo `"message"` con `isStep: true`.

**Problema**: Cuando el resultado de una herramienta tiene `_sendToUser` o `status`, se muestra el contenido crudo del resultado (ej. todo el JSON de resultados de busqueda) directamente en el chat como un mensaje del agente. Esto NO es lo que queremos — queremos mostrar la ACCION (narracion) no el RESULTADO.

El flujo de canales externos (Telegram/Discord) en `server.ts:361-403` hace lo correcto:
- `text` → envia narracion como `progress`
- `tool_call` → envia narracion humanizada via `getNarration()` como `progress`
- `tool_result` → solo si tiene `_sendToUser`, envia resumen como `progress`

El WebChat necesita el MISMO patron pero adaptado: usar tipo `"progress"` para narraciones (que el frontend ya maneja con `handleProgress`) y NO como tipo `"message"`.

### Solucion

**Archivo: `packages/core/src/gateway/server.ts`**

Cambiar el `onStep` handler del WebChat (lineas ~2594-2617 para texto y ~2447-2465 para audio) para que envie narraciones como `"progress"` eventos (igual que los canales externos), en vez de resultados crudos como `"message"`:

```typescript
// ANTES (problematico):
onStep: async (step) => {
  if (signal.aborted) return;
  if (step.type === "tool_result" && step.message) {
    try {
      const result = JSON.parse(step.message);
      if (result._sendToUser || result.status) {
        const userMessage = result.message || result.status || step.message;
        ws.send(JSON.stringify({
          type: "message",
          sessionId: unifiedSessionId,
          content: `📊 ${userMessage}`,
          isStep: true,
        }));
        return;
      }
    } catch { }
  }
  log.debug(`[TOOL] ${step.type}: ${step.toolName || ""}`);
},

// DESPUES (corregido):
onStep: async (step) => {
  if (signal.aborted) return;
  
  // "text" = el agente narra lo que esta pensando
  if (step.type === "text" && step.message) {
    const trimmedMessage = step.message.trim();
    if (trimmedMessage) {
      ws.send(JSON.stringify({
        type: "progress",
        sessionId: unifiedSessionId,
        content: trimmedMessage,
      }));
    }
    return;
  }

  // "tool_call" = el agente va a ejecutar una herramienta → narrar al usuario
  if (step.type === "tool_call" && step.toolName) {
    const narration = getNarration(step.toolName);
    ws.send(JSON.stringify({
      type: "progress",
      sessionId: unifiedSessionId,
      content: narration,
    }));
    return;
  }

  // "tool_result" = resultado de herramienta → solo si pide enviarse al usuario
  if (step.type === "tool_result" && step.message) {
    try {
      const result = JSON.parse(step.message);
      if (result._sendToUser || result.status) {
        const userMessage = result.message || result.status || "";
        if (userMessage) {
          ws.send(JSON.stringify({
            type: "progress",
            sessionId: unifiedSessionId,
            content: userMessage,
          }));
        }
        return;
      }
    } catch { }
  }
},
```

Esto necesita hacerse en DOS lugares del server.ts:
1. El handler de texto/WebChat principal (~linea 2594)
2. El handler de audio/WebChat (~linea 2447)

Tambien importar `getNarration` si no esta importado ya.

**Efecto en el frontend**: El tipo `"progress"` ya es manejado por `handleProgress` en `useChatStreaming.ts` que agrega pasos al `currentSteps` array mostrado como badges en el ChatHistory. No se necesita cambio frontend para esto.

---

## Problema 2: Procesos huerfanos

### Diagnostico

El analisis revela multiples fuentes de procesos huerfanos:

1. **CRITICAL - Gateway shutdown incompleto** (`server.ts:2806-2818`): El SIGTERM handler NO detiene:
   - BrowserService (Chrome sigue corriendo)
   - MCP hot-reload interval (2s polling infinito)
   - CanvasManager heartbeat intervals
   - RateLimiter cleanup intervals
   - PairingService cleanup interval
   - Code Bridge ProcessManager agents

2. **CRITICAL - Code Bridge ProcessManager sin shutdown** (`process-manager.ts`): No tiene metodo `killAll()` o `shutdown()`. Si Code Bridge se detiene, todos los subagentes quedan huerfanos.

3. **HIGH - BrowserService nunca detenido** (`browser-service.ts`): Chrome se lanza con `Bun.spawn` y `stop()` existe pero NUNCA se llama en shutdown.

4. **HIGH - setInterval sin cleanup**: RateLimiter, MCP hot-reload, PairingService, CanvasManager heartbeat — todos con intervals que nunca se limpian.

### Solucion

**Archivo: `packages/core/src/gateway/server.ts`** — Ampliar el SIGTERM handler:

```typescript
process.on("SIGTERM", async () => {
  log.info("Received SIGTERM, shutting down gracefully...");
  
  // 1. Watchers
  watchers.forEach((close) => close());
  
  // 2. MCP
  const mcp = agent?.getMCPManager();
  if (mcp) {
    log.info("Disconnecting MCP servers...");
    await mcp.disconnectAll().catch(() => { });
  }
  
  // 3. Channels
  if (channelManager) await channelManager.stopAll();
  
  // 4. BrowserService
  try {
    const { BrowserService } = await import("../tools/web/browser-service");
    await BrowserService.stopAll().catch(() => { });
  } catch { }
  
  // 5. CanvasManager — stop heartbeats
  try {
    canvasManager?.clearAll?.();
  } catch { }
  
  // 6. MCP hot-reload
  try {
    stopMCPHotReload();
  } catch { }
  
  // 7. Code Bridge ProcessManager
  try {
    processManager?.killAll();
  } catch { }
  
  // 8. Server
  server.stop();
  
  // 9. PID file
  try { unlinkSync(pidFile); } catch { }
  
  process.exit(0);
});
```

**Archivo: `packages/code-bridge/src/process-manager.ts`** — Agregar `killAll()`:

```typescript
killAll() {
  for (const [taskId, record] of this.agents) {
    try {
      record.proc.kill();
    } catch { }
  }
  this.agents.clear();
}
```

**Archivo: BrowserService** — Agregar `stopAll()` static method si no existe (ya existe `CDPClient.closeAll()`).

---

## Problema 3: Cargar solo ultimos 15 mensajes, contexto limpio

### Diagnostico

Actualmente:
- Backend `handleGetChatHistory` (`chat.ts:200-213`) carga `?limit=50` por defecto (historial del chat).
- Backend `getRecentMessages` en conversaciones para LLM usa `getRecentMessages(threadId, 50)` en `chat.ts:90`.
- Frontend `ChatContainer.tsx:44-62` hace `apiClient('/api/chat/history?sessionId=...')` sin limit param, cargando TODOS los mensajes (default 50 del backend).
- El `chatStore` con persist middleware guarda TODOS los mensajes en localStorage, sin limpieza.

Las mensajes `tool` y `system` del backend tambien se incluyen en el historial, ensuciando el contexto.

### Solucion

**1. Frontend: `ChatContainer.tsx`** — Agregar `limit=15` al fetch:

```typescript
const response = await apiClient<{ messages: any[] }>(`/api/chat/history?sessionId=${sessionId}&limit=15`);
```

**2. Frontend: `ChatContainer.tsx`** — Filtrar roles no deseados al cargar historial:

```typescript
const formattedMessages = response.messages
  .filter((m: any) => m.role === "user" || m.role === "assistant")
  .map((m: any) => ({
    id: m.id,
    conversationId: m.session_id,
    type: (m.role === "user" ? "user" : "agent") as any,
    content: m.content,
    agentId,
    timestamp: m.created_at,
  }));
```

**3. Frontend: `chatStore.ts`** — Limitar mensajes persistidos a 15:

En el `partialize` del persist, solo guardar los ultimos 15 mensajes:

```typescript
partialize: (state) => ({
  messages: state.messages.slice(-15),
}),
```

**4. Backend: `chat.ts`** — Cambiar default limit de 50 a 15:

```typescript
const limit = parseInt(url.searchParams.get("limit") || "15")
```

---

## Archivos a modificar

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `packages/core/src/gateway/server.ts` | onStep handler para WebChat: enviar narraciones como `progress`, no como `message`. Importar `getNarration`. |
| 2 | `packages/core/src/gateway/server.ts` | onStep handler para WebChat audio: mismo cambio |
| 3 | `packages/core/src/gateway/server.ts` | Ampliar SIGTERM handler con cleanup completo |
| 4 | `packages/core/src/gateway/routes/chat.ts` | Cambiar default limit de 50 a 15 |
| 5 | `packages/code-bridge/src/process-manager.ts` | Agregar `killAll()` |
| 6 | `packages/hive-ui/src/modules/chat/ChatContainer.tsx` | Agregar `&limit=15` al fetch, filtrar roles |
| 7 | `packages/hive-ui/src/stores/chatStore.ts` | Limitar persist a ultimos 15 mensajes |