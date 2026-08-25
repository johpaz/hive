# HiveAgents LLM API — Manual de Integración

API OpenAI-compatible para inferencia local con llama.cpp. Backend Vulkan/RADV en AMD Ryzen AI MAX+ 395.

**URL pública:** `https://llm.hiveagents.io`  
**Base URL OpenAI:** `https://llm.hiveagents.io/v1`  
**Docs interactivas:** `https://llm.hiveagents.io/docs`  
**Manual Markdown:** `https://llm.hiveagents.io/api-docs`

La URL pública funciona desde otro computador sin VPN. No dependas de una IP LAN fija.

> **Seguridad:** solicita la clave al administrador y guárdala en una variable de entorno o secret manager. Nunca la incluyas en Git, documentación pública ni JavaScript entregado al navegador.

---

## Quick Start (5 pasos)

```bash
export HIVE_LLM_API_KEY="YOUR_API_KEY"
export HIVE_LLM_BASE="https://llm.hiveagents.io"
export HIVE_LLM_MODEL="Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"

# 1. Verificar que la API está viva
curl "$HIVE_LLM_BASE/health"

# 2. Listar modelos disponibles (sin autenticación)
curl "$HIVE_LLM_BASE/api/models"

# 3. Solicitar la carga. Responde HTTP 202 inmediatamente.
curl -X POST "$HIVE_LLM_BASE/api/load" \
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$HIVE_LLM_MODEL\"}"

# 4. Esperar hasta que loaded=true y loading=false
curl "$HIVE_LLM_BASE/api/status"

# 5. Chat con streaming usando el nombre exacto del modelo activo
curl -N "$HIVE_LLM_BASE/v1/chat/completions" \
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$HIVE_LLM_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"¿Qué es un transformer?\"}],\"stream\":true,\"max_tokens\":200}"
```

> **Regla de oro:** El modelo **debe estar cargado** antes de inferir. Si intentas chat sin cargar modelo primero, fallará. El modelo queda en VRAM entre peticiones hasta que hagas `/api/unload` o cargues otro.
>
> La carga es global: cargar o descargar un modelo afecta a todos los clientes conectados. Una aplicación consumidora normalmente sólo consulta `/api/status` e infiere; deja `/api/load` y `/api/unload` a un proceso administrador.

---

## Autenticación

Requieren Bearer token:

```
Authorization: Bearer YOUR_API_KEY
```

- Inferencia: `/v1/*`
- Cambios de estado: `POST /api/load`, `DELETE /api/unload`
- Benchmarks y operaciones administrativas

Son públicas y de sólo lectura: `/`, `/api`, `/api-docs`, `/health`, `/docs`, `/api/status`, `/api/models` y `/api/projectors`.

### Aplicaciones web y CORS

Python, Node.js, aplicaciones de escritorio y backends pueden usar directamente la URL pública. CORS no les aplica.

El navegador sólo acepta actualmente el origen `https://hive.hiveagents.io`. Para otro frontend web:

1. llama a esta API desde tu propio backend, o
2. solicita al administrador que autorice explícitamente tu origen.

No coloques el Bearer 

 en código frontend público.

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
curl https://llm.hiveagents.io/api/models
```

Devuelve cada modelo con metadata pre-calculada:

```json
[
  {
    "name": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "path": "/data/models/...",
    "sizeGb": 22.7,
    "isMoE": true,
    "hasMtp": false,
    "isGemma": false,
    "benchmark": { "generationTps": 62.7, "promptTps": 137.1, "measuredAt": "2026-08-18" },
    "recommendedConfig": { "ngl": -1, "ctx": 8192, "kvType": "f16", "flashAttn": false, "jinja": true }
  }
]
```

El catálogo se genera directamente desde los GGUF presentes en `/data/models`.
`GET /api/models` es la fuente de verdad si el inventario cambia. Al **18 de
agosto de 2026** quedaron instalados únicamente estos tres modelos:

| Identificador exacto para `model` | Arquitectura | Tamaño | Visión | Perfil automático |
|---|---|---:|---|---|
| `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` | MoE, 3B activos | 22.7 GB | Sí, con su `mmproj` | 8K, KV f16, Jinja |
| `Qwen3.8-27B-UD-Q4_K_XL.gguf` | Dense + MTP | 17.9 GB | Sí, con su `mmproj` | 8K, KV f16, MTP n=3, Jinja |
| `DeepSeek-V4-Flash-UD-IQ2_XXS-00001-of-00003.gguf` | MoE, 3 shards | 90.9 GB | No | 32K, KV q4_0, flash attention, Jinja |

En DeepSeek se usa el nombre del primer shard: llama.cpp descubre los otros dos
automáticamente y la API informa el tamaño total de los tres.

---

## 3. Cargar modelo

```bash
POST /api/load
```

La API responde `202 Accepted` al iniciar la carga:

```json
{"success":true,"loading":true}
```

Consulta `GET /api/status` hasta obtener `"loaded": true`, `"loading": false` y `"error": null`. No envíes inferencia mientras `"loading": true`.

```bash
# Con config personalizada
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "config": { "ctx": 8192, "kvType": "f16" }
  }'

# Qwen3.8 con su configuración recomendada automática
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen3.8-27B-UD-Q4_K_XL.gguf"}'
```

**Parámetros de config:** los valores de la tabla son la base. Al omitir
`config`, la API aplica el perfil automático indicado en el catálogo anterior;
los valores enviados por el cliente tienen la última prioridad.

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `ngl` | -1 | GPU layers (-1 = todos) |
| `ctx` | 8192 | Contexto asignado al cargar. Aumentarlo consume más memoria y eleva el coste de procesar historiales largos |
| `batch` | 2048 | Batch size |
| `ubatch` | 512 | Micro-batch |
| `kvType` | `"f16"` | KV cache: `f16` · `q8_0` · `q4_0`. Los Qwen usan `f16`; el perfil de DeepSeek usa `q4_0` |
| `flashAttn` | `false` | Los Qwen lo mantienen desactivado; el perfil de DeepSeek lo activa |
| `threads` | 4 | Hilos CPU. El perfil de DeepSeek usa 16 |
| `mtp` | `false` | MTP speculative decoding |
| `mtpDraftN` | 3 | Tokens draft MTP |
| `jinja` | `false` | **El perfil automático lo activa en los tres modelos instalados.** Habilita el chat template Jinja |

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
import os

MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"  # debe coincidir con /api/status

client = OpenAI(
    base_url="https://llm.hiveagents.io/v1",
    api_key=os.environ["HIVE_LLM_API_KEY"]
)

# Chat simple
response = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Hola, ¿cómo estás?"}],
    max_tokens=256
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model=MODEL,
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

const MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"; // debe coincidir con /api/status
const API_KEY = process.env.HIVE_LLM_API_KEY;
if (!API_KEY) throw new Error("Falta HIVE_LLM_API_KEY");

const client = new OpenAI({
  baseURL: "https://llm.hiveagents.io/v1",
  apiKey: API_KEY,
});

const stream = await client.chat.completions.create({
  model: MODEL,
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
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "messages": [{"role": "user", "content": "¿Qué es la IA?"}],
    "stream": true,
    "max_tokens": 200
  }'
```

### LangChain

```python
from langchain_openai import ChatOpenAI
import os

llm = ChatOpenAI(
    base_url="https://llm.hiveagents.io/v1",
    api_key=os.environ["HIVE_LLM_API_KEY"],
    model="Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    max_tokens=512
)
response = llm.invoke("Explica el patrón RAG")
print(response.content)
```

---

## 6. Visión / imágenes

Lista los proyectores:

```bash
curl https://llm.hiveagents.io/api/projectors
```

Los dos Qwen instalados admiten imágenes cuando se cargan con su proyector;
DeepSeek V4 Flash es sólo texto. El modelo y el `mmproj` deben pertenecer a la
misma carpeta. Usa la ruta completa devuelta por `/api/projectors`, porque los
dos proyectores comparten el nombre `mmproj-F16.gguf`.

```bash
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "config": {
      "ctx": 8192,
      "mmproj": "/data/models/qwen3.6-35b-a3b/mmproj-F16.gguf"
    }
  }'
```

Después de confirmar la carga en `/api/status`, envía la imagen como URL pública o data URL:

```python
response = client.chat.completions.create(
    model=MODEL,
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe esta imagen"},
            {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}},
        ],
    }],
    max_tokens=512,
)
```

Un modelo marcado `sin visión` sólo acepta contenido de texto.

---

## 7. Historial y latencia

La API es stateless: el cliente debe reenviar los mensajes que quiera conservar en cada petición. El modelo procesa el historial antes de producir el primer token.

Para baja latencia, envía el mensaje actual y como máximo los cuatro mensajes anteriores. Montar el modelo evita leer nuevamente sus pesos, pero no evita procesar el prompt.

---

## 8. Errores frecuentes

| Estado/mensaje | Causa | Solución |
|---|---|---|
| `401 Invalid or missing Bearer token` | Clave ausente o incorrecta | Envía `Authorization: Bearer ...` |
| `No hay modelo cargado` | Se llamó `/v1/*` antes de completar `/api/load` | Espera `loaded=true` en `/api/status` |
| `image input is not supported` | Modelo sin visión o sin `mmproj` | Envía sólo texto o monta la pareja correcta |
| `llama-server terminó durante la carga` | Modelo/proyector incompatible o fallo del backend | Consulta `error` en `/api/status` |
| El navegador bloquea por CORS | Origen web no autorizado | Usa un backend propio o solicita autorizar el origen |

Configura timeouts amplios: hasta cinco minutos para gestión de carga y al menos 60–120 segundos para inferencias largas.

---

## 9. Thinking / Reasoning

### Qwen3 — Control via `chat_template_kwargs`

```python
# Desactivar thinking (respuestas rápidas) — jinja debe estar activo
response = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Lista 5 frameworks"}],
    max_tokens=256,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}}
)
# → content: "1. React  2. Vue ..."  |  reasoning_content: null  |  10 tokens vs 463

# Con thinking (por defecto) — más tokens pero razonamiento visible
response = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Lista 5 frameworks"}],
    max_tokens=4096   # ← necesario para que el thinking no agote el presupuesto
)
# → reasoning_content: "Let me think..."  |  content: "1. React..."
```

> **Nota:** En tool calls, `reasoning_content` puede aparecer aunque `enable_thinking=False`.
> El modelo razona internamente cómo usar la herramienta — es comportamiento esperado y no se puede desactivar.

---

## 10. Tool Calls desde el frontend

Los tres modelos instalados soportan tool calls en formato OpenAI con
`jinja: true`. DeepSeek V4 Flash se validó el 18 de agosto de 2026 de extremo a
extremo mediante esta API —no mediante una llamada directa a llama-server—: el
endpoint aceptó `tools` y `tool_choice`, devolvió la llamada, aceptó el resultado
con rol `tool` y produjo la respuesta final. La API actúa como proxy transparente
— **el loop de herramientas lo implementa el cliente**.

| Modelo | Tool call validada | Nota |
|---|---|---|
| `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` | Sí | Recomendado para agentes por velocidad |
| `Qwen3.8-27B-UD-Q4_K_XL.gguf` | Sí | MTP activo |
| `DeepSeek-V4-Flash-UD-IQ2_XXS-00001-of-00003.gguf` | Sí | Ciclo API de dos turnos validado; mayor latencia y consumo |

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

Los modelos Qwen3.x son modelos de **razonamiento**. Antes de responder, pueden consumir tokens en `reasoning_content` (el bloque de pensamiento). Si `max_tokens` es muy bajo (~50-512), el modelo puede no llegar a generar el `content` real.

**Regla:** usar `max_tokens: 4096` como mínimo para inferencia normal, más si la tarea es compleja.

---

### TypeScript / JavaScript completo

```typescript
const BASE_URL = "https://llm.hiveagents.io";
const API_KEY = process.env.HIVE_LLM_API_KEY;
if (!API_KEY) throw new Error("Falta HIVE_LLM_API_KEY");

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
        model: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf", // debe coincidir con el modelo cargado
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
    model: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
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

## 11. Modelos y rendimiento

| Identificador exacto | Tipo | Tamaño | Carga | Prompt | Generación media |
|---|---|---:|---:|---:|---:|
| `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` | MoE | 22.7 GB | 8.1 s | 137.1 t/s | **62.7 t/s** |
| `Qwen3.8-27B-UD-Q4_K_XL.gguf` | Dense + MTP | 17.9 GB | 8.1 s | 46.1 t/s | **25.3 t/s** |
| `DeepSeek-V4-Flash-UD-IQ2_XXS-00001-of-00003.gguf` | MoE, 3 shards | 90.9 GB | 90.8 s | 21.0 t/s | **12.8 t/s** |

Medición del 18 de agosto de 2026: tres corridas por modelo, 128 tokens por corrida,
`temperature=0`, `ignore_eos=true`, caché de prompt desactivada y configuración
recomendada por `/api/models`. Consulta `BENCHMARK.md` para los resultados
individuales y el alcance de la prueba.

### Modelo recomendado por caso

- **Agentes / tool use / planificación:** `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`
- **Chat general de baja latencia:** `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`
- **Chat denso con MTP o segunda opción con visión:** `Qwen3.8-27B-UD-Q4_K_XL.gguf`
- **Experimentos con el modelo de mayor tamaño:** `DeepSeek-V4-Flash-UD-IQ2_XXS-00001-of-00003.gguf` (carga y generación mucho más lentas)

### Configuración recomendada para agentes

```bash
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "config": { "ctx": 8192, "kvType": "f16", "jinja": true }
  }'
```

Usa `ctx=8192` como punto de partida. Auméntalo sólo cuando la aplicación necesite más historial y después de medir memoria y tiempo al primer token.

---

## 12. Completions (texto plano)

```bash
curl https://llm.hiveagents.io/v1/completions \
  -H "Authorization: Bearer $HIVE_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"local","prompt":"El aprendizaje automático es","max_tokens":200}'
```

### Listar modelos (formato OpenAI)
```bash
curl https://llm.hiveagents.io/v1/models -H "Authorization: Bearer $HIVE_LLM_API_KEY"
```

Este endpoint lista los tres modelos instalados aunque ninguno esté cargado. Cada
`id` coincide con el nombre que debes enviar en `model`. Para metadata de tamaño,
capacidades y configuración recomendada usa `GET /api/models`.

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
- **KV q8_0 / q4_0:** En los Qwen no mejoran rendimiento; usa `f16`. DeepSeek usa `q4_0` en su perfil conservador para limitar memoria.
- **Flash-attn:** Manténlo `off` en Qwen. El perfil de DeepSeek lo activa por su arquitectura y huella de memoria.
- **DeepSeek V4 Flash:** ocupa 90.9 GB. En la medición más reciente cargó en 90.8 s y generó 12.8 t/s; conserva timeouts de al menos cinco minutos porque la carga anterior llegó a 259.6 s.
