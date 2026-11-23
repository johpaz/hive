---
name: google_drive
description: "Search, download/export and upload files in the user's Google Drive"
version: 1.0.0
author: Hive Team
icon: "🗂️"
category: google
permissions:
  - internet_access
dependencies: []
tools: [gdrive_search, gdrive_download, gdrive_upload]

triggers:
  - "busca en mi drive"
  - "abre el documento de google"
  - "descarga de drive"
  - "sube a drive"
  - "guarda en drive"
  - "google drive"

preferred_agents: [google_drive_agent]

steps:
  - step: 1
    action: gdrive_search
    instruction: "Busca el archivo, confirma el correcto por nombre y fecha, descarga o exporta lo necesario y sube siempre como archivo nuevo."
    output: result

rules:
  - "Nunca sobrescribas ni borres archivos de Drive"
  - "Docs se leen como texto y Sheets como CSV; Slides salen como PDF en un artifact"
  - "Usa artifact_id para subir archivos binarios ya generados en Hive"

output_format:
  structure: markdown
  sections:
    - "resultado"
    - "siguiente_paso"
  max_length: "400 words"

examples:
  - user_input: "busca el contrato de marzo en mi drive"
    expected_behavior: "gdrive_search({ query: 'contrato marzo' }) → gdrive_download del archivo elegido → resumen"
---

# Google Drive

## Cuándo se activa

Cuando el usuario quiere encontrar, leer o guardar archivos en Google Drive.
