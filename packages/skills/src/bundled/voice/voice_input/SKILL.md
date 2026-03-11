---
name: voice_input
description: "Transcribe audio input to text using STT (Speech-to-Text) providers like Groq Whisper or OpenAI Whisper"
version: 1.0.0
author: Hive Team
icon: "🎙️"
category: voice
permissions:
  - voice_transcribe
dependencies: []
tools: [voice_transcribe]

# Structured skill fields
triggers:
  - "transcribí este audio"
  - "transcribe audio"
  - "convertí voz a texto"
  - "convert voice to text"
  - "qué dice el audio"
  - "what does audio say"
  - "escuchá esto"
  - "listen to this"
  - "audio a texto"
  - "audio to text"
  - "reconocimiento de voz"
  - "speech recognition"
  - "nota de voz"
  - "voice note"

preferred_agents: []

steps:
  - step: 1
    action: receive_audio
    instruction: "Receive audio file or stream from user"
    params:
      source: "file upload | voice message | stream"
    output: audio_data

  - step: 2
    action: voice_transcribe
    instruction: "Send audio to STT provider for transcription"
    params:
      audio: "audio buffer or file path"
      language: "auto-detect or specified"
    output: transcription

  - step: 3
    action: synthesize
    instruction: "Format transcription with punctuation and structure"
    output: formatted_text

  - step: 4
    action: deliver_result
    instruction: "Return transcription to user"
    output: delivered

rules:
  - "Auto-detect language when not specified"
  - "Add punctuation and capitalization for readability"
  - "Indicate speaker changes if multi-speaker audio"
  - "Mark unclear segments with [inaudible] or [unclear]"
  - "Preserve original language unless translation requested"
  - "Handle background noise gracefully — note if affects quality"

output_format:
  structure: markdown
  sections:
    - "transcription"
    - "language_detected"
    - "duration"
    - "confidence"
    - "notes"
  max_length: "Full transcription with timestamps if long"

examples:
  - user_input: "[envía audio] transcribí esto"
    expected_behavior: "voice_transcribe → return text transcription with punctuation"

  - user_input: "convertí esta nota de voz a texto"
    expected_behavior: "voice_transcribe → return formatted transcription"

  - user_input: "qué dice este audio"
    expected_behavior: "voice_transcribe → summarize if very long, full transcription if short"
---

# Voice Input Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario envía audio y necesita transcripción a texto: notas de voz, grabaciones, comandos de voz.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `voice_transcribe` | Convierte audio → texto | Transcripción de cualquier audio |

## Workflow

### Transcripción
```javascript
// 1. Recibir audio
// - File upload
// - Voice message (Telegram, WhatsApp)
// - Stream en vivo

// 2. Transcribir
const result = voice_transcribe({
  audio: audioBuffer,
  language: "es"  // o "auto" para detectar
})

// 3. Formatear
// - Agregar puntuación
// - Capitalizar
// - Marcar speakers si hay múltiples

// 4. Entregar resultado
```

## Proveedores STT Soportados

| Provider | Modelos | Idiomas |
|----------|---------|---------|
| Groq | whisper-large-v3, turbo | Multi |
| OpenAI | whisper-1 | Multi |

## Configuración por Canal

Cada canal puede configurar su proveedor STT preferido:
- `stt_provider`: "groq-whisper" | "openai-whisper"

## Mejores Prácticas

- Detectar idioma automáticamente
- Agregar puntuación para legibilidad
- Marcar segmentos inaudibles
- Preservar idioma original

## Errores a Evitar

- ❌ Traducir sin pedir (mantener idioma)
- ❌ Omitir puntuación
- ❌ No indicar baja confianza
- ❌ Ignorar ruido de fondo que afecta calidad
