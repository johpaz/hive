# @johpaz/hive-tts

Síntesis de voz **local y offline** para Hive, basada en [Piper TTS](https://github.com/rhasspy/piper).

## ¿Cuándo usarlo?

Este paquete es un **fallback opcional**. Hive usa primero los providers de voz configurados (ElevenLabs, OpenAI TTS, etc.). Este módulo se activa cuando:

- No hay conexión a internet
- No hay providers de voz configurados
- El usuario prefiere procesamiento 100% local y privado
- `packages/hivelearn` necesita generar archivos de audio narrados en el servidor (descargables, pre-generados para canales no-browser como Telegram/Discord)

> **Nota:** En el browser, `packages/hivelearn` usa Web Speech API para reproducción interactiva. Este paquete es el complemento **server-side** para generación de archivos WAV.

## Instalación

```bash
bun add @johpaz/hive-tts
```

El postinstall descarga automáticamente:
- Binario de Piper (~8MB) para tu plataforma (Linux/Windows/macOS)
- Modelo de voz español `es_ES-sharvard-medium` (~60MB)

Solo se descarga una vez. Si falla por falta de internet, reintenta con:

```bash
bun run packages/tts/src/install.ts
```

## Uso

### Iniciar el servidor TTS

```bash
bun run packages/tts/src/server.ts
# Puerto custom:
TTS_PORT=5501 bun run packages/tts/src/server.ts
```

### Desde packages/hivelearn

```typescript
import { isTTSAvailable, synthesizeToFile } from "@johpaz/hive-tts/client"

if (await isTTSAvailable()) {
  await synthesizeToFile(
    "Bienvenido al módulo de álgebra lineal.",
    "./lessons/intro.wav"
  )
}
```

### API HTTP directa

```bash
# Health check
curl http://localhost:5500/health

# Generar audio
curl -X POST http://localhost:5500/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hive está procesando tu solicitud."}' \
  --output audio.wav

# Reproducir (Linux)
aplay audio.wav
```

## Variables de entorno

| Variable   | Default                 | Descripción              |
|------------|-------------------------|--------------------------|
| `TTS_PORT` | `5500`                  | Puerto del servidor HTTP |
| `TTS_VOICE`| `es_ES-sharvard-medium` | Voz por defecto          |
| `TTS_URL`  | `http://localhost:5500` | URL para el cliente      |

## Plataformas soportadas

| Plataforma | Arquitectura | Estado      |
|------------|-------------|-------------|
| Linux      | x64         | ✅ Testeado  |
| Linux      | arm64       | ✅ Soportado |
| Windows    | x64         | ✅ Soportado |
| macOS      | x64 (Intel) | ✅ Soportado |
| macOS      | arm64 (M*)  | ✅ Soportado |

## Voces adicionales

Para instalar más voces, descargar manualmente desde:
https://huggingface.co/rhasspy/piper-voices

Colocar los archivos `.onnx` y `.onnx.json` en `packages/tts/voices/`.
