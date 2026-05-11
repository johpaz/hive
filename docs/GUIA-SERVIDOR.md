# Hive Server - Guía de Despliegue y Consumo API

Servidor local de inferencia LLM con API compatible OpenAI, basado en `llama-server` (binarios oficiales de llama.cpp).

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  Frontend / Agente                                       │
│  SDK OpenAI → http://localhost:{PUERTO}/v1               │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ TEXTO    │  │ IMAGEN   │  │ AUDIO    │              │
│  │ :8081    │  │ :8082    │  │ :8083    │              │
│  │ E2B/E4B  │  │ E2B+mm  │  │ E2B+mm  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                          │
│  Cada servidor es independiente.                         │
│  Solo 1 corre a la vez (VRAM compartida).               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

Los 3 modos **nunca** van juntos. Cada uno es un servidor `llama-server` independiente en un puerto distinto.

---

## 1. Descarga e Instalación de Binarios Oficiales

### Binarios disponibles por plataforma y backend

| OS | Arch | Backend | Archivo | GPU requerida |
|----|------|---------|---------|---------------|
| Linux | x64 | CPU | `llama-{VER}-bin-ubuntu-x64.tar.gz` | Ninguna |
| Linux | x64 | Vulkan | `llama-{VER}-bin-ubuntu-vulkan-x64.tar.gz` | Cualquiera (AMD, Intel, NVIDIA) |
| Linux | x64 | ROCm | `llama-{VER}-bin-ubuntu-rocm-7.2-x64.tar.gz` | AMD (ROCm 7.2) |
| Linux | x64 | SYCL | `llama-{VER}-bin-ubuntu-sycl-fp16-x64.tar.gz` | Intel (oneAPI) |
| Linux | ARM64 | CPU | `llama-{VER}-bin-ubuntu-arm64.tar.gz` | Ninguna |
| Linux | ARM64 | Vulkan | `llama-{VER}-bin-ubuntu-vulkan-arm64.tar.gz` | Cualquiera |
| macOS | ARM64 | Metal | `llama-{VER}-bin-macos-arm64.tar.gz` | Apple Silicon (M1/M2/M3/M4) |
| macOS | x64 | CPU | `llama-{VER}-bin-macos-x64.tar.gz` | Ninguna |
| Windows | x64 | CPU | `llama-{VER}-bin-win-cpu-x64.zip` | Ninguna |
| Windows | x64 | CUDA 12.4 | `llama-{VER}-bin-win-cuda-12.4-x64.zip` | NVIDIA (CUDA 12.4+) |
| Windows | x64 | CUDA 13.1 | `llama-{VER}-bin-win-cuda-13.1-x64.zip` | NVIDIA (CUDA 13.1+) |
| Windows | x64 | Vulkan | `llama-{VER}-bin-win-vulkan-x64.zip` | Cualquiera |
| Windows | x64 | SYCL | `llama-{VER}-bin-win-sycl-x64.zip` | Intel |
| Windows | x64 | HIP/Radeon | `llama-{VER}-bin-win-hip-radeon-x64.zip` | AMD (HIP) |
| Windows | ARM64 | CPU | `llama-{VER}-bin-win-cpu-arm64.zip` | Ninguna |
| Android | ARM64 | Vulkan | `llama-{VER}-bin-android-arm64.tar.gz` | Cualquiera |

`{VER}` = versión de la release, ej: `b9025`. Última release: https://github.com/ggml-org/llama.cpp/releases

### Script de instalación con autodetección

El script detecta automáticamente el OS, arquitectura y GPU disponible, y descarga el binario correcto:

```bash
#!/usr/bin/env bash
# install-llama.sh - Descarga binarios oficiales de llama.cpp con autodetección
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/bin-llama"
mkdir -p "$BIN_DIR"

# --- Detectar versión más reciente ---
LLAMA_VER=$(curl -s https://api.github.com/repos/ggml-org/llama.cpp/releases/latest | grep -oP '"tag_name": "\K[^"]+')
echo "Versión detectada: $LLAMA_VER"

# --- Detectar OS ---
case "$(uname -s)" in
  Linux)   OS="ubuntu" ;;
  Darwin)  OS="macos" ;;
  MINGW*|MSYS*|CYGWIN*) OS="win" ;;
  *)       echo "OS no soportado: $(uname -s)"; exit 1 ;;
esac

# --- Detectar arquitectura ---
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Arch no soportada: $ARCH"; exit 1 ;;
esac

# --- Detectar GPU / Backend ---
detect_backend() {
  # macOS → siempre Metal
  if [[ "$OS" == "macos" && "$ARCH" == "arm64" ]]; then
    echo "metal"
    return
  fi

  # Prioridad: CUDA > Vulkan > CPU
  # NVIDIA (nvidia-smi)
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    echo "cuda"
    return
  fi

  # Vulkan (vulkaninfo)
  if command -v vulkaninfo &>/dev/null && vulkaninfo --summary &>/dev/null; then
    echo "vulkan"
    return
  fi

  # ROCm (rocm-smi)
  if command -v rocm-smi &>/dev/null && rocm-smi &>/dev/null; then
    echo "rocm"
    return
  fi

  # Intel GPU (sycl)
  if [[ -d /opt/intel/oneapi ]] || [[ -n "$ONEAPI_ROOT" ]]; then
    echo "sycl"
    return
  fi

  echo "cpu"
}

BACKEND=$(detect_backend)
echo "Backend detectado: $BACKEND"

# --- Construir nombre del archivo ---
case "$OS-$ARCH-$BACKEND" in
  ubuntu-x64-cpu)    SUFFIX="bin-ubuntu-x64" ;;
  ubuntu-x64-vulkan) SUFFIX="bin-ubuntu-vulkan-x64" ;;
  ubuntu-x64-rocm)   SUFFIX="bin-ubuntu-rocm-7.2-x64" ;;
  ubuntu-x64-sycl)   SUFFIX="bin-ubuntu-sycl-fp16-x64" ;;
  ubuntu-arm64-cpu)    SUFFIX="bin-ubuntu-arm64" ;;
  ubuntu-arm64-vulkan) SUFFIX="bin-ubuntu-vulkan-arm64" ;;
  macos-arm64-metal) SUFFIX="bin-macos-arm64" ;;
  macos-x64-cpu)     SUFFIX="bin-macos-x64" ;;
  win-x64-cpu)       SUFFIX="bin-win-cpu-x64" ;;
  win-x64-cuda)      SUFFIX="bin-win-cuda-12.4-x64" ;;
  win-x64-vulkan)    SUFFIX="bin-win-vulkan-x64" ;;
  win-x64-sycl)      SUFFIX="bin-win-sycl-x64" ;;
  win-arm64-cpu)     SUFFIX="bin-win-cpu-arm64" ;;
  *) echo "Combinación no soportada: $OS-$ARCH-$BACKEND"; exit 1 ;;
esac

FILENAME="llama-${LLAMA_VER}-${SUFFIX}"
EXT=$([[ "$OS" == "win" ]] && echo "zip" || echo "tar.gz")
URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VER}/${FILENAME}.${EXT}"

echo "Descargando: $URL"
curl -L -o "${BIN_DIR}/${FILENAME}.${EXT}" "$URL"

# --- Extraer ---
cd "$BIN_DIR"
if [[ "$EXT" == "tar.gz" ]]; then
  tar xzf "${FILENAME}.${EXT}"
else
  unzip -o "${FILENAME}.${EXT}"
fi

EXTRACTED_DIR="${BIN_DIR}/llama-${LLAMA_VER}"
echo ""
echo "✅ Instalación completa en: ${EXTRACTED_DIR}"
echo ""
echo "Binarios clave:"
echo "  llama-server  → servidor API OpenAI-compatible"
echo "  llama-cli     → CLI interactivo"
echo "  llama-bench   → benchmark de rendimiento"
echo ""
echo "Para verificar:"
echo "  export LD_LIBRARY_PATH=${EXTRACTED_DIR}:\$LD_LIBRARY_PATH"
echo "  ${EXTRACTED_DIR}/llama-server --help"
```

### Instalación manual

Si prefieres descargar manualmente:

```bash
# Linux Vulkan x64
curl -L -o bin-llama/llama-b9025-bin-ubuntu-vulkan-x64.tar.gz \
  "https://github.com/ggml-org/llama.cpp/releases/download/b9025/llama-b9025-bin-ubuntu-vulkan-x64.tar.gz"
tar xzf bin-llama/llama-b9025-bin-ubuntu-vulkan-x64.tar.gz -C bin-llama/

# Windows CUDA 12.4 x64
curl -L -o bin-llama/llama-b9025-bin-win-cuda-12.4-x64.zip \
  "https://github.com/ggml-org/llama.cpp/releases/download/b9025/llama-b9025-bin-win-cuda-12.4-x64.zip"
# Descomprimir manualmente

# macOS ARM64 (Metal)
curl -L -o bin-llama/llama-b9025-bin-macos-arm64.tar.gz \
  "https://github.com/ggml-org/llama.cpp/releases/download/b9025/llama-b9025-bin-macos-arm64.tar.gz"
tar xzf bin-llama/llama-b9025-bin-macos-arm64.tar.gz -C bin-llama/
```

### Verificar instalación

```bash
# Linux/macOS
export LD_LIBRARY_PATH=./bin-llama/llama-b9025:$LD_LIBRARY_PATH
./bin-llama/llama-b9025/llama-server --help

# Windows (PowerShell)
.\bin-llama\llama-b9025\llama-server.exe --help
```

Al iniciar el servidor, debes ver el backend detectado:
- Vulkan: `ggml_vulkan: Found 1 Vulkan devices`
- CUDA: `ggml_cuda: Found 1 CUDA devices`
- Metal: `ggml_metal: Found 1 Metal devices`
- CPU: (no muestra mensaje de GPU, usa CPU directamente)

### Instalación Windows

```powershell
mkdir bin-oficial
cd bin-oficial

curl -L -o llama-vulkan-x64.zip `
  "https://github.com/ggml-org/llama.cpp/releases/download/b9023/llama-b9023-bin-win-vulkan-x64.zip"

Expand-Archive llama-vulkan-x64.zip
# Los binarios quedan en bin-oficial\llama-b9023\
```

### Verificar instalación

```bash
# Linux
export LD_LIBRARY_PATH=./bin-llama/llama-b9025:$LD_LIBRARY_PATH
./bin-oficial/llama-b9023/llama-server --version

# Debe mostrar: ggml_vulkan: Found 1 Vulkan devices
```

---

## 2. Descarga de Modelos

```bash
mkdir -p models
cd models

# E2B - Texto / Imagen / Audio (2.95 GiB)
curl -L -o gemma-4-E2B-it-UD-Q4_K_XL.gguf \
  "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-UD-Q4_K_XL.gguf"

# E4B - Texto (4.76 GiB)
curl -L -o gemma-4-E4B-it-UD-Q4_K_XL.gguf \
  "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q4_K_XL.gguf"

# Proyector Multimodal - Requerido para Imagen y Audio (946 MiB)
curl -L -o mmproj-BF16.gguf \
  "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/mmproj-BF16.gguf"
```

---

## 3. Levantar el Servidor por Modo

### Configuración común a todos los modos

| Parámetro | Valor | Nota |
|-----------|-------|------|
| `-ngl 999` | Todas las capas en GPU | Vulkan/CUDA/Metal obligatorio |
| `-fa 1` | Flash Attention | Siempre activado |
| `-ctk f16 -ctv f16` | Cache KV f16 | Más rápido según benchmark |
| `-t 16` | 16 threads | Ajustar a tu CPU |
| `-c 8192` | Contexto 8K | Ajustar según necesidad |
| `-b 2048 -ub 512` | Batch sizes | Optimizado para Ryzen 680M |

### Variables de entorno

```bash
export LD_LIBRARY_PATH=./bin-llama/llama-b9025:$LD_LIBRARY_PATH
export GGML_VULKAN_CHECK_RESULTS=0
export GGML_VULKAN_DEBUG=0
```

---

### 3a. Modo TEXTO — Puerto 8081

Usa **E2B** (rápido) o **E4B** (más capacidad).

#### E2B (recomendado — 42 t/s generación):

```bash
./bin-llama/llama-b9025/llama-server \
  -m models/gemma-4-E2B-it-UD-Q4_K_XL.gguf \
  --host 0.0.0.0 --port 8081 \
  -t 16 -c 8192 -ngl 999 \
  -b 2048 -ub 512 \
  --cache-type-k f16 --cache-type-v f16 \
  --flash-attn on \
  --jinja
```

#### E4B (mayor capacidad — 22 t/s generación):

```bash
./bin-llama/llama-b9025/llama-server \
  -m models/gemma-4-E4B-it-UD-Q4_K_XL.gguf \
  --host 0.0.0.0 --port 8081 \
  -t 16 -c 8192 -ngl 999 \
  -b 2048 -ub 512 \
  --cache-type-k f16 --cache-type-v f16 \
  --flash-attn on \
  --jinja
```

---

### 3b. Modo IMAGEN — Puerto 8082

Usa **E2B + mmproj**. La imagen se envía como base64 en el JSON de la API.

```bash
./bin-llama/llama-b9025/llama-server \
  -m models/gemma-4-E2B-it-UD-Q4_K_XL.gguf \
  --mmproj models/mmproj-BF16.gguf \
  --host 0.0.0.0 --port 8082 \
  -t 16 -c 8192 -ngl 999 \
  -b 2048 -ub 512 \
  --cache-type-k f16 --cache-type-v f16 \
  --flash-attn on \
  --jinja
```

---

### 3c. Modo AUDIO (Speech-to-Text) — Puerto 8083

Usa **E2B + mmproj**. El audio se envía como base64 en el JSON de la API.

```bash
./bin-llama/llama-b9025/llama-server \
  -m models/gemma-4-E2B-it-UD-Q4_K_XL.gguf \
  --mmproj models/mmproj-BF16.gguf \
  --host 0.0.0.0 --port 8083 \
  -t 16 -c 8192 -ngl 999 \
  -b 2048 -ub 512 \
  --cache-type-k f16 --cache-type-v f16 \
  --flash-attn on \
  --jinja
```

---

## 4. Consumir la API — OpenAI-Compatible

Todos los endpoints siguen el estándar OpenAI. Apuntas el SDK a `http://localhost:{PUERTO}/v1`.

### Endpoints disponibles

| Endpoint | Descripción |
|----------|-------------|
| `POST /v1/chat/completions` | Chat con mensajes (texto, imagen, audio) |
| `POST /v1/completions` | Completions simples |
| `POST /v1/embeddings` | Embeddings |
| `GET /v1/models` | Info del modelo cargado |
| `GET /health` | Health check |

### Verificar capacidades del servidor

```bash
# Ver si el servidor soporta multimodal
curl http://localhost:8082/v1/models | jq '.data[0].capabilities'
# Debe incluir "multimodal" cuando mmproj está cargado

# Health check
curl http://localhost:8081/health
```

---

### 4a. Consumir TEXTO (curl)

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer no-key" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "system", "content": "Eres un asistente útil."},
      {"role": "user", "content": "Explica la fotosíntesis en 3 líneas."}
    ],
    "temperature": 0.7,
    "max_tokens": 512
  }'
```

### 4b. Consumir IMAGEN (curl con base64)

```bash
# Codificar imagen a base64
IMAGE_B64=$(base64 -w0 foto.jpg)

curl http://localhost:8082/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer no-key" \
  -d "{
    \"model\": \"gpt-3.5-turbo\",
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": [
          {\"type\": \"text\", \"text\": \"Describe esta imagen:\"},
          {
            \"type\": \"image_url\",
            \"image_url\": {
              \"url\": \"data:image/jpeg;base64,${IMAGE_B64}\"
            }
          }
        ]
      }
    ]
  }"
```

### 4c. Consumir AUDIO / SST (curl con base64)

```bash
# Codificar audio a base64
AUDIO_B64=$(base64 -w0 grabacion.wav)

curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer no-key" \
  -d "{
    \"model\": \"gpt-3.5-turbo\",
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": [
          {\"type\": \"text\", \"text\": \"Transcribe el siguiente audio:\"},
          {
            \"type\": \"image_url\",
            \"image_url\": {
              \"url\": \"data:audio/wav;base64,${AUDIO_B64}\"
            }
          }
        ]
      }
    ]
  }"
```

> **Nota**: El endpoint `/v1/chat/completions` usa `image_url` tanto para imágenes como para audio. El tipo MIME en el data URI indica al servidor si es imagen o audio.

---

### 4d. Consumir con SDK OpenAI (Python)

```python
import openai
import base64

# Configurar cliente local
client = openai.OpenAI(
    base_url="http://localhost:8081/v1",
    api_key="sk-no-key-required"
)

# --- TEXTO ---
response = client.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[
        {"role": "system", "content": "Eres un asistente útil."},
        {"role": "user", "content": "Hola, ¿cómo estás?"}
    ]
)
print(response.choices[0].message.content)

# --- IMAGEN (apuntar al puerto 8082) ---
client_img = openai.OpenAI(
    base_url="http://localhost:8082/v1",
    api_key="sk-no-key-required"
)

with open("foto.jpg", "rb") as f:
    image_b64 = base64.b64encode(f.read()).decode()

response = client_img.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe esta imagen:"},
            {"type": "image_url", "image_url": {
                "url": f"data:image/jpeg;base64,{image_b64}"
            }}
        ]
    }]
)
print(response.choices[0].message.content)

# --- AUDIO / SST (apuntar al puerto 8083) ---
client_audio = openai.OpenAI(
    base_url="http://localhost:8083/v1",
    api_key="sk-no-key-required"
)

with open("grabacion.wav", "rb") as f:
    audio_b64 = base64.b64encode(f.read()).decode()

response = client_audio.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Transcribe este audio:"},
            {"type": "image_url", "image_url": {
                "url": f"data:audio/wav;base64,{audio_b64}"
            }}
        ]
    }]
)
print(response.choices[0].message.content)
```

---

### 4e. Consumir con SDK OpenAI (JavaScript / Bun)

```typescript
import OpenAI from "openai";
import { readFileSync } from "fs";

// TEXTO
const client = new OpenAI({
  baseURL: "http://localhost:8081/v1",
  apiKey: "sk-no-key-required",
});

const response = await client.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [
    { role: "system", content: "Eres un asistente útil." },
    { role: "user", content: "Hola, ¿cómo estás?" },
  ],
});
console.log(response.choices[0].message.content);

// IMAGEN (puerto 8082)
const clientImg = new OpenAI({
  baseURL: "http://localhost:8082/v1",
  apiKey: "sk-no-key-required",
});

const imageB64 = readFileSync("foto.jpg").toString("base64");

const imgResponse = await clientImg.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Describe esta imagen:" },
      { type: "image_url", image_url: {
        url: `data:image/jpeg;base64,${imageB64}`
      }},
    ],
  }],
});
console.log(imgResponse.choices[0].message.content);

// AUDIO / SST (puerto 8083)
const clientAudio = new OpenAI({
  baseURL: "http://localhost:8083/v1",
  apiKey: "sk-no-key-required",
});

const audioB64 = readFileSync("grabacion.wav").toString("base64");

const audioResponse = await clientAudio.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Transcribe este audio:" },
      { type: "image_url", image_url: {
        url: `data:audio/wav;base64,${audioB64}`
      }},
    ],
  }],
});
console.log(audioResponse.choices[0].message.content);
```

---

### 4f. Function Calling / Tools

El servidor soporta function calling con el flag `--jinja` (ya incluido en los comandos de arriba).

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "¿Qué tiempo hace en Madrid?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Obtiene el clima de una ciudad",
          "parameters": {
            "type": "object",
            "properties": {
              "city": {"type": "string", "description": "Nombre de la ciudad"}
            },
            "required": ["city"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

> **Nota**: Gemma 4 no tiene template nativo de tools. Se usa el formato genérico via Jinja. Para mejores resultados con tools, considerar `--chat-template chatml`.

---

### 4g. Streaming

Agregar `"stream": true` a cualquier request:

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Cuenta un cuento corto"}],
    "stream": true
  }'
```

En el SDK:

```typescript
const stream = await client.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{ role: "user", content: "Cuenta un cuento corto" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

---

## 5. Resumen de Configuraciones por Modo

| Modo | Puerto | Modelo | mmproj | Tipo de input | Rendimiento (gen) |
|------|--------|--------|--------|---------------|-------------------|
| Texto (E2B) | 8081 | E2B Q4_K_XL | ❌ | Solo texto | ~42 t/s |
| Texto (E4B) | 8081 | E4B Q4_K_XL | ❌ | Solo texto | ~22 t/s |
| Imagen | 8082 | E2B Q4_K_XL | ✅ | Texto + imagen base64 | Variable* |
| Audio/SST | 8083 | E2B Q4_K_XL | ✅ | Texto + audio base64 | Variable* |

*La velocidad de generación con multimodal depende del tamaño de la imagen/audio procesada.

---

## 6. Scripts de Inicio Rápido

Todos los scripts autodetectan el directorio de binarios instalado por `install-llama.sh`.

### `serve-texto.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Autodetectar directorio de binarios
BIN_DIR=$(ls -d "${SCRIPT_DIR}"/bin-llama/llama-b9* 2>/dev/null | head -1)
[[ -z "$BIN_DIR" ]] && { echo "Error: ejecuta ./install-llama.sh primero"; exit 1; }
export LD_LIBRARY_PATH="${BIN_DIR}:$LD_LIBRARY_PATH"

MODEL="${1:-E2B}"

case "$MODEL" in
  E2B) MODEL_FILE="gemma-4-E2B-it-UD-Q4_K_XL.gguf" ;;
  E4B) MODEL_FILE="gemma-4-E4B-it-UD-Q4_K_XL.gguf" ;;
  *)   echo "Uso: $0 [E2B|E4B]"; exit 1 ;;
esac

exec "${BIN_DIR}/llama-server" \
  -m "${SCRIPT_DIR}/models/${MODEL_FILE}" \
  --host 0.0.0.0 --port 8081 \
  -t $(nproc) -c 8192 -ngl 999 \
  -b 2048 -ub 512 \
  --cache-type-k f16 --cache-type-v f16 \
  --flash-attn on \
  --jinja
```

### `serve-imagen.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN_DIR=$(ls -d "${SCRIPT_DIR}"/bin-llama/llama-b9* 2>/dev/null | head -1)
[[ -z "$BIN_DIR" ]] && { echo "Error: ejecuta ./install-llama.sh primero"; exit 1; }
export LD_LIBRARY_PATH="${BIN_DIR}:$LD_LIBRARY_PATH"

exec "${BIN_DIR}/llama-server" \
  -m "${SCRIPT_DIR}/models/gemma-4-E2B-it-UD-Q4_K_XL.gguf" \
  --mmproj "${SCRIPT_DIR}/models/mmproj-BF16.gguf" \
  --host 0.0.0.0 --port 8082 \
  -t $(nproc) -c 8192 -ngl 999 \
  -b 2048 -ub 512 \
  --cache-type-k f16 --cache-type-v f16 \
  --flash-attn on \
  --jinja
```

### `serve-audio.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN_DIR=$(ls -d "${SCRIPT_DIR}"/bin-llama/llama-b9* 2>/dev/null | head -1)
[[ -z "$BIN_DIR" ]] && { echo "Error: ejecuta ./install-llama.sh primero"; exit 1; }
export LD_LIBRARY_PATH="${BIN_DIR}:$LD_LIBRARY_PATH"

exec "${BIN_DIR}/llama-server" \
  -m "${SCRIPT_DIR}/models/gemma-4-E2B-it-UD-Q4_K_XL.gguf" \
  --mmproj "${SCRIPT_DIR}/models/mmproj-BF16.gguf" \
  --host 0.0.0.0 --port 8083 \
  -t $(nproc) -c 8192 -ngl 999 \
  -b 2048 -ub 512 \
  --cache-type-k f16 --cache-type-v f16 \
  --flash-attn on \
  --jinja
```

### Uso

```bash
chmod +x serve-texto.sh serve-imagen.sh serve-audio.sh

# Levantar servidor de texto (E2B por defecto)
./serve-texto.sh

# Levantar servidor de texto con E4B
./serve-texto.sh E4B

# Levantar servidor de imagen
./serve-imagen.sh

# Levantar servidor de audio
./serve-audio.sh
```

---

## 7. Web UI

`llama-server` incluye una Web UI embebida. Acceder en:

- Texto: http://localhost:8081
- Imagen: http://localhost:8082
- Audio: http://localhost:8083

La UI permite chatear directamente con el modelo, enviar imágenes y ver respuestas en tiempo real.

---

## 8. Benchmark de Referencia

Resultados con binario oficial b9025, Vulkan, Ryzen 9 6900HX (680M iGPU):

| Modelo | Cache | Prompt pp512 | Gen tg128 |
|--------|-------|-------------|-----------|
| E2B Q4_K_XL | f16 | 797 t/s | 42 t/s |
| E2B Q4_K_XL | q8_0 | 766 t/s | 40 t/s |
| E2B Q4_K_XL | q4_0 | 750 t/s | 39 t/s |
| E4B Q4_K_XL | f16 | 404 t/s | 23 t/s |
| E4B Q4_K_XL | q8_0 | 381 t/s | 21 t/s |

**Configuración óptima: cache f16** (más rápido en generación y prompt).
**turbo3/turbo4**: No soportados en el binario oficial. turbo4 crashea en Vulkan.

---

## 9. Notas Importantes

- **Solo 1 servidor a la vez**: Los 3 modos comparten la VRAM de la GPU. No es posible correr E2B y E4B simultáneamente en una 680M.
- **El campo `model` en la API puede ser cualquier string**: El servidor siempre usa el modelo con el que se inició. `"gpt-3.5-turbo"` es un placeholder válido.
- **Formatos de audio soportados**: WAV, MP3, FLAC (codificados en base64).
- **Formatos de imagen soportados**: JPG, PNG, WEBP, GIF (codificados en base64).
- **`--jinja` es requerido para function calling**: Sin este flag, las tools no funcionan.
- **`--tools all`**: Habilita tools nativas del servidor (lectura de archivos, ejecución de comandos). Usar solo en entornos de confianza.
