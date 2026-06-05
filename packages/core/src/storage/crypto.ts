import { logger } from "../utils/logger"
import { getDb } from "./sqlite"

const log = logger.child("crypto")
const SERVICE = "hive"

// ─── Keychain with in-memory fallback ────────────────────────────────────────
// On Linux headless (no GNOME Keyring / libsecret) Bun.secrets throws.
// Fall back to in-memory storage so the server stays functional, but log a
// warning so operators know secrets won't survive a restart in that mode.

const _mem = new Map<string, string>()
let _keychainOk: boolean | null = null // null = untested

async function _get(name: string): Promise<string | null> {
  if (_keychainOk === false) {
    return _mem.get(name) ?? _readDbSecret(name)
  }
  try {
    const val = await (Bun as any).secrets.get({ service: SERVICE, name })
    _keychainOk = true
    return val ?? _mem.get(name) ?? _readDbSecret(name)
  } catch {
    _keychainOk = false
    return _mem.get(name) ?? _readDbSecret(name)
  }
}

async function _set(name: string, value: string): Promise<boolean> {
  if (_keychainOk === false) {
    _mem.set(name, value)
    return persistSecretToDb(name, value)
  }
  try {
    await (Bun as any).secrets.set({ service: SERVICE, name, value })
    _keychainOk = true
    return true
  } catch {
    _keychainOk = false
    _mem.set(name, value)
    return persistSecretToDb(name, value)
  }
}

/**
 * Read a secret from its DB ciphertext column as a last-resort fallback
 * when the keychain and in-memory map are both empty. Used to survive
 * container restarts when the OS keychain is unavailable (Docker, headless).
 */
function _readDbSecret(name: string): string | null {
  const parts = name.split(":")
  if (parts.length !== 3) return null
  const [kind, id, field] = parts

  let table: string
  let column: string
  switch (`${kind}:${field}`) {
    case "provider:api_key": table = "providers"; column = "api_key"; break
    case "provider:headers":  table = "providers"; column = "headers"; break
    case "channel:config":    table = "channels";  column = "config"; break
    case "mcp:headers":       table = "mcp_servers"; column = "headers"; break
    case "mcp:env":           table = "mcp_servers"; column = "env"; break
    case "agent:headers":     table = "agents"; column = "headers"; break
    default: return null
  }

  try {
    const db = getDb()
    const row = db.query(
      `SELECT ${column}_encrypted AS enc, ${column}_iv AS iv FROM ${table} WHERE id = ?`
    ).get(id) as { enc: string | null; iv: string | null } | undefined
    if (!row?.enc || !row?.iv) return null
    const plain = legacyDecryptAES(row.enc, row.iv)
    if (plain) {
      // Cache in memory for subsequent lookups in this process
      _mem.set(name, plain)
    }
    return plain || null
  } catch {
    return null
  }
}

async function _del(name: string): Promise<void> {
  _mem.delete(name)
  try {
    await (Bun as any).secrets.delete({ service: SERVICE, name })
  } catch {
    // ignore — might not exist or keychain unavailable
  }
}

// ─── Primitive API ────────────────────────────────────────────────────────────

export async function storeSecret(name: string, value: string): Promise<void> {
  await _set(name, value)
}

export async function loadSecret(name: string): Promise<string | null> {
  return _get(name)
}

export async function deleteSecret(name: string): Promise<void> {
  await _del(name)
}

// ─── Provider secrets ────────────────────────────────────────────────────────

/**
 * Returns true if the secret was persisted to a durable store (OS keychain
 * or DB-backed fallback). Returns false if it ended up in the per-process
 * in-memory map only — useful so callers can avoid destructive actions
 * (like nulling the DB ciphertext) that would lose data on restart.
 */
export async function storeProviderApiKey(id: string, apiKey: string): Promise<boolean> {
  return await _set(`provider:${id}:api_key`, apiKey)
}

export async function loadProviderApiKey(id: string): Promise<string> {
  return (await _get(`provider:${id}:api_key`)) ?? ""
}

export async function storeProviderHeaders(id: string, headers: Record<string, unknown>): Promise<boolean> {
  return await _set(`provider:${id}:headers`, JSON.stringify(headers))
}

export async function loadProviderHeaders(id: string): Promise<Record<string, unknown>> {
  const raw = await _get(`provider:${id}:headers`)
  return raw ? JSON.parse(raw) : {}
}

export async function deleteProviderSecrets(id: string): Promise<void> {
  await Promise.all([
    _del(`provider:${id}:api_key`),
    _del(`provider:${id}:headers`),
  ])
}

// ─── Channel secrets ─────────────────────────────────────────────────────────

export async function storeChannelConfig(id: string, config: Record<string, unknown>): Promise<boolean> {
  return await _set(`channel:${id}:config`, JSON.stringify(config))
}

export async function loadChannelConfig(id: string): Promise<Record<string, unknown>> {
  const raw = await _get(`channel:${id}:config`)
  return raw ? JSON.parse(raw) : {}
}

export async function deleteChannelSecrets(id: string): Promise<void> {
  await _del(`channel:${id}:config`)
}

// ─── MCP secrets ──────────────────────────────────────────────────────────────

export async function storeMcpHeaders(id: string, headers: Record<string, unknown>): Promise<boolean> {
  return await _set(`mcp:${id}:headers`, JSON.stringify(headers))
}

export async function loadMcpHeaders(id: string): Promise<Record<string, unknown>> {
  const raw = await _get(`mcp:${id}:headers`)
  return raw ? JSON.parse(raw) : {}
}

export async function storeMcpEnv(id: string, env: Record<string, string>): Promise<boolean> {
  return await _set(`mcp:${id}:env`, JSON.stringify(env))
}

export async function loadMcpEnv(id: string): Promise<Record<string, string>> {
  const raw = await _get(`mcp:${id}:env`)
  return raw ? JSON.parse(raw) : {}
}

export async function deleteMcpSecrets(id: string): Promise<void> {
  await Promise.all([
    _del(`mcp:${id}:headers`),
    _del(`mcp:${id}:env`),
  ])
}

// ─── Agent secrets ────────────────────────────────────────────────────────────

export async function storeAgentHeaders(id: string, headers: Record<string, unknown>): Promise<boolean> {
  return await _set(`agent:${id}:headers`, JSON.stringify(headers))
}

export async function loadAgentHeaders(id: string): Promise<Record<string, unknown>> {
  const raw = await _get(`agent:${id}:headers`)
  return raw ? JSON.parse(raw) : {}
}

export async function deleteAgentSecrets(id: string): Promise<void> {
  await _del(`agent:${id}:headers`)
}

// ─── Unchanged utilities ──────────────────────────────────────────────────────

export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return "••••••••"
  return apiKey.slice(0, 4) + "••••••••" + apiKey.slice(-4)
}

export function hashPassword(password: string): string {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(password)
  return hasher.digest("hex")
}

export function verifyPassword(password: string, hash: string): boolean {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(password)
  return hasher.digest("hex") === hash
}

// ─── Legacy AES-256-GCM decryption ──────────────────────────────────────────
// Used only by the one-shot migration in storage/migrate.ts.
// Safe to remove after all installs have run the migration once.

export function legacyDecryptAES(encrypted: string, iv: string): string {
  const nodeCrypto = require("node:crypto")
  const nodeFs = require("node:fs")
  const nodePath = require("node:path")
  const nodeOs = require("node:os")

  let key: Buffer
  const masterKey = process.env.HIVE_MASTER_KEY
  if (masterKey) {
    key = Buffer.from(masterKey.slice(0, 32).padEnd(32, "0"), "utf8")
  } else {
    const hiveDir = process.env.HIVE_HOME || nodePath.join(nodeOs.homedir(), ".hive")
    const keyPath = nodePath.join(hiveDir, ".master.key")
    if (!nodeFs.existsSync(keyPath)) return ""
    key = Buffer.from(nodeFs.readFileSync(keyPath, "utf8").trim(), "hex")
  }

  try {
    const ivBuf = Buffer.from(iv, "hex")
    const [encData, authTag] = encrypted.split(":")
    const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, ivBuf)
    decipher.setAuthTag(Buffer.from(authTag, "hex"))
    return decipher.update(encData, "hex", "utf8") + decipher.final("utf8")
  } catch {
    return ""
  }
}

function getMasterKey(): Buffer | null {
  const nodeCrypto = require("node:crypto")
  const nodeFs = require("node:fs")
  const nodePath = require("node:path")
  const nodeOs = require("node:os")

  const masterKey = process.env.HIVE_MASTER_KEY
  if (masterKey) {
    return Buffer.from(masterKey.slice(0, 32).padEnd(32, "0"), "utf8")
  }
  const hiveDir = process.env.HIVE_HOME || nodePath.join(nodeOs.homedir(), ".hive")
  const keyPath = nodePath.join(hiveDir, ".master.key")
  if (!nodeFs.existsSync(keyPath)) return null
  try {
    return Buffer.from(nodeFs.readFileSync(keyPath, "utf8").trim(), "hex")
  } catch {
    return null
  }
}

/**
 * Encrypt a plaintext string using the same AES-256-GCM scheme as the legacy
 * store. Format: `<encDataHex>:<authTagHex>`. Used as a DB-backed fallback
 * when the OS keychain is unavailable (headless Linux, Docker, etc.).
 */
export function legacyEncryptAES(plain: string, ivHex: string): string {
  const nodeCrypto = require("node:crypto")
  const key = getMasterKey()
  if (!key) return ""
  try {
    const iv = Buffer.from(ivHex, "hex")
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv)
    const encData = cipher.update(plain, "utf8", "hex") + cipher.final("hex")
    const authTag = cipher.getAuthTag().toString("hex")
    return `${encData}:${authTag}`
  } catch {
    return ""
  }
}

/**
 * DB-backed persistence fallback for secrets. Maps the canonical secret
 * name (e.g. `provider:openai:api_key`) to the matching ciphertext column
 * and updates the row in-place. Returns true if the row was written.
 */
function persistSecretToDb(name: string, value: string): boolean {
  const nodeCrypto = require("node:crypto")
  const parts = name.split(":")
  if (parts.length !== 3) return false
  const [kind, id, field] = parts

  let table: string
  let column: string
  switch (`${kind}:${field}`) {
    case "provider:api_key": table = "providers"; column = "api_key"; break
    case "provider:headers":  table = "providers"; column = "headers"; break
    case "channel:config":    table = "channels";  column = "config"; break
    case "mcp:headers":       table = "mcp_servers"; column = "headers"; break
    case "mcp:env":           table = "mcp_servers"; column = "env"; break
    case "agent:headers":     table = "agents"; column = "headers"; break
    default: return false
  }

  const key = getMasterKey()
  if (!key) {
    log.warn(`[secrets] No master key in ${process.env.HIVE_HOME || "~/.hive"}/.master.key — cannot persist ${name} to DB fallback`)
    return false
  }

  const iv = nodeCrypto.randomBytes(12).toString("hex")
  const enc = legacyEncryptAES(value, iv)
  if (!enc) return false

  try {
    const db = getDb()
    db.query(`UPDATE ${table} SET ${column}_encrypted = ?, ${column}_iv = ? WHERE id = ?`)
      .run(enc, iv, id)
    return true
  } catch (err) {
    log.warn(`[secrets] DB fallback failed for ${name}: ${(err as Error).message}`)
    return false
  }
}
