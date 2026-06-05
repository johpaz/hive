# HiveAgents LLM API

**Hardware:** AMD Ryzen AI MAX+ 395 · Radeon 8060S (64 GB VRAM) · 128 GB RAM  
**Stack:** llama.cpp + Bun + Elysia · Backend Vulkan

---

## URLs de acceso

| Acceso | URL |
|--------|-----|
| Red local | `http://192.168.1.14:3000` |
| Tailscale | `http://<tailscale-ip>:3000` |
| Cloudflare (externo) | `https://llm.hiveagents.io` |
| Swagger UI | `http://192.168.1.14:3000/docs` |

---

## Autenticación

Todas las rutas excepto `/health` y `/docs` requieren Bearer token:

```
Authorization: Bearer 17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf
```

```bash
export KEY="17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf"
export BASE="http://192.168.1.14:3000"
```

---

## Modelos disponibles y rendimiento

Benchmarks medidos en este hardware (Vulkan, sin flash-attn, KV f16):

| Modelo | Tipo | Tamaño | Prompt t/s | Gen t/s | MTP |
|--------|------|--------|-----------|---------|-----|
| `Qwen3.6-35B-A3B-UD-Q6_K.gguf` | MoE | 30 GB | 312 | **62** | — |
| `gemma-4-26B-A4B-it-UD-Q6_K_XL.gguf` | MoE | 23 GB | 360 | **52** | — |
| `gemma-4-12b-it-UD-Q4_K_XL.gguf` | Dense | 7 GB | **826** | 27 | — |
| `Qwen3.6-27B-UD-Q6_K_XL.gguf` | Dense+MTP | 26 GB | 181 | **21** (con MTP) | ✅ n=3 |
| `gemma-4-31B-it-UD-Q6_K_XL.gguf` | Dense | 27 GB | 136 | 11 | — |

**Recomendado para producción:** `Qwen3.6-35B-A3B-UD-Q6_K.gguf` — el más rápido (62 t/s gen).

---

## 1. Health check

```bash
GET /health   # sin auth
```
```bash
curl $BASE/health
# {"status":"ok","service":"llm-api","ts":"2026-06-05T..."}
```

---

## 2. Gestión de modelos

### Listar modelos
```bash
GET /api/models
```
```bash
curl -H "Authorization: Bearer $KEY" $BASE/api/models
```
Devuelve cada modelo con `isMoE`, `hasMtp` y `recommendedConfig` pre-calculados.

### Cargar modelo
```bash
POST /api/load
```

> La respuesta llega **solo cuando el modelo está 100% listo**. Espera antes de inferir.  
> Tiempo típico: 15–60 segundos.

```bash
# Config óptima auto-detectada
curl -X POST $BASE/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen3.6-35B-A3B-UD-Q6_K.gguf"}'

# Con config personalizada
curl -X POST $BASE/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.6-27B-UD-Q6_K_XL.gguf",
    "config": { "mtp": true, "mtpDraftN": 3, "ctx": 8192, "kvType": "f16" }
  }'
```

**Parámetros de config:**

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `ngl` | -1 | GPU layers (-1 = todos) |
| `ctx` | 8192 | Tamaño de contexto en tokens |
| `batch` | 2048 | Batch size |
| `ubatch` | 512 | Micro-batch (256 mejor para 12B) |
| `kvType` | `"f16"` | KV cache: `f16` · `q8_0` · `q4_0` |
| `flashAttn` | `false` | Flash attention (desactivado — Vulkan AMD no lo soporta) |
| `mtp` | `false` | MTP speculative decoding (Qwen3.6-27B embebido) |
| `mtpDraftN` | 3 | Tokens draft MTP — 3 es el óptimo medido |

### Estado del modelo activo
```bash
GET /api/status
```
```bash
curl -H "Authorization: Bearer $KEY" $BASE/api/status
```
```json
{
  "loaded": true,
  "model": {
    "name": "Qwen3.6-35B-A3B-UD-Q6_K.gguf",
    "config": { "kvType": "f16", "mtp": false, "ctx": 8192 },
    "pid": 12345,
    "loadedAt": "2026-06-05T17:00:00Z"
  }
}
```

### Descargar modelo (liberar VRAM)
```bash
DELETE /api/unload
```
```bash
curl -X DELETE -H "Authorization: Bearer $KEY" $BASE/api/unload
```

---

## 3. Inferencia (OpenAI-compatible)

Compatible con **cualquier cliente OpenAI** — SDK Python, TypeScript, LangChain, etc.

### Chat Completions

```bash
POST /v1/chat/completions
```

#### curl
```bash
# Sin streaming
curl $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local",
    "messages": [
      {"role": "system", "content": "Eres un asistente experto."},
      {"role": "user", "content": "¿Qué es un transformer?"}
    ],
    "max_tokens": 512
  }'

# Con streaming
curl $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local",
    "messages": [{"role": "user", "content": "Escribe un poema sobre la IA"}],
    "stream": true,
    "max_tokens": 256
  }'
```

#### Python
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.1.14:3000/v1",
    api_key="17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf"
)

# Sin streaming
response = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Hola, ¿cómo estás?"}],
    max_tokens=256
)
print(response.choices[0].message.content)

# Con streaming
stream = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Explica qué es Docker"}],
    stream=True,
    max_tokens=512
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

#### TypeScript
```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://192.168.1.14:3000/v1",
  apiKey: "17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf",
});

// Sin streaming
const response = await client.chat.completions.create({
  model: "local",
  messages: [{ role: "user", content: "¿Cuál es la capital de Colombia?" }],
  max_tokens: 100,
});
console.log(response.choices[0].message.content);

// Con streaming
const stream = await client.chat.completions.create({
  model: "local",
  messages: [{ role: "user", content: "Escribe un haiku sobre IA" }],
  stream: true,
  max_tokens: 100,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

#### LangChain
```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://192.168.1.14:3000/v1",
    api_key="17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf",
    model="local",
    max_tokens=512
)

response = llm.invoke("Explica el patrón RAG en IA")
print(response.content)
```

#### Modo thinking (Qwen3 / Gemma4)
```python
# Activar razonamiento profundo (más lento, más preciso)
response = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "Resuelve: x² + 5x + 6 = 0"}],
    extra_body={"thinking": True}
)

# Desactivar thinking (respuestas rápidas)
response = client.chat.completions.create(
    model="local",
    messages=[
        {"role": "system", "content": "/no_think"},
        {"role": "user", "content": "Lista 5 frameworks de Python"}
    ]
)
```

### Completions (texto plano)
```bash
curl $BASE/v1/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"local","prompt":"El aprendizaje automático es","max_tokens":200}'
```

### Listar modelos (formato OpenAI)
```bash
curl $BASE/v1/models -H "Authorization: Bearer $KEY"
```

---

## 4. Benchmark

```bash
POST /api/benchmark
```

```bash
# Suite por defecto (7 configuraciones)
curl -X POST $BASE/api/benchmark \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gemma-4-12b-it-UD-Q4_K_XL.gguf"}'

# Configs específicas
curl -X POST $BASE/api/benchmark \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.6-35B-A3B-UD-Q6_K.gguf",
    "configs": [
      {"kvType":"f16","flashAttn":false,"batch":2048,"ubatch":512,"pp":512,"tg":128},
      {"kvType":"f16","flashAttn":false,"batch":4096,"ubatch":1024,"pp":512,"tg":128}
    ]
  }'
```

---

## 5. Flujo rápido de prueba

```bash
export KEY="17707bdfbeb77965f89d1ab266c4e68ec6896b0bdbcd8c0cc398a022b053f3bf"
export BASE="http://192.168.1.14:3000"

# 1. Health
curl $BASE/health

# 2. Cargar modelo (espera ~30s)
curl -X POST $BASE/api/load \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen3.6-35B-A3B-UD-Q6_K.gguf"}'

# 3. Chat rápido
curl $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"local",
    "messages":[
      {"role":"system","content":"/no_think"},
      {"role":"user","content":"Di hola en 5 idiomas"}
    ],
    "max_tokens":100
  }' | python3 -c "import json,sys; print(json.load(sys.stdin)['choices'][0]['message']['content'])"
```
