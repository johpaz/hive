import { getDb } from "../../storage/sqlite"
import { decryptApiKey, maskApiKey, encryptApiKey, encryptConfig } from "../../storage/crypto"

export async function handleGetProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const rawProviders = getDb().query(`
    SELECT id, name, base_url, enabled, active, num_ctx,
      api_key_encrypted, api_key_iv,
      CASE WHEN api_key_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_api_key,
      CASE WHEN headers_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_headers
    FROM providers
  `).all() as Record<string, unknown>[]

  const modelsRows = getDb().query(`
    SELECT id, name, provider_id, enabled, active FROM models
  `).all() as Record<string, unknown>[]

  const modelsByProvider: Record<string, Record<string, unknown>[]> = {}
  for (const m of modelsRows) {
    const pid = m.provider_id as string
    if (!modelsByProvider[pid]) modelsByProvider[pid] = []
    modelsByProvider[pid].push({ id: m.id, name: m.name, provider_id: m.provider_id, enabled: !!m.enabled, active: !!m.active })
  }

  const providers = rawProviders.map((p) => {
    let masked_api_key: string | null = null
    if (p.api_key_encrypted && p.api_key_iv) {
      try {
        const plain = decryptApiKey(p.api_key_encrypted as string, p.api_key_iv as string)
        masked_api_key = maskApiKey(plain)
      } catch { /* silently ignore */ }
    }
    return {
      id: p.id,
      name: p.name,
      base_url: p.base_url,
      enabled: p.enabled,
      active: p.active,
      num_ctx: p.num_ctx ?? null,
      has_api_key: p.has_api_key,
      has_headers: p.has_headers,
      masked_api_key,
      models: modelsByProvider[p.id as string] || [],
    }
  })

  return addCorsHeaders(Response.json({ providers }), req)
}

export async function handleCreateProvider(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  getDb().query(`
    INSERT OR REPLACE INTO providers(id, name, base_url, enabled, active)
    VALUES(?, ?, ?, ?, 1)
  `).run(body.id, body.name, body.base_url || null, body.enabled !== undefined ? body.enabled : 1)
  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleToggleProvider(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const providerId = url.pathname.split("/")[3]
  const body = await req.json().catch(() => ({}))
  const { active } = body
  
  if (active === undefined) {
    return addCorsHeaders(new Response("Missing active field", { status: 400 }), req)
  }
  
  getDb().query(`UPDATE providers SET active = ?, enabled = ? WHERE id = ?`).run(active ? 1 : 0, active ? 1 : 0, providerId)
  return addCorsHeaders(Response.json({ success: true, active }), req)
}

export async function handleUpdateProvider(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const providerIdMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/)
  
  if (!providerIdMatch) {
    return addCorsHeaders(new Response("Invalid path", { status: 400 }), req)
  }
  
  const id = providerIdMatch[1]
  const body = await req.json().catch(() => ({}))
  const updates: string[] = []
  const params: unknown[] = []

  if (body.name) {
    updates.push("name = ?")
    params.push(body.name)
  }
  const baseUrl = body.base_url !== undefined ? body.base_url : body.baseUrl
  if (baseUrl !== undefined) {
    updates.push("base_url = ?")
    params.push(baseUrl || null)
  }
  if (body.enabled !== undefined) {
    updates.push("enabled = ?")
    params.push(body.enabled ? 1 : 0)
  }
  if (body.active !== undefined) {
    updates.push("active = ?")
    params.push(body.active ? 1 : 0)
  }
  if (body.config?.apiKey || body.apiKey) {
    const apiKey = body.config?.apiKey || body.apiKey
    const { encrypted, iv } = encryptApiKey(apiKey)
    updates.push("api_key_encrypted = ?")
    params.push(encrypted)
    updates.push("api_key_iv = ?")
    params.push(iv)
  }
  if (body.headers) {
    const { encrypted, iv } = encryptConfig(body.headers)
    updates.push("headers_encrypted = ?")
    params.push(encrypted)
    updates.push("headers_iv = ?")
    params.push(iv)
  }
  const numCtx = body.num_ctx !== undefined ? body.num_ctx : body.numCtx
  if (numCtx !== undefined) {
    updates.push("num_ctx = ?")
    params.push(numCtx ? Number(numCtx) : null)
  }

  if (updates.length > 0) {
    params.push(id)
    getDb().query(`UPDATE providers SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleSyncProviderModels(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  providerId: string
): Promise<Response> {
  const db = getDb()
  const providerRow = db.query<Record<string, unknown>, [string]>(
    "SELECT * FROM providers WHERE id = ?"
  ).get(providerId)

  if (!providerRow) {
    return addCorsHeaders(new Response("Provider not found", { status: 404 }), req)
  }

  const baseUrl = ((providerRow.base_url as string) || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/(v1|api)\/?$/, "")

  try {
    const res = await fetch(`${baseUrl}/api/tags`)
    if (!res.ok) {
      return addCorsHeaders(Response.json({ error: `Ollama responded ${res.status}` }, { status: 502 }), req)
    }

    const data = await res.json() as { models: Array<{ name: string }> }
    const ollamaModels = data.models || []

    const upsert = db.query(
      `INSERT INTO models (id, provider_id, name, model_type, enabled, active) 
       VALUES (?, ?, ?, 'llm', 1, 1) 
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = 1`
    )

    for (const m of ollamaModels) {
      upsert.run(m.name, providerId, m.name)
    }

    const installedIds = ollamaModels.map(m => m.name)
    const existingModels = db.query<Record<string, unknown>, [string]>(
      "SELECT id FROM models WHERE provider_id = ?"
    ).all(providerId) as Record<string, unknown>[]

    const disable = db.query("UPDATE models SET active = 0, enabled = 0 WHERE id = ?")
    for (const row of existingModels) {
      if (!installedIds.includes(row.id as string)) {
        disable.run(row.id as string)
      }
    }

    const models = db.query<Record<string, unknown>, [string]>(
      "SELECT id, name, provider_id, enabled, active FROM models WHERE provider_id = ?"
    ).all(providerId)

    return addCorsHeaders(Response.json({ 
      success: true, 
      synced: ollamaModels.length, 
      models 
    }), req)
  } catch (err: unknown) {
    return addCorsHeaders(Response.json({ 
      error: `No se pudo conectar a Ollama: ${(err as Error).message}` 
    }, { status: 502 }), req)
  }
}
