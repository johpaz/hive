import { logger } from "../utils/logger"

const log = logger.child("crypto")
const SERVICE = "hive"

// ─── Keychain with in-memory fallback ────────────────────────────────────────
// On Linux headless (no GNOME Keyring / libsecret) Bun.secrets throws.
// Fall back to in-memory storage so the server stays functional, but log a
// warning so operators know secrets won't survive a restart in that mode.

const _mem = new Map<string, string>()
let _keychainOk: boolean | null = null // null = untested

async function _get(name: string): Promise<string | null> {
  if (_keychainOk === false) return _mem.get(name) ?? null
  try {
    const val = await (Bun as any).secrets.get({ service: SERVICE, name })
    _keychainOk = true
    return val ?? null
  } catch {
    _keychainOk = false
    return _mem.get(name) ?? null
  }
}

async function _set(name: string, value: string): Promise<void> {
  if (_keychainOk === false) {
    log.warn(`[secrets] OS keychain unavailable — in-memory fallback (secret lost on restart): ${name}`)
    _mem.set(name, value)
    return
  }
  try {
    await (Bun as any).secrets.set({ service: SERVICE, name, value })
    _keychainOk = true
  } catch {
    _keychainOk = false
    log.warn(`[secrets] OS keychain unavailable — in-memory fallback (secret lost on restart): ${name}`)
    _mem.set(name, value)
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

export async function storeProviderApiKey(id: string, apiKey: string): Promise<void> {
  await _set(`provider:${id}:api_key`, apiKey)
}

export async function loadProviderApiKey(id: string): Promise<string> {
  return (await _get(`provider:${id}:api_key`)) ?? ""
}

export async function storeProviderHeaders(id: string, headers: Record<string, unknown>): Promise<void> {
  await _set(`provider:${id}:headers`, JSON.stringify(headers))
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

export async function storeChannelConfig(id: string, config: Record<string, unknown>): Promise<void> {
  await _set(`channel:${id}:config`, JSON.stringify(config))
}

export async function loadChannelConfig(id: string): Promise<Record<string, unknown>> {
  const raw = await _get(`channel:${id}:config`)
  return raw ? JSON.parse(raw) : {}
}

export async function deleteChannelSecrets(id: string): Promise<void> {
  await _del(`channel:${id}:config`)
}

// ─── MCP secrets ──────────────────────────────────────────────────────────────

export async function storeMcpHeaders(id: string, headers: Record<string, unknown>): Promise<void> {
  await _set(`mcp:${id}:headers`, JSON.stringify(headers))
}

export async function loadMcpHeaders(id: string): Promise<Record<string, unknown>> {
  const raw = await _get(`mcp:${id}:headers`)
  return raw ? JSON.parse(raw) : {}
}

export async function storeMcpEnv(id: string, env: Record<string, string>): Promise<void> {
  await _set(`mcp:${id}:env`, JSON.stringify(env))
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

export async function storeAgentHeaders(id: string, headers: Record<string, unknown>): Promise<void> {
  await _set(`agent:${id}:headers`, JSON.stringify(headers))
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
    key = Buffer.from(nodeFs.readFileSync(keyPath, "utf-8").trim(), "hex")
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
