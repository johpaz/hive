import { logger } from "../utils/logger.ts";
import { ensureHiveDb } from "./bootstrap";
import { col, toIndexable, fromIndexable } from "./hive";
import {
  storeProviderApiKey,
  storeChannelConfig,
  storeMcpEnv,
  loadProviderApiKey,
  loadChannelConfig,
} from "./crypto";
import { SkillLoader } from "@johpaz/hive-agents-skills";
import type {
  UserDoc, ProviderDoc, ModelDoc, AgentDoc, ChannelDoc, McpServerDoc,
  UserIdentityDoc, OnboardingProgressDoc, EthicsDoc, SkillDoc, ToolDoc,
} from "./collections";

export interface OnboardingSection {
  step: "user" | "skills" | "ethics" | "tools" | "provider" | "model" | "channel" | "mcp" | "agent" | "complete";
  userId: string;
  data: Record<string, unknown>;
  completedAt?: number;
}

const log = logger.child("onboarding");

const HIVE_SYSTEM_PROMPT = `
# HIVE — Agente Coordinador

Sos Bee, coordinador de Hive. Resolvés tareas del usuario directamente o delegando a workers especializados. Tu rol es "coordinator".

## ⚡ REGLAS CRÍTICAS

1. **Ética primero** — Operás bajo un Código de Ética obligatorio. No podés ignorarlo.
2. **Confirmá antes de guardar** — Siempre verificá con el usuario antes de persistir datos en la BD.
3. **Buscá antes de crear** — Usá search_knowledge para capacidades, find_agent para workers.
4. **Mínimo privilegio** — Asigná solo las tools necesarias a cada worker.
5. **Nunca cli_exec para cron** — Usá siempre cron.create para tareas programadas.
6. **Preguntá si no encontrás nada** — Si \`search_knowledge\` no devuelve resultados y el pedido es corto o ambiguo, preguntale al usuario qué quiere decir o dónde buscar (web, sus archivos, una herramienta puntual) en vez de adivinar la intención y encadenar más búsquedas por tu cuenta. Una pregunta cuesta un turno; adivinar mal cuesta varios.
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

**Tarea compleja (múltiples workers):** Creá un agente con create_agent, descomponé el trabajo, delegá con delegate_task.

**Worker:** find_agent → ¿existe? → reutilizalo. Si no → create_agent con system_prompt claro y tools_json mínimo. **delegate_task** lo activa.

**Cierre:** Usá notify o report_progress para informar al usuario del resultado final.

## 🧠 MEMORIA

- \`save_note\` — Persiste notas por conversación (sobrevive compresión)
- \`memory_write\` / \`memory_read\` — Memoria cross-conversación por clave
- Playbook — Reglas aprendidas inyectadas automáticamente

## 📡 CANALES

webchat (siempre activo) · telegram · discord · slack · whatsapp
Canal preferido para cron: telegram > discord > webchat
`

/** Generates a 32-char lowercase hex id, matching the old `lower(hex(randomblob(16)))` scheme. */
function genId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function initOnboardingDb(): Promise<void> {
  try {
    // ensureHiveDb() already reseeds the static catalogs unconditionally on
    // every call — no separate userCount gate/seedAllData() call needed here.
    await ensureHiveDb();
  } catch (e) {
    log.error("⚠️ Fallo al inicializar/poblar la DB:", { error: (e as Error).message });
  }
}

export async function saveUserProfile(data: {
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
}): Promise<string> {
  try {
    const usersCol = await col<UserDoc>("users");
    let finalUserId = data.userId;

    if (!finalUserId) {
      finalUserId = genId();
      await usersCol.put(finalUserId, {
        id: finalUserId,
        name: data.userName || null,
        language: data.userLanguage || null,
        timezone: data.userTimezone || null,
        occupation: data.userOccupation || null,
        notes: data.userNotes || null,
        master_key_hash: null,
        email: null,
        password_hash: null,
        preferred_cron_channel: "auto",
        created_at: Date.now(),
      });
      log.info("✅ User created with auto-generated ID", { userId: finalUserId });
    } else {
      const existing = await usersCol.get(finalUserId);
      await usersCol.put(finalUserId, {
        id: finalUserId,
        name: data.userName ?? existing?.doc.name ?? null,
        language: data.userLanguage ?? existing?.doc.language ?? null,
        timezone: data.userTimezone ?? existing?.doc.timezone ?? null,
        occupation: data.userOccupation ?? existing?.doc.occupation ?? null,
        notes: data.userNotes ?? existing?.doc.notes ?? null,
        master_key_hash: existing?.doc.master_key_hash ?? null,
        email: existing?.doc.email ?? null,
        password_hash: existing?.doc.password_hash ?? null,
        preferred_cron_channel: existing?.doc.preferred_cron_channel ?? "auto",
        created_at: existing?.doc.created_at ?? Date.now(),
      }, existing ? { expectedVersion: existing.version } : undefined);
    }

    // 2️⃣ Crear identidad base para webchat (sesión única)
    if (data.channelUserId) {
      const identitiesCol = await col<UserIdentityDoc>("userIdentities");
      await identitiesCol.put(`${finalUserId}:webchat`, {
        user_id: finalUserId, channel: "webchat", channel_user_id: data.channelUserId, linked_at: Date.now(),
      });
      log.info("✅ User identity created for webchat", { userId: finalUserId });
    }

    // 3️⃣ Crear o actualizar agente
    if (data.agentId && data.agentName) {
      const agentsCol = await col<AgentDoc>("agents");
      const existingAgent = await agentsCol.get(data.agentId);
      const now = Date.now();
      await agentsCol.put(data.agentId, {
        id: data.agentId,
        user_id: finalUserId,
        name: data.agentName,
        description: data.agentDescription ?? existingAgent?.doc.description ?? null,
        system_prompt: HIVE_SYSTEM_PROMPT,
        tone: data.agentTone ?? existingAgent?.doc.tone ?? null,
        role: "coordinator",
        status: existingAgent?.doc.status ?? "idle",
        enabled: existingAgent?.doc.enabled ?? true,
        provider_id: existingAgent?.doc.provider_id ?? toIndexable(null),
        model_id: existingAgent?.doc.model_id ?? toIndexable(null),
        tools_json: existingAgent?.doc.tools_json ?? null,
        skills_json: existingAgent?.doc.skills_json ?? null,
        parent_id: existingAgent?.doc.parent_id ?? toIndexable(null),
        max_iterations: existingAgent?.doc.max_iterations ?? 10,
        workspace: existingAgent?.doc.workspace ?? null,
        lastTraceAt: existingAgent?.doc.lastTraceAt ?? null,
        created_at: existingAgent?.doc.created_at ?? now,
        updated_at: now,
      }, existingAgent ? { expectedVersion: existingAgent.version } : undefined);
    }

    return finalUserId;
  } catch (e) {
    log.error("⚠️ Error saving user profile:", { error: (e as Error).message });
    throw e;
  }
}

export async function activateSkills(userId: string, skillIds: string[]): Promise<void> {
  try {
    const skillsCol = await col<SkillDoc>("skills");
    for (const skillId of skillIds) {
      const existing = await skillsCol.get(skillId);
      if (existing) await skillsCol.put(skillId, { ...existing.doc, active: true }, { expectedVersion: existing.version });
    }
    log.info("✅ Skills activadas:", { skillIds: skillIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating skills:", { error: (e as Error).message });
  }
}

export async function activateEthics(userId: string, ethicsId: string): Promise<void> {
  try {
    const ethicsCol = await col<EthicsDoc>("ethics");
    const all = await ethicsCol.scan({});
    for (const e of all) {
      const shouldBeActive = e.id === ethicsId;
      if (e.doc.active !== shouldBeActive) {
        await ethicsCol.put(e.id, { ...e.doc, active: shouldBeActive }, { expectedVersion: e.version });
      }
    }
    log.info("✅ Ethics activado:", { ethicsId });
  } catch (e) {
    log.error("⚠️ Error activating ethics:", { error: (e as Error).message });
  }
}

export async function activateTools(userId: string, toolIds: string[]): Promise<void> {
  try {
    const toolsCol = await col<ToolDoc>("tools");
    for (const toolId of toolIds) {
      const existing = await toolsCol.get(toolId);
      if (existing) await toolsCol.put(toolId, { ...existing.doc, active: true, enabled: true }, { expectedVersion: existing.version });
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
export async function activateBrowserTools(): Promise<void> {
  try {
    const toolsCol = await col<ToolDoc>("tools");
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
      const existing = await toolsCol.get(toolId);
      if (existing) await toolsCol.put(toolId, { ...existing.doc, active: true, enabled: true }, { expectedVersion: existing.version });
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
    const providersCol = await col<ProviderDoc>("providers");
    const modelsCol = await col<ModelDoc>("models");

    // 1️⃣ Primero: Actualizar provider global con API key del usuario
    const existingProvider = await providersCol.get(data.provider);
    if (existingProvider) {
      await providersCol.put(data.provider, {
        ...existingProvider.doc, base_url: data.baseUrl || null, enabled: true, active: true,
      }, { expectedVersion: existingProvider.version });
    }

    if (data.apiKey) {
      await storeProviderApiKey(data.provider, data.apiKey);
    }

    log.info("✅ Provider actualizado:", { provider: data.provider });

    // 2️⃣ Segundo: Activar el modelo seleccionado
    // For Ollama, models are inserted dynamically (not seeded), ensure row exists first
    if (data.provider === "ollama" && data.model) {
      const existingModel = await modelsCol.get(data.model);
      if (!existingModel) {
        await modelsCol.put(data.model, {
          id: data.model, provider_id: "ollama", name: data.model, model_type: "llm",
          context_window: 0, capabilities: null, enabled: true, active: true,
        });
      }
    }

    const modelToActivate = await modelsCol.get(data.model);
    if (modelToActivate) {
      await modelsCol.put(data.model, { ...modelToActivate.doc, enabled: true, active: true }, { expectedVersion: modelToActivate.version });
    }

    log.info("✅ Model activado:", { model: data.model });
  } catch (e) {
    log.error("⚠️ Error saving provider:", { error: (e as Error).message });
    throw e;
  }
}

export async function activateMcpServers(userId: string, mcpIds: string[]): Promise<void> {
  try {
    const mcpCol = await col<McpServerDoc>("mcpServers");
    for (const mcpId of mcpIds) {
      const existing = await mcpCol.get(mcpId);
      if (existing) await mcpCol.put(mcpId, { ...existing.doc, active: true, enabled: true }, { expectedVersion: existing.version });
    }
    log.info("✅ MCP servers activados:", { mcpIds: mcpIds.join(", ") });
  } catch (e) {
    log.error("⚠️ Error activating MCP servers:", { error: (e as Error).message });
  }
}

export async function saveAgentConfig(data: {
  userId: string;
  agentId?: string;
  agentName: string;
  providerId: string;
  modelId: string;
  tone: string;
  description?: string;
}): Promise<string> {
  try {
    const providersCol = await col<ProviderDoc>("providers");
    const modelsCol = await col<ModelDoc>("models");
    const agentsCol = await col<AgentDoc>("agents");

    // Validate FK references — use null if the referenced row doesn't exist
    // (e.g. custom Ollama model IDs are not in the seed models table)
    const rawProviderId = data.providerId || null;
    const rawModelId = data.modelId || null;
    const safeProviderId = rawProviderId && (await providersCol.get(rawProviderId)) ? rawProviderId : null;
    const safeModelId = rawModelId && (await modelsCol.get(rawModelId)) ? rawModelId : null;

    let finalAgentId = data.agentId;
    const now = Date.now();

    if (!finalAgentId) {
      finalAgentId = genId();
      await agentsCol.put(finalAgentId, {
        id: finalAgentId, user_id: data.userId, name: data.agentName,
        description: data.description || null, system_prompt: HIVE_SYSTEM_PROMPT,
        tone: data.tone, role: "coordinator", status: "idle", enabled: true,
        provider_id: toIndexable(safeProviderId), model_id: toIndexable(safeModelId),
        tools_json: null, skills_json: null, parent_id: toIndexable(null),
        max_iterations: 10, workspace: null, lastTraceAt: null,
        created_at: now, updated_at: now,
      });
      log.info("✅ Agent created with auto-generated ID", { agentId: finalAgentId });
    } else {
      const existing = await agentsCol.get(finalAgentId);
      await agentsCol.put(finalAgentId, {
        id: finalAgentId,
        user_id: data.userId ?? existing?.doc.user_id,
        name: data.agentName ?? existing?.doc.name,
        description: data.description ?? existing?.doc.description ?? null,
        system_prompt: HIVE_SYSTEM_PROMPT,
        tone: data.tone ?? existing?.doc.tone,
        role: "coordinator",
        status: "idle",
        enabled: true,
        provider_id: toIndexable(safeProviderId) !== "__none__" ? toIndexable(safeProviderId) : (existing?.doc.provider_id ?? toIndexable(null)),
        model_id: toIndexable(safeModelId) !== "__none__" ? toIndexable(safeModelId) : (existing?.doc.model_id ?? toIndexable(null)),
        tools_json: existing?.doc.tools_json ?? null,
        skills_json: existing?.doc.skills_json ?? null,
        parent_id: existing?.doc.parent_id ?? toIndexable(null),
        max_iterations: existing?.doc.max_iterations ?? 10,
        workspace: existing?.doc.workspace ?? null,
        lastTraceAt: existing?.doc.lastTraceAt ?? null,
        created_at: existing?.doc.created_at ?? now,
        updated_at: now,
      }, existing ? { expectedVersion: existing.version } : undefined);
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
    const channelsCol = await col<ChannelDoc>("channels");
    const existing = await channelsCol.get(data.channelId);
    if (existing) {
      await channelsCol.put(data.channelId, {
        ...existing.doc, user_id: userId, active: true, enabled: true, status: "connected",
      }, { expectedVersion: existing.version });
    }

    if (data.config && Object.keys(data.config).length > 0) {
      await storeChannelConfig(data.channelId, data.config);
    }

    // Create user_identity for the channel if channelUserId provided
    if (data.channelUserId) {
      const channelType = data.channelId; // webchat, telegram, discord, etc.
      const identitiesCol = await col<UserIdentityDoc>("userIdentities");
      await identitiesCol.put(`${userId}:${channelType}`, {
        user_id: userId, channel: channelType, channel_user_id: data.channelUserId, linked_at: Date.now(),
      });
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
    const modelsCol = await col<ModelDoc>("models");
    const providersCol = await col<ProviderDoc>("providers");
    const channelsCol = await col<ChannelDoc>("channels");

    // Activate STT and TTS models
    for (const modelId of [data.sttProvider, data.ttsProvider]) {
      const existing = await modelsCol.get(modelId);
      if (existing) await modelsCol.put(modelId, { ...existing.doc, active: true, enabled: true }, { expectedVersion: existing.version });
    }

    // Resolve provider IDs from the DB: the value can be a model id or a provider id
    const resolveVoiceProviderId = async (id: string): Promise<string> => {
      const model = await modelsCol.get(id);
      if (model?.doc.provider_id) return model.doc.provider_id;
      const provider = await providersCol.get(id);
      return provider?.doc.id || "";
    };

    const sttProviderId = await resolveVoiceProviderId(data.sttProvider);
    const ttsProviderId = await resolveVoiceProviderId(data.ttsProvider);

    // Save STT API key to provider if provided.
    // Note: this deliberately does NOT flip the provider's enabled/active flags —
    // groq/openai/gemini/qwen are shared rows between voice (STT/TTS) and LLM chat,
    // and voice's own "configured" check only looks at whether a key is stored, so
    // touching those flags here would silently surface a voice-only key as a fully
    // active LLM chat provider.
    if (data.sttApiKey && sttProviderId) {
      await storeProviderApiKey(sttProviderId, data.sttApiKey);
      log.info("✅ STT API key guardada en keychain", { provider: sttProviderId });
    }

    // Save TTS API key to provider if provided (see note above).
    if (data.ttsApiKey && ttsProviderId) {
      await storeProviderApiKey(ttsProviderId, data.ttsApiKey);
      log.info("✅ TTS API key guardada en keychain", { provider: ttsProviderId });
    }

    // Update channel with voice config
    const existingChannel = await channelsCol.get(data.channelId);
    if (existingChannel) {
      await channelsCol.put(data.channelId, {
        ...existingChannel.doc, user_id: data.userId, voice_enabled: data.voiceEnabled,
        stt_provider: data.sttProvider, tts_provider: data.ttsProvider,
      }, { expectedVersion: existingChannel.version });
    }

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
    const mcpId = `${data.userId}:${data.name}`;
    const mcpCol = await col<McpServerDoc>("mcpServers");

    await mcpCol.put(mcpId, {
      id: mcpId, user_id: data.userId, name: data.name, transport: data.transport,
      command: data.command || null, args: JSON.stringify(data.args || []),
      url: data.url || null, enabled: !!data.enabled, active: !!data.enabled,
      builtin: false, status: "disconnected", tools_count: 0,
    });

    if (data.env && Object.keys(data.env).length > 0) {
      await storeMcpEnv(mcpId, data.env);
    }

    log.info("✅ MCP server saved:", { name: data.name });
  } catch (e) {
    log.error("⚠️ Error saving MCP server:", { error: (e as Error).message });
  }
}

export async function saveToolSelection(userId: string, tools: string[]): Promise<void> {
  try {
    const toolsCol = await col<ToolDoc>("tools");
    for (const tool of tools) {
      const existing = await toolsCol.get(tool);
      if (existing) await toolsCol.put(tool, { ...existing.doc, active: true, enabled: true }, { expectedVersion: existing.version });
    }
    log.info("✅ Tools activadas:", { tools: tools.join(", ") });
  } catch (e) {
    log.error("⚠️ Error saving tools:", { error: (e as Error).message });
  }
}

async function setActiveEnabled(collection: string, id: string, value: boolean): Promise<void> {
  const c = await col<{ active: boolean; enabled: boolean }>(collection);
  const existing = await c.get(id);
  if (existing) await c.put(id, { ...existing.doc, active: value, enabled: value }, { expectedVersion: existing.version });
}

export async function activateProvider(providerId: string): Promise<void> {
  try {
    await setActiveEnabled("providers", providerId, true);
    log.info("✅ Provider activado:", { providerId });
  } catch (e) {
    log.error("⚠️ Error activating provider:", { error: (e as Error).message });
  }
}

export async function activateModel(modelId: string): Promise<void> {
  try {
    await setActiveEnabled("models", modelId, true);
    log.info("✅ Model activado:", { modelId });
  } catch (e) {
    log.error("⚠️ Error activating model:", { error: (e as Error).message });
  }
}

export async function activateMcpServer(mcpName: string): Promise<void> {
  try {
    await setActiveEnabled("mcpServers", mcpName, true);
    log.info("✅ MCP server activado:", { mcpName });
  } catch (e) {
    log.error("⚠️ Error activating MCP server:", { error: (e as Error).message });
  }
}

export async function deactivateProvider(providerId: string): Promise<void> {
  try {
    await setActiveEnabled("providers", providerId, false);
    log.warn("⚠️ Provider desactivado:", { providerId });
  } catch (e) {
    log.error("⚠️ Error deactivating provider:", { error: (e as Error).message });
  }
}

export async function deactivateModel(modelId: string): Promise<void> {
  try {
    await setActiveEnabled("models", modelId, false);
    log.warn("⚠️ Model desactivado:", { modelId });
  } catch (e) {
    log.error("⚠️ Error deactivating model:", { error: (e as Error).message });
  }
}

export async function deactivateChannel(channelType: string): Promise<void> {
  try {
    await setActiveEnabled("channels", channelType, false);
    log.warn("⚠️ Channel desactivado:", { channelType });
  } catch (e) {
    log.error("⚠️ Error deactivating channel:", { error: (e as Error).message });
  }
}

export async function deactivateMcpServer(mcpName: string): Promise<void> {
  try {
    await setActiveEnabled("mcpServers", mcpName, false);
    log.warn("⚠️ MCP server desactivado:", { mcpName });
  } catch (e) {
    log.error("⚠️ Error deactivating MCP server:", { error: (e as Error).message });
  }
}

export async function getAllProviders(): Promise<Array<{
  id: string;
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  active: boolean;
}>> {
  try {
    const providersCol = await col<ProviderDoc>("providers");
    const entries = await providersCol.scan({});
    return entries.map((e) => ({
      id: e.doc.id, name: e.doc.name, baseUrl: e.doc.base_url,
      enabled: e.doc.enabled, active: e.doc.active,
    }));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting providers:", (e as Error).message);
    return [];
  }
}

export async function getAllModels(): Promise<Array<{
  id: string;
  name: string;
  providerId: string;
  contextWindow: number | null;
  capabilities: string | null;
  enabled: boolean;
  active: boolean;
}>> {
  try {
    const modelsCol = await col<ModelDoc>("models");
    const entries = await modelsCol.scan({});
    return entries.map((e) => ({
      id: e.doc.id, name: e.doc.name, providerId: e.doc.provider_id,
      contextWindow: e.doc.context_window, capabilities: e.doc.capabilities,
      enabled: e.doc.enabled, active: e.doc.active,
    }));
  } catch (e) {
    log.error("⚠️ Error getting models:", { error: (e as Error).message });
    return [];
  }
}

export async function getAllEthics(): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  content: string;
  isDefault: boolean;
  active: boolean;
}>> {
  try {
    const ethicsCol = await col<EthicsDoc>("ethics");
    const entries = await ethicsCol.scan({});
    return entries.map((e) => ({
      id: e.doc.id, name: e.doc.name, description: e.doc.description, content: e.doc.content,
      isDefault: e.doc.is_default, active: e.doc.active,
    }));
  } catch (e) {
    log.error("⚠️ Error getting ethics:", { error: (e as Error).message });
    return [];
  }
}

export async function getAllSkills(): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  active: boolean;
}>> {
  try {
    const skillsCol = await col<SkillDoc>("skills");
    const entries = await skillsCol.scan({});
    return entries.map((e) => ({
      id: e.doc.id, name: e.doc.name, description: e.doc.description,
      enabled: true, active: e.doc.active,
    }));
  } catch (e) {
    log.error("⚠️ Error getting skills:", { error: (e as Error).message });
    return [];
  }
}

export async function getAllDbTools(): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  enabled: boolean;
  active: boolean;
}>> {
  try {
    const toolsCol = await col<ToolDoc>("tools");
    const entries = await toolsCol.scan({});
    return entries.map((e) => ({
      id: e.doc.id, name: e.doc.name, description: e.doc.description, category: e.doc.category,
      enabled: e.doc.enabled, active: e.doc.active,
    }));
  } catch (e) {
    log.error("⚠️ Error getting tools:", { error: (e as Error).message });
    return [];
  }
}

export async function getAllMcpServers(): Promise<Array<{
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  url: string | null;
  builtin: boolean;
  enabled: boolean;
  active: boolean;
}>> {
  try {
    const mcpCol = await col<McpServerDoc>("mcpServers");
    const entries = await mcpCol.scan({});
    return entries.map((e) => ({
      id: e.doc.id, name: e.doc.name, transport: e.doc.transport, command: e.doc.command,
      args: e.doc.args, url: e.doc.url, builtin: e.doc.builtin,
      enabled: e.doc.enabled, active: e.doc.active,
    }));
  } catch (e) {
    log.error("⚠️ Error getting MCP servers:", { error: (e as Error).message });
    return [];
  }
}

export async function getAllChannels(): Promise<Array<{
  id: string;
  type: string;
  accountId: string;
  status: string;
  enabled: boolean;
  active: boolean;
}>> {
  try {
    const channelsCol = await col<ChannelDoc>("channels");
    const entries = await channelsCol.scan({});
    return entries.map((e) => ({
      id: e.doc.id, type: e.doc.type, accountId: e.doc.id,
      status: e.doc.status, enabled: e.doc.enabled, active: e.doc.active,
    }));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting channels:", (e as Error).message);
    return [];
  }
}

export async function getActiveTools(): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}>> {
  try {
    const toolsCol = await col<ToolDoc>("tools");
    const entries = await toolsCol.scan({});
    return entries.filter((e) => e.doc.active).map((e) => ({
      id: e.doc.id, name: e.doc.name, description: e.doc.description, category: e.doc.category,
    }));
  } catch (e) {
    log.error("⚠️ Error getting active tools:", { error: (e as Error).message });
    return [];
  }
}

export async function getOnboardingProgress(userId: string): Promise<OnboardingSection | null> {
  try {
    const progressCol = await col<OnboardingProgressDoc>("onboardingProgress");
    const entry = await progressCol.get(userId);
    if (entry) {
      return {
        step: entry.doc.step as OnboardingSection["step"],
        userId,
        data: JSON.parse(entry.doc.data),
        completedAt: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveOnboardingProgress(section: OnboardingSection): Promise<void> {
  try {
    const progressCol = await col<OnboardingProgressDoc>("onboardingProgress");
    await progressCol.put(section.userId, {
      user_id: section.userId, step: section.step, data: JSON.stringify(section.data),
    });
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
    const providersCol = await col<ProviderDoc>("providers");
    const entries = await providersCol.scan({});
    return Promise.all(entries.map(async (e) => ({
      id: e.doc.name,
      name: e.doc.name,
      apiKey: (await loadProviderApiKey(e.doc.name)) || null,
      baseUrl: e.doc.base_url,
      enabled: e.doc.enabled,
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
    const channelsCol = await col<ChannelDoc>("channels");
    const entries = await channelsCol.findBy("user_id", userId);
    return Promise.all(entries.map(async (e) => ({
      id: e.doc.type,
      type: e.doc.type,
      accountId: e.doc.id,
      config: await loadChannelConfig(e.doc.id),
      enabled: e.doc.enabled,
    })));
  } catch (e) {
    log.warn("[onboarding] ⚠️ Error getting channels:", (e as Error).message);
    return [];
  }
}

export async function getUserAgents(userId: string): Promise<Array<{
  id: string;
  name: string;
  providerId: string | null;
  modelId: string | null;
  tone: string;
}>> {
  try {
    const agentsCol = await col<AgentDoc>("agents");
    const entries = await agentsCol.findBy("user_id", userId);
    return entries.map((e) => ({
      id: e.doc.id, name: e.doc.name,
      providerId: fromIndexable(e.doc.provider_id), modelId: fromIndexable(e.doc.model_id),
      tone: e.doc.tone || "friendly",
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
export async function getSingleUserId(): Promise<string | null> {
  try {
    const usersCol = await col<UserDoc>("users");
    const entries = await usersCol.scan({ limit: 1 });
    return entries[0]?.id || null;
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
export async function getCoordinatorAgentId(): Promise<string | null> {
  try {
    const agentsCol = await col<AgentDoc>("agents");
    const entries = await agentsCol.findBy("role", "coordinator", { limit: 1 });
    return entries[0]?.id || null;
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
export async function getUserIdFromChannelIdentity(channel: string, channelUserId: string): Promise<string | null> {
  try {
    const identitiesCol = await col<UserIdentityDoc>("userIdentities");
    const all = await identitiesCol.scan({});
    const match = all.find((e) => e.doc.channel === channel && e.doc.channel_user_id === channelUserId);
    return match?.doc.user_id || null;
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
export async function resolveUserId(
  opts: {
    userId?: string | null;
    threadId?: string | null;
    channel?: string | null;
    channelUserId?: string | null;
  }
): Promise<string | null> {
  // Priority 1: Explicit userId
  if (opts.userId) {
    return opts.userId;
  }

  // Priority 2: Channel identity lookup
  if (opts.channel && opts.channelUserId) {
    const userId = await getUserIdFromChannelIdentity(opts.channel, opts.channelUserId);
    if (userId) {
      return userId;
    }
  }

  // Priority 3: Single user from database
  const singleUserId = await getSingleUserId();
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
export async function getDefaultAgentId(): Promise<string | null> {
  try {
    const agentsCol = await col<AgentDoc>("agents");

    // Try coordinator first
    const coordinators = await agentsCol.findBy("role", "coordinator");
    const enabledCoordinator = coordinators.find((e) => e.doc.enabled);
    if (enabledCoordinator) return enabledCoordinator.id;

    // Fallback to first enabled agent
    const all = await agentsCol.scan({});
    const firstEnabled = all.find((e) => e.doc.enabled);
    return firstEnabled?.id || null;
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
export async function resolveAgentId(agentId?: string | null): Promise<string | null> {
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
export async function getUserPreferences(userId: string): Promise<string | null> {
  try {
    const usersCol = await col<UserDoc>("users");
    const entry = await usersCol.get(userId);
    return entry?.doc.notes || null;
  } catch (e) {
    log.warn("[getUserPreferences] ⚠️ Error getting user preferences:", (e as Error).message);
    return null;
  }
}

/**
 * Get agent configuration by ID
 */
export async function getAgentConfig(agentId: string): Promise<{
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
} | null> {
  try {
    const agentsCol = await col<AgentDoc>("agents");
    const entry = await agentsCol.get(agentId);
    if (!entry) return null;
    return {
      id: entry.doc.id, user_id: entry.doc.user_id, name: entry.doc.name,
      description: entry.doc.description, system_prompt: entry.doc.system_prompt, tone: entry.doc.tone,
      provider_id: fromIndexable(entry.doc.provider_id), model_id: fromIndexable(entry.doc.model_id),
      tools_json: entry.doc.tools_json, skills_json: entry.doc.skills_json,
      max_iterations: entry.doc.max_iterations,
    };
  } catch (e) {
    log.warn("[getAgentConfig] ⚠️ Error getting agent config:", (e as Error).message);
    return null;
  }
}
