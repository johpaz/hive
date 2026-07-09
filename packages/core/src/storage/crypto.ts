import { logger } from "../utils/logger"
import { col } from "./hive"

const log = logger.child("crypto")
const SERVICE = "hive"

interface SecretDoc {
  ciphertext: string
  iv: string
}

// ─── Keychain with in-memory fallback ────────────────────────────────────────
// On Linux headless (no GNOME Keyring / libsecret) Bun.secrets throws.
// Fall back to in-memory storage so the server stays functional, but log a
// warning so operators know secrets won't survive a restart in that mode.

const _mem = new Map<string, string>()
let _keychainOk: boolean | null = null // null = untested

async function _get(name: string): Promise<string | null> {
  if (_keychainOk === false) {
    return _mem.get(name) ?? (await _readCollectionSecret(name))
  }
  try {
    const val = await (Bun as any).secrets.get({ service: SERVICE, name })
    _keychainOk = true
    return val ?? _mem.get(name) ?? (await _readCollectionSecret(name))
  } catch {
    _keychainOk = false
    return _mem.get(name) ?? (await _readCollectionSecret(name))
  }
}

async function _set(name: string, value: string): Promise<boolean> {
  if (_keychainOk === false) {
    _mem.set(name, value)
    return persistSecretToCollection(name, value)
  }
  try {
    await (Bun as any).secrets.set({ service: SERVICE, name, value })
    _keychainOk = true
    return true
  } catch {
    _keychainOk = false
    _mem.set(name, value)
    return persistSecretToCollection(name, value)
  }
}

/**
 * Read a secret from the `secrets` HiveDB collection as a last-resort
 * fallback when the keychain and in-memory map are both empty. Used to
 * survive process restarts when the OS keychain is unavailable (Docker,
 * headless).
 */
async function _readCollectionSecret(name: string): Promise<string | null> {
  try {
    const secrets = await col<SecretDoc>("secrets")
    const entry = await secrets.get(name)
    if (!entry) return null
    const plain = decryptSecret(entry.doc.ciphertext, entry.doc.iv)
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
  try {
    const secrets = await col<SecretDoc>("secrets")
    await secrets.delete(name)
  } catch {
    // ignore — might not exist
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
 * or the `secrets` collection fallback). Returns false if it ended up in the
 * per-process in-memory map only — useful so callers can avoid destructive
 * actions that would lose data on restart.
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

// ─── AES-256-GCM for the collection-backed secret fallback ──────────────────

export function decryptSecret(encrypted: string, iv: string): string {
  const nodeCrypto = require("node:crypto")
  const key = getMasterKey()
  if (!key) return ""
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
 * Encrypt a plaintext string with AES-256-GCM. Format:
 * `<encDataHex>:<authTagHex>`. Used as the `secrets` collection fallback
 * when the OS keychain is unavailable (headless Linux, Docker, etc.).
 */
export function encryptSecret(plain: string, ivHex: string): string {
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
 * Persist a secret to the `secrets` collection as a last-resort fallback
 * (keyed directly by the canonical secret name, e.g.
 * `provider:openai:api_key`). Returns true if the document was written.
 */
async function persistSecretToCollection(name: string, value: string): Promise<boolean> {
  const nodeCrypto = require("node:crypto")

  const key = getMasterKey()
  if (!key) {
    log.warn(`[secrets] No master key in ${process.env.HIVE_HOME || "~/.hive"}/.master.key — cannot persist ${name} to collection fallback`)
    return false
  }

  const iv = nodeCrypto.randomBytes(12).toString("hex")
  const ciphertext = encryptSecret(value, iv)
  if (!ciphertext) return false

  try {
    const secrets = await col<SecretDoc>("secrets")
    await secrets.put(name, { ciphertext, iv })
    return true
  } catch (err) {
    log.warn(`[secrets] Collection fallback failed for ${name}: ${(err as Error).message}`)
    return false
  }
}
