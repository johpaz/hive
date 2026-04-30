# Hive v0.0.30 - Release Notes

## Release Date
2026-04-30

## Resumen Ejecutivo

Esta versión incluye cambios **mayoritarios** en la arquitectura del proyecto:

1. **Migración de HiveLearn**: El módulo educativo se separó como proyecto independiente en [github.com/johpaz/HiveLearn](https://github.com/johpaz/HiveLearn.git)
2. **Soporte Multimodal en Canales**: WhatsApp, Slack, Telegram y Discord ahora soportan imágenes, documentos y audio
3. **Transcripción de Reuniones**: Nueva funcionalidad completa para grabar y transcribir reuniones en tiempo real
4. **Mejoras en Agent Loop**: Soporte nativo para mensajes multimodales y descubrimiento dinámico de herramientas MCP
5. **Performance UI**: Bundle splitting reduce el chunk inicial en 94% (1.8MB → 107KB)

---

## 🚨 Cambios Mayores

### 1. Migración de HiveLearn a Repositorio Independiente

**HiveLearn** ahora es un proyecto standalone separado del monorepo principal de Hive.

**¿Qué cambia?**
- El paquete `packages/hivelearn` fue **eliminado** (128 archivos)
- Las páginas de UI relacionadas fueron removidas: `HiveLearnConfigPage`, `HiveLearnSessionsPage`, `HiveLearnSwarmPage`
- HiveLearn tiene su propio repositorio: https://github.com/johpaz/HiveLearn.git
- HiveLearn mantiene su propia versión, documentación y ciclo de releases

**Archivos eliminados del monorepo:**
- `packages/hivelearn/**/*` (todo el paquete: agentes, herramientas, skills, scheduler, persistencia)
- `packages/hive-ui/src/pages/HiveLearn*.tsx` (páginas de configuración y sesiones)

**Migración para usuarios existentes:**
```bash
# Si usabas HiveLearn, instálalo como paquete separado o clona el repo:
git clone https://github.com/johpaz/HiveLearn.git

# O usa HiveLearn como servicio externo compatible con Hive
```

---

## 🚀 Nuevas Funcionalidades

### 1. Transcripción de Reuniones en Tiempo Real

Nueva funcionalidad completa para grabar y transcribir reuniones directamente desde la interfaz:

- **Grabación en tiempo real**: captura de audio vía WebSocket (`/meeting-stream`), chunks enviados al backend para transcripción inmediata con Whisper
- **Sesiones persistentes**: tablas `meeting_sessions` + `meeting_segments` con soporte de múltiples oradores (`speaker`)
- **REST API**: `POST /api/meetings`, `GET /api/meetings`, `GET /api/meetings/:id`, `POST /api/meetings/:id/segments`, `POST /api/meetings/:id/stop`
- **4 nuevas tools de agente** (total: 66 → 70): `start_meeting`, `stop_meeting`, `add_meeting_segment`, `get_meeting_report`
- **Skill `meeting_transcription`**: permite a los agentes operar sesiones de reunión
- **Fix audio MIME**: extensión de archivo correcta por tipo (webm/m4a/mp3/wav/flac/ogg) — antes todo se enviaba como `.ogg` rompiendo la transcripción de audio WebM
- **UI**: página `/meeting` con `MeetingPanel`, `meetingStore` (Zustand), entrada en el sidebar

### 2. Sistema de Perfiles de Proveedor LLM

Nuevo sistema de compatibilidad que normaliza las diferencias entre APIs de distintos proveedores:

- **`ProviderProfile`**: flags configurables por proveedor — normalización de nombres de tools, `tool_choice`, `parallel_tool_calls`, strip de `additionalProperties`, retry sin tools
- **Perfiles definidos** para: openai, kimi, deepseek, groq, mistral, openrouter, nvidia, local-llama
- **Normalización de nombres de tools**: convierte nombres con caracteres inválidos al formato `[a-zA-Z0-9_-]{1,64}` requerido por OpenAI/Groq; desnormaliza en la respuesta de forma transparente
- **Retry automático sin tools**: reintenta la llamada sin tools cuando el proveedor responde 422 (kimi) o 400/422 (groq, openrouter), en lugar de fallar
- **Modelos sin soporte de tools** (`NO_TOOL_MODELS`): deepseek-r1 y variantes — tools suprimidas automáticamente
- **NVIDIA NIM** añadido como proveedor (`https://integrate.api.nvidia.com/v1`)

### 3. Soporte Multimodal en Canales 📸📄🎙️

Todos los canales de comunicación ahora soportan **imágenes, documentos y audio** de manera nativa.

#### WhatsApp (Baileys)
- **Soporte para grupos**: configuración `acceptGroups` para habilitar/deshabilitar mensajes grupales
- **Descarga de medios**: imágenes, documentos y audio se procesan automáticamente
- **Detección de teléfono**: muestra el número vinculado en la UI
- **Versión de WhatsApp Web**: se muestra en el estado de conexión
- **Patch Bun-ws**: fix para warnings de compatibilidad con `ws` en Bun
- **Mejoras en reconexión**: manejo robusto de desconexiones y reconexiones automáticas

#### Slack
- **Soporte multimodal completo**: unificación de manejo de mensajes en canales y DMs
- **Imágenes**: detección automática por tipo MIME y extensión
- **Documentos**: descarga vía `url_private` con nombre de archivo
- **Audio**: soporte para archivos .mp3, .wav, .ogg, .webm

#### Telegram
- **Imágenes con caption**: descarga automática de la foto más grande, uso del caption como texto
- **Documentos**: soporte completo con nombre de archivo y tipo MIME
- **Manejo de errores**: logs de advertencia si falla la descarga de medios

#### Discord
- **Imágenes adjuntas**: detección por tipo MIME y extensión (.jpg, .png, .gif, .webp)
- **Documentos**: archivos .pdf, .doc, .docx, .txt se procesan como documentos
- **Audio**: attachments de audio se transcriben automáticamente

#### Interfaz Base de Canales
- **Nuevos tipos en `IncomingMessage`**:
  ```typescript
  image?: { url?: string; base64?: string; buffer?: Buffer; mimeType?: string; caption?: string }
  document?: { url?: string; base64?: string; buffer?: Buffer; mimeType?: string; fileName?: string }
  ```

### 4. Mejoras en Agent Loop y LLM Providers 🤖

#### Agent Loop
- **Soporte para mensajes multimodales**: `userMessage` ahora acepta `string | ContentPart[]`
- **Extracción de texto para FTS5**: `rawUserMessage` para búsquedas en historial
- **Inyección dinámica de herramientas MCP**: descubrimiento y registro automático de herramientas MCP durante la ejecución
- **Trazas mejoradas**: logging detallado de inyección de herramientas con `full_name`, `id`, `tool_name`
- **Manejo de contexto multimodal**: `taskContext` también acepta `ContentPart[]`

#### LLM Providers
- **OpenAI Compatible**: mejoras en manejo de herramientas y retry
- **Anthropic**: actualizaciones de compatibilidad
- **Gemini**: mejoras en streaming
- **Ollama**: soporte para modelos locales
- **NVIDIA NIM**: nuevo proveedor añadido

---

## 📦 Archivos Nuevos/Creados

| Archivo | Descripción |
|--------|--------------|
| `packages/core/src/gateway/routes/meeting.ts` | CRUD y lógica de sesiones de reunión (232 líneas) |
| `packages/core/src/tools/meeting/index.ts` | 4 tools de agente para reuniones |
| `packages/hive-ui/src/modules/meeting/MeetingPanel.tsx` | UI principal de transcripción (456 líneas) |
| `packages/hive-ui/src/pages/MeetingPage.tsx` | Página `/meeting` |
| `packages/hive-ui/src/stores/meetingStore.ts` | Estado Zustand de reuniones (132 líneas) |
| `packages/skills/src/bundled/meeting/meeting_transcription/SKILL.md` | Skill de transcripción |
| `docs/MEETING-TRANSCRIPTION-MANUAL-USUARIO.md` | Manual de usuario de reuniones |

---

## 🔧 Archivos Modificados

### Core

| Paquete | Archivo | Cambio |
|---------|---------|--------|
| core | storage/schema.ts | +meeting_sessions, +meeting_segments (4 índices) |
| core | storage/sqlite.ts | Inicializa MEETING_SCHEMA |
| core | storage/onboarding.ts | Actualizaciones menores |
| core | storage/seed.ts | Actualizaciones menores |
| core | gateway/server.ts | WebSocket /meeting-stream + 5 rutas REST de reuniones |
| core | gateway/routes/channels.ts | Detalles de WhatsApp, mejoras en gestión |
| core | gateway/routes/voice.ts | Mejoras en manejo de audio |
| core | gateway/routes/agents.ts | Mejoras en configuración |
| core | gateway/routes/providers.ts | Actualizaciones de modelos |
| core | gateway/slash-commands.ts | Nuevos comandos |
| core | agent/agent-loop.ts | Soporte multimodal, inyección MCP dinámica |
| core | agent/llm-providers/interface.ts | ProviderProfile, PROVIDER_PROFILES, normalizeToolName, NO_TOOL_MODELS |
| core | agent/llm-providers/openai-compat.ts | Compatibilidad multi-proveedor, retry sin tools, desnormalización |
| core | agent/llm-providers/anthropic.ts | Actualizaciones |
| core | agent/llm-providers/gemini.ts | Actualizaciones |
| core | agent/llm-providers/ollama.ts | Actualizaciones |
| core | agent/providers/index.ts | Nuevos proveedores |
| core | agent/service.ts | Mejoras menores |
| core | agent/context-compiler.ts | Mejoras en contexto |
| core | agent/conversation-store.ts | Soporte multimodal |
| core | agent/llm-client.ts | Mejoras en clientes |
| core | agent/compaction.ts | Mejoras en compactación |
| core | channels/base.ts | Tipos `image` y `document` en `IncomingMessage` |
| core | channels/whatsapp.ts | Soporte grupos, multimedia, phone detection |
| core | channels/slack.ts | Soporte multimodal completo |
| core | channels/telegram.ts | Imágenes y documentos con descarga |
| core | channels/discord.ts | Imágenes y documentos adjuntos |
| core | channels/manager.ts | `getWhatsAppDetails()`, `acceptGroups` |
| core | tools/index.ts | Registro de 4 meeting tools (66 → 70 tools) |
| core | voice/index.ts | Extensión de archivo correcta por MIME type de audio |
| core | canvas/a2ui-tools.ts | Mejoras en herramientas A2UI |

### Hive UI

| Paquete | Archivo | Cambio |
|---------|---------|--------|
| hive-ui | App.tsx | Lazy loading de todas las páginas (code splitting) |
| hive-ui | vite.config.ts | manualChunks para vendors pesados |
| hive-ui | index.html | Actualizaciones |
| hive-ui | index.css | Refactorización de estilos |
| hive-ui | stores/useGlobalConfigStore.ts | Import estático de useLoaderStore |
| hive-ui | stores/useWebSocketStore.ts | Mejoras en WebSocket |
| hive-ui | stores/bridgeStore.ts | Actualizaciones |
| hive-ui | stores/projectsStore.ts | Actualizaciones |
| hive-ui | hooks/useAgents.ts | Mejoras en hooks |
| hive-ui | hooks/useChatStreaming.ts | Soporte multimodal |
| hive-ui | types/a2ui.ts | Tipos actualizados |
| hive-ui | types/channels.ts | Tipos multimodales |
| hive-ui | types/chat.ts | Tipos de chat |
| hive-ui | types/providers.ts | Tipos de proveedores |
| hive-ui | modules/layout/HiveSidebar.tsx | Entrada "Reuniones" en el nav |
| hive-ui | modules/layout/Header.tsx | Mejoras en header |
| hive-ui | modules/agents/AgentCreateForm.tsx | Mejoras en formulario |
| hive-ui | modules/agents/ModelSelector.tsx | Selector de modelos |
| hive-ui | modules/chat/ChatInput.tsx | Soporte para adjuntos |
| hive-ui | modules/chat/ChatMessage.tsx | Renderizado multimodal |
| hive-ui | modules/chat/ChatHistory.tsx | Historial de chat |
| hive-ui | modules/canvas/CanvasComponentMap.tsx | Componentes de canvas |
| hive-ui | modules/canvas/CanvasContainer.tsx | Contenedor de canvas |
| hive-ui | modules/canvas/a2ui/A2UIRenderer.tsx | Renderer A2UI |
| hive-ui | modules/providers/models/ModelCard.tsx | Cards de modelos |
| hive-ui | modules/providers/models/ModelSelector.tsx | Selector |
| hive-ui | modules/providers/models/ModelCapabilities.tsx | Capacidades |
| hive-ui | modules/agent-config/voice/VoiceProvidersPanel.tsx | Panel de voz |
| hive-ui | pages/DashboardPage.tsx | Dashboard |
| hive-ui | pages/ProvidersPage.tsx | Página de proveedores |
| hive-ui | pages/SettingsPage.tsx | Configuración |
| hive-ui | pages/SetupPage.tsx | Setup inicial |
| hive-ui | pages/WebChatPage.tsx | WebChat |
| hive-ui | pages/ProjectsPage.tsx | Proyectos |
| hive-ui | pages/ChannelsPage.tsx | Canales |
| hive-ui | components/ui/command.tsx | Componentes UI |
| hive-ui | components/ui/sidebar.tsx | Sidebar |
| hive-ui | components/UsageStatsPanel.tsx | Stats de uso |

---

## 🗑️ Archivos Eliminados

| Archivo | Razón |
|--------|-------|
| `packages/hivelearn/**/*` (128 archivos) | Migrado a repo independiente |
| `packages/hive-ui/src/pages/HiveLearnConfigPage.tsx` | HiveLearn migrado |
| `packages/hive-ui/src/pages/HiveLearnSessionsPage.tsx` | HiveLearn migrado |
| `packages/hive-ui/src/pages/HiveLearnSwarmPage.tsx` | HiveLearn migrado |
| `CHANGELOG-v0.0.29.md` | Consolidado en v0.0.30 |
| `.opencode/plans/webchat-fixes.md` | Plan completado |
| `.opencode/plans/webchat-modernization.md` | Plan completado |
| `hive.db` | Archivo local, no debe estar en repo |

---

## 🗄️ Migraciones de Base de Datos

| Versión | Descripción |
|---------|-------------|
| v0.0.30 | `meeting_sessions` + `meeting_segments` tables |

**Esquema de reuniones:**
```sql
CREATE TABLE meeting_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  user_id TEXT,
  title TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER
);

CREATE TABLE meeting_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  speaker TEXT,
  transcript TEXT,
  start_time INTEGER,
  end_time INTEGER,
  created_at INTEGER
);
```

---

## ⚡ Performance UI — Bundle Splitting

El bundle de la interfaz fue completamente reorganizado para eliminar el chunk monolítico inicial.

| Métrica | Antes | Después | Mejora |
|--------|-------|----------|--------|
| Chunk inicial (`index.js`) | 1,895 kB / gzip 520 kB | 107 kB / gzip 29 kB | **94% más pequeño** |
| Tiempo de build | — | 786 ms | — |
| Warning chunk > 500 kB | ✗ (1 chunk enorme) | ✅ ninguno | — |

**Cambios aplicados:**
- **Code splitting por ruta** (`React.lazy` + `Suspense`): cada página se descarga solo cuando el usuario la visita
- **Vendor chunks separados**: `@xyflow/react` (canvas), `recharts` (charts), `@radix-ui/*`, `@tanstack/react-query`, `react-router-dom` — cada uno cacheado independientemente
- **Fix `INEFFECTIVE_DYNAMIC_IMPORT`**: `useLoaderStore` pasó a import estático en `useGlobalConfigStore`, eliminando el warning de Rolldown

El usuario percibe carga inicial notablemente más rápida, especialmente en conexiones lentas o móvil.

---

## 📊 Estadísticas del Cambio

| Métrica | Cantidad |
|--------|----------|
| Archivos eliminados (HiveLearn) | 128 |
| Archivos eliminados (UI HiveLearn) | 3 |
| Archivos modificados (core) | ~40 |
| Archivos modificados (hive-ui) | ~50 |
| Nuevas tools de agente | 4 |
| Nuevas tablas de BD | 2 |
| Canales con soporte multimodal | 4 (WhatsApp, Slack, Telegram, Discord) |

---

## 🔑 Notas de Upgrade

### Para todos los usuarios

```bash
# Las tablas meeting_sessions y meeting_segments se crean automáticamente al iniciar Hive.
# No se requiere migración manual.
```

### Para usuarios de HiveLearn

Si utilizabas HiveLearn dentro del monorepo:

1. **Clona el nuevo repositorio**:
   ```bash
   git clone https://github.com/johpaz/HiveLearn.git
   cd HiveLearn
   bun install
   ```

2. **Configura HiveLearn como servicio externo**:
   - HiveLearn mantiene compatibilidad con Hive vía API
   - Configura la URL de HiveLearn en la sección de servicios externos de Hive

3. **Migra tus datos**:
   - Las sesiones y currículos existentes están en `hive.db`
   - HiveLearn incluye scripts de migración en su nuevo repositorio

### Para desarrolladores

```bash
# Actualiza dependencias
bun install

# Limpia cache de build
bun run clean

# Reconstruye
bun run build
```

---

## 🐛 Fixes Notables

- **Audio MIME en reuniones**: Los archivos de audio ahora usan la extensión correcta según su tipo (webm/m4a/mp3/wav/flac/ogg), arreglando la transcripción de audio WebM que fallaba antes
- **Warnings Bun en WhatsApp**: Patch para warnings de `ws` no implementados en Bun
- **Inyección de herramientas MCP**: Fix para herramientas MCP que no se registraban correctamente por nombres con espacios/caracteres especiales
- **Bundle UI**: Eliminación de warning `INEFFECTIVE_DYNAMIC_IMPORT` en Rolldown

---

## 📝 Cambios en README

- Actualización de estadísticas de líneas de código
- Mención de HiveLearn como proyecto separado
- Actualización de estructura del monorepo

---

## 🔗 Enlaces Relacionados

- **HiveLearn (nuevo repo)**: https://github.com/johpaz/HiveLearn.git
- **Issue tracker**: https://github.com/johpaz/hive/issues
- **Documentación principal**: https://github.com/johpaz/hive/tree/master/docs

---

**Versión anterior**: v0.0.29  
**Próxima versión**: v0.0.31 (en desarrollo)
