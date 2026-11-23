---
name: google_gmail
description: "Search, read, reply, send, draft, organize (read/star/archive/labels/trash) and handle attachments in the user's connected Gmail account"
version: 1.0.0
author: Hive Team
icon: "📧"
category: google
permissions:
  - internet_access
dependencies: []
tools: [gmail_search, gmail_read, gmail_thread, gmail_send, gmail_reply, gmail_forward, gmail_draft_save, gmail_draft_list, gmail_draft_send, gmail_draft_delete, gmail_modify, gmail_labels, gmail_attachment_download]

triggers:
  - "busca correos"
  - "correos sin leer"
  - "lee el correo"
  - "envía un correo"
  - "responde el correo"
  - "mi bandeja de entrada"
  - "marca como leído"
  - "archiva el correo"
  - "reenvía el correo"
  - "renombra la etiqueta"
  - "guarda un borrador"
  - "descarga el adjunto"
  - "gmail"

preferred_agents: [google_mail_agent]

steps:
  - step: 1
    action: gmail_search
    instruction: "Busca con la sintaxis de Gmail, lee solo los mensajes necesarios y, para enviar, muestra un preview y espera la aprobación del usuario."
    output: result

rules:
  - "Reenviar usa gmail_forward (incluye original y adjuntos) y requiere confirmación; borrar una etiqueta también"
  - "Para contestar usa gmail_reply (mantiene el hilo); gmail_send es solo para correos nuevos"
  - "Editar un borrador: gmail_read del borrador y gmail_draft_save con draft_id y todos los campos"
  - "gmail_modify es reversible y no pide confirmación; enviar y borrar borradores sí"
  - "Enviar correo es irreversible: siempre preview primero y confirmed=true solo tras aprobación"
  - "Nunca pegues el cuerpo completo de correos largos; resume y cita id, remitente y fecha"
  - "Si la cuenta no está conectada, indica conectar Google en Ajustes → Integraciones"

output_format:
  structure: markdown
  sections:
    - "resultado"
    - "siguiente_paso"
  max_length: "400 words"

examples:
  - user_input: "busca los correos sin leer de Ana"
    expected_behavior: "gmail_search({ query: 'from:ana is:unread' }) → lista con remitente, asunto y fecha"
---

# Gmail

## Cuándo se activa

Cuando el usuario pide buscar, leer o enviar correos de su cuenta de Gmail.
