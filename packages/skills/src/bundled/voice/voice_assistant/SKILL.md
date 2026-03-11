---
name: voice_assistant
description: "Full voice-to-voice interaction: transcribe user speech, process request, and respond with synthesized speech"
version: 1.0.0
author: Hive Team
icon: "🎙️🔊"
category: voice
permissions:
  - voice_transcribe
  - voice_speak
dependencies: []
tools: [voice_transcribe, voice_speak]

# Structured skill fields
triggers:
  - "modo voz"
  - "voice mode"
  - "asistente de voz"
  - "voice assistant"
  - "hablá conmigo"
  - "talk to me"
  - "interacción por voz"
  - "voice interaction"
  - "respuesta hablada"
  - "spoken response"
  - "comando de voz"
  - "voice command"
  - "diálogo por voz"
  - "voice dialogue"

preferred_agents: []

steps:
  - step: 1
    action: voice_transcribe
    instruction: "Transcribe user's voice input to text"
    params:
      audio: "user audio input"
    output: user_text

  - step: 2
    action: process_request
    instruction: "Process transcribed text and generate appropriate response"
    params:
      text: "transcribed user request"
    output: response_text

  - step: 3
    action: voice_speak
    instruction: "Synthesize response text to speech"
    params:
      text: "response text"
      voice_id: "configured voice"
    output: response_audio

  - step: 4
    action: deliver_response
    instruction: "Send synthesized speech back to user"
    output: delivered

rules:
  - "Maintain conversation context across voice exchanges"
  - "Keep responses concise for voice (avoid long paragraphs)"
  - "Use natural, conversational tone optimized for speech"
  - "Handle interruptions gracefully (if streaming supported)"
  - "Indicate when processing (typing indicators, sounds)"
  - "Fallback to text if voice fails at any step"

output_format:
  structure: audio_with_text
  sections:
    - "audio_response"
    - "text_fallback"
    - "conversation_context"
  max_length: "Short, natural speech responses (30-60 seconds max)"

examples:
  - user_input: "[audio] ¿Cuál es el clima hoy?"
    expected_behavior: "Transcribe → process weather query → respond with voice synthesis"

  - user_input: "[audio] Contame un chiste"
    expected_behavior: "Transcribe → generate joke → speak response with appropriate timing"

  - user_input: "activá el modo voz"
    expected_behavior: "Enable voice mode → all future responses include audio synthesis"
---

# Voice Assistant Skill

## Cuándo se Activa

Esta skill se activa para interacción completa voz a voz: el usuario habla, el asistente procesa y responde con voz.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `voice_transcribe` | Audio → texto | Input del usuario |
| `voice_speak` | Texto → audio | Respuesta del asistente |

## Workflow

### Voice-to-Voice
```javascript
// 1. Usuario habla
const userAudio = receiveAudio()

// 2. Transcribir
const userText = voice_transcribe({
  audio: userAudio,
  language: "auto"
})
// → "¿Cuál es el clima hoy?"

// 3. Procesar request
// - Entender intención
// - Ejecutar acción (ej. consultar API clima)
// - Generar respuesta
const responseText = "Hoy hay 25 grados y soleado en Buenos Aires"

// 4. Sintetizar respuesta
const responseAudio = voice_speak({
  text: responseText,
  voice_id: "eleven_flash_v2_5",
  language: "es"
})

// 5. Enviar audio
sendAudio(responseAudio)
```

## Casos de Uso

| Caso | Flujo |
|------|-------|
| Pregunta simple | Transcribe → responde → sintetiza |
| Comando | Transcribe → ejecuta → confirma por voz |
| Diálogo | Mantener contexto entre exchanges |
| Wake word | Escuchar "hey bee" → activar → procesar |

## Configuración

### Wake Word
```json
{
  "voice_wake_word": "hey bee",
  "voice_wake_enabled": true
}
```

### Canal Voice
```json
{
  "voice_enabled": true,
  "tts_enabled": true,
  "stt_provider": "groq-whisper",
  "tts_provider": "elevenlabs",
  "tts_voice_id": "eleven_flash_v2_5"
}
```

## Mejores Prácticas

- Respuestas cortas y naturales (<60s)
- Mantener contexto conversacional
- Indicadores de procesamiento
- Fallback a texto si falla voz

## Errores a Evitar

- ❌ Respuestas muy largas para audio
- ❌ Perder contexto entre exchanges
- ❌ No indicar que está procesando
- ❌ No tener fallback si falla TTS/STT
