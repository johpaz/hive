import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

let _encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_encryptionKey) return _encryptionKey;

  const masterKey = process.env.HIVE_MASTER_KEY;

  if (masterKey) {
    _encryptionKey = Buffer.from(masterKey.slice(0, 32).padEnd(32, "0"), "utf8");
  } else {
    const hiveDir = process.env.HIVE_HOME || path.join(homedir(), ".hive");
    if (!existsSync(hiveDir)) {
      mkdirSync(hiveDir, { recursive: true });
    }
    const keyPath = path.join(hiveDir, ".master.key");

    if (existsSync(keyPath)) {
      const storedKey = readFileSync(keyPath, "utf-8").trim();
      _encryptionKey = Buffer.from(storedKey, "hex");
    } else {
      _encryptionKey = randomBytes(32);
      writeFileSync(keyPath, _encryptionKey.toString("hex"), { mode: 0o600 });
    }
  }

  return _encryptionKey;
}

export interface EncryptedData {
  encrypted: string;
  iv: string;
}

export function encrypt(text: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(16);

  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    encrypted: encrypted + ":" + authTag,
    iv: iv.toString("hex"),
  };
}

export function decrypt(data: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(data.iv, "hex");
  const [encrypted, authTag] = data.encrypted.split(":");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function encryptApiKey(apiKey: string): { encrypted: string; iv: string } {
  return encrypt(apiKey);
}

export function decryptApiKey(encrypted: string, iv: string): string {
  return decrypt({ encrypted, iv });
}

export function encryptConfig(config: Record<string, unknown>): { encrypted: string; iv: string } {
  return encrypt(JSON.stringify(config));
}

export function decryptConfig(encrypted: string, iv: string): Record<string, unknown> {
  const decrypted = decrypt({ encrypted, iv });
  return JSON.parse(decrypted);
}

export function hashPassword(password: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(password);
  return hasher.digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(password);
  return hasher.digest("hex") === hash;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return "••••••••";
  return apiKey.slice(0, 4) + "••••••••" + apiKey.slice(-4);
}
