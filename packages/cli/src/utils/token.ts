import { randomBytes } from "node:crypto"

export function generateAuthToken(): string {
    // 32 bytes → 43 caracteres base64url seguros
    return randomBytes(32).toString("base64url")
}
