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
  -d '{"model":"Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"}'

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
    "name": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "path": "/data/models/...",
    "sizeGb": 22.7,
    "isMoE": true,
    "hasMtp": false,
    "isGemma": false,
    "recommendedConfig": { "ngl": -1, "ctx": 8192, "kvType": "f16", "flashAttn": false }
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
  -d '{"model": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"}'

# Con config personalizada (ctx=200000 para contexto largo)
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "config": { "ctx": 200000, "kvType": "f16" }
  }'

# Gemma 4 (auto-detecta --jinja)
curl -X POST https://llm.hiveagents.io/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gemma-4-12b-it-UD-Q4_K_XL.gguf", "config": {"ctx": 8192}}'
```

**Parámetros de config:**

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `ngl` | -1 | GPU layers (-1 = todos) |
| `ctx` | 8192 | Contexto en tokens. **Máximo probado: 200000** |
| `batch` | 2048 | Batch size |
| `ubatch` | 512 | Micro-batch |
| `kvType` | `"f16"` | KV cache: `f16` · `q8_0` · `q4_0`. **Usar `f16`** — q8_0/q4_0 caen rendimiento en Vulkan AMD |
| `flashAttn` | `false` | Flash attention (no mejora TGS en Vulkan AMD) |
| `mtp` | `false` | MTP speculative decoding |
| `mtpDraftN` | 3 | Tokens draft MTP |
| `jinja` | `false` | **Auto-true para Gemma 4.** Habilita chat template Jinja |

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
    api_key="17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf"
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

### Qwen3 — Control via system prompt

```python
# Desactivar thinking (respuestas rápidas)
response = client.chat.completions.create(
    model="local",
    messages=[
        {"role": "system", "content": "/no_think"},
        {"role": "user", "content": "Lista 5 frameworks"}
    ],
    max_tokens=256
)
```

### Gemma 4 — Control via `chat_template_kwargs`

```python
# Desactivar thinking en Gemma 4
stream = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "¿Qué es un transformer?"}],
    stream=True,
    max_tokens=256,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}}
)

# Con thinking activado (por defecto) — el stream envía reasoning_content
stream = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Resuelve paso a paso"}],
    stream=True,
    max_tokens=512
)
# El frontend debe manejar:
# chunk.choices[0].delta.reasoning_content  ← thinking
# chunk.choices[0].delta.content            ← respuesta final
```

> **Sin `--jinja`, Gemma 4 genera todo en `reasoning_content` y `content` aparece vacío.** La API auto-activa `--jinja` al cargar modelos Gemma.

---

## 7. Modelos y rendimiento

| Modelo | Tipo | Tamaño | Prompt corto TGS | Contexto largo |
|--------|------|--------|-----------------|----------------|
| `Qwen3.6-35B-A3B-UD-Q4_K_M` | MoE | 22.7 GB | **62.8 t/s** | **37.1 t/s** @ 39K ctx |
| `Qwen3.6-35B-A3B-UD-Q6_K` | MoE | 30.0 GB | **57.7 t/s** | — |
| `Qwen3-Coder-Next-UD-Q4_K_M` | MoE | 49.3 GB | **50.9 t/s** | — |
| `gemma-4-26B-A4B-UD-Q4_K_M` | MoE | 16.9 GB | **51.5 t/s** | — |
| `gemma-4-26B-A4B-UD-Q6_K_XL` | MoE | 23.3 GB | **47.8 t/s** | — |
| `gemma-4-12b-it-UD-Q4_K_XL` | Dense | 7.4 GB | **27.7 t/s** | — |
| `Qwopus3.6-27B-v2-MTP-Q6_K` | Dense+MTP | 22.4 GB | **17.9 t/s** | — |
| `Qwen3.6-27B-UD-Q6_K_XL` | Dense+MTP | 26.0 GB | **16.0 t/s** | — |
| `gemma-4-31B-it-UD-Q6_K_XL` | Dense | 27.5 GB | **7.6 t/s** | — |

**ctx máximo probado:** 200,000 tokens. El modelo carga sin OOM y genera a 37 t/s con 39K tokens de prompt.

---

## 8. Completions (texto plano)

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
- **Gemma 4 sin `--jinja`:** Todo el output va a `reasoning_content`, `content` vacío.

