import { getDb } from "../../storage/sqlite"
import { storeChannelConfig, loadChannelConfig, deleteChannelSecrets } from "../../storage/crypto"

export async function handleGetChannels(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelManager?: any
): Promise<Response> {
  const channels = getDb().query(`
    SELECT id, type, id as account_id, enabled, active, status, last_active,
           voice_enabled, tts_enabled, stt_provider, tts_provider, tts_voice_id, step_delivery_mode,
           vision_enabled, ocr_provider, vision_provider, vision_model_id
    FROM channels
  `).all() as Array<{
    id: string;
    type: string;
    account_id: string;
    enabled: number;
    active: number;
    status: string;
    last_active: number | null;
    voice_enabled: number;
    tts_enabled: number;
    stt_provider: string | null;
    tts_provider: string | null;
    tts_voice_id: string | null;
    step_delivery_mode: string | null;
    vision_enabled: number;
    ocr_provider: string | null;
    vision_provider: string | null;
    vision_model_id: string | null;
  }>

  // Convert to format expected by UI (ConnectedChannel[])
  // Overlay the live runtime status from channelManager so that channels like
  // Telegram/Discord (which never write "connected" to the DB) show the correct state.
  const formattedChannels = await Promise.all(channels.map(async c => {
    let liveStatus: string = c.status;
    if (channelManager && typeof channelManager.getChannelStatus === "function") {
      const live = channelManager.getChannelStatus(c.type, c.id);
      if (live && live.status !== "not_found") liveStatus = live.status;
    }
    const config = await loadChannelConfig(c.id);
    const isConfigured = Object.keys(config).length > 0;

    return {
      id: c.id,
      type: c.type as ConnectedChannel["type"],
      accountId: c.account_id,
      enabled: c.enabled === 1,
      active: c.active === 1,
      status: liveStatus as ConnectedChannel["status"],
      last_active: c.last_active ?? undefined,
      voice_enabled: c.voice_enabled === 1,
      tts_enabled: c.tts_enabled === 1,
      stt_provider: c.stt_provider ?? undefined,
      tts_provider: c.tts_provider ?? undefined,
      tts_voice_id: c.tts_voice_id ?? undefined,
      step_delivery_mode: c.step_delivery_mode ?? undefined,
      vision_enabled: c.vision_enabled === 1,
      ocr_provider: c.ocr_provider ?? undefined,
      vision_provider: c.vision_provider ?? undefined,
      vision_model_id: c.vision_model_id ?? undefined,
      isConfigured,
    };
  }))

  return addCorsHeaders(Response.json({ channels: formattedChannels }), req)
}

type ConnectedChannel = {
  id: string;
  type: string;
  accountId?: string;
  enabled: boolean;
  active: boolean;
  status: string;
  last_active?: number;
  voice_enabled: boolean;
  tts_enabled: boolean;
  stt_provider?: string;
  tts_provider?: string;
  tts_voice_id?: string;
  step_delivery_mode?: string;
  vision_enabled: boolean;
  ocr_provider?: string;
  vision_provider?: string;
  vision_model_id?: string;
  isConfigured?: boolean;
}

export async function handleGetChannelConfig(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const channelIdMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/)
  
  if (!channelIdMatch) {
    return addCorsHeaders(Response.json({ error: "Invalid path" }), req)
  }
  
  const channelId = channelIdMatch[1]
  const config = getDb().query(`
    SELECT * FROM user_channels WHERE channel = ?
  `).all(channelId) as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({ config }), req)
}

export async function handleActivateChannel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { channel, config, accountId } = body
  
  if (!channel) {
    return addCorsHeaders(Response.json({ success: false, error: "channel required" }), req)
  }
  
  const userId = "default"
  getDb().query(`
    INSERT OR REPLACE INTO user_channels(user_id, channel, account_id, config, active)
    VALUES(?, ?, ?, ?, 1)
  `).run(userId, channel, accountId || null, JSON.stringify(config || {}))
  
  return addCorsHeaders(Response.json({ success: true, channel }), req)
}

export async function handleDeactivateChannel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split("/")
  const channel = parts[3]
  const accountId = parts[4]

  if (!channel) {
    return addCorsHeaders(Response.json({ success: false, error: "channel required" }), req)
  }

  const userId = "default"
  if (accountId) {
    getDb().query(`DELETE FROM user_channels WHERE user_id = ? AND channel = ? AND account_id = ?`).run(userId, channel, accountId)
  } else {
    getDb().query(`DELETE FROM user_channels WHERE user_id = ? AND channel = ?`).run(userId, channel)
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleCreateChannel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { type, config: channelConfig } = body;

  if (!type) {
    return addCorsHeaders(new Response("Missing type", { status: 400 }), req);
  }

  // Reuse the existing seeded channel record (e.g. id="whatsapp") if it exists
  // and has not been configured yet — avoids creating duplicate UUID entries.
  // A seeded-but-unconfigured channel has no secret in the keychain yet.
  const seededRows = getDb().query(
    `SELECT id FROM channels WHERE type = ? LIMIT 10`
  ).all(type) as { id: string }[];

  // Find a row with no config in keychain (unconfigured seed)
  let seededId: string | null = null;
  for (const row of seededRows) {
    const existing = await loadChannelConfig(row.id);
    if (Object.keys(existing).length === 0) {
      seededId = row.id;
      break;
    }
  }

  let id: string;
  if (seededId) {
    id = seededId;
    getDb().query(
      `UPDATE channels SET enabled = 1, active = 1, status = 'connecting' WHERE id = ?`
    ).run(id);
  } else {
    const { randomUUID } = await import("crypto");
    id = randomUUID();
    getDb().query(`
      INSERT INTO channels(id, type, enabled, active, status)
      VALUES(?, ?, 1, 1, 'connecting')
    `).run(id, type);
  }

  if (channelConfig && Object.keys(channelConfig).length > 0) {
    await storeChannelConfig(id, channelConfig);
  }

  if (channelManager) {
    channelManager.addChannel(type, id, channelConfig || {}).catch((err: Error) => {
      console.error(`[channels] Failed to start ${type}:${id}:`, err.message);
    });
  }

  return addCorsHeaders(Response.json({ success: true, id, status: "connecting" }), req);
}

export async function handleReconnectChannel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { config: newConfig } = body;

  const row = getDb().query(`SELECT type FROM channels WHERE id = ?`).get(channelId) as {
    type: string;
  } | undefined;

  if (!row) {
    return addCorsHeaders(Response.json({ success: false, error: "Channel not found" }, { status: 404 }), req);
  }

  // Update credentials if new config provided
  if (newConfig && Object.keys(newConfig).length > 0) {
    await storeChannelConfig(channelId, newConfig);
  }
  getDb().query(`UPDATE channels SET enabled = 1, active = 1, status = 'connecting' WHERE id = ?`)
    .run(channelId);

  if (channelManager) {
    let config: Record<string, unknown> = {};
    if (newConfig && Object.keys(newConfig).length > 0) {
      config = newConfig;
    } else {
      config = await loadChannelConfig(channelId);
    }

    // Remove old instance then start fresh — must be sequential to avoid race
    // where removeChannel deletes the key AFTER addChannel already set it
    ;(async () => {
      try { await channelManager.removeChannel(row.type, channelId); } catch { /* ignore */ }
      try {
        await channelManager.addChannel(row.type, channelId, config);
      } catch (err: unknown) {
        console.error(`[channels] Failed to reconnect ${row.type}:${channelId}:`, (err as Error).message);
      }
    })();
  }

  return addCorsHeaders(Response.json({ success: true, status: "connecting" }), req);
}

export async function handleGetChannelStatus(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelManager?: any
): Promise<Response> {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/channels\/([^/]+)\/([^/]+)\/status$/);
  if (!match) {
    return addCorsHeaders(Response.json({ error: "Invalid path" }, { status: 400 }), req);
  }

  const [, type, id] = match;

  if (!channelManager) {
    return addCorsHeaders(Response.json({ status: "unknown" }), req);
  }

  const statusData = channelManager.getChannelStatus(type, id);
  return addCorsHeaders(Response.json(statusData), req);
}

export async function handleGetChannelAccount(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string
): Promise<Response> {
  // This should read from the config file or database
  // For now, return a placeholder - the actual implementation depends on config storage
  return addCorsHeaders(Response.json({ name, accountId, config: {} }), req);
}

export async function handleUpdateChannelAccount(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  if (!body.config) {
    return new Response("Missing config", { status: 400 });
  }

  // Note: Channel config persistence should be handled by the caller
  if (channelManager) {
    await channelManager.removeChannel(name, accountId);
    await channelManager.startChannel(name, accountId);
  }

  return addCorsHeaders(Response.json({ success: true }), req);
}

export async function handleDeleteChannelAccount(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string,
  config?: any,
  channelManager?: any
): Promise<Response> {
  // Note: Config update should be handled by the caller
  if (channelManager) {
    await channelManager.removeChannel(name, accountId);
  }

  return addCorsHeaders(Response.json({ success: true }), req);
}

export async function handleChannelAction(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string,
  action: "start" | "stop",
  channelManager?: any
): Promise<Response> {
  try {
    if (!channelManager) {
      return addCorsHeaders(new Response("Channel manager not available", { status: 500 }), req);
    }

    if (action === "start") {
      await channelManager.startChannel(name, accountId);
    } else {
      await channelManager.stopChannel(name, accountId);
    }
    return addCorsHeaders(Response.json({ success: true }), req);
  } catch (error) {
    return addCorsHeaders(Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    ), req);
  }
}

export async function handleUpdateChannelSettings(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const allowed = ["voice_enabled", "tts_enabled", "stt_provider", "tts_provider", "tts_voice_id", "step_delivery_mode", "vision_enabled", "ocr_provider", "vision_provider", "vision_model_id"] as const;
  const updates: string[] = [];
  const params: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`);
      params.push(typeof body[key] === "boolean" ? (body[key] ? 1 : 0) : body[key]);
    }
  }

  // Merge type-specific config into config_encrypted if body.config is provided
  const newConfig = body.config as Record<string, unknown> | undefined;
  if (newConfig && typeof newConfig === "object" && Object.keys(newConfig).length > 0) {
    const exists = getDb().query(`SELECT id FROM channels WHERE id = ?`).get(channelId);
    if (exists) {
      const currentConfig = await loadChannelConfig(channelId);
      await storeChannelConfig(channelId, { ...currentConfig, ...newConfig });
    }
  }

  if (updates.length === 0) {
    return addCorsHeaders(Response.json({ error: "No valid fields to update" }, { status: 400 }), req);
  }

  params.push(channelId);
  getDb().query(`UPDATE channels SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[]);

  return addCorsHeaders(Response.json({ success: true }), req);
}

export async function handleToggleChannel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { active } = body;

  if (active === undefined) {
    return addCorsHeaders(Response.json({ success: false, error: "Missing active field", message: "Falta el campo 'active'" }, { status: 400 }), req);
  }

  getDb().query(`UPDATE channels SET active = ?, enabled = ? WHERE id = ?`).run(active ? 1 : 0, active ? 1 : 0, channelId);

  return addCorsHeaders(Response.json({ success: true, active, message: active ? `Canal "${channelId}" activado` : `Canal "${channelId}" desactivado` }), req);
}

export async function handleGetWhatsAppDetails(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string,
  channelManager?: any
): Promise<Response> {
  if (!channelManager) {
    return addCorsHeaders(Response.json({ error: "Channel manager not available", status: 500 }), req);
  }

  const details = channelManager.getWhatsAppDetails(channelId);
  if (!details) {
    return addCorsHeaders(Response.json({ error: "WhatsApp channel not found", status: 404 }), req);
  }

  return addCorsHeaders(Response.json(details), req);
}

export async function handleDisconnectWhatsApp(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { clearSession } = body;

  if (!channelManager) {
    return addCorsHeaders(Response.json({ success: false, error: "Channel manager not available", status: 500 }), req);
  }

  const key = `whatsapp:${channelId}`;
  const channel = channelManager.channels?.get?.(key);

  if (!channel) {
    return addCorsHeaders(Response.json({ success: false, error: "WhatsApp channel not found", status: 404 }), req);
  }

  try {
    if (typeof (channel as any).disconnect === "function") {
      await (channel as any).disconnect(clearSession === true);
    }
    return addCorsHeaders(Response.json({ success: true }), req);
  } catch (error) {
    return addCorsHeaders(Response.json({ success: false, error: (error as Error).message }, { status: 500 }), req);
  }
}

export async function handleUpdateWhatsAppConfig(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { acceptGroups, reconnectMaxAttempts, reconnectBaseDelayMs, dmPolicy, selfMessagesOnly, allowFrom } = body;

  // Read and decrypt the existing config, merge new values, then re-encrypt.
  // These fields live inside config_encrypted — not as top-level columns.
  const row = getDb().query(`SELECT config_encrypted, config_iv FROM channels WHERE id = ?`)
    .get(channelId) as { config_encrypted: string | null; config_iv: string | null } | undefined;

  if (!row) {
    return addCorsHeaders(Response.json({ success: false, error: "Channel not found" }, { status: 404 }), req);
  }

  const currentConfig = await loadChannelConfig(channelId);
  const merged: Record<string, unknown> = { ...currentConfig };
  if (acceptGroups !== undefined) merged.acceptGroups = Boolean(acceptGroups);
  if (reconnectMaxAttempts !== undefined) merged.reconnectMaxAttempts = Number(reconnectMaxAttempts);
  if (reconnectBaseDelayMs !== undefined) merged.reconnectBaseDelayMs = Number(reconnectBaseDelayMs);
  if (dmPolicy !== undefined) merged.dmPolicy = dmPolicy;
  if (selfMessagesOnly !== undefined) merged.selfMessagesOnly = Boolean(selfMessagesOnly);
  if (allowFrom !== undefined) merged.allowFrom = Array.isArray(allowFrom) ? allowFrom : [];
  await storeChannelConfig(channelId, merged);

  // Restart the running channel so it picks up the new config immediately.
  if (channelManager) {
    try {
      await channelManager.removeChannel("whatsapp", channelId);
      await channelManager.addChannel("whatsapp", channelId, merged);
    } catch { /* ignore restart errors */ }
  }

  return addCorsHeaders(Response.json({ success: true }), req);
}
