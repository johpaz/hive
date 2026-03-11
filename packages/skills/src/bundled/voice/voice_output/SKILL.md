---
name: voice_output
description: "Convert text to synthesized speech using TTS (Text-to-Speech) providers like ElevenLabs, OpenAI TTS, or Gemini TTS"
version: 1.0.0
author: Hive Team
icon: "🔊"
category: voice
permissions:
  - voice_speak
dependencies: []
tools: [voice_speak]

# Structured skill fields
triggers:
  - "leé esto en voz alta"
  - "read this aloud"
  - "convertí a voz"
  - "convert to speech"
  - "hablá este texto"
  - "speak this text"
  - "texto a voz"
  - "text to speech"
  - "generá audio"
  - "generate audio"
  - "síntesis de voz"
  - "voice synthesis"
  - "escuchá la respuesta"
  - "listen to response"

preferred_agents: []

steps:
  - step: 1
    action: receive_text
    instruction: "Receive text content to convert to speech"
    params:
      text: "text to synthesize"
      language: "language code (es, en, etc.)"
    output: text_content

  - step: 2
    action: optimize_for_speech
    instruction: "Preprocess text for natural speech (expand abbreviations, handle special chars)"
    output: optimized_text

  - step: 3
    action: voice_speak
    instruction: "Send text to TTS provider for synthesis"
    params:
      text: "optimized text"
      voice_id: "configured voice ID"
      language: "language code"
    output: audio_buffer

  - step: 4
    action: deliver_audio
    instruction: "Return synthesized audio to user via channel"
    output: delivered

rules:
  - "Use configured TTS provider for channel (tts_provider config)"
  - "Respect user's voice preference if set (tts_voice_id)"
  - "Preprocess text: expand numbers, dates, abbreviations for natural speech"
  - "Handle SSML tags if present for prosody control"
  - "Split long text into chunks if exceeds provider limits"
  - "Cache frequently spoken responses to reduce API calls"

output_format:
  structure: audio
  sections:
    - "audio_file"
    - "duration"
    - "voice_used"
    - "language"
  max_length: "Audio attachment or file path"

examples:
  - user_input: "leé esta respuesta en voz alta"
    expected_behavior: "voice_speak → return audio file with synthesized speech"

  - user_input: "convertí este texto a audio"
    expected_behavior: "voice_speak → generate and return audio file"

  - user_input: "respondeme por voz"
    expected_behavior: "Generate response text → voice_speak → send audio"
---

# Voice Output Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita convertir texto a voz: leer respuestas, generar audio, síntesis de voz.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `voice_speak` | Convierte texto → audio | Síntesis de voz |

## Workflow

### Text-to-Speech
```javascript
// 1. Recibir texto
const text = "Hola, ¿cómo estás?"

// 2. Preprocesar
// - Expandir números: "5" → "cinco"
// - Expandir fechas: "01/01" → "primero de enero"
// - Expandir abbreviaturas: "Dr." → "Doctor"

// 3. Sintetizar
const audio = voice_speak({
  text: optimizedText,
  voice_id: "eleven_flash_v2_5",  // o configured voice
  language: "es"
})

// 4. Entregar audio
// - Enviar como archivo
// - Streaming si el canal lo soporta
```

## Proveedores TTS Soportados

| Provider | Modelos | Voces |
|----------|---------|-------|
| ElevenLabs | Flash V2.5, Turbo V2.5, Multilingual V2, V3 | 1000+ |
| OpenAI | tts-1, tts-1-hd, gpt-4o-mini-tts | 6+ |
| Gemini | 2.5 Flash TTS, 2.5 Pro TTS | Multi |
| Qwen | Qwen TTS Flash, Instruct | Multi |

## Configuración por Canal

Cada canal configura su proveedor TTS:
- `tts_provider`: "elevenlabs" | "openai-tts" | "gemini-tts"
- `tts_voice_id`: ID específico de voz (ej. ElevenLabs voice ID)

## Mejores Prácticas

- Preprocesar texto para naturalidad
- Usar voz configurada por usuario
- Cachear respuestas frecuentes
- Split de textos largos

## Errores a Evitar

- ❌ Enviar texto crudo sin preprocesar
- ❌ Ignorar preferencia de voz
- ❌ No manejar límites de longitud
- ❌ No cachear (costo API)
