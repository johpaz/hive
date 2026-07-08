# HiveAgents LLM API — Manual de Integración

API OpenAI-compatible para inferencia local con llama.cpp. Backend Vulkan/RADV en AMD Ryzen AI MAX+ 395.

**URL pública:** `https://llm.hiveagents.io`  
**URL local:** `http://192.168.1.14:3000`  
**Docs interactivas:** `https://llm.hiveagents.io/docs`

---

## Quick Start (5 pasos)

```bash
export KEY="17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf"
export BASE="https://llm.hiveagents.io"

# 1. Verificar que la API está viva
curl $BASE/health

# 2. Listar modelos disponibles
curl -H "Authorization: Bearer $KEY" $BASE/api/models

# 3. Cargar un modelo (~30s, el modelo queda en VRAM)
curl -X POST $BASE/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf"}'

# 4. Chat con streaming
curl -N $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"local",
    "messages":[{"role":"user","content":"¿Qué es un transformer?"}],
    "stream":true,
    "max_tokens":200
  }'

# 5. Descargar modelo (liberar VRAM)
curl -X DELETE -H "Authorization: Bearer $KEY" $BASE/api/unload
```

> **Regla de oro:** El modelo **debe estar cargado** antes de inferir. Si intentas chat sin cargar modelo primero, fallará. El modelo queda en VRAM entre peticiones hasta que hagas `/api/unload` o cargues otro.

---

## Autenticación

Todas las rutas excepto `/health` y `/docs` requieren Bearer token:

```
Authorization: Bearer 17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf
```

---

## 1. Health check

```bash
GET /health   # sin auth
```

```bash
curl https://llm.hiveagents.io/health
# {"status":"ok","service":"llm-api","ts":"2026-06-10T..."}
```

---

## 2. Listar modelos disponibles

```bash
GET /api/models
```

```bash
curl -H "Authorization: Bearer $KEY" https://llm.hiveagents.io/api/models
```

Devuelve cada modelo con metadata pre-calculada:

```json
[
  {
    "name": "Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf",
    "path": "/data/models/...",
    "sizeGb": 22.1,
    "isMoE": true,
    "hasMtp": false,
    "isGemma": false,
    "recommendedConfig": { "ngl": -1, "ctx": 200000, "kvType": "f16", "flashAttn": false, "jinja": true }
  }
]
```

---

## 3. Cargar modelo

```bash
POST /api/load
```

La respuesta llega **solo cuando el modelo está 100% listo** (espera antes de inferir).

```bash
# Config óptima auto-detectada
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf"}'

# Con config personalizada (ctx=200000 para contexto largo)
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf",
    "config": { "ctx": 200000, "kvType": "f16" }
  }'
```

**Parámetros de config:**

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `ngl` | -1 | GPU layers (-1 = todos) |
| `ctx` | 200000 | Contexto en tokens. **Probado y recomendado para cargas de contexto largo** |
| `batch` | 2048 | Batch size |
| `ubatch` | 512 | Micro-batch |
| `kvType` | `"f16"` | KV cache: `f16` · `q8_0` · `q4_0`. **Usar `f16`** — q8_0/q4_0 caen rendimiento en Vulkan AMD |
| `flashAttn` | `false` | Flash attention (no mejora TGS en Vulkan AMD) |
| `mtp` | `false` | MTP speculative decoding |
| `mtpDraftN` | 3 | Tokens draft MTP |
| `jinja` | `false` | **Auto-true para Qwen-AgentWorld.** Habilita chat template Jinja |

---

## 4. Estado y descarga

```bash
# Ver modelo activo
GET /api/status

# Liberar VRAM
DELETE /api/unload
```

---

## 5. Inferencia — Chat Completions (OpenAI-compatible)

Compatible con cualquier SDK OpenAI, LangChain, LiteLLM, etc.

### Python — OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llm.hiveagents.io/v1",
    api_key="**************************"
)

# Chat simple
response = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Hola, ¿cómo estás?"}],
    max_tokens=256
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Explica Docker"}],
    stream=True,
    max_tokens=512
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

### TypeScript

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://llm.hiveagents.io/v1",
  apiKey: "17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf",
});

const stream = await client.chat.completions.create({
  model: "local",
  messages: [{ role: "user", content: "Escribe un haiku" }],
  stream: true,
  max_tokens: 100,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

### curl — Streaming

```bash
curl -N https://llm.hiveagents.io/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local",
    "messages": [{"role": "user", "content": "¿Qué es la IA?"}],
    "stream": true,
    "max_tokens": 200
  }'
```

### LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="https://llm.hiveagents.io/v1",
    api_key="17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf",
    model="local",
    max_tokens=512
)
response = llm.invoke("Explica el patrón RAG")
print(response.content)
```

---

## 6. Thinking / Reasoning

### Qwen-AgentWorld — Control via `chat_template_kwargs`

```python
# Desactivar thinking (respuestas rápidas) — jinja debe estar activo
response = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Lista 5 frameworks"}],
    max_tokens=256,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}}
)
# → content: "1. React  2. Vue ..."  |  reasoning_content: null  |  10 tokens vs 463

# Con thinking (por defecto) — más tokens pero razonamiento visible
response = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Lista 5 frameworks"}],
    max_tokens=4096   # ← necesario para que el thinking no agote el presupuesto
)
# → reasoning_content: "Let me think..."  |  content: "1. React..."
```

> **Nota:** En tool calls, `reasoning_content` aparece siempre aunque `enable_thinking=False`.
> El modelo razona internamente cómo usar la herramienta — es comportamiento esperado y no se puede desactivar.

> La API auto-activa `--jinja` al cargar `Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf`.

---

## 7. Tool Calls desde el frontend

`Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf` soporta tool calls en formato OpenAI con `--jinja` activo. La API actúa como proxy transparente — **el loop de herramientas lo implementa el cliente**.

### Flujo completo

```
Turno 1: cliente envía tools[] + mensaje
         ↓
         modelo responde con finish_reason="tool_calls"
         ↓
Turno 2: cliente ejecuta la tool y envía el resultado
         ↓
         modelo responde con finish_reason="stop" y la respuesta final
```

### ⚠️ Gotcha crítico: `max_tokens`

Qwen-AgentWorld es un modelo de **razonamiento**. Antes de responder, consume tokens en `reasoning_content` (el bloque de pensamiento). Si `max_tokens` es muy bajo (~50-512), el modelo nunca llega a generar el `content` real.

**Regla:** usar `max_tokens: 4096` como mínimo para inferencia normal, más si la tarea es compleja.

---

### TypeScript / JavaScript completo

```typescript
const BASE_URL = "https://llm.hiveagents.io";
const API_KEY = "17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf";

// Definición de tools (formato OpenAI)
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          units: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "Temperature units",
          },
        },
        required: ["location"],
      },
    },
  },
];

// Tu implementación real de cada tool
async function executeTool(name: string, args: Record<string, unknown>) {
  if (name === "get_weather") {
    const { location } = args as { location: string };
    // llamar a tu API del clima aquí
    return { temperature: 28, units: "celsius", condition: "sunny", humidity: 45 };
  }
  throw new Error(`Tool desconocida: ${name}`);
}

// Loop agentic completo
async function chatWithTools(userMessage: string) {
  const messages: any[] = [
    { role: "system", content: "You are a helpful assistant. Use tools when needed." },
    { role: "user", content: userMessage },
  ];

  while (true) {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf", // modelo único de HiveAgents
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 4096,   // ← importante para modelos de razonamiento
        stream: false,
      }),
    });

    const data = await response.json();
    const choice = data.choices[0];
    const assistantMessage = choice.message;

    // Añadir respuesta del modelo al historial
    messages.push(assistantMessage);

    // ── Caso 1: el modelo quiere llamar tools ──
    if (choice.finish_reason === "tool_calls") {
      // Ejecutar todas las tools en PARALELO (el modelo puede pedir varias a la vez)
      const toolResults = await Promise.all(
        assistantMessage.tool_calls.map(async (toolCall: any) => {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeTool(toolCall.function.name, args);
          return { id: toolCall.id, result };
        })
      );

      // Añadir resultados al historial (un mensaje "tool" por cada tool_call)
      for (const { id, result } of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: JSON.stringify(result),
        });
      }
      // Volver a llamar al modelo con los resultados
      continue;
    }

    // ── Caso 2: respuesta final ──
    // choice.finish_reason === "stop"
    return assistantMessage.content;
  }
}

// Uso
const answer = await chatWithTools("¿Qué tiempo hace en Madrid?");
console.log(answer); // "The current weather in Madrid is sunny with 28°C and 45% humidity."
```

---

### Respuestas reales de la API (datos de prueba)

**Turno 1 — modelo llama a una tool:**
```json
{
  "choices": [{
    "finish_reason": "tool_calls",
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "",
      "tool_calls": [{
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\":\"Madrid\"}"
        },
        "id": "wfUZtb334zKZpvZn36P6ORzq8skjmSok"
      }]
    }
  }],
  "usage": { "prompt_tokens": 114, "completion_tokens": 122, "total_tokens": 236 }
}
```

**Turno 2 — modelo entrega respuesta final:**
```json
{
  "choices": [{
    "finish_reason": "stop",
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "The current weather in Madrid is sunny with a temperature of 28°C and 45% humidity."
    }
  }],
  "usage": { "prompt_tokens": 168, "completion_tokens": 28, "total_tokens": 196 }
}
```

---

### Streaming con tool calls — formato de los chunks

En streaming, los chunks de tool calls llegan con `delta.tool_calls[]`:

```typescript
const stream = await fetch(`${BASE_URL}/v1/chat/completions`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf",
    messages,
    tools,
    tool_choice: "auto",
    max_tokens: 4096,
    stream: true,
  }),
});

const reader = stream.body!.getReader();
const decoder = new TextDecoder();

let thinkingText = "";
let contentText = "";
const toolCallsAccumulator: Record<string, { name: string; arguments: string }> = {};

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  for (const line of decoder.decode(value).split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

    const chunk = JSON.parse(line.slice(6));
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    // Razonamiento interno del modelo (no mostrar al usuario o mostrar como "thinking...")
    if (delta.reasoning_content) {
      thinkingText += delta.reasoning_content;
    }

    // Respuesta final al usuario
    if (delta.content) {
      contentText += delta.content;
      // renderizar contentText en UI
    }

    // Acumular tool calls (vienen fragmentados)
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsAccumulator[idx]) {
          toolCallsAccumulator[idx] = { name: "", arguments: "" };
        }
        if (tc.function?.name) toolCallsAccumulator[idx].name += tc.function.name;
        if (tc.function?.arguments) toolCallsAccumulator[idx].arguments += tc.function.arguments;
      }
    }

    // fin de turno
    if (chunk.choices[0]?.finish_reason === "tool_calls") {
      // ejecutar toolCallsAccumulator y continuar el loop
    }
  }
}
```

---

### Formato de los mensajes de historial

```typescript
// Mensaje de usuario
{ role: "user", content: "texto" }

// Mensaje de sistema
{ role: "system", content: "instrucciones" }

// Respuesta del modelo sin tools
{ role: "assistant", content: "respuesta" }

// Respuesta del modelo con tool call — usar null en content, no omitirlo
{
  role: "assistant",
  content: null,
  tool_calls: [{
    type: "function",
    function: { name: "nombre", arguments: '{"key":"value"}' },
    id: "id_unico"
  }]
}

// Resultado de la tool — tool_call_id debe coincidir con el id del tool_call
{
  role: "tool",
  tool_call_id: "id_unico",
  content: JSON.stringify({ resultado: "..." })  // ← siempre string
}
```

---

## 8. Modelo y rendimiento

HiveAgents distribuye un único modelo optimizado para agentes en una sola máquina:

| Modelo | Tipo | Tamaño | Contexto | Uso recomendado |
|--------|------|--------|----------|-----------------|
| `Qwen-AgentWorld-35B-A3B-UD-Q4_K_M` | MoE | 22.1 GB | 200,000 tokens | Agentes, tool use, MCP, terminal, web, SWE |

### ¿Por qué este modelo?

`Qwen-AgentWorld-35B-A3B` es un **language world model** entrenado para simular y razonar sobre entornos agenticos. La release oficial cubre siete dominios relevantes para agentes: **MCP, Search, Terminal, SWE, Android, Web y OS**, y está diseñada para trayectorias multi-turn de acción-observación, que es justo el patrón de un agente con tools.

Configuración recomendada:

```bash
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf",
    "config": { "ctx": 200000, "kvType": "f16", "jinja": true }
  }'
```

- **ctx máximo probado:** 200,000 tokens.
- El modelo carga sin OOM y genera a ~37 t/s con 39K tokens de prompt.
- La API auto-activa `--jinja` para Qwen-AgentWorld.

---

## 9. Completions (texto plano)

```bash
curl https://llm.hiveagents.io/v1/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"local","prompt":"El aprendizaje automático es","max_tokens":200}'
```

### Listar modelos (formato OpenAI)
```bash
curl https://llm.hiveagents.io/v1/models -H "Authorization: Bearer $KEY"
```

---

## Notas técnicas

### Streaming sin overhead
El proxy Elysia reenvía `request.body` directamente a llama-server vía `fetch()` con `duplex: 'half'`. No bufferiza. Benchmark confirmó: **-0.4% TGS** vs llamada directa (margen de error).

### VRAM y modelos cargados
- Un modelo cargado ocupa VRAM constantemente
- Cambiar de modelo: `POST /api/load` descarga el anterior automáticamente
- Para liberar VRAM: `DELETE /api/unload`

### Optimizaciones del sistema
- BIOS UMA Frame Buffer: 64 GB → **2 GB** (OS ve 123 GB)
- GRUB: `amd_iommu=off amdgpu.gttsize=122880 ttm.pages_limit=335544321 transparent_hugepage=never mitigations=off`
- tuned: `accelerator-performance`
- GPU: hasta 107W, sin throttling

### Limitaciones conocidas
- **KV q8_0 / q4_0:** No mejoran rendimiento en Vulkan AMD. Usar `f16`.
- **Flash-attn:** No mejora TGS en Vulkan AMD. Mantener `off`.
- **Sin `--jinja`:** Qwen-AgentWorld puede enviar todo a `reasoning_content` (`content` vacío) o aumentar el TTFT. La API lo activa automáticamente.