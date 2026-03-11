import * as crypto from "node:crypto";

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateShortId(length = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i]! % chars.length];
  }
  
  return result;
}

export function hashString(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hashObject(obj: unknown): string {
  return hashString(JSON.stringify(obj));
}

export async function hmacSign(
  key: string,
  data: string,
  algorithm: "sha256" | "sha512" = "sha256"
): Promise<string> {
  return crypto.createHmac(algorithm, key).update(data).digest("hex");
}

export async function hmacVerify(
  key: string,
  data: string,
  signature: string,
  algorithm: "sha256" | "sha512" = "sha256"
): Promise<boolean> {
  const expected = await hmacSign(key, data, algorithm);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

export function encrypt(text: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(key, "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", derivedKey, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedData: string, key: string): string {
  const [ivHex, encrypted] = encryptedData.split(":");
  if (!ivHex || !encrypted) {
    throw new Error("Invalid encrypted data format");
  }
  
  const iv = Buffer.from(ivHex, "hex");
  const derivedKey = crypto.scryptSync(key, "salt", 32);
  const decipher = crypto.createDecipheriv("aes-256-cbc", derivedKey, iv);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
