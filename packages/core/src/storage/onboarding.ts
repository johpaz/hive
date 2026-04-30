import { logger } from "../utils/logger.ts";
import { getDb, initializeDatabase } from "./sqlite";
import { encryptApiKey, encryptConfig, decryptApiKey, decryptConfig } from "./crypto";
import { seedAllData, SEED_DATA } from "./seed";
import { SkillLoader } from "@johpaz/hive-agents-skills";

export interface OnboardingSection {
  step: "user" | "skills" | "ethics" | "tools" | "provider" | "model" | "channel" | "codebridge" | "mcp" | "agent" | "complete";
  userId: string;
  data: Record<string, unknown>;
  completedAt?: number;
}

const log = logger.child("onboarding");
// 9️⃣ Hive System Prompt 

const HIVE_SYSTEM_PROMPT = `
# HIVE — Agente Coordinador

Sos Bee, coordinador de Hive. Resolvés tareas del usuario directamente o delegando a workers especializados. Tu rol es "coordinator".

## ⚡ REGLAS CRÍTICAS

1. **Ética primero** — Operás bajo un Código de Ética obligatorio. No podés ignorarlo.
2. **Confirmá antes de guardar** — Siempre verificá con el usuario antes de persistir datos en la BD.
3. **Buscá antes de crear** — Usá search_knowledge para capacidades, find_agent para workers.
4. **Mínimo privilegio** — Asigná solo las tools necesarias a cada worker.
5. **Nunca cli_exec para cron** — Usá siempre cron.create para tareas programadas.
6. **Nunca codebridge_launch directo** — Creá un worker code_developer primero.

## 🔍 DISCOVERY — CÓMO ENCONTRAR MÁS CAPACIDADES

Arrancás con solo 4 herramientas. Para descubrir más, usá **search_knowledge**:

- \`search_knowledge(type="tools", query="leer archivos")\` → herramientas nativas
- \`search_knowledge(type="mcp", query="listar bases datos")\` → herramientas MCP externas
- \`search_knowledge(type="skills", query="debuggear código")\` → skills (instrucciones de tareas)
- \`search_knowledge(type="playbook", query="seguridad")\` → playbook (buenas prácticas)
- \`search_knowledge(type="all", query="buscar web internet")\` → busca en todo

La búsqueda es bilingüe: buscá en español y si hay pocos resultados se re-intenta con equivalentes en inglés.

**Prioridad:** SIEMPRE preferí herramientas nativas sobre MCP cuando ambas resuelven la tarea.

## 📋 FLUJO DE TRABAJO

**Tarea simple (1-2 pasos):** Ejecutala directo con tus tools.

**Tarea repetitiva:** Usá cron.create. Preguntá al usuario cada cuánto ejecutarla.

**Tarea compleja (múltiples workers):** Creá un proyecto con project_create, descomponé en tareas, delegá con delegate_task.

**Worker:** find_agent → ¿existe? → reutilizalo. Si no → create_agent con system_prompt claro y tools_json mínimo. **delegate_task** lo activa.

**Proyectos:** Solo creá proyecto cuando hay múltiples workers coordinando. NO para tareas unitarias.

**Cierre:** task_update(status, result) → task_evaluate(criteria) → project_done(summary).

## 🧠 MEMORIA

- \`save_note\` — Persiste notas por conversación (sobrevive compresión)
- \`memory_write\` / \`memory_read\` — Memoria cross-conversación por clave
- Playbook — Reglas aprendidas inyectadas automáticamente

## 📡 CANALES

webchat (siempre activo) · telegram · discord · slack · whatsapp
Canal preferido para cron: telegram > discord > webchat
`
export function initOnboardingDb(): void {
  try {
    initializeDatabase();

    // Verificar si la DB ya tiene datos antes de hacer seed
    const db = getDb();
    const userCount = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };

    if (userCount.count > 0) {
      log.info("✅ DB ya inicializada con " + userCount.count + " usuario(s). Saltando seed.");
      return;
    }

    log.info("🌱 Ejecutando seed de datos...");
    seedAllData();
    log.info("✅ Seed completado correctamente.");
  } catch (e) {
    log.error("⚠️ Fallo al inicializar/poblar la DB:", { error: (e as Error).message });
  }
}

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
  try {
    const db = getDb();
    let finalUserId = data.userId;

    if (!finalUserId) {
      // 1️⃣ Dejar que SQLite genere el ID automáticamente con randomblob(16)
      const result = db.query(`
        INSERT INTO users(name, language, timezone, occupation, notes)
VALUES(?, ?, ?, ?, ?) RETURNING id
  `).get(
        data.userName || null,
        data.userLanguage || null,
        data.userTimezone || null,
        data.userOccupation || null,
        data.userNotes || null
      ) as { id: string };
      finalUserId = result.id;
      log.info("✅ User created with auto-generated ID", { userId: finalUserId });
    } else {
      // 1️⃣ Upsert con ID explícito (flujo web o actualización)
      db.query(`
        INSERT INTO users(id, name, language, timezone, occupation, notes)
VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
name = COALESCE(excluded.name, name),
  language = COALESCE(excluded.language, language),
  timezone = COALESCE(excluded.timezone, timezone),
  occupation = COALESCE(excluded.occupation, occupation),
  notes = COALESCE(excluded.notes, notes)
    `).run(
        finalUserId,
        data.userName || null,
        data.userLanguage || null,
        data.userTimezone || null,
        data.userOccupation || null,
        data.userNotes || null
      );
    }

    // 2️⃣ Crear identidad base para webchat (sesión única)
    if (data.channelUserId) {
      db.query(`
        INSERT OR REPLACE INTO user_identities(user_id, channel, channel_user_id)
VALUES(?, 'webchat', ?)
  `).run(finalUserId, data.channelUserId);
      log.info("✅ User identity created for webchat", { userId: finalUserId });
    }

    // 3️⃣ Crear o actualizar agente
    if (data.agentId && data.agentName) {

      db.query(`
        INSERT INTO agents
  (id, user_id, name, description, tone, system_prompt, status, role)
VALUES(?, ?, ?, ?, ?, ?, 'idle', 'coordinator')
        ON CONFLICT(id) DO UPDATE SET
user_id = COALESCE(excluded.user_id, user_id),
  name = COALESCE(excluded.name, name),
  description = COALESCE(excluded.description, description),
  tone = COALESCE(excluded.tone, tone),
  system_prompt = excluded.system_prompt,
  role = 'coordinator'
    `).run(
        data.agentId,
        finalUserId,
        data.agentName,
        data.agentDescription || null,
        data.agentTone || null,
        HIVE_SYSTEM_PROMPT,
      );
    }

    return finalUserId;
  } catch (e) {
    log.error("⚠️ Error saving user profile:", { error: (e as Error).message });
    throw e;
  }
}

export function activateSkills(userId: string, skillIds: string[]): void {
  try {
    const db = getDb();
    // Activar skills seleccionadas
    for (const skillId of skillIds) {
      db.query(`UPDATE skills SET active = 1 WHERE id = ? `).run(skillId);
    }
    log.info("✅ Skills activadas:", { skillIds: skillIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating skills:", { error: (e as Error).message });
  }
}

export function activateEthics(userId: string, ethicsId: string): void {
  try {
    const db = getDb();
    // Activar el ethics seleccionado
    db.query(`UPDATE ethics SET active = 1 WHERE id = ? `).run(ethicsId);
    // Desactivar los demás
    db.query(`UPDATE ethics SET active = 0 WHERE id != ? `).run(ethicsId);
    log.info("✅ Ethics activado:", { ethicsId });
  } catch (e) {
    log.error("⚠️ Error activating ethics:", { error: (e as Error).message });
  }
}

export function activateTools(userId: string, toolIds: string[]): void {
  try {
    const db = getDb();
    // Activar tools seleccionadas
    for (const toolId of toolIds) {
      db.query(`UPDATE tools SET active = 1, enabled = 1 WHERE id = ? `).run(toolId);
    }
    log.info("✅ Tools activadas:", { toolIds: toolIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating tools:", { error: (e as Error).message });
  }
}

/**
 * Activate all browser tools when Chromium is available
 * Called from gateway initializer when browser service connects successfully
 */
export function activateBrowserTools(): void {
  try {
    const db = getDb();
    const browserToolIds = [
      "browser_navigate",
      "browser_screenshot",
      "browser_click",
      "browser_type",
      "browser_extract",
      "browser_script",
      "browser_wait",
    ];

    for (const toolId of browserToolIds) {
      db.query(`UPDATE tools SET active = 1, enabled = 1 WHERE id = ? `).run(toolId);
    }
    log.info("✅ Browser tools activated (Chromium available)");
  } catch (e) {
    log.error("⚠️ Error activating browser tools:", { error: (e as Error).message });
  }
}

export async function saveProviderConfig(data: {
  userId: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<void> {
  try {
    const db = getDb();

    let apiKeyEncrypted = null;
    let apiKeyIv = null;

    if (data.apiKey) {
      const encrypted = await encryptApiKey(data.apiKey);
      apiKeyEncrypted = encrypted.encrypted;
      apiKeyIv = encrypted.iv;
    }

    // 1️⃣ Primero: Actualizar provider global con API key del usuario
    db.query(`
      UPDATE providers SET
api_key_encrypted = ?,
  api_key_iv = ?,
  base_url = ?,
  enabled = 1,
  active = 1
      WHERE id = ?
  `).run(apiKeyEncrypted, apiKeyIv, data.baseUrl || null, data.provider);

    log.info("✅ Provider actualizado:", { provider: data.provider });

    // 2️⃣ Segundo: Activar el modelo seleccionado
    // For Ollama, models are inserted dynamically (not seeded), ensure row exists first
    if (data.provider === "ollama" && data.model) {
      db.query(`
        INSERT OR IGNORE INTO models(id, name, provider_id, model_type, enabled, active)
VALUES(?, ?, 'ollama', 'llm', 1, 1)
  `).run(data.model, data.model);
    }

    db.query(`
      UPDATE models SET enabled = 1, active = 1
      WHERE id = ?
  `).run(data.model);

    log.info("✅ Model activado:", { model: data.model });
  } catch (e) {
    log.error("⚠️ Error saving provider:", { error: (e as Error).message });
    throw e;
  }
}

export function activateCodeBridge(userId: string, codeBridgeConfig: { id: string; enabled: boolean; port?: number }[]): void {
  try {
    const db = getDb();
    // 7️⃣ Séptimo: Configurar Code Bridge CLIs seleccionados
    for (const cb of codeBridgeConfig) {
      db.query(`
        UPDATE code_bridge SET enabled = ?, active = ?, port = ?, user_id = ?
  WHERE id = ?
    `).run(cb.enabled ? 1 : 0, cb.enabled ? 1 : 0, cb.port || 18791, userId, cb.id);
    }
    log.info("✅ Code Bridge configurado:", { codeBridgeIds: codeBridgeConfig.map(c => c.id).join(", ") });
  } catch (e) {
    log.error("⚠️ Error configuring code bridge:", { error: (e as Error).message });
  }
}

export function activateMcpServers(userId: string, mcpIds: string[]): void {
  try {
    const db = getDb();
    // Activar MCP servers seleccionados
    for (const mcpId of mcpIds) {
      db.query(`UPDATE mcp_servers SET active = 1, enabled = 1 WHERE id = ? `).run(mcpId);
    }
    log.info("✅ MCP servers activados:", { mcpIds: mcpIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating MCP servers:", { error: (e as Error).message });
  }
}


export function saveAgentConfig(data: {
  userId: string;
  agentId?: string;
  agentName: string;
  providerId: string;
  modelId: string;
  tone: string;
  description?: string;
}): string {
  try {
    const db = getDb();
    let finalAgentId = data.agentId;

    // Validate FK references — use null if the referenced row doesn't exist
    // (e.g. custom Ollama model IDs are not in the seed models table)
    const rawProviderId = data.providerId || null;
    const rawModelId = data.modelId || null;
    const safeProviderId = rawProviderId && db.query("SELECT id FROM providers WHERE id = ?").get(rawProviderId) ? rawProviderId : null;
    const safeModelId = rawModelId && db.query("SELECT id FROM models WHERE id = ?").get(rawModelId) ? rawModelId : null;

    // Si no se pasa agentId, dejar que SQLite lo genere automáticamente
    if (!finalAgentId) {
      const result = db.query(`
        INSERT INTO agents
  (user_id, name, description, tone, system_prompt, provider_id, model_id, status, role, enabled)
VALUES(?, ?, ?, ?, ?, ?, ?, 'idle', 'coordinator', 1)
        RETURNING id
  `).get(
        data.userId,
        data.agentName,
        data.description || null,
        data.tone,
        HIVE_SYSTEM_PROMPT,
        safeProviderId,
        safeModelId
      ) as { id: string };
      finalAgentId = result.id;
      log.info("✅ Agent created with auto-generated ID", { agentId: finalAgentId });
    } else {
      // INSERT or UPDATE agent (crea nuevo o actualiza existente)
      db.query(`
        INSERT INTO agents
  (id, user_id, name, description, tone, system_prompt, provider_id, model_id, status, role, enabled)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'coordinator', 1)
        ON CONFLICT(id) DO UPDATE SET
user_id = COALESCE(excluded.user_id, user_id),
  name = COALESCE(excluded.name, name),
  description = COALESCE(excluded.description, description),
  tone = COALESCE(excluded.tone, tone),
  system_prompt = excluded.system_prompt,
  provider_id = COALESCE(excluded.provider_id, provider_id),
  model_id = COALESCE(excluded.model_id, model_id),
  status = 'idle',
  enabled = 1,
  role = 'coordinator'
    `).run(
        data.agentId,
        data.userId,
        data.agentName,
        data.description || null,
        data.tone,
        HIVE_SYSTEM_PROMPT,
        safeProviderId,
        safeModelId
      );
    }

    return finalAgentId;
  } catch (e) {
    log.error("⚠️ Error saving agent:", { error: (e as Error).message });
    throw e;
  }
}

export async function activateChannel(userId: string, data: {
  channelId: string;
  channelUserId?: string; // For creating user_identity
  config?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();

    if (data.config && Object.keys(data.config).length > 0) {
      const encrypted = await encryptConfig(data.config);
      db.query(`
        UPDATE channels 
        SET user_id = ?, active = 1, enabled = 1, status = 'connected',
  config_encrypted = ?, config_iv = ?
    WHERE id = ?
      `).run(userId, encrypted.encrypted, encrypted.iv, data.channelId);
    } else {
      db.query(`
        UPDATE channels 
        SET user_id = ?, active = 1, enabled = 1, status = 'connected'
        WHERE id = ?
  `).run(userId, data.channelId);
    }

    // Create user_identity for the channel if channelUserId provided
    if (data.channelUserId) {
      const channelType = data.channelId; // webchat, telegram, discord, etc.
      db.query(`
        INSERT OR REPLACE INTO user_identities(user_id, channel, channel_user_id)
VALUES(?, ?, ?)
      `).run(userId, channelType, data.channelUserId);
      log.info("✅ User identity created", { userId, channel: channelType });
    }

    log.info("✅ Channel activated:", { channelId: data.channelId, userId });
  } catch (e) {
    log.error("⚠️ Error activating channel:", { error: (e as Error).message });
  }
}

export async function saveVoiceConfig(data: {
  userId: string;
  channelId: string;
  voiceEnabled: boolean;
  sttProvider: string;
  ttsProvider: string;
  sttApiKey?: string;
  ttsApiKey?: string;
}): Promise<void> {
  try {
    const db = getDb();

    // Activate STT and TTS models
    db.query(`UPDATE models SET active = 1, enabled = 1 WHERE id = ? `).run(data.sttProvider);
    db.query(`UPDATE models SET active = 1, enabled = 1 WHERE id = ? `).run(data.ttsProvider);

    // Determine provider IDs based on model IDs
    let sttProviderId = "";
    let ttsProviderId = "";

    if (data.sttProvider.startsWith("whisper") || data.sttProvider === "distil-whisper-large-v3-en") {
      sttProviderId = "groq";
    } else if (data.sttProvider === "whisper-1") {
      sttProviderId = "openai";
    }

    if (data.ttsProvider.startsWith("eleven")) {
      ttsProviderId = "elevenlabs";
    } else if (data.ttsProvider.startsWith("tts-") || data.ttsProvider.startsWith("gpt-")) {
      ttsProviderId = "openai";
    } else if (data.ttsProvider.startsWith("gemini")) {
      ttsProviderId = "gemini";
    } else if (data.ttsProvider.startsWith("qwen")) {
      ttsProviderId = "qwen";
    }

    // Save STT API key to provider if provided
    if (data.sttApiKey && sttProviderId) {
      const encrypted = await encryptApiKey(data.sttApiKey);
      db.query(`
        UPDATE providers SET
api_key_encrypted = ?,
  api_key_iv = ?,
  enabled = 1,
  active = 1
        WHERE id = ?
  `).run(encrypted.encrypted, encrypted.iv, sttProviderId);
      log.info("✅ STT API key guardada en BD (encriptada)", { provider: sttProviderId });
    }

    // Save TTS API key to provider if provided
    if (data.ttsApiKey && ttsProviderId) {
      const encrypted = await encryptApiKey(data.ttsApiKey);
      db.query(`
        UPDATE providers SET
api_key_encrypted = ?,
  api_key_iv = ?,
  enabled = 1,
  active = 1
        WHERE id = ?
  `).run(encrypted.encrypted, encrypted.iv, ttsProviderId);
      log.info("✅ TTS API key guardada en BD (encriptada)", { provider: ttsProviderId });
    }

    // Update channel with voice config
    db.query(`
      UPDATE channels 
      SET user_id = ?, voice_enabled = ?, stt_provider = ?, tts_provider = ?
  WHERE id = ?
    `).run(data.userId, data.voiceEnabled ? 1 : 0, data.sttProvider, data.ttsProvider, data.channelId);

    log.info("✅ Voice config saved:", {
      channelId: data.channelId,
      userId: data.userId,
      sttProvider: data.sttProvider,
      ttsProvider: data.ttsProvider,
      sttProviderId,
      ttsProviderId
    });
  } catch (e) {
    log.error("⚠️ Error saving voice config:", { error: (e as Error).message });
  }
}

export async function saveMcpServer(data: {
  userId: string;
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}): Promise<void> {
  try {
    const db = getDb();

    const mcpId = `${data.userId}:${data.name} `;

    let envEncrypted = null;
    let envIv = null;

    if (data.env && Object.keys(data.env).length > 0) {
      const encrypted = await encryptConfig(data.env as Record<string, unknown>);
      envEncrypted = encrypted.encrypted;
      envIv = encrypted.iv;
    }

    db.query(`
      INSERT OR REPLACE INTO mcp_servers
  (id, user_id, name, transport, command, args, env_encrypted, env_iv, url, enabled, builtin)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
      mcpId,
      data.userId,
      data.name,
      data.transport,
      data.command || null,
      JSON.stringify(data.args || []),
      envEncrypted,
      envIv,
      data.url || null,
      data.enabled ? 1 : 0
    );

    log.info("✅ MCP server saved:", { name: data.name });
  } catch (e) {
    log.error("⚠️ Error saving MCP server:", { error: (e as Error).message });
  }
}

export function saveToolSelection(userId: string, tools: string[]): void {
  try {
    const db = getDb();

    for (const tool of tools) {
      // Activar la herramienta (ya existe del seed)
      db.query(`
        UPDATE tools SET active = 1, enabled = 1
        WHERE id = ?
  `).run(tool);
    }

    log.info("✅ Tools activadas:", { tools: tools.join(", ") });
  } catch (e) {
    log.error("⚠️ Error saving tools:", { error: (e as Error).message });
  }
}

export function activateProvider(providerId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE providers SET active = 1, enabled = 1
      WHERE id = ?
  `).run(providerId);
    log.info("✅ Provider activado:", { providerId });
  } catch (e) {
    log.error("⚠️ Error activating provider:", { error: (e as Error).message });
  }
}

export function activateModel(modelId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE models SET active = 1, enabled = 1
      WHERE id = ?
  `).run(modelId);
    log.info("✅ Model activado:", { modelId });
  } catch (e) {
    log.error("⚠️ Error activating model:", { error: (e as Error).message });
  }
}



export function activateMcpServer(mcpName: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE mcp_servers SET active = 1, enabled = 1
      WHERE id = ?
  `).run(mcpName);
    log.info("✅ MCP server activado:", { mcpName });
  } catch (e) {
    log.error("⚠️ Error activating MCP server:", { error: (e as Error).message });
  }
}

export function deactivateProvider(providerId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE providers SET active = 0, enabled = 0
      WHERE id = ?
  `).run(providerId);
    log.warn("⚠️ Provider desactivado:", { providerId });
  } catch (e) {
    log.error("⚠️ Error deactivating provider:", { error: (e as Error).message });
  }
}

export function deactivateModel(modelId: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE models SET active = 0, enabled = 0
      WHERE id = ?
  `).run(modelId);
    log.warn("⚠️ Model desactivado:", { modelId });
  } catch (e) {
    log.error("⚠️ Error deactivating model:", { error: (e as Error).message });
  }
}

export function deactivateChannel(channelType: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE channels SET active = 0, enabled = 0
      WHERE id = ?
  `).run(channelType);
    log.warn("⚠️ Channel desactivado:", { channelType });
  } catch (e) {
    log.error("⚠️ Error deactivating channel:", { error: (e as Error).message });
  }
}

export function deactivateMcpServer(mcpName: string): void {
  try {
    const db = getDb();
    db.query(`
      UPDATE mcp_servers SET active = 0, enabled = 0
      WHERE id = ?
  `).run(mcpName);
    log.warn("⚠️ MCP server desactivado:", { mcpName });
  } catch (e) {
    log.error("⚠️ Error deactivating MCP server:", { error: (e as Error).message });
  }
}

export function getAllProviders(): Array<{
  id: string;
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, base_url, enabled, active
      FROM providers
  `).all() as Array<{
      id: string;
      name: string;
      base_url: string | null;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      baseUrl: r.base_url,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting providers:", (e as Error).message);
    return [];
  }
}

export function getAllModels(): Array<{
  id: string;
  name: string;
  providerId: string;
  contextWindow: number | null;
  capabilities: string | null;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, provider_id, context_window, capabilities, enabled, active
      FROM models
  `).all() as Array<{
      id: string;
      name: string;
      provider_id: string;
      context_window: number | null;
      capabilities: string | null;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      providerId: r.provider_id,
      contextWindow: r.context_window,
      capabilities: r.capabilities,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting models:", { error: (e as Error).message });
    return [];
  }
}

export function getAllEthics(): Array<{
  id: string;
  name: string;
  description: string | null;
  content: string;
  isDefault: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, description, content, is_default, active
      FROM ethics
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      content: string;
      is_default: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      content: r.content,
      isDefault: r.is_default === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting ethics:", { error: (e as Error).message });
    return [];
  }
}

export function getAllCodeBridge(): Array<{
  id: string;
  name: string;
  cliCommand: string;
  port: number;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, cli_command, port, enabled, active
      FROM code_bridge
  `).all() as Array<{
      id: string;
      name: string;
      cli_command: string;
      port: number;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      cliCommand: r.cli_command,
      port: r.port,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting code bridge:", { error: (e as Error).message });
    return [];
  }
}

export function getAllSkills(): Array<{
  id: string;
  name: string;
  description: string | null;
  source: string;
  isGlobal: boolean;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, api_key_encrypted, api_key_iv, base_url, enabled
      FROM providers
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      source: string;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      isGlobal: false,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting skills:", { error: (e as Error).message });
    return [];
  }
}

export function getAllDbTools(): Array<{
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, description, category, enabled, active
      FROM tools
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      category: string | null;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting tools:", { error: (e as Error).message });
    return [];
  }
}

export function getAllMcpServers(): Array<{
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  url: string | null;
  builtin: boolean;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, transport, command, args, url, builtin, enabled, active
      FROM mcp_servers
  `).all() as Array<{
      id: string;
      name: string;
      transport: string;
      command: string | null;
      args: string | null;
      url: string | null;
      builtin: number;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      transport: r.transport,
      command: r.command,
      args: r.args,
      url: r.url,
      builtin: r.builtin === 1,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.error("⚠️ Error getting MCP servers:", { error: (e as Error).message });
    return [];
  }
}

export function getAllChannels(): Array<{
  id: string;
  type: string;
  accountId: string;
  status: string;
  enabled: boolean;
  active: boolean;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, type, id as account_id, status, enabled, active
      FROM channels
  `).all() as Array<{
      id: string;
      type: string;
      account_id: string;
      status: string;
      enabled: number;
      active: number;
    }>;

    return results.map(r => ({
      id: r.id,
      type: r.type,
      accountId: r.id,
      status: r.status,
      enabled: r.enabled === 1,
      active: r.active === 1,
    }));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting channels:", (e as Error).message);
    return [];
  }
}

export function getActiveTools(): Array<{
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, description, category
      FROM tools WHERE active = 1
  `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      category: string | null;
    }>;

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
    }));
  } catch (e) {
    log.error("⚠️ Error getting active tools:", { error: (e as Error).message });
    return [];
  }
}

export function getOnboardingProgress(userId: string): OnboardingSection | null {
  try {
    const db = getDb();
    const result = db.query<{ step: string; data: string }, [string]>(
      "SELECT step, data FROM onboarding_progress WHERE user_id = ? LIMIT 1"
    ).get(userId);

    if (result) {
      return {
        step: result.step as OnboardingSection["step"],
        userId,
        data: JSON.parse(result.data),
        completedAt: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveOnboardingProgress(section: OnboardingSection): void {
  try {
    const db = getDb();
    db.query(`
      INSERT OR REPLACE INTO onboarding_progress(id, user_id, step, data)
VALUES(?, ?, ?, ?)
  `).run(section.userId, section.userId, section.step, JSON.stringify(section.data));
  } catch (e) {
    log.error("⚠️ Error saving progress:", { error: (e as Error).message });
  }
}

export async function getUserProviders(userId: string): Promise<Array<{
  id: string;
  name: string;
  apiKey: string | null;
  baseUrl: string | null;
  enabled: boolean;
}>> {
  try {
    const db = getDb();
    const results = db.query(`
      SELECT id, name, api_key_encrypted, api_key_iv, base_url, enabled
      FROM providers
  `).all() as Array<{
      id: string;
      name: string;
      api_key_encrypted: string | null;
      api_key_iv: string | null;
      base_url: string | null;
      enabled: number;
    }>;

    return Promise.all(results.map(async r => ({
      id: r.name,
      name: r.name,
      apiKey: r.api_key_encrypted && r.api_key_iv
        ? await decryptApiKey(r.api_key_encrypted, r.api_key_iv)
        : null,
      baseUrl: r.base_url,
      enabled: r.enabled === 1,
    })));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting providers:", (e as Error).message);
    return [];
  }
}

export async function getUserChannels(userId: string): Promise<Array<{
  id: string;
  type: string;
  accountId: string;
  config: Record<string, unknown>;
  enabled: boolean;
}>> {
  try {
    const db = getDb();
    const results = db.query<{
      id: string;
      type: string;
      account_id: string;
      config_encrypted: string | null;
      config_iv: string | null;
      enabled: number;
    }, [string]>(`
      SELECT id, type, id as account_id, config_encrypted, config_iv, enabled
      FROM channels WHERE user_id = ?
  `).all(userId);

    return Promise.all(results.map(async r => ({
      id: r.type,
      type: r.type,
      accountId: r.id,
      config: r.config_encrypted && r.config_iv
        ? await decryptConfig(r.config_encrypted, r.config_iv)
        : {},
      enabled: r.enabled === 1,
    })));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting channels:", (e as Error).message);
    return [];
  }
}

export function getUserAgents(userId: string): Array<{
  id: string;
  name: string;
  providerId: string | null;
  modelId: string | null;
  tone: string;
}> {
  try {
    const db = getDb();
    const results = db.query<{
      id: string;
      name: string;
      provider_id: string | null;
      model_id: string | null;
      tone: string;
    }, [string]>(`
      SELECT id, name, provider_id, model_id, tone
      FROM agents WHERE user_id = ?
  `).all(userId);

    return results.map(r => ({
      id: r.id,
      name: r.name,
      providerId: r.provider_id,
      modelId: r.model_id,
      tone: r.tone || "friendly",
    }));
  } catch (e) {
    log.error("⚠️ Error getting agents:", { error: (e as Error).message });
    return [];
  }
}

// ─── Identity Resolution Helpers ──────────────────────────────────────────────
// These functions resolve userId and agentId from the database instead of environment variables

/**
 * Get the single user ID from the database.
 * Hive is designed around a single-user model, so this returns the first user found.
 * @returns The user ID or null if no users exist
 */
export function getSingleUserId(): string | null {
  try {
    const db = getDb();
    const result = db.query("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
    return result?.id || null;
  } catch (e) {
    log.warn("[getSingleUserId] ⚠️ Error getting user ID:", (e as Error).message);
    return null;
  }
}

/**
 * Get the coordinator agent ID from the database.
 * The coordinator is the agent with role = 'coordinator'.
 * @returns The coordinator agent ID or null if not found
 */
export function getCoordinatorAgentId(): string | null {
  try {
    const db = getDb();
    const result = db.query("SELECT id FROM agents WHERE role = 'coordinator' LIMIT 1").get() as { id: string } | undefined;
    return result?.id || null;
  } catch (e) {
    log.warn("[getCoordinatorAgentId] ⚠️ Error getting coordinator agent ID:", (e as Error).message);
    return null;
  }
}

/**
 * Get the user ID associated with a specific channel identity.
 * @param channel The channel type (e.g., 'webchat', 'telegram', 'discord')
 * @param channelUserId The channel-specific user ID (e.g., Telegram chat_id)
 * @returns The Hive user ID or null if not found
 */
export function getUserIdFromChannelIdentity(channel: string, channelUserId: string): string | null {
  try {
    const db = getDb();
    const result = db.query(
      "SELECT user_id FROM user_identities WHERE channel = ? AND channel_user_id = ? LIMIT 1"
    ).get(channel, channelUserId) as { user_id: string } | undefined;
    return result?.user_id || null;
  } catch (e) {
    log.warn("[getUserIdFromChannelIdentity] ⚠️ Error getting user ID from channel identity:", (e as Error).message);
    return null;
  }
}

/**
 * Resolve the user ID from various sources with priority:
 * 1. Explicit userId parameter
  * 2. Channel identity lookup (if channel and channelUserId provided)
  * 3. Single user from database
  * 4. Null (no user found)
  */
export function resolveUserId(
  opts: {
    userId?: string | null;
    threadId?: string | null;
    channel?: string | null;
    channelUserId?: string | null;
  }
): string | null {
  // Priority 1: Explicit userId
  if (opts.userId) {
    return opts.userId;
  }

  // Priority 2: Channel identity lookup
  if (opts.channel && opts.channelUserId) {
    const userId = getUserIdFromChannelIdentity(opts.channel, opts.channelUserId);
    if (userId) {
      return userId;
    }
  }

  // Priority 3: Single user from database
  const singleUserId = getSingleUserId();
  if (singleUserId) {
    return singleUserId;
  }

  // Priority 4: No user found
  return null;
}

/**
 * Get the default agent ID with priority:
 * 1. Coordinator agent (role = 'coordinator')
 * 2. First enabled agent
 * 3. Null (no agent found)
 */
export function getDefaultAgentId(): string | null {
  try {
    const db = getDb();

    // Try coordinator first
    const coordinator = db.query(
      "SELECT id FROM agents WHERE role = 'coordinator' AND enabled = 1 LIMIT 1"
    ).get() as { id: string } | undefined;

    if (coordinator?.id) {
      return coordinator.id;
    }

    // Fallback to first enabled agent
    const firstAgent = db.query(
      "SELECT id FROM agents WHERE enabled = 1 LIMIT 1"
    ).get() as { id: string } | undefined;

    return firstAgent?.id || null;
  } catch (e) {
    log.warn("[getDefaultAgentId] ⚠️ Error getting default agent ID:", (e as Error).message);
    return null;
  }
}

/**
 * Resolve the agent ID with priority:
 * 1. Explicit agentId parameter
 * 2. Coordinator agent from database
 * 3. First enabled agent from database
 * 4. Null (no agent found)
 */
export function resolveAgentId(agentId?: string | null): string | null {
  // Priority 1: Explicit agentId
  if (agentId) {
    return agentId;
  }

  // Priority 2: Default from database (coordinator or first enabled)
  return getDefaultAgentId();
}

/**
 * Get user preferences (notes) for a given user ID
 */
export function getUserPreferences(userId: string): string | null {
  try {
    const db = getDb();
    const result = db.query("SELECT notes FROM users WHERE id = ?").get(userId) as { notes: string | null } | undefined;
    return result?.notes || null;
  } catch (e) {
    log.warn("[getUserPreferences] ⚠️ Error getting user preferences:", (e as Error).message);
    return null;
  }
}

/**
 * Get agent configuration by ID
 */
export function getAgentConfig(agentId: string): {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  tone: string | null;
  provider_id: string | null;
  model_id: string | null;
  tools_json: string | null;
  skills_json: string | null;
  max_iterations: number;
} | null {
  try {
    const db = getDb();
    const result = db.query(`
      SELECT id, user_id, name, description, system_prompt, tone,
  provider_id, model_id, tools_json, skills_json, max_iterations
      FROM agents WHERE id = ?
  `).get(agentId) as {
      id: string;
      user_id: string;
      name: string;
      description: string | null;
      system_prompt: string | null;
      tone: string | null;
      provider_id: string | null;
      model_id: string | null;
      tools_json: string | null;
      skills_json: string | null;
      max_iterations: number;
    } | undefined;

    return result || null;
  } catch (e) {
    log.warn("[getAgentConfig] ⚠️ Error getting agent config:", (e as Error).message);
    return null;
  }
}

/**
 * Idempotent startup migrations. Runs on every gateway start.
 * Each migration is guarded by the schema_migrations table — once applied, it never re-runs.
 */
export function runStartupMigrations(): void {
  try {
    const db = getDb();

    const applied = (v: string) =>
      !!db.query("SELECT 1 FROM schema_migrations WHERE version = ?").get(v);
    const markApplied = (v: string) =>
      db.query("INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)").run(v);

    // v0.0.29 — consolidate tools + skills: drop and recreate tables with current schema, reseed
    if (!applied("v0.0.29")) {
      const db = getDb();
      log.info("[migration v0.0.29] Dropping and recreating tools + skills tables...");

      db.run("DROP TABLE IF EXISTS skills_fts");
      db.run("DROP TABLE IF EXISTS skills");
      db.run("DROP TABLE IF EXISTS tools_fts");
      db.run("DROP TABLE IF EXISTS tools");

      db.run(`CREATE TABLE tools (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        category    TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )`);

      db.run(`CREATE VIRTUAL TABLE tools_fts USING fts5(tool_name, name, description, category)`);

      db.run(`CREATE TABLE skills (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        description      TEXT,
        version          TEXT DEFAULT '0.0.1',
        author           TEXT DEFAULT 'Anonymous',
        icon             TEXT DEFAULT '🧩',
        category         TEXT NOT NULL,
        permissions      TEXT,
        dependencies     TEXT,
        tools            TEXT NOT NULL,
        triggers         TEXT NOT NULL,
        preferred_agents TEXT,
        body             TEXT NOT NULL,
        version_num      INTEGER DEFAULT 1,
        active           INTEGER DEFAULT 1,
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
      )`);

      db.run(`CREATE VIRTUAL TABLE skills_fts USING fts5(id, name, description, category, tools, triggers, body)`);

      db.run("CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)");
      db.run("CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(active)");

      db.run(`DROP TRIGGER IF EXISTS skills_ai`);
      db.run(`DROP TRIGGER IF EXISTS skills_au`);
      db.run(`DROP TRIGGER IF EXISTS skills_ad`);
      db.run(`CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(id, name, description, category, tools, triggers, body)
        VALUES (new.id, new.name, new.description, new.category, new.tools, new.triggers, new.body);
      END`);
      db.run(`CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
        DELETE FROM skills_fts WHERE id = old.id;
        INSERT INTO skills_fts(id, name, description, category, tools, triggers, body)
        VALUES (new.id, new.name, new.description, new.category, new.tools, new.triggers, new.body);
      END`);
      db.run(`CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
        DELETE FROM skills_fts WHERE id = old.id;
      END`);

      // Reseed tools
      const insertToolFts = db.prepare(`INSERT OR REPLACE INTO tools_fts(tool_name, name, description, category) VALUES (?, ?, ?, ?)`);
      let toolCount = 0;
      for (const tool of SEED_DATA.tools) {
        db.query(`INSERT INTO tools (id, name, description, category, enabled, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, (unixepoch()), (unixepoch()))`)
          .run(tool.id, tool.name, tool.description, tool.category);
        insertToolFts.run(tool.name, tool.name, tool.description, tool.category);
        toolCount++;
      }
      log.info(`[migration v0.0.29] ✅ ${toolCount} tools re-seeded`);

      // Reseed skills from SkillLoader
      const skillLoader = new SkillLoader({ workspacePath: process.env.HIVE_HOME || process.cwd() });
      const bundledSkills = skillLoader.loadBundledSkills();
      log.info(`[migration v0.0.29] 📚 SkillLoader loaded ${bundledSkills.length} bundled skills`);
      let skillCount = 0;
      for (const s of bundledSkills) {
        db.query(`
          INSERT OR REPLACE INTO skills (
            id, name, description, version, author, icon, category,
            permissions, dependencies, tools, triggers, preferred_agents,
            body, version_num, active, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, (unixepoch()), (unixepoch()))
        `).run(
          s.name, s.name, s.description || "",
          typeof s.version === "string" ? s.version : String(s.version || "0.0.1"),
          s.author || "Anonymous",
          s.icon || "🧩",
          s.category || "general",
          JSON.stringify(s.permissions || []),
          JSON.stringify(s.dependencies || []),
          (s.tools || []).join(","),
          (s.triggers || []).join(","),
          JSON.stringify(s.preferred_agents || []),
          s.content || "",
          parseInt(String(s.version || "0.0.1").split(".")[0]) || 1
        );
        skillCount++;
      }
      log.info(`[migration v0.0.29] ✅ ${skillCount} skills re-seeded (FTS5 auto-synced via triggers)`);

      markApplied("v0.0.29");
      log.info("✅ Migration v0.0.29: tools + skills consolidated, dropped and recreated");
    }

    // v0.0.30 — add NVIDIA NIM provider + 12 free models (without dropping existing data)
    if (!applied("v0.0.30")) {
      const db = getDb();
      log.info("[migration v0.0.30] Ensuring providers table exists...");
      db.run(`CREATE TABLE IF NOT EXISTS providers (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL UNIQUE,
        api_key_encrypted TEXT,
        api_key_iv      TEXT,
        headers_encrypted TEXT,
        headers_iv      TEXT,
        base_url        TEXT,
        category        TEXT NOT NULL DEFAULT 'llm',
        num_ctx         INTEGER,
        num_gpu         INTEGER DEFAULT -1,
        enabled         INTEGER NOT NULL DEFAULT 1,
        active          INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      )`);
      log.info("[migration v0.0.30] Ensuring models table exists...");
      db.run(`CREATE TABLE IF NOT EXISTS models (
        id              TEXT PRIMARY KEY,
        provider_id     TEXT REFERENCES providers(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        model_type      TEXT NOT NULL DEFAULT 'llm',
        context_window  INTEGER NOT NULL DEFAULT 20000,
        capabilities    TEXT,
        enabled         INTEGER NOT NULL DEFAULT 1,
        active          INTEGER NOT NULL DEFAULT 0
      )`);
      db.run("CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id)");
      db.run("CREATE INDEX IF NOT EXISTS idx_models_type ON models(model_type)");
      log.info("[migration v0.0.30] Adding new providers and models...");
      for (const provider of SEED_DATA.providers) {
        db.query(`
          INSERT OR IGNORE INTO providers (id, name, base_url, category, enabled, active)
          VALUES (?, ?, ?, ?, 1, 0)
        `).run(provider.id, provider.name, provider.baseUrl || null, provider.category || 'llm');
      }
      const ollamaHost = process.env.OLLAMA_HOST;
      if (ollamaHost) {
        db.query(`UPDATE providers SET base_url = ? WHERE id = 'ollama'`).run(ollamaHost);
        log.info(`[migration v0.0.30] ✅ Ollama base_url set to ${ollamaHost} (from OLLAMA_HOST env)`);
      }
      let modelCount = 0;
      for (const model of SEED_DATA.models) {
        db.query(`
          INSERT OR IGNORE INTO models (id, provider_id, name, model_type, context_window, capabilities, enabled, active)
          VALUES (?, ?, ?, ?, ?, ?, 1, 0)
        `).run(model.id, model.providerId, model.name, model.modelType, model.contextWindow || null, model.capabilities || null);
        modelCount++;
      }
      log.info(`[migration v0.0.30] ✅ Added ${SEED_DATA.providers.length} providers and ${modelCount} models`);
      markApplied("v0.0.30");
      log.info("✅ Migration v0.0.30: NVIDIA NIM provider + 12 free models added");
    }

    // v0.0.31 — Update coordinator system_prompt to reduced version + sync bundled skills
    if (!applied("v0.0.31")) {
      const db = getDb();
      log.info("[migration v0.0.31] Updating coordinator system_prompt...");

      // Update coordinator system_prompt with new concise version
      db.run(`UPDATE agents SET system_prompt = ? WHERE role = 'coordinator'`, [HIVE_SYSTEM_PROMPT]);
      const updated = db.query("SELECT name FROM agents WHERE role = 'coordinator' AND system_prompt = ?").get(HIVE_SYSTEM_PROMPT);
      if (updated) {
        log.info("[migration v0.0.31] ✅ Coordinator system_prompt updated");
      } else {
        log.warn("[migration v0.0.31] ⚠️ Coordinator update may have failed - checking length...");
      }

      // Add/update skills from bundled data (busqueda_fts5, canvas_report, memory_manager minimal set)
      log.info("[migration v0.0.31] Verifying minimal skills exist...");
      const skillLoader = new SkillLoader({ workspacePath: process.env.HIVE_HOME || process.cwd() });
      const bundledSkills = skillLoader.loadBundledSkills();

      let skillsAdded = 0;
      for (const s of bundledSkills) {
        db.query(`
          INSERT OR IGNORE INTO skills (
            id, name, description, version, author, icon, category,
            permissions, dependencies, tools, triggers, preferred_agents,
            body, version_num, active, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, (unixepoch()), (unixepoch()))
        `).run(
          s.name, s.name, s.description || "", String(s.version || "1.0.0"),
          s.author || "Hive", s.icon || "🧩", s.category || "general",
          JSON.stringify(s.permissions || []), JSON.stringify(s.dependencies || []),
          (s.tools || []).join(","), (s.triggers || []).join(","), "[]",
          s.content || "", 100
        );
        skillsAdded++;
      }
      log.info(`[migration v0.0.31] ✅ ${skillsAdded} skills synced from bundle`);

      // Sync skills_fts (FTS5 index)
      log.info("[migration v0.0.31] Syncing skills_fts index...");
      db.run("DELETE FROM skills_fts");
      const ftsInsert = db.prepare("INSERT INTO skills_fts(id, name, description, category, tools, triggers, body) VALUES(?, ?, ?, ?, ?, ?, ?)");
      const activeSkills = db.query("SELECT * FROM skills WHERE active = 1").all() as any[];
      for (const s of activeSkills) {
        ftsInsert.run(s.id, s.name, s.description || "", s.category || "", s.tools || "", s.triggers || "", s.body || "");
      }
      log.info(`[migration v0.0.31] ✅ ${activeSkills.length} skills indexed in FTS5`);

    markApplied("v0.0.31");
    log.info("✅ Migration v0.0.31: Reduced system_prompt + skills sync");
  }

  // v0.0.32 — add vision/multimodal columns to channels table
  if (!applied("v0.0.32")) {
    const db = getDb();
    log.info("[migration v0.0.32] Adding vision columns to channels table...");

    const addCol = (col: string, def: string) => {
      try { db.run(`ALTER TABLE channels ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
    };
    addCol("vision_enabled", "INTEGER NOT NULL DEFAULT 0");
    addCol("ocr_provider", "TEXT");
    addCol("vision_provider", "TEXT");
    addCol("vision_model_id", "TEXT");

    markApplied("v0.0.32");
    log.info("✅ Migration v0.0.32: vision columns added to channels");
  }
  } catch (e) {
    log.error("⚠️ runStartupMigrations failed:", { error: (e as Error).message });
  }
}
