/**
 * HiveLearn — local AES-256-GCM decryption.
 *
 * Réplica exacta de la función decryptApiKey del core para desencriptar
 * las API keys almacenadas en la BD compartida.
 *
 * Usa la misma clave:
 *  1. HIVE_MASTER_KEY env var (primeros 32 chars, padded con '0')
 *  2. Archivo ${HIVE_HOME}/.master.key  (default: ~/.hive/.master.key)
 */
import { createDecipheriv } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

let _key: Buffer | null = null

function getKey(): Buffer {
  if (_key) return _key

  const masterKey = process.env.HIVE_MASTER_KEY
  if (masterKey) {
    _key = Buffer.from(masterKey.slice(0, 32).padEnd(32, '0'), 'utf8')
    return _key
  }

  const hiveDir = process.env.HIVE_HOME || join(homedir(), '.hive')
  const keyPath = join(hiveDir, '.master.key')
  if (existsSync(keyPath)) {
    _key = Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'hex')
    return _key
  }

  throw new Error('HiveLearn: no encryption key found. Set HIVE_MASTER_KEY or ensure ~/.hive/.master.key exists.')
}

/** Desencripta una API key cifrada con AES-256-GCM (mismo formato que core). */
export function decryptApiKey(encrypted: string, iv: string): string {
  const key = getKey()
  const ivBuf = Buffer.from(iv, 'hex')
  const [encPart, authTagHex] = encrypted.split(':')

  const decipher = createDecipheriv('aes-256-gcm', key, ivBuf)
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  return decipher.update(encPart, 'hex', 'utf8') + decipher.final('utf8')
}
