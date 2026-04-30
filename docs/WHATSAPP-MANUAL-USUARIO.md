# Manual de Usuario: Canal WhatsApp

## Requisitos

- **Teléfono** con WhatsApp activo (versión estable, no Business requerido)
- **Hive** corriendo localmente o en servidor
- **Conexión a internet** en el servidor y en el teléfono
- Un número de WhatsApp dedicado al bot (se recomienda un número secundario)

---

## Advertencias Importantes

> **PROTOCOLO NO OFICIAL**: WhatsApp no provee una API pública para bots. Hive usa
> [Baileys](https://github.com/WhiskeySockets/Baileys), que emula WhatsApp Web. Esto significa
> que WhatsApp puede detectar el uso del cliente y **banear el número** sin previo aviso.
> Úsalo bajo tu propio riesgo, preferentemente con un número secundario.

> **SELF-MESSAGE**: El bot **solo responde a mensajes que el propio número se envía a sí mismo**.
> Abre WhatsApp, busca tu propio chat ("Mis mensajes" o "Yo") y escríbete ahí. El bot no responde
> mensajes de otros contactos a menos que hayas activado grupos y te escriban en uno.

> **SESIÓN PERSISTIDA**: Las credenciales de sesión se guardan en disco dentro de Hive. Si borras
> esos archivos tendrás que escanear el QR nuevamente. No compartas esos archivos.

---

## 1. Agregar el Canal WhatsApp

1. En Hive UI, ve a **Settings → Channels**
2. Haz clic en **"Add Channel"** y selecciona **WhatsApp**
3. Asigna un nombre descriptivo (ej. `whatsapp-bot`)
4. Haz clic en **"Save"** — el canal quedará en estado **Disconnected**

---

## 2. Conectar: Escanear el Código QR

1. En la tarjeta del canal, haz clic en **"Configure"**
2. En la sección **"Conexión"**, haz clic en **"Connect"**
3. El servidor generará un código QR — verás el QR en el panel (puede tardar 5-10 segundos)
4. Abre WhatsApp en tu teléfono → **Menú → Dispositivos vinculados → Vincular un dispositivo**
5. Escanea el QR
6. El estado cambiará a **Connected** en pocos segundos

**Si el QR expira** antes de escanearlo, haz clic en **"Refresh QR"** o desconecta y vuelve a conectar.

---

## 3. Probar la Conexión

1. En tu teléfono, abre el chat **"Mis mensajes"** (tu propio número)
2. Escribe un mensaje, por ejemplo: `Hola`
3. El agente debe responder en segundos
4. Si no responde, revisa los logs del servidor en busca de errores

---

## 4. Configurar Opciones de Baileys

Accede a **Settings → Channels → Configure** en la tarjeta de WhatsApp.

### Opciones disponibles

| Opción | Descripción | Valor por defecto |
|--------|-------------|-------------------|
| **Aceptar grupos** | Si está activo, el bot también procesa mensajes en grupos donde está el número | Desactivado |
| **Política de mensajes** | Controla quién puede interactuar con el bot | `open` |
| **Intentos de reconexión** | Cuántas veces intenta reconectarse automáticamente antes de detenerse | 10 |
| **Retraso base de reconexión** | Milisegundos de espera base entre reintentos (se va incrementando) | 5000 ms |

### Política de mensajes (`dmPolicy`)

| Valor | Comportamiento |
|-------|----------------|
| `open` | Cualquier mensaje al número activa el bot |
| `allowlist` | Solo números en la lista blanca pueden activar el bot |
| `denylist` | Números en lista negra son ignorados |

> **Nota**: `allowlist` y `denylist` requieren configuración adicional de la lista en el backend.
> Para la mayoría de usos, `open` es suficiente junto con el control de self-message.

### Guardar cambios

Haz clic en **"Save Configuration"** después de modificar cualquier opción. Los cambios
se aplican al reiniciar el canal (botón **"Disconnect"** → **"Connect"**).

---

## 5. Configurar Voz (STT / TTS)

En la tarjeta del canal, abre la pestaña **"Voice"**.

### Transcripción de audio entrante (STT)

El bot puede transcribir notas de voz que se envíen al número usando **Groq Whisper**
u **OpenAI Whisper**:

1. Activa **"Voice Enabled"**
2. Selecciona el proveedor STT (ej. `groq`)
3. Asegúrate de que el proveedor STT tenga su API key configurada en **Settings → Providers**
4. Guarda los cambios

Cuando alguien envíe una nota de voz, se transcribirá automáticamente y el texto resultante
se pasará al agente.

### Síntesis de voz saliente (TTS)

El bot puede responder con audio en lugar de texto:

1. Activa **"TTS Enabled"**
2. Selecciona el proveedor TTS y la voz deseada
3. Guarda los cambios

---

## 6. Reconexión Automática

Si la sesión se cae (por ejemplo, tu teléfono se reinicia o el servidor se reinicia),
Baileys intentará reconectarse automáticamente:

- Usa el valor de **"Intentos de reconexión"** como máximo
- Espera entre intentos = `retrasoBase * 2^intento` (backoff exponencial)
- Si agota los intentos, el canal queda en estado **Error** y debes reconectar manualmente

Para reconectar manualmente: **Configure → Disconnect → Connect**.

---

## 7. Archivos de Sesión

Las credenciales de sesión de Baileys se guardan en:

```
packages/core/sessions/whatsapp-<channelId>/
```

Estos archivos contienen las claves de cifrado de tu sesión WhatsApp. **No los compartas ni
los subas a un repositorio público.** Están incluidos en `.gitignore`.

Si quieres forzar una reconexión limpia (nuevo QR):

1. Desconecta el canal desde la UI
2. Elimina la carpeta de sesión correspondiente
3. Reconecta — se generará un QR nuevo

---

## Solución de Problemas

### El QR no aparece

- Verifica que el servidor Hive esté corriendo (`bun run dev` en `packages/core`)
- Revisa los logs: debe aparecer `[WhatsApp] QR code generated`
- Asegúrate de que el canal esté en estado **Disconnected** antes de intentar conectar

### El bot no responde mensajes

- Confirma que te estás escribiendo **a tu propio número** ("Mis mensajes")
- Verifica que el canal esté en estado **Connected** en la UI
- Revisa que el agente tenga configurado un modelo LLM válido

### "Error de conexión" o estado Error

- Puede ser un cierre de sesión por parte de WhatsApp (número baneado o sesión expirada)
- Intenta desconectar, borrar la carpeta de sesión y escanear un QR nuevo
- Si el problema persiste, el número puede haber sido restringido por WhatsApp

### Advertencias en los logs sobre `ws` y Bun

```
warn: ws.WebSocket 'upgrade' event not implemented in bun
```

Estos mensajes son **cosméticos** — no afectan el funcionamiento. Son advertencias de
compatibilidad entre el paquete `ws` (Node.js) y el runtime Bun. La conexión WebSocket
funciona correctamente.

### Las notas de voz no se transcriben

- Verifica que **"Voice Enabled"** esté activo en la tarjeta del canal
- Comprueba que el proveedor STT tenga API key válida en **Settings → Providers**
- Revisa los logs del servidor para errores de transcripción

---

## Flujo Completo de un Mensaje

```
Teléfono (self-message)
  → WhatsApp Web
    → Baileys (whatsapp.ts) — valida self-msg, descarga audio si corresponde
      → STT (Groq/OpenAI Whisper) si es nota de voz
        → Agent Loop (LLM + tools)
          → Respuesta de texto o audio (TTS)
            → WhatsApp Web → Tu teléfono
```
