import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
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
// the database. The AES key lives in the OS keychain (libsecret / macOS
// Keychain / Credential Manager); only where no keychain exists (headless
// Linux, Docker) does it fall back to <HIVE_HOME>/.master.key, next to the
// database, so a fresh install is still durable without configuration.
//
// The OS keychain (Bun.secrets) is only a best-effort mirror. It throws on
// headless Linux/Docker (no libsecret/D-Bus), and on desktops it can be a
// session keyring that is discarded when the session ends — so a secret
// written *only* there does not survive a server restart. That is exactly
// what was wiping every provider API key, channel token and MCP header on
// restart in production.

const _mem = new Map<string, string>()
// Bumped by every write and delete. A read that was already in flight when the
// secret changed must not cache what it found: that resurrected deleted keys
// in memory until restart.
const _epoch = new Map<string, number>()
let _keychainOk: boolean | null = null // null = untested
let _keychainApi: unknown = undefined

/**
 * A test double or a recovered runtime may replace Bun.secrets. Reset the
 * cached availability result when that API object changes so a previous
 * headless failure cannot poison the replacement backend forever.
 */
function _getKeychainApi(): any {
  const api = (Bun as any).secrets
  if (api !== _keychainApi) {
    _keychainApi = api
    _keychainOk = null
  }
  return api
}

async function _get(name: string): Promise<string | null> {
  await initMasterKey()
  const cached = _mem.get(name)
  if (cached !== undefined) return cached
  const epoch = _epoch.get(name) ?? 0
  const cache = (value: string) => { if ((_epoch.get(name) ?? 0) === epoch) _mem.set(name, value) }

  // Durable store first — it is the one every write goes to.
  const stored = await _readCollectionSecret(name)
  if (stored) {
    cache(stored)
    return stored
  }

  // Legacy/desktop installs may only have the value in the OS keychain.
  const fromKeychain = await _keychainGet(name)
  if (fromKeychain) cache(fromKeychain)
  return fromKeychain
}

/**
 * Persist a secret. Always writes the durable store; the keychain is
 * mirrored on top when available. Returns false only when the value ended up
 * nowhere but this process's memory — callers can use that to warn instead of
 * silently accepting a secret that dies with the process.
 */
async function _set(name: string, value: string): Promise<boolean> {
  await initMasterKey()
  _epoch.set(name, (_epoch.get(name) ?? 0) + 1)
  _mem.set(name, value)
  const durable = await persistSecretToCollection(name, value)
  const mirrored = await _keychainSet(name, value)
  if (!durable && !mirrored) {
    log.error(`[secrets] ${name} could not be persisted — it will be lost on restart`)
  }
  return durable || mirrored
}

/** Read a secret from the `secrets` HiveDB collection — the durable store. `_get` caches it. */
async function _readCollectionSecret(name: string): Promise<string | null> {
  try {
    const secrets = await col<SecretDoc>("secrets")
    const entry = await secrets.get(name)
    if (!entry) return null
    return decryptSecret(entry.doc.ciphertext, entry.doc.iv) || null
  } catch {
    return null
  }
}

async function _keychainGet(name: string): Promise<string | null> {
  const keychain = _getKeychainApi()
  if (_keychainOk === false) return null
  try {
    const val = await keychain.get({ service: SERVICE, name })
    _keychainOk = true
    return val ?? null
  } catch {
    _keychainOk = false
    return null
  }
}

async function _keychainSet(name: string, value: string): Promise<boolean> {
  const keychain = _getKeychainApi()
  if (_keychainOk === false) return false
  try {
    await keychain.set({ service: SERVICE, name, value })
    _keychainOk = true
    return true
  } catch {
    _keychainOk = false
    return false
  }
}

async function _del(name: string): Promise<void> {
  _epoch.set(name, (_epoch.get(name) ?? 0) + 1)
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
  // Again once the stores are empty: a read that started inside this window
  // found the old value and must not cache it.
  _epoch.set(name, (_epoch.get(name) ?? 0) + 1)
  _mem.delete(name)
}

/**
 * Resolve the master key (minting it on a fresh install) and report where
 * secrets will be stored. Called once at boot so an operator sees the answer
 * before typing an API key, not after a restart lost it.
 */
export async function ensureSecretsBackend(): Promise<{ durable: boolean; keySource: MasterKeySource }> {
  await initMasterKey()
  const durable = _masterKey !== null
  if (!durable) {
    log.error(
      `[secrets] No master key available — API keys and channel tokens will NOT survive a restart. ` +
      `Set HIVE_MASTER_KEY or make ${getHiveDir()} writable.`
    )
  }
  return { durable, keySource: _keySource }
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

export async function deleteProviderApiKey(id: string): Promise<void> {
  await _del(`provider:${id}:api_key`)
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

type MasterKeySource = "env" | "keychain" | "file" | "none"

// One entry per data directory: the keychain is per-user, HIVE_HOME is not, and
// a second instance (tests, another profile) must never adopt this one's key.
const masterKeyEntry = () =>
  `master-key:${new Bun.CryptoHasher("sha256").update(path.resolve(getHiveDir())).digest("hex").slice(0, 16)}`

let _masterKey: Buffer | null = null
let _keySource: MasterKeySource = "none"
let _initPromise: Promise<void> | null = null

/**
 * Resolve the AES key protecting the `secrets` collection, in order:
 *
 *  1. `HIVE_MASTER_KEY` — the key never touches the machine's disk.
 *  2. The OS keychain. A key left in `<HIVE_HOME>/.master.key` by an earlier
 *     version is moved there, and the file is removed only after the keychain
 *     returns the same key.
 *  3. `<HIVE_HOME>/.master.key` (0600) where no keychain exists.
 *
 * Memoized: every secret read/write awaits it, so the sync primitives below
 * can rely on `_masterKey`.
 */
export function initMasterKey(): Promise<void> {
  return (_initPromise ??= resolveMasterKey())
}

async function resolveMasterKey(): Promise<void> {
  const fromEnv = process.env.HIVE_MASTER_KEY
  if (fromEnv) {
    _masterKey = Buffer.from(fromEnv.slice(0, 32).padEnd(32, "0"), "utf8")
    _keySource = "env"
    return
  }

  const keyPath = path.join(getHiveDir(), ".master.key")
  const fromKeychain = await _keychainGetKey()
  if (fromKeychain) {
    _masterKey = fromKeychain
    _keySource = "keychain"
    // An earlier version's file must not outlive the key it duplicates.
    if (existsSync(keyPath) && readFileKey(keyPath)?.equals(fromKeychain)) removeKeyFile(keyPath)
    return
  }

  // No key in the keychain: reuse the file's key (migration) or mint a new one.
  const key = (existsSync(keyPath) ? readFileKey(keyPath) : null) ?? randomBytes(32)
  if (await _keychainSetKey(key)) {
    _masterKey = key
    _keySource = "keychain"
    if (existsSync(keyPath)) removeKeyFile(keyPath)
    else log.info("[secrets] Master key generated in the OS keychain")
    return
  }

  // Headless Linux / Docker: no keychain to hold it.
  _masterKey = loadOrMintKeyFile(keyPath)
  _keySource = _masterKey ? "file" : "none"
}

/** Read the key from the keychain; null when absent, malformed or no keychain. */
async function _keychainGetKey(): Promise<Buffer | null> {
  try {
    const hex = await (Bun as any).secrets.get({ service: SERVICE, name: masterKeyEntry() })
    const key = hex ? Buffer.from(String(hex).trim(), "hex") : null
    return key?.length === 32 ? key : null
  } catch {
    return null
  }
}

/** Store the key and confirm the keychain gives it back — a write that does not persist is no write. */
async function _keychainSetKey(key: Buffer): Promise<boolean> {
  try {
    await (Bun as any).secrets.set({ service: SERVICE, name: masterKeyEntry(), value: key.toString("hex") })
  } catch {
    return false
  }
  return (await _keychainGetKey())?.equals(key) ?? false
}

function readFileKey(keyPath: string): Buffer | null {
  try {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex")
    if (key.length === 32) return key
    log.error(`[secrets] ${keyPath} is not a 32-byte hex key — secrets cannot be read or written`)
  } catch (err) {
    log.error(`[secrets] Could not read ${keyPath}: ${(err as Error).message}`)
  }
  return null
}

function removeKeyFile(keyPath: string): void {
  try {
    unlinkSync(keyPath)
    log.info(`[secrets] Master key moved to the OS keychain; removed ${keyPath}`)
  } catch (err) {
    log.warn(`[secrets] Master key is in the OS keychain but ${keyPath} could not be removed: ${(err as Error).message}`)
  }
}

function loadOrMintKeyFile(keyPath: string): Buffer | null {
  try {
    if (!existsSync(keyPath)) {
      mkdirSync(path.dirname(keyPath), { recursive: true })
      try {
        // "wx" so two processes starting at once can't overwrite each other's key
        writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" })
        log.info(`[secrets] No OS keychain; master key generated at ${keyPath}`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      }
    }
    return readFileKey(keyPath)
  } catch (err) {
    log.error(`[secrets] Could not read or create ${keyPath}: ${(err as Error).message}`)
    return null
  }
}

function getMasterKey(): Buffer | null {
  return _masterKey
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
