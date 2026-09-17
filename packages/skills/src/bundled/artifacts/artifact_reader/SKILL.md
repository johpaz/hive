---
name: artifact_reader
description: "Leer archivos grandes que llegaron como artifact_ref: por tramos o buscando dentro, sin volcarlos enteros al contexto."
version: 1.0.0
author: Hive Team
icon: "📎"
category: artifacts
permissions:
  - artifact_read
dependencies: []
tools: [artifact_read, artifact_inspect]

# Structured skill fields
triggers:
  - "lee el archivo adjunto"
  - "read the attachment"
  - "qué dice el documento"
  - "what does the document say"
  - "busca en el archivo"
  - "search in the file"
  - "artifact_ref"
  - "el resultado quedó truncado"
  - "the result was truncated"
  - "sigue leyendo"
  - "keep reading"

preferred_agents: []

steps:
  - step: 1
    action: artifact_inspect
    instruction: "Ver tamaño y tipo antes de leer. Un artefacto de 2 MB no se lee entero: se busca dentro"
    params:
      artifactId: "id del artifact_ref"
    output: metadatos

  - step: 2
    action: artifact_read
    instruction: "Si se busca algo puntual, usar `search` — devuelve extractos alrededor de cada coincidencia y cuesta una fracción de paginar. Si hace falta el texto seguido, usar offset/limit"
    params:
      artifactId: "id del artefacto"
      search: "término a buscar (opcional)"
      offset: "desde qué carácter (opcional)"
      limit: "cuántos caracteres (opcional)"
    output: contenido

  - step: 3
    action: synthesize
    instruction: "Responder con lo encontrado, citando de dónde salió"
    output: respuesta

rules:
  - "**Buscar antes que paginar.** `search` devuelve extractos de todas las coincidencias en una sola llamada; paginar un archivo grande con offset/limit gasta varios turnos y llena el contexto con texto que no se necesitaba."
  - "`artifact_inspect` no devuelve contenido: sirve para decidir cómo leer sin gastar contexto en averiguarlo."
  - "Para continuar una lectura, usar el `next_offset` que devolvió la llamada anterior. No adivinar la posición."
  - "Un `artifact_ref` aparece cuando un resultado fue demasiado grande para el contexto. No es un error: es el archivo esperando a que lo leas por partes."

output_format:
  structure: markdown
  sections:
    - "lo encontrado"
    - "de qué parte del archivo salió"
  max_length: "Sólo lo relevante, nunca el archivo entero"

examples:
  - user_input: "busca 'error de conexión' en el log adjunto"
    expected_behavior: "artifact_read con search='error de conexión' — una llamada, no paginar"

  - user_input: "qué dice el documento"
    expected_behavior: "artifact_inspect para ver el tamaño → artifact_read del primer tramo → resumir"

  - user_input: "sigue leyendo"
    expected_behavior: "artifact_read con el next_offset de la llamada anterior"
---

# Artifact Reader Skill

## Cuándo se Activa

Cuando aparece un **`artifact_ref`**: un archivo, un adjunto o el resultado de
una tool que era demasiado grande para entrar en el contexto.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `artifact_inspect` | Tamaño, tipo MIME, integridad | Antes de leer, para decidir cómo |
| `artifact_read` | Contenido, por tramos o buscando | Para leer de verdad |

## Lo Que Hay Que Entender

**Un `artifact_ref` no es un error.** Es el mecanismo por el que un archivo
grande queda fuera de la ventana de contexto y a la vez disponible. El archivo
está entero; lo que cambia es que se lee a pedido en vez de entrar completo en
cada turno de la conversación.

**Buscar cuesta mucho menos que paginar.** `artifact_read` con `search` recorre
el archivo del lado del servidor y devuelve extractos de cada coincidencia con
su contexto alrededor. Paginar el mismo archivo con `offset`/`limit` gasta un
turno por tramo y mete en el contexto un montón de texto que no hacía falta.
Cuando se sabe qué se busca, se busca.

**Continuar es explícito.** Cada lectura devuelve `next_offset`. Ese es el valor
que se pasa para seguir — no se calcula a mano.
