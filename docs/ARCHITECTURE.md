# Hive Architecture Documentation

## Overview

Hive es un sistema de agente de IA personal que utiliza **SQLite como única fuente de verdad**. El sistema está diseñado alrededor de un **usuario único** cuyo `user_id` es la llave maestra para todas las consultas y configuraciones. El agente coordinador, identificado por `role = 'coordinator'`, es el núcleo que activa el **agent loop**.

---

## 1. Sistema de Usuario Único

### Concepto Fundamental

Hive opera bajo el modelo de **usuario único**. Esto significa:

- **Un solo usuario** es registrado durante el onboarding
- El `user_id` generado es la **llave primaria** que vincula todas las entidades del sistema
- Todas las configuraciones, agentes, canales y preferencias están asociadas a este `user_id`

### Generación del User ID

El `user_id` se genera automáticamente usando SQLite:

```sql
-- En packages/core/src/storage/schema.ts
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT,
  language TEXT,
  timezone TEXT,
  occupation TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Características:**
- **Formato**: UUID de 32 caracteres hexadecimales (16 bytes)
- **Generación**: `randomblob(16)` de SQLite + conversión a hex
- **Único**: Garantizado por la función criptográfica de SQLite

---

## 2. Proceso de Onboarding

El onboarding es un wizard de **8 pasos** que configura progresivamente el sistema.

### Ubicación del Código

- **CLI**: `packages/cli/src/commands/onboard.ts`
- **Storage**: `packages/core/src/storage/onboarding.ts`

### Flujo del Wizard

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: User Profile    → saveUserProfile()               │
│  Step 2: Agent Profile   → saveAgentConfig()               │
│  Step 3: Ethics          → activateEthics()                │
│  Step 4: Provider/Model  → saveProviderConfig()            │
│  Step 5: Voice           → saveVoiceConfig()               │
│  Step 6: Channel         → activateChannel()               │
│  Step 7: Code Bridge     → activateCodeBridge()            │
│  Step 8: Complete        → saveOnboardingProgress()        │
└─────────────────────────────────────────────────────────────┘
```

### Paso 1: Perfil de Usuario

```typescript
// packages/cli/src/commands/onboard.ts (línea ~890)
state.userId = saveUserProfile({
  userName: state.userName,
  userLanguage: state.userLanguage,
  userTimezone: state.userTimezone,
  userOccupation: state.userOccupation,
  userNotes: state.userNotes,
  channelUserId: state.sessionToken, // Para webchat user_identity
});
```

**Función `saveUserProfile()`** (`packages/core/src/storage/onboarding.ts`):

```typescript
export function saveUserProfile(data: {
  userId?: string;
  userName?: string;
  userLanguage?: string;
  userTimezone?: string;
  userOccupation?: string;
  userNotes?: string;
  agentName?: string;
  agentId?: string;
  agentDescription?: string;
  agentTone?: string;
  channelUserId?: string;
}): string {
  const db = getDb();
  let finalUserId = data.userId;

  // 1️⃣ Generar ID automáticamente si no se proporciona
  if (!finalUserId) {
    const result = db.query(`
      INSERT INTO users (name, language, timezone, occupation, notes)
      VALUES (?, ?, ?, ?, ?) RETURNING id
    `).get(
      data.userName || null,
      data.userLanguage || null,
      data.userTimezone || null,
      data.userOccupation || null,
      data.userNotes || null
    ) as { id: string };
    finalUserId = result.id;
  }

  // 2️⃣ Crear identidad para webchat
  if (data.channelUserId) {
    db.query(`
      INSERT OR REPLACE INTO user_identities (user_id, channel, channel_user_id)
      VALUES (?, 'webchat', ?)
    `).run(finalUserId, data.channelUserId);
  }

  return finalUserId;
}
```

**Datos persistidos:**
- `users`: nombre, idioma, timezone, ocupación, notas
- `user_identities`: mapeo `user_id` → `webchat` → `sessionToken`

### Paso 2: Perfil del Agente Coordinador

```typescript
// packages/cli/src/commands/onboard.ts (línea ~970)
state.agentId = saveAgentConfig({
  userId: state.userId,
  agentName: state.agentName,
  description: state.agentDescription,
  tone: state.agentTone,
  providerId: "",
  modelId: "",
});
```

**Función `saveAgentConfig()`** (`packages/core/src/storage/onboarding.ts`):

```typescript
export function saveAgentConfig(data: {
  userId: string;
  agentId?: string;
  agentName: string;
  providerId: string;
  modelId: string;
  tone: string;
  description?: string;
}): string {
  const db = getDb();
  const systemPrompt = buildAgentSystemPrompt(data.agentName, data.description, data.tone);

  // INSERT con auto-generación de ID
  if (!data.agentId) {
    const result = db.query(`
      INSERT INTO agents
        (user_id, name, description, tone, system_prompt, provider_id, model_id,
         status, role, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', 'coordinator', 1)
      RETURNING id
    `).get(
      data.userId,
      data.agentName,
      data.description || null,
      data.tone,
      systemPrompt,
      data.providerId || null,
      data.modelId || null
    ) as { id: string };
    finalAgentId = result.id;
  }

  return finalAgentId;
}
```

**System Prompt Generado:**

```typescript
function buildAgentSystemPrompt(name: string, description: string | undefined, tone: string): string {
  const toneGuide: Record<string, string> = {
    friendly:     "Sos cálido, cercano y empático...",
    professional: "Sos preciso, claro y formal...",
    direct:       "Sos conciso y al punto...",
    casual:       "Sos relajado e informal...",
  }

  const lines = [
    `Sos ${name}${description ? `, ${description}` : ""}.`,
    "",
    `TONO Y ESTILO:`,
    toneGuide[tone],
    "",
    `PRINCIPIOS:`,
    `- Siempre usá las herramientas disponibles...`,
    `- Confirmá acciones irreversibles...`,
  ]

  return lines.join("\n")
}
```

**Datos persistidos:**
- `agents`: `id` (auto-generado), `user_id`, `name`, `description`, `tone`, `system_prompt`, `role = 'coordinator'`

### Paso 3: Ética

```typescript
activateEthics(state.userId, "default");
```

**Función `activateEthics()`**:

```typescript
export function activateEthics(userId: string, ethicsId: string): void {
  const db = getDb();
  db.query(`UPDATE ethics SET active = 1 WHERE id = ?`).run(ethicsId);
  db.query(`UPDATE ethics SET active = 0 WHERE id != ?`).run(ethicsId);
}
```

### Paso 4: Proveedor y Modelo LLM

```typescript
await saveProviderConfig({
  userId: state.userId,
  provider: state.provider,  // ej: "gemini"
  model: state.model,        // ej: "gemini-2.5-flash"
  apiKey: state.apiKey,      // encriptada
  baseUrl: PROVIDER_BASE_URLS[state.provider],
});
```

**Función `saveProviderConfig()`**:

```typescript
export async function saveProviderConfig(data: {
  userId: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<void> {
  const db = getDb();

  // Encriptar API key
  let apiKeyEncrypted = null;
  let apiKeyIv = null;

  if (data.apiKey) {
    const encrypted = await encryptApiKey(data.apiKey);
    apiKeyEncrypted = encrypted.encrypted;
    apiKeyIv = encrypted.iv;
  }

  // Actualizar provider con API key encriptada
  db.query(`
    UPDATE providers SET
      api_key_encrypted = ?,
      api_key_iv = ?,
      base_url = ?,
      enabled = 1,
      active = 1
    WHERE id = ?
  `).run(apiKeyEncrypted, apiKeyIv, data.baseUrl || null, data.provider);

  // Activar modelo seleccionado
  db.query(`
    UPDATE models SET enabled = 1, active = 1
    WHERE id = ?
  `).run(data.model);
}
```

**Datos persistidos:**
- `providers`: `api_key_encrypted`, `api_key_iv`, `base_url`, `enabled = 1`, `active = 1`
- `models`: `enabled = 1`, `active = 1` para el modelo seleccionado

### Paso 5: Voz (Opcional)

```typescript
saveVoiceConfig({
  userId: state.userId,
  channelId: "webchat",
  voiceEnabled: true,
  sttProvider: "whisper-large-v3-turbo",
  ttsProvider: "eleven_flash_v2_5",
  sttApiKey: groqApiKey,
  ttsApiKey: elevenlabsApiKey,
});
```

**Datos persistidos:**
- `channels`: `voice_enabled`, `stt_provider`, `tts_provider`
- `providers`: API keys de STT/TTS encriptadas
- `models`: Activación de modelos de voz

### Paso 6: Canal de Comunicación

```typescript
activateChannel(state.userId, {
  channelId: "webchat",
  channelUserId: state.sessionToken,
  config: { botToken: "..." } // si aplica
});
```

**Función `activateChannel()`**:

```typescript
export async function activateChannel(userId: string, data: {
  channelId: string;
  channelUserId?: string;
  config?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();

  // Encriptar configuración del canal
  if (data.config && Object.keys(data.config).length > 0) {
    const encrypted = await encryptConfig(data.config);
    db.query(`
      UPDATE channels
      SET user_id = ?, active = 1, enabled = 1, status = 'connected',
          config_encrypted = ?, config_iv = ?
      WHERE id = ?
    `).run(userId, encrypted.encrypted, encrypted.iv, data.channelId);
  }

  // Crear user_identity
  if (data.channelUserId) {
    db.query(`
      INSERT OR REPLACE INTO user_identities (user_id, channel, channel_user_id)
      VALUES (?, ?, ?)
    `).run(userId, data.channelId, data.channelUserId);
  }
}
```

**Datos persistidos:**
- `channels`: `user_id`, `active = 1`, `enabled = 1`, `status = 'connected'`, `config_encrypted`
- `user_identities`: mapeo `user_id` → `channel` → `channel_user_id`

### Paso 7: Code Bridge (Opcional)

```typescript
activateCodeBridge(state.userId, [
  { id: "claude-code", enabled: true, port: 18791 },
  { id: "gemini-cli", enabled: false, port: 18792 },
]);
```

**Datos persistidos:**
- `code_bridge`: `enabled`, `active`, `port`, `user_id`

### Paso 8: Completado

```typescript
saveOnboardingProgress({
  step: "complete",
  userId: state.userId,
  data: { completed: true }
});
```

**Datos persistidos:**
- `onboarding_progress`: registro del paso completado

---

## 3. Esquema de Base de Datos

### Tablas Principales

#### `users` - Usuario Único

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name            TEXT,
  language        TEXT,
  timezone        TEXT,
  occupation      TEXT,
  notes           TEXT,
  master_key_hash TEXT,
  preferred_cron_channel TEXT NOT NULL DEFAULT 'auto',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Relaciones:**
- `agents.user_id` → `users.id`
- `user_identities.user_id` → `users.id`
- `user_channels.user_id` → `users.id`

#### `agents` - Agentes (incluye Coordinador)

```sql
CREATE TABLE agents (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  system_prompt   TEXT,
  tone            TEXT,
  role            TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator', 'worker')),
  status          TEXT NOT NULL DEFAULT 'idle',
  enabled         INTEGER NOT NULL DEFAULT 1,
  provider_id     TEXT REFERENCES providers(id),
  model_id        TEXT REFERENCES models(id),
  tools_json      TEXT,
  skills_json     TEXT,
  parent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
  max_iterations  INTEGER NOT NULL DEFAULT 10,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Campos Clave:**
- `role`: `'coordinator'` | `'worker'` - **ÚNICA forma de identificar al coordinador**
- `system_prompt`: Prompt generado dinámicamente
- `tools_json`: JSON array de tool IDs permitidos
- `skills_json`: JSON array de skill IDs permitidos

**Nota:** El campo `is_coordinator` fue eliminado. Ahora se usa exclusivamente `role = 'coordinator'`.

#### `user_identities` - Mapeo de Identidades por Canal

```sql
CREATE TABLE user_identities (
  user_id         TEXT NOT NULL REFERENCES users(id),
  channel         TEXT NOT NULL,  -- 'webchat', 'telegram', 'discord', etc.
  channel_user_id TEXT NOT NULL,  -- Token o ID específico del canal
  linked_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, channel)
);
```

**Propósito:**
- Permite que un mismo usuario tenga diferentes identidades en cada canal
- Ejemplo: `user_id` → `telegram` → `chat_id_de_telegram`

#### `providers` - Proveedores de LLM/STT/TTS

```sql
CREATE TABLE providers (
  id              TEXT PRIMARY KEY,  -- ej: "gemini", "openai", "elevenlabs"
  name            TEXT NOT NULL UNIQUE,
  api_key_encrypted TEXT,
  api_key_iv      TEXT,
  base_url        TEXT,
  category        TEXT NOT NULL DEFAULT 'llm',  -- 'llm', 'stt', 'tts'
  enabled         INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Seguridad:**
- API keys encriptadas con AES-256-CBC
- IV (Initialization Vector) almacenado separadamente

#### `models` - Modelos de IA

```sql
CREATE TABLE models (
  id              TEXT PRIMARY KEY,  -- ej: "gemini-2.5-flash", "gpt-4o"
  provider_id     TEXT REFERENCES providers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  model_type      TEXT NOT NULL DEFAULT 'llm',  -- 'llm', 'stt', 'tts', 'vision'
  context_window  INTEGER NOT NULL DEFAULT 20000,
  capabilities    TEXT,  -- JSON array
  enabled         INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 0
);
```

#### `channels` - Canales de Comunicación

```sql
CREATE TABLE channels (
  id          TEXT PRIMARY KEY,  -- ej: "webchat", "telegram", "discord"
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  config_encrypted TEXT,
  config_iv   TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'disconnected',
  voice_enabled INTEGER NOT NULL DEFAULT 0,
  tts_enabled INTEGER NOT NULL DEFAULT 0,
  stt_provider TEXT,
  tts_provider TEXT,
  tts_voice_id TEXT,
  step_delivery_mode TEXT DEFAULT 'new_messages'
);
```

#### `tools` - Herramientas del Sistema

```sql
CREATE TABLE tools (
  id          TEXT PRIMARY KEY,  -- ej: "web_search", "exec", "memory_write"
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  category    TEXT,  -- 'bundled', 'filesystem', 'code', 'web', 'memory', 'agents'
  enabled     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Tool Crítica: `search_knowledge`**

Esta tool **SIEMPRE** debe estar disponible para el coordinador. Permite buscar herramientas, skills y reglas del playbook que puedan no estar activas o visibles en el loadout actual.

```typescript
// Búsqueda unificada con FTS5
search_knowledge({
  query: "web",           // Término de búsqueda
  type: "all",            // "all" | "tools" | "skills" | "playbook"
  limit: 10               // Máximo de resultados
})
```

**Respuesta:**
```json
{
  "ok": true,
  "query": "web",
  "type": "all",
  "totalResults": 5,
  "tools": [
    { "id": "web_search", "name": "web_search", "description": "...", "enabled": true, "active": true }
  ],
  "skills": [],
  "playbook": [],
  "summary": {
    "toolsFound": 1,
    "skillsFound": 0,
    "playbookRulesFound": 0
  }
}
```

**Características:**
- Usa **FTS5** para búsqueda full-text con ranking BM25
- **Fallback automático** a LIKE si FTS5 falla
- Busca en nombre, descripción y categoría
- Retorna herramientas activas e inactivas (para descubrimiento)

#### `skills` - Habilidades (Skills)

```sql
CREATE TABLE skills (
  id          TEXT PRIMARY KEY,  -- ej: "web_search", "shell", "file_manager"
  name        TEXT NOT NULL,
  description TEXT,
  source      TEXT NOT NULL,  -- 'bundled', 'user'
  enabled     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 0,
  tools       TEXT,  -- JSON array de tool IDs
  content     TEXT,  -- Instrucciones para búsqueda FTS5
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `ethics` - Lineamientos Éticos

```sql
CREATE TABLE ethics (
  id              TEXT PRIMARY KEY,  -- ej: "default"
  name            TEXT NOT NULL,
  description     TEXT,
  content         TEXT NOT NULL,  -- Markdown con las reglas éticas
  is_default      INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 0  -- Solo uno activo a la vez
);
```

### Tablas de Contexto (Context Engine)

#### `conversations` - Historial de Mensajes

```sql
CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id       TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'webchat',
  role            TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
  content         TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id    TEXT,
  token_count     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `traces` - Trazas de Ejecución

```sql
CREATE TABLE traces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id       TEXT NOT NULL,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  tool_used       TEXT,
  input_summary   TEXT NOT NULL,
  output_summary  TEXT NOT NULL,
  success         INTEGER NOT NULL DEFAULT 1,
  error_message   TEXT,
  duration_ms     INTEGER,
  tokens_used     INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `playbook` - Reglas Evolutivas (ACE)

```sql
CREATE TABLE playbook (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  rule                  TEXT NOT NULL,
  category              TEXT NOT NULL CHECK(category IN 
    ('tool_selection','response_quality','error_avoidance','optimization','agent_creation')),
  applicable_to         TEXT,  -- JSON array
  helpful_count         INTEGER NOT NULL DEFAULT 0,
  harmful_count         INTEGER NOT NULL DEFAULT 0,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `scratchpad` - Notas Persistentes

```sql
CREATE TABLE scratchpad (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  source      TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(thread_id, key)
);
```

---

## 4. Flujo de Persistencia de Datos

### Diagrama de Secuencia del Onboarding

```
┌─────────┐    ┌──────────────┐    ┌──────────┐    ┌───────────┐
│  CLI    │    │ Onboarding   │    │  SQLite  │    │  Crypto   │
│ Wizard  │    │  Functions   │    │    DB    │    │  Module   │
└────┬────┘    └──────┬───────┘    └────┬─────┘    └─────┬─────┘
     │                │                 │                │
     │ saveUserProfile│                 │                │
     │───────────────>│                 │                │
     │                │ INSERT INTO users│               │
     │                │────────────────>│                │
     │                │ RETURNING id    │                │
     │                │<────────────────│                │
     │                │                 │                │
     │                │ INSERT INTO user_identities      │
     │                │────────────────>│                │
     │                │<────────────────│                │
     │ userId         │                 │                │
     │<───────────────│                 │                │
     │                │                 │                │
     │ saveAgentConfig              │                │
     │───────────────>│                 │                │
     │                │ INSERT INTO agents│               │
     │                │ role='coordinator'│                │
     │                │────────────────>│                │
     │                │ RETURNING id    │                │
     │                │<────────────────│                │
     │ agentId        │                 │                │
     │<───────────────│                 │                │
     │                │                 │                │
     │ saveProviderConfig             │                │
     │───────────────>│                 │                │
     │                │                 │ encryptApiKey()│
     │                │────────────────────────────────>│
     │                │                 │ encrypted, iv  │
     │                │<────────────────────────────────│
     │                │ UPDATE providers│                │
     │                │ api_key_encrypted│               │
     │                │────────────────>│                │
     │                │ UPDATE models   │                │
     │                │ active=1        │                │
     │                │────────────────>│                │
     │                │<────────────────│                │
     │                │                 │                │
     │ activateChannel              │                │
     │───────────────>│                 │                │
     │                │ encryptConfig() │                │
     │                │────────────────────────────────>│
     │                │<────────────────────────────────│
     │                │ UPDATE channels │                │
     │                │ INSERT INTO user_identities      │
     │                │────────────────>│                │
     │                │<────────────────│                │
     │                │                 │                │
```

### Encriptación de Datos Sensibles

**Módulo:** `packages/core/src/storage/crypto.ts`

```typescript
// Encriptación de API Keys
export async function encryptApiKey(apiKey: string): Promise<{
  encrypted: string;
  iv: string;
}> {
  const key = await deriveKey();  // Derivada de HIVE_MASTER_KEY
  const iv = crypto.getRandomValues(new Uint8Array(16));
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "AES-CBC" }, false, ["encrypt"]
  );
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv }, cryptoKey, new TextEncoder().encode(apiKey)
  );
  
  return {
    encrypted: Buffer.from(encrypted).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
}

// Desencriptación
export async function decryptApiKey(encrypted: string, iv: string): Promise<string> {
  const key = await deriveKey();
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "AES-CBC" }, false, ["decrypt"]
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: Buffer.from(iv, "base64") },
    cryptoKey,
    Buffer.from(encrypted, "base64")
  );
  
  return new TextDecoder().decode(decrypted);
}
```

---

## 5. El Agente Coordinador

### Definición

El **agente coordinador** es el agente principal que:
- Tiene `role = 'coordinator'` en la base de datos
- Está vinculado al `user_id` del usuario único
- Activa y gestiona el **agent loop**
- Coordina agentes trabajadores (workers) si se crean

### Creación durante el Onboarding

```typescript
// packages/cli/src/commands/onboard.ts
state.agentId = saveAgentConfig({
  userId: state.userId,
  agentName: state.agentName,  // ej: "Bee"
  description: state.agentDescription,
  tone: state.agentTone,
  providerId: "",  // Se asigna después
  modelId: "",     // Se asigna después
});
```

**SQL generado:**

```sql
INSERT INTO agents (
  user_id, name, description, tone, system_prompt,
  status, role, enabled
) VALUES (
  'abc123...', 'Bee', 'Asistente personal...', 'friendly',
  'Sos Bee, Asistente personal inteligente...',
  'idle', 'coordinator', 1
) RETURNING id;
```

### System Prompt del Coordinador

El system prompt se genera dinámicamente con:

1. **Nombre y descripción** del agente
2. **Tono de comunicación** (friendly, professional, direct, casual)
3. **Principios éticos** (de la tabla `ethics`)
4. **Guías de uso de herramientas**

**Ejemplo:**

```
Sos Bee, Asistente personal inteligente y desarrollador senior.

TONO Y ESTILO:
Sos cálido, cercano y empático. Usás un lenguaje natural y amigable, 
como si hablaras con un amigo de confianza.

PRINCIPIOS:
- Siempre usá las herramientas disponibles antes de pedir información al usuario.
- Confirmá acciones irreversibles (borrar archivos, cancelar tareas) antes de ejecutarlas.
- Cuando no puedas completar algo, explicá brevemente por qué y qué alternativas hay.
- Adaptá tu nivel técnico al contexto del usuario.
```

### Búsqueda del Coordinador

```typescript
// packages/core/src/agent/agent-loop.ts
private _resolveCoordinatorId(): string {
  // Use the storage helper to get coordinator agent ID from database
  const coordinatorId = resolveAgentId(null);
  return coordinatorId || "main";
}
```

---

## 6. Agent Loop

### Ubicación

`packages/core/src/agent/agent-loop.ts`

### Arquitectura

El agent loop es un **generator asíncrono** que:

1. Carga el contexto del agente desde la BD
2. Compila el prompt del sistema
3. Llama al LLM
4. Ejecuta herramientas si es necesario
5. Persiste el historial y trazas

### Flujo Principal

```typescript
export async function* runAgent(
  opts: AgentLoopOptions
): AsyncGenerator<StreamChunk> {
  const db = getDb();

  // 1️⃣ Cargar agente desde BD
  const agent = db.query("SELECT * FROM agents WHERE id = ?")
    .get(opts.agentId);

  // 2️⃣ Resolver configuración del LLM
  const providerCfg = await resolveProviderConfig(
    agent.provider_id,
    agent.model_id
  );

  // 3️⃣ Compilar contexto (system prompt + history + tools)
  const ctx = await compileContext({
    agentId: opts.agentId,
    threadId: opts.threadId,
    userMessage: opts.userMessage,
    channel: opts.channel,
    mcpManager: opts.mcpManager,
    userId: opts.userId,
  });

  // 4️⃣ Loop principal
  while (iterations < maxIterations) {
    // 4a. Llamada al LLM
    const response = await callLLM({
      ...providerCfg,
      messages,
      tools: ctx.tools,
    });

    // 4b. Emitir respuesta
    yield { agent: { messages: [agentMsg] } };

    // 4c. Si hay tool calls, ejecutarlos
    if (response.tool_calls?.length) {
      for (const tc of response.tool_calls) {
        const toolResult = await executeTool(...);
        yield { tools: { messages: [{ content: toolResult }] } };
        
        // Guardar traza
        saveTrace({
          threadId: opts.threadId,
          agentId: opts.agentId,
          toolUsed: toolName,
          success: !toolResult.startsWith("[Tool Error]"),
        });
      }
    }

    // 4d. Si no hay más tool calls, finalizar
    if (!response.tool_calls?.length) {
      addMessage(opts.threadId, "assistant", response.content);
      break;
    }
  }
}
```

### Context Compiler

**Ubicación:** `packages/core/src/agent/context-compiler.ts`

El compilador de contexto construye el prompt del sistema con:

1. **System prompt base** del agente
2. **Ética activa** (de `ethics` donde `active = 1`)
3. **Herramientas disponibles** (de `tools` donde `active = 1`)
4. **Skills activas** (de `skills` donde `active = 1`)
5. **Playbook** (reglas evolutivas de `playbook` donde `active = 1`)
6. **Historial de conversación** (de `conversations` por `thread_id`)
7. **Notas persistentes** (de `scratchpad` por `thread_id`)

```typescript
export async function compileContext(opts: {
  agentId: string;
  threadId: string;
  userMessage: string;
  channel?: string;
  userId?: string;
}): Promise<{
  systemPrompt: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  allTools: any[];
}> {
  const db = getDb();

  // 1️⃣ Cargar agente
  const agent = db.query("SELECT * FROM agents WHERE id = ?")
    .get(agentId);

  // 2️⃣ Cargar ética activa
  const ethics = db.query(
    "SELECT content FROM ethics WHERE active = 1 LIMIT 1"
  ).get() as { content: string } | undefined;

  // 3️⃣ Cargar herramientas activas
  const tools = db.query(
    "SELECT * FROM tools WHERE active = 1 AND enabled = 1"
  ).all();

  // 4️⃣ Cargar historial
  const history = db.query(
    "SELECT * FROM conversations WHERE thread_id = ? ORDER BY created_at ASC"
  ).all(threadId);

  // 5️⃣ Construir system prompt
  const systemPrompt = [
    agent.system_prompt,
    ethics?.content,
    playbookRules.map(r => `RULE: ${r.rule}`),
  ].join("\n\n");

  // 6️⃣ Construir mensajes
  const messages = history.map(row => ({
    role: row.role,
    content: row.content,
  }));

  return { systemPrompt, messages, tools, allTools };
}
```

### Persistencia de la Conversación

**Módulo:** `packages/core/src/agent/conversation-store.ts`

```typescript
export function addMessage(
  threadId: string,
  role: "user" | "assistant" | "tool" | "system",
  content: string,
  metadata?: { channel?: string; tool_calls?: any[] }
): void {
  const db = getDb();
  
  db.query(`
    INSERT INTO conversations 
      (thread_id, channel, role, content, tool_calls_json, created_at)
    VALUES (?, ?, ?, ?, ?, (unixepoch()))
  `).run(
    threadId,
    metadata?.channel || "webchat",
    role,
    content,
    metadata?.tool_calls ? JSON.stringify(metadata.tool_calls) : null
  );
}
```

### Persistencia de Trazas

**Módulo:** `packages/core/src/agent/tracer.ts`

```typescript
export function saveTrace(opts: {
  threadId: string;
  agentId: string;
  agentName: string;
  toolUsed?: string;
  inputSummary: string;
  outputSummary: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  tokensUsed?: number;
}): void {
  const db = getDb();
  
  db.query(`
    INSERT INTO traces 
      (thread_id, agent_id, agent_name, tool_used, 
       input_summary, output_summary, success, 
       error_message, duration_ms, tokens_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (unixepoch()))
  `).run(
    opts.threadId,
    opts.agentId,
    opts.agentName,
    opts.toolUsed || null,
    opts.inputSummary,
    opts.outputSummary,
    opts.success ? 1 : 0,
    opts.errorMessage || null,
    opts.durationMs || null,
    opts.tokensUsed || null
  );
}
```

---

## 7. Inicialización del Gateway

### Ubicación

`packages/core/src/gateway/initializer.ts`

### Flujo de Inicialización

```typescript
export async function initializeGateway(
  config: Config,
  pidFile: string
): Promise<GatewayInitializationResult> {
  // 1️⃣ Verificar que exista al menos un usuario
  await verifyDatabaseUsers();

  // 2️⃣ Escribir archivo PID
  await writePidFile(pidFile);

  // 3️⃣ Cargar configuración desde BD
  const { provider, model } = await loadAgentConfigFromDB(config);

  // 4️⃣ Sincronizar índices FTS5 (búsqueda semántica)
  await Promise.all([
    syncToolsToFTS(),
    syncSkillsToFTS(),
    syncPlaybookToFTS()
  ]);

  // 5️⃣ Crear AgentService
  const agent = createAgentService();
  await agent.initialize();

  // 6️⃣ Inicializar agent loop
  await initializeAgentLoop();

  // 7️⃣ Inicializar LLM runner
  const runner = await initializeLLMRunner(config, provider, model);

  // 8️⃣ Inicializar channel manager
  const channelManager = await initializeChannelManager(config);

  return { agent, runner, channelManager, provider, model };
}
```

### Verificación de Usuario

```typescript
export async function verifyDatabaseUsers(): Promise<void> {
  const db = getDb();
  const userCount = db.query(
    "SELECT COUNT(*) as count FROM users"
  ).get() as { count: number };

  if (userCount.count === 0) {
    throw new Error(
      "No users found in the database. " +
      "A valid user is required to start the Hive Gateway."
    );
  }

  log.info(`Database verified: ${userCount.count} user(s) found`);
}
```

### Carga de Configuración

```typescript
export async function loadAgentConfigFromDB(
  config: Config
): Promise<{ provider: string; model: string }> {
  const db = getDb();

  // Obtener configuración del coordinador
  const agentConfig = db.query(`
    SELECT provider_id, model_id FROM agents
    WHERE id = ? OR role = 'coordinator'
    ORDER BY (CASE WHEN id = ? THEN 1 ELSE 0 END) DESC
    LIMIT 1
  `).get(coordinatorAgentId || "", coordinatorAgentId || "") as
    { provider_id: string | null; model_id: string | null } | undefined;

  let provider = agentConfig?.provider_id || "gemini";
  let model = agentConfig?.model_id || "gemini-2.5-flash";

  // Cargar API keys desencriptadas
  const providers = db.query(`
    SELECT id, api_key_encrypted, api_key_iv, base_url
    FROM providers
    WHERE active = 1 AND api_key_encrypted IS NOT NULL
  `).all();

  for (const p of providers) {
    const apiKey = await decryptApiKey(p.api_key_encrypted, p.api_key_iv);
    config.models.providers[p.id] = { apiKey, ... };
  }

  return { provider, model };
}
```

### Inicialización del Agent Loop

```typescript
export async function initializeAgentLoop(mcpManager?: any): Promise<void> {
  await buildAgentLoop({ mcpManager });
  log.info("Agent loop initialized");
}
```

**Función `buildAgentLoop()`:**

```typescript
// packages/core/src/agent/agent-loop.ts
export function buildAgentLoop(opts: { mcpManager?: MCPClientManager | null }): AgentLoop {
  _agentLoop = new AgentLoop();
  if (opts.mcpManager) _agentLoop.setMCPManager(opts.mcpManager);
  return _agentLoop;
}
```

---

## 8. Diagramas de Flujo

### Flujo Completo del Sistema

```
┌──────────────────────────────────────────────────────────────────┐
│                         ONBOARDING                               │
│  ┌────────┐  ┌─────────┐  ┌────────┐  ┌──────────┐              │
│  │ Usuario│→ │ Agente  │→ │Provider│→ │ Canal    │→ ...         │
│  │ (user) │  │(coordinator)│ │(LLM)  │  │(webchat) │              │
│  └───┬────┘  └────┬────┘  └───┬────┘  └────┬─────┘              │
│      │           │           │            │                     │
│      ▼           ▼           ▼            ▼                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    SQLite Database                       │    │
│  │  users │ agents │ providers │ models │ channels │ ...   │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      GATEWAY STARTUP                             │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────┐          │
│  │verifyDatabase()│→ │loadConfig() │→ │buildAgentLoop│          │
│  └────────────────┘  └─────────────┘  └──────────────┘          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                       RUNTIME LOOP                               │
│  ┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐   │
│  │ Message │→   │Context   │→   │ LLM Call  │→   │ Tool     │   │
│  │ (user)  │    │ Compiler │    │           │    │ Execute  │   │
│  └─────────┘    └──────────┘    └───────────┘    └────┬─────┘   │
│       ▲                                               │         │
│       │                                               ▼         │
│       │  ┌─────────┐    ┌──────────┐    ┌──────────┐ │         │
│       └──│ Response│←── │  Trace   │←── │  Result  │─┘         │
│          │         │    │  Save    │    │          │           │
│          └─────────┘    └──────────┘    └──────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

### Persistencia de Datos en Runtime

```
┌─────────────┐
│ User Input  │ (webchat, telegram, discord)
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  addMessage(threadId, "user", content) │
│  → INSERT INTO conversations           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  compileContext()                       │
│  → SELECT FROM agents, ethics, tools   │
│  → SELECT FROM conversations (history) │
│  → SELECT FROM scratchpad (notes)      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  callLLM(messages, tools)              │
│  → API externa (OpenAI, Gemini, etc.)  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  executeTool(toolName, args)           │
│  → Ejecución de herramienta            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  saveTrace(...)                         │
│  → INSERT INTO traces                  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  addMessage(threadId, "assistant", ...)│
│  → INSERT INTO conversations           │
└─────────────────────────────────────────┘
```

---

## 9. Resumen de Claves de Diseño

### Principios Arquitectónicos

1. **SQLite como única fuente de verdad**
   - Todos los datos persisten en un solo archivo `.db`
   - No hay dependencias de bases de datos externas

2. **Usuario único como llave maestra**
   - Todo está vinculado al `user_id`
   - Simplifica la gestión de configuraciones y permisos

3. **Agente coordinador como núcleo**
   - `role = 'coordinator'` identifica al agente principal
   - Activa y gestiona el agent loop

4. **Encriptación de datos sensibles**
   - API keys encriptadas con AES-256-CBC
   - Clave maestra derivada de `HIVE_MASTER_KEY`

5. **Context Engine evolutivo**
   - Playbook con reglas aprendidas de trazas
   - Scratchpad para notas persistentes
   - Compresión de contexto con resúmenes

### Tablas Críticas

| Tabla | Propósito | Llave |
|-------|-----------|-------|
| `users` | Usuario único | `id` (auto-generado) |
| `agents` | Agentes (coordinador + workers) | `id` (auto-generado) |
| `user_identities` | Mapeo canal → usuario | `(user_id, channel)` |
| `providers` | Proveedores de LLM/STT/TTS | `id` (ej: "gemini") |
| `models` | Modelos de IA | `id` (ej: "gpt-4o") |
| `channels` | Canales de comunicación | `id` (ej: "webchat") |
| `conversations` | Historial de mensajes | `id` (auto-incremental) |
| `traces` | Trazas de ejecución | `id` (auto-incremental) |

### Flujos Críticos

1. **Onboarding**: 8 pasos → persistencia progresiva en BD
2. **Gateway startup**: Verificación → carga → inicialización
3. **Agent loop**: Mensaje → contexto → LLM → herramientas → respuesta
4. **Persistencia**: Conversaciones + trazas → BD

---

## 10. Archivos Clave del Código

| Archivo | Propósito |
|---------|-----------|
| `packages/cli/src/commands/onboard.ts` | Wizard de onboarding |
| `packages/core/src/storage/onboarding.ts` | Funciones de persistencia |
| `packages/core/src/storage/schema.ts` | Esquema de BD |
| `packages/core/src/storage/sqlite.ts` | Inicialización de BD |
| `packages/core/src/storage/crypto.ts` | Encriptación/desencriptación |
| `packages/core/src/agent/agent-loop.ts` | Agent loop principal |
| `packages/core/src/agent/context-compiler.ts` | Compilador de contexto |
| `packages/core/src/agent/conversation-store.ts` | Persistencia de mensajes |
| `packages/core/src/agent/tracer.ts` | Persistencia de trazas |
| `packages/core/src/gateway/initializer.ts` | Inicialización del gateway |
| `packages/core/src/gateway/server.ts` | Servidor principal |

---

## 11. Referencias de API

### Funciones de Onboarding

```typescript
// Crear/actualizar usuario
saveUserProfile(data: {
  userId?: string;
  userName?: string;
  userLanguage?: string;
  userTimezone?: string;
  userOccupation?: string;
  userNotes?: string;
  channelUserId?: string;
}): string

// Crear/actualizar agente
saveAgentConfig(data: {
  userId: string;
  agentId?: string;
  agentName: string;
  providerId: string;
  modelId: string;
  tone: string;
  description?: string;
}): string

// Guardar configuración de provider
saveProviderConfig(data: {
  userId: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<void>

// Activar canal
activateChannel(userId: string, data: {
  channelId: string;
  channelUserId?: string;
  config?: Record<string, unknown>;
}): Promise<void>

// Activar ética
activateEthics(userId: string, ethicsId: string): void

// Activar herramientas
activateTools(userId: string, toolIds: string[]): void
```

### Funciones del Agent Loop

```typescript
// Ejecutar agente como generator
runAgent(opts: {
  agentId: string;
  userMessage: string;
  threadId: string;
  channel?: string;
  mcpManager?: MCPClientManager;
  userId?: string;
}): AsyncGenerator<StreamChunk>

// Compilar contexto
compileContext(opts: {
  agentId: string;
  threadId: string;
  userMessage: string;
  channel?: string;
  mcpManager?: MCPClientManager;
  userId?: string;
}): Promise<{
  systemPrompt: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  allTools: any[];
}>

// Guardar mensaje
addMessage(
  threadId: string,
  role: "user" | "assistant" | "tool" | "system",
  content: string,
  metadata?: { channel?: string }
): void

// Guardar traza
saveTrace(opts: {
  threadId: string;
  agentId: string;
  agentName: string;
  toolUsed?: string;
  inputSummary: string;
  outputSummary: string;
  success: boolean;
  durationMs?: number;
  tokensUsed?: number;
}): void
```

---

## 12. Identity Resolution desde Storage

### Funciones Helper

Para eliminar la dependencia de variables de entorno, se crearon funciones helper en `packages/core/src/storage/onboarding.ts`:

```typescript
// Obtener el único usuario de la BD
export function getSingleUserId(): string | null

// Obtener el agente coordinador (role = 'coordinator')
export function getCoordinatorAgentId(): string | null

// Resolver userId con prioridad:
// 1. userId explícito
// 2. Búsqueda por identidad de canal
// 3. Usuario único de la BD
export function resolveUserId(opts: {
  userId?: string | null;
  threadId?: string | null;
  channel?: string | null;
  channelUserId?: string | null;
}): string | null

// Resolver agentId con prioridad:
// 1. agentId explícito
// 2. Coordinador de la BD
// 3. Primer agente enabled
export function resolveAgentId(agentId?: string | null): string | null
```

### Archivos Actualizados

Todas las referencias a `process.env.HIVE_USER_ID` y `process.env.HIVE_AGENT_ID` fueron reemplazadas por llamadas a las funciones helper:

| Archivo | Cambio |
|---------|--------|
| `agent/agent-loop.ts` | `resolveUserId()`, `resolveAgentId()` |
| `agent/service.ts` | `resolveUserId()`, `resolveAgentId()` |
| `agent/context-compiler.ts` | `resolveUserId()` |
| `agent/prompt-builder.ts` | `resolveUserId()` |
| `tools/coordinator-tools.ts` | `resolveUserId()` |
| `tools/project-management.ts` | `resolveUserId()`, `resolveAgentId()` |
| `tools/cron.ts` | `resolveUserId()` |
| `agent/providers/index.ts` | `resolveUserId()`, `resolveAgentId()` |
| `gateway/server.ts` | `resolveUserId()` |
| `gateway/initializer.ts` | `resolveAgentId()` |
| `channels/webchat.ts` | `resolveUserId()` |

### Beneficios

1. **Persistencia completa**: userId y agentId se obtienen de la BD, no del entorno
2. **Multi-identidad**: Soporta diferentes channel_user_id por canal (Telegram, Discord, etc.)
3. **Fallback seguro**: Si no hay usuario en la BD, retorna null con manejo de error claro
4. **Sin configuración manual**: No需要 establecer variables de entorno después del onboarding

---

## 13. Conclusión

El sistema Hive está diseñado alrededor de tres pilares fundamentales:

1. **Usuario único**: El `user_id` es la llave maestra que vincula todas las entidades
2. **Agente coordinador**: El agente con `role = 'coordinator'` activa el agent loop
3. **SQLite como fuente de verdad**: Todos los datos persisten en una base de datos local

El onboarding es el proceso que configura progresivamente estos tres pilares, guardando cada paso en la base de datos. Una vez completado, el gateway puede iniciarse y el agent loop se ejecuta continuamente, procesando mensajes de los usuarios, ejecutando herramientas y persistiendo todo el historial y trazas.

La arquitectura es **modular**, **escalable** y **segura**, con encriptación de datos sensibles y un sistema de contexto evolutivo que mejora con el uso.
