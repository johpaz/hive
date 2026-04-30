---
name: meeting_transcription
description: "Transcribir reuniones en tiempo real y generar informes gerenciales con decisiones, action items y próximos pasos"
version: 1.0.0
author: Hive Team
icon: "🎙️📋"
category: meeting
permissions:
  - meeting_start
  - meeting_add_segment
  - meeting_stop
  - meeting_report
  - office_escribir_docx
  - notify
  - report_progress
dependencies: []
tools:
  - meeting_start
  - meeting_add_segment
  - meeting_stop
  - meeting_report
  - office_escribir_docx
  - notify
  - report_progress

triggers:
  - "transcribir reunión"
  - "iniciar transcripción"
  - "meeting transcription"
  - "grabar reunión"
  - "iniciar reunión"
  - "start meeting"
  - "detener reunión"
  - "stop meeting"
  - "reporte de reunión"
  - "generar reporte reunión"
  - "informe de reunión"
  - "acta de reunión"
  - "transcripción de reunión"
  - "meeting report"

preferred_agents: []

steps:
  - step: 1
    action: meeting_start
    instruction: "Preguntar el título de la reunión si no fue indicado. Luego iniciar la sesión con meeting_start y comunicar el session_id al usuario."
    params:
      title: "Título indicado por el usuario"
      stt_model: "whisper-large-v3-turbo"
    output: session_id

  - step: 2
    action: meeting_add_segment
    instruction: "Por cada audio recibido del usuario, llamar meeting_add_segment con el session_id activo. Mostrar la transcripción en tiempo real con notify."
    params:
      session_id: "<session_id del paso 1>"
      audio_base64: "<audio del usuario>"
    output: transcript_segment

  - step: 3
    action: meeting_stop
    instruction: "Cuando el usuario indique que terminó la reunión, llamar meeting_stop con el session_id activo."
    params:
      session_id: "<session_id activo>"
    output: session_stopped

  - step: 4
    action: meeting_report
    instruction: "Obtener el transcript completo de la reunión para análisis."
    params:
      session_id: "<session_id>"
    output: transcript_data

  - step: 5
    action: llm_analysis
    instruction: |
      Analiza el transcript recibido y genera un INFORME GERENCIAL estructurado en español.
      El informe debe tener EXACTAMENTE estas secciones:

      ## Informe de Reunión: [Título]
      **Fecha:** [fecha actual]
      **Duración:** [duración]
      **Segmentos transcritos:** [número]

      ### 1. Resumen Ejecutivo
      [3-5 oraciones que capturen la esencia y resultado de la reunión]

      ### 2. Participantes Detectados
      [Lista de nombres o roles mencionados en el transcript]

      ### 3. Decisiones Tomadas
      [Lista numerada de cada decisión concreta adoptada]

      ### 4. Action Items
      | Tarea | Responsable | Fecha límite |
      |-------|-------------|--------------|
      [Una fila por cada tarea o compromiso asumido]

      ### 5. Próximos Pasos
      [Lista de acciones inmediatas post-reunión]

      ### 6. Temas de Seguimiento
      [Puntos que quedaron pendientes o requieren más discusión]
    output: report_markdown

  - step: 6
    action: office_escribir_docx
    instruction: "Guardar el informe como documento Word en el workspace del usuario."
    params:
      ruta: "informe_reunion_<session_id>.docx"
      titulo: "Informe de Reunión"
      parrafos: "<secciones del reporte>"
    output: docx_path

  - step: 7
    action: notify
    instruction: "Enviar el informe Markdown completo al chat y confirmar que el DOCX fue guardado."
    output: delivered

rules:
  - "Siempre confirmar el session_id activo antes de agregar segmentos"
  - "Usar notify para mostrar cada transcripción en tiempo real al usuario"
  - "Si no hay sesión activa al pedir un reporte, preguntar el session_id"
  - "El informe debe estar 100% en español"
  - "Las tablas de action items deben tener columnas: Tarea, Responsable, Fecha límite"
  - "Para sesiones con más de 30 segmentos, incluir resumen por bloques de tiempo"
  - "Si el transcript está vacío, informar al usuario y no generar el reporte"
  - "Siempre entregar el informe tanto en chat (Markdown) como en archivo DOCX"

output_format:
  structure: markdown_and_docx
  sections:
    - "resumen_ejecutivo"
    - "participantes"
    - "decisiones"
    - "action_items"
    - "proximos_pasos"
    - "seguimiento"

examples:
  - user_input: "transcribir reunión"
    expected_behavior: "Preguntar título → meeting_start → confirmar sesión iniciada con ID"

  - user_input: "detener reunión"
    expected_behavior: "meeting_stop → informar cantidad de segmentos → ofrecer generar reporte"

  - user_input: "genera el reporte de la reunión abc123"
    expected_behavior: "meeting_report → análisis LLM → office_escribir_docx → notify con Markdown completo"

  - user_input: "genera el informe de la reunión"
    expected_behavior: "Si hay sesión activa o reciente, usar ese ID. Si no, preguntar el session_id."
---

# Meeting Transcription Skill

## Cuándo se Activa

Esta skill se activa para gestión completa del ciclo de vida de una reunión: inicio, transcripción en tiempo real, detención y generación de informe gerencial.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `meeting_start` | Crea una sesión en DB → devuelve session_id | Al iniciar la reunión |
| `meeting_add_segment` | Transcribe un chunk de audio y lo persiste | Por cada audio recibido |
| `meeting_stop` | Marca la sesión como detenida | Cuando termina la reunión |
| `meeting_report` | Lee todos los segmentos y arma el transcript | Para generar el reporte |
| `office_escribir_docx` | Guarda el reporte como archivo Word | Al finalizar el análisis |
| `notify` | Envía mensajes en tiempo real al canal | Para mostrar transcripciones y el reporte |
| `report_progress` | Muestra progreso en barra | Durante transcripción larga |

## Workflow Completo

```
Usuario: "transcribir reunión"
  → Agente pregunta título
  → meeting_start(title) → session_id: "abc123"
  → Agente: "✅ Sesión abc123 iniciada. Habla cuando quieras."

[Usuario graba audio en la UI]
  → meeting_add_segment(session_id, audio_base64)
  → notify: "[Speaker]: Texto transcrito..."

Usuario: "detener reunión"
  → meeting_stop(session_id)
  → Agente: "⏹️ 47 segmentos transcritos. ¿Genero el reporte?"

Usuario: "sí"
  → meeting_report(session_id) → transcript completo
  → LLM analiza → secciones estructuradas
  → office_escribir_docx → informe_reunion_abc123.docx
  → notify: [Markdown del informe completo]
  → Agente: "✅ DOCX guardado en workspace."
```

## Formato del Informe Gerencial

El informe generado incluye:

1. **Resumen Ejecutivo** — Captura la esencia en 3-5 oraciones
2. **Participantes** — Detectados automáticamente del transcript
3. **Decisiones Tomadas** — Lista numerada de cada decisión
4. **Action Items** — Tabla con Tarea / Responsable / Fecha
5. **Próximos Pasos** — Acciones inmediatas
6. **Temas de Seguimiento** — Pendientes para futuras reuniones

## Consideraciones

- El informe se entrega en dos formatos: **Markdown en chat** + **DOCX descargable**
- El idioma del informe es siempre **español**
- La latencia de transcripción es ~4s por chunk de 3s de audio (normal para Whisper)
- El session_id debe conservarse durante toda la reunión
