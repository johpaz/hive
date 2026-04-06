# 🦙 Local LLM (llama-server) — Guía de Integración

Conecta tu servidor local de llama.cpp (`llama-server`) como proveedor de IA en Hive.

## Vista Rápida

| Propiedad | Valor |
|-----------|-------|
| **Provider ID** | `local-llama` |
| **Nombre** | Local LLM (llama-server) |
| **Base URL** | `http://localhost:8080/v1` |
| **API Key** | No requerida |
| **Tipo** | OpenAI-compatible |
| **Sync** | Automático via `/v1/models` |

---

## 1. Iniciar llama-server

```bash
# Ejemplo con Gemma 4
setsid env VK_ICD_FILENAMES=/path/to/vulkan_icd.json \
  ./llama-server \
  --model /path/to/google_gemma-4-26B-A4B-it-IQ2_XXS.gguf \
  --port 8080 \
  --jinja \
  --ctx-size 32768

# Verificar que está corriendo
curl http://localhost:8080/health
# {"status":"ok"}
```

**Flags recomendados:**
- `--port 8080` — Puerto de la API (debe coincidir con la configuración de Hive)
- `--jinja` — Habilita templates Jinja para formateo de chat
- `--ctx-size 32768` — Tamaño de contexto (ajustar según VRAM)

---

## 2. Configurar en Hive

### Opción A: Desde la UI (Recomendado)

1. Abre Hive → **Providers** en el sidebar
2. Busca **"Local LLM (llama-server)"** en la lista
3. Haz clic en **Activar** (toggle)
4. Ve a **HiveLearn → Configuración** y selecciona el provider
5. Haz clic en **Sync Models** para auto-detectar el modelo cargado
6. Selecciona el modelo detectado y guarda

### Opción B: Desde la API

```bash
# 1. Activar el provider
curl -X POST http://localhost:3000/api/providers/local-llama/toggle \
  -H "Content-Type: application/json" \
  -d '{"active": true}'

# 2. Sync de modelos (auto-detecta el modelo cargado)
curl -X POST http://localhost:3000/api/providers/local-llama/sync-models \
  -H "Content-Type: application/json"

# 3. Verificar que los modelos aparecen
curl http://localhost:3000/api/models
```

### Opción C: Setup Wizard

1. En el setup wizard, selecciona **"Local LLM (llama-server)"**
2. No requiere API key — solo verifica conectividad
3. Selecciona el modelo detectado automáticamente
4. Completa el setup

---

## 3. Verificación

```bash
# Health check directo
curl http://localhost:8080/health
# {"status":"ok"}

# Test de chat
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Di hola"}],
    "max_tokens": 50
  }'

# Verificar desde Hive
curl http://localhost:3000/api/hivelearn/config
# Debe mostrar providerId: "local-llama"
```

---

## 4. Usar con HiveLearn

Una vez configurado:

1. Ve a **HiveLearn → Aprender** (`/hivelearn`)
2. Ingresa tu perfil y objetivo
3. Selecciona **Local LLM** como provider
4. El enjambre de 16 agentes usará tu modelo local

**Rendimiento esperado:**
- Modelo pequeño (7B-13B IQ2): ~20-40 tokens/s en GPU
- Lección completa (~16 nodos): ~2-4 minutos
- Con caché activada: ~10 segundos para lecciones repetidas

---

## 5. Configuración Avanzada

### Cambiar el puerto por defecto

Si usas un puerto diferente a 8080:

```bash
# Opción 1: Variable de entorno
export LOCAL_LLM_HOST=http://localhost:9000

# Opción 2: Editar el provider en la DB
sqlite3 hive.db "UPDATE providers SET base_url = 'http://localhost:9000/v1' WHERE id = 'local-llama';"
```

### Modelos recomendados

| Modelo | VRAM | Calidad | Uso |
|--------|------|---------|-----|
| `gemma-4-1b` | ~1GB | Básica | Testing rápido |
| `gemma-4-12b-IQ3` | ~6GB | Buena | Uso diario |
| `gemma-4-26b-IQ2` | ~10GB | Excelente | Producción |
| `qwen3-32b-IQ3` | ~14GB | Excelente | Tareas complejas |
| `llama-3.3-70b-IQ2` | ~24GB | Superior | Máxima calidad |

### Multi-GPU

```bash
./llama-server \
  --model /path/to/model.gguf \
  --port 8080 \
  --tensor-split 1,1 \
  --device "CUDA0,CUDA1"
```

---

## 6. Troubleshooting

### "Could not connect to llama-server"

```bash
# Verificar que está corriendo
curl http://localhost:8080/health

# Ver logs del servidor
journalctl --user -u llama-server -f
# o revisa la terminal donde lo iniciaste

# Verificar puerto
ss -tlnp | grep 8080
```

### "No models found from provider"

El sync usa el endpoint `/v1/models`. Verifica:

```bash
curl http://localhost:8080/v1/models
# Debe devolver: {"data": [{"id": "model-name", ...}]}
```

Si el endpoint no responde, el modelo no se cargó correctamente.

### Respuestas vacías o cortas

Aumenta `max_tokens` en la configuración del agente o verifica:

```bash
# Verificar que el modelo responde
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Escribe un párrafo largo sobre Rust"}],
    "max_tokens": 1024,
    "temperature": 0.7
  }'
```

### OOM (Out of Memory)

```bash
# Reducir contexto
./llama-server --model model.gguf --port 8080 --ctx-size 16384

# Usar quantización más agresiva
# IQ2_XXS → IQ3_S → Q4_K_M
```

---

## 7. Arquitectura

```
┌─────────────┐     OpenAI API      ┌─────────────────┐
│  Hive Agent  │ ──────────────────► │  llama-server   │
│  (hl-*)      │  POST /v1/chat/    │  :8080            │
│              │  completions        │  (single model)   │
└──────┬───────┘                     └─────────────────┘
       │
       │  resolveProviderConfig()
       │  → SELECT base_url FROM providers WHERE id='local-llama'
       │  → Decrypt API key (not needed for local)
       │
       │  callLLM({ provider: "local-llama", ... })
       │  → getProvider("local-llama")
       │  → OpenAICompatProvider (fallback)
       │  → Uses baseUrl from DB: http://localhost:8080/v1
       ▼
  ┌─────────────────┐
  │ OpenAICompat    │  ← Universal adapter
  │ Provider        │     Works with any OpenAI-compatible endpoint
  └─────────────────┘
```

**No se necesita adapter nuevo** — llama-server es OpenAI-compatible, así que usa el `OpenAICompatProvider` existente que ya soporta Groq, Mistral, OpenRouter, DeepSeek, etc.
