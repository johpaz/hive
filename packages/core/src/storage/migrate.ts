import { logger } from "../utils/logger"
import { getDb } from "./sqlite"
import {
  legacyDecryptAES,
  storeProviderApiKey, storeProviderHeaders,
  storeChannelConfig,
  storeMcpHeaders, storeMcpEnv,
  storeAgentHeaders,
  loadProviderApiKey,
} from "./crypto"

const log = logger.child("migrate")

/**
 * One-shot migration: moves AES-encrypted secrets from SQLite columns to
 * the OS keychain via Bun.secrets.
 *
 * Idempotent — rows that are already NULL in *_encrypted are skipped.
 * Rows that already have a secret in the keychain are also skipped.
 * Safe to call on every startup; only does work on the first run after upgrade.
 */
export async function migrateEncryptedSecretsToKeychain(): Promise<void> {
  const db = getDb()
  let migrated = 0

  // ── Providers ──────────────────────────────────────────────────────────────
  const providers = db.query(`
    SELECT id, api_key_encrypted, api_key_iv, headers_encrypted, headers_iv
    FROM providers
    WHERE api_key_encrypted IS NOT NULL OR headers_encrypted IS NOT NULL
  `).all() as Array<{
    id: string
    api_key_encrypted: string | null
    api_key_iv: string | null
    headers_encrypted: string | null
    headers_iv: string | null
  }>

  for (const p of providers) {
    if (p.api_key_encrypted && p.api_key_iv) {
      const existing = await loadProviderApiKey(p.id)
      let stored = !!existing
      if (!existing) {
        const plain = legacyDecryptAES(p.api_key_encrypted, p.api_key_iv)
        if (plain) {
          stored = await storeProviderApiKey(p.id, plain)
          if (stored) migrated++
        }
      }
      // Only null the DB ciphertext when the secret reached a durable store
      // (OS keychain or DB-backed fallback). In-memory fallback would lose
      // the secret on the next process restart.
      if (stored) {
        db.query(`UPDATE providers SET api_key_encrypted = NULL, api_key_iv = NULL WHERE id = ?`).run(p.id)
      } else {
        log.warn(`[migrate] keychain unavailable — keeping AES ciphertext for ${p.id} (will retry next start)`)
      }
    }

    if (p.headers_encrypted && p.headers_iv) {
      const plain = legacyDecryptAES(p.headers_encrypted, p.headers_iv)
      let stored = false
      if (plain) {
        try {
          stored = await storeProviderHeaders(p.id, JSON.parse(plain))
          if (stored) migrated++
        } catch { /* ignore JSON parse errors */ }
      }
      if (stored) {
        db.query(`UPDATE providers SET headers_encrypted = NULL, headers_iv = NULL WHERE id = ?`).run(p.id)
      } else {
        log.warn(`[migrate] keychain unavailable — keeping AES headers ciphertext for ${p.id}`)
      }
    }
  }

  // ── Channels ───────────────────────────────────────────────────────────────
  const channels = db.query(`
    SELECT id, config_encrypted, config_iv
    FROM channels
    WHERE config_encrypted IS NOT NULL
  `).all() as Array<{
    id: string
    config_encrypted: string
    config_iv: string
  }>

  for (const c of channels) {
    const plain = legacyDecryptAES(c.config_encrypted, c.config_iv)
    let stored = false
    if (plain) {
      try {
        stored = await storeChannelConfig(c.id, JSON.parse(plain))
        if (stored) migrated++
      } catch { /* ignore JSON parse errors */ }
    }
    if (stored) {
      db.query(`UPDATE channels SET config_encrypted = NULL, config_iv = NULL WHERE id = ?`).run(c.id)
    } else {
      log.warn(`[migrate] keychain unavailable — keeping channel config for ${c.id}`)
    }
  }

  // ── MCP servers ────────────────────────────────────────────────────────────
  const mcpServers = db.query(`
    SELECT id, headers_encrypted, headers_iv, env_encrypted, env_iv
    FROM mcp_servers
    WHERE headers_encrypted IS NOT NULL OR env_encrypted IS NOT NULL
  `).all() as Array<{
    id: string
    headers_encrypted: string | null
    headers_iv: string | null
    env_encrypted: string | null
    env_iv: string | null
  }>

  for (const m of mcpServers) {
    if (m.headers_encrypted && m.headers_iv) {
      const plain = legacyDecryptAES(m.headers_encrypted, m.headers_iv)
      let stored = false
      if (plain) {
        try {
          stored = await storeMcpHeaders(m.id, JSON.parse(plain))
          if (stored) migrated++
        } catch { /* ignore */ }
      }
      if (stored) {
        db.query(`UPDATE mcp_servers SET headers_encrypted = NULL, headers_iv = NULL WHERE id = ?`).run(m.id)
      } else {
        log.warn(`[migrate] keychain unavailable — keeping MCP headers for ${m.id}`)
      }
    }
    if (m.env_encrypted && m.env_iv) {
      const plain = legacyDecryptAES(m.env_encrypted, m.env_iv)
      let stored = false
      if (plain) {
        try {
          stored = await storeMcpEnv(m.id, JSON.parse(plain))
          if (stored) migrated++
        } catch { /* ignore */ }
      }
      if (stored) {
        db.query(`UPDATE mcp_servers SET env_encrypted = NULL, env_iv = NULL WHERE id = ?`).run(m.id)
      } else {
        log.warn(`[migrate] keychain unavailable — keeping MCP env for ${m.id}`)
      }
    }
  }

  // ── Agents ─────────────────────────────────────────────────────────────────
  const agents = db.query(`
    SELECT id, headers_encrypted, headers_iv
    FROM agents
    WHERE headers_encrypted IS NOT NULL
  `).all() as Array<{
    id: string
    headers_encrypted: string
    headers_iv: string
  }>

  for (const a of agents) {
    const plain = legacyDecryptAES(a.headers_encrypted, a.headers_iv)
    let stored = false
    if (plain) {
      try {
        stored = await storeAgentHeaders(a.id, JSON.parse(plain))
        if (stored) migrated++
      } catch { /* ignore */ }
    }
    if (stored) {
      db.query(`UPDATE agents SET headers_encrypted = NULL, headers_iv = NULL WHERE id = ?`).run(a.id)
    } else {
      log.warn(`[migrate] keychain unavailable — keeping agent headers for ${a.id}`)
    }
  }

  if (migrated > 0) {
    log.info(`[migrate] Migrated ${migrated} secret(s) from SQLite AES to OS keychain`)
  }
}
