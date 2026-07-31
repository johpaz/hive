import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { getHiveDir } from "../config/loader.ts"
import { logger } from "../utils/logger"
import { col } from "./hive"

const log = logger.child("crypto")
const SERVICE = "hive"

interface SecretDoc {
  ciphertext: string
  iv: string
}

// ─── Durable secret store ────────────────────────────────────────────────────
// The `secrets` collection is the source of truth: AES-256-GCM ciphertext in
// the database, keyed by <HIVE_HOME>/.master.key. It lives inside the data
// directory, so whatever persists the database (a Docker volume, a backup)
// persists the secrets with it.
//
// The OS keychain (Bun.secrets) is only a best-effort mirror. It throws on
// headless Linux/Docker (no libsecret/D-Bus), and on desktops it can be a
// session keyring that is discarded when the session ends — so a secret
// written *only* there does not survive a server restart. That is exactly
// what was wiping every provider API key, channel token and MCP header on
// restart in production.

const _mem = new Map<string, string>()
let _keychainOk: boolean | null = null // null = untested

async function _get(name: string): Promise<string | null> {
  const cached = _mem.get(name)
  if (cached !== undefined) return cached

  // Durable store first — it is the one every write goes to.
  const stored = await _readCollectionSecret(name)
  if (stored) return stored

  // Legacy/desktop installs may only have the value in the OS keychain.
  const fromKeychain = await _keychainGet(name)
  if (fromKeychain) _mem.set(name, fromKeychain)
  return fromKeychain
}

/**
 * Persist a secret. Always writes the durable store; the keychain is
 * mirrored on top when available. Returns false only when the value ended up
 * nowhere but this process's memory — callers can use that to warn instead of
 * silently accepting a secret that dies with the process.
 */
async function _set(name: string, value: string): Promise<boolean> {
  _mem.set(name, value)
  const durable = await persistSecretToCollection(name, value)
  const mirrored = await _keychainSet(name, value)
  if (!durable && !mirrored) {
    log.error(`[secrets] ${name} could not be persisted — it will be lost on restart`)
  }
  return durable || mirrored
}

/**
 * Read a secret from the `secrets` HiveDB collection — the durable store.
 * Decrypted values are cached in memory for the rest of the process.
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

async function _keychainGet(name: string): Promise<string | null> {
  if (_keychainOk === false) return null
  try {
    const val = await (Bun as any).secrets.get({ service: SERVICE, name })
    _keychainOk = true
    return val ?? null
  } catch {
    _keychainOk = false
    return null
  }
}

async function _keychainSet(name: string, value: string): Promise<boolean> {
  if (_keychainOk === false) return false
  try {
    await (Bun as any).secrets.set({ service: SERVICE, name, value })
    _keychainOk = true
    return true
  } catch {
    _keychainOk = false
    return false
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

/**
 * Mint the master key (if this is a fresh install) and report where secrets
 * will be stored. Called once at boot so an operator sees the answer before
 * typing an API key, not after a restart lost it.
 */
export function ensureSecretsBackend(): { durable: boolean } {
  const durable = getMasterKey() !== null
  if (!durable) {
    log.error(
      `[secrets] No master key available — API keys and channel tokens will NOT survive a restart. ` +
      `Set HIVE_MASTER_KEY or make ${getHiveDir()} writable.`
    )
  }
  return { durable }
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
  const key = getMasterKey()
  if (!key) return ""
  try {
    const ivBuf = Buffer.from(iv, "hex")
    const [encData, authTag] = encrypted.split(":")
    const decipher = createDecipheriv("aes-256-gcm", key, ivBuf)
    decipher.setAuthTag(Buffer.from(authTag, "hex"))
    return decipher.update(encData, "hex", "utf8") + decipher.final("utf8")
  } catch {
    return ""
  }
}

let _masterKey: Buffer | null = null

/**
 * The AES key protecting the `secrets` collection.
 *
 * `HIVE_MASTER_KEY` wins when set (the recommended way to run in production:
 * the key never touches the data volume). Otherwise the key is minted on
 * first use and written 0600 to `<HIVE_HOME>/.master.key`, next to the
 * database — a fresh install becomes durable without the user configuring
 * anything, and restoring the data directory restores the ability to read
 * the secrets inside it.
 */
function getMasterKey(): Buffer | null {
  if (_masterKey) return _masterKey

  const fromEnv = process.env.HIVE_MASTER_KEY
  if (fromEnv) {
    _masterKey = Buffer.from(fromEnv.slice(0, 32).padEnd(32, "0"), "utf8")
    return _masterKey
  }

  const keyPath = path.join(getHiveDir(), ".master.key")
  try {
    if (!existsSync(keyPath)) {
      mkdirSync(path.dirname(keyPath), { recursive: true })
      try {
        // "wx" so two processes starting at once can't overwrite each other's key
        writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" })
        log.info(`[secrets] Master key generated at ${keyPath}`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      }
    }
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex")
    if (key.length !== 32) {
      log.error(`[secrets] ${keyPath} is not a 32-byte hex key — secrets cannot be read or written`)
      return null
    }
    _masterKey = key
    return _masterKey
  } catch (err) {
    log.error(`[secrets] Could not read or create ${keyPath}: ${(err as Error).message}`)
    return null
  }
}

/**
 * Encrypt a plaintext string with AES-256-GCM. Format:
 * `<encDataHex>:<authTagHex>`. Used for every document in the `secrets`
 * collection.
 */
export function encryptSecret(plain: string, ivHex: string): string {
  const key = getMasterKey()
  if (!key) return ""
  try {
    const iv = Buffer.from(ivHex, "hex")
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    const encData = cipher.update(plain, "utf8", "hex") + cipher.final("hex")
    const authTag = cipher.getAuthTag().toString("hex")
    return `${encData}:${authTag}`
  } catch {
    return ""
  }
}

/**
 * Persist a secret to the `secrets` collection — the durable store — keyed by
 * the canonical secret name (e.g. `provider:openai:api_key`). Returns true if
 * the document was written.
 */
async function persistSecretToCollection(name: string, value: string): Promise<boolean> {
  const key = getMasterKey()
  if (!key) {
    log.warn(`[secrets] No master key — cannot persist ${name} durably`)
    return false
  }

  const iv = randomBytes(12).toString("hex")
  const ciphertext = encryptSecret(value, iv)
  if (!ciphertext) return false

  try {
    const secrets = await col<SecretDoc>("secrets")
    await secrets.put(name, { ciphertext, iv })
    return true
  } catch (err) {
    log.warn(`[secrets] Durable write failed for ${name}: ${(err as Error).message}`)
    return false
  }
}
