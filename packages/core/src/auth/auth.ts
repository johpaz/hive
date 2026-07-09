import jwt from "jsonwebtoken";
import { hashString } from "../utils/crypto.ts";
import { col } from "../storage/hive.ts";
import type { RefreshTokenDoc } from "../storage/collections.ts";

const JWT_SECRET = process.env.JWT_SECRET || "hive-default-jwt-secret-change-in-production";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

interface JwtPayload {
  userId: string;
  type: "access" | "refresh";
}

export async function generateTokens(userId: string): Promise<AuthTokens> {
  const accessToken = jwt.sign({ userId, type: "access" } satisfies JwtPayload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

  const refreshToken = jwt.sign({ userId, type: "refresh" } satisfies JwtPayload, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });

  const refreshTokenHash = hashString(refreshToken);
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_TOKEN_EXPIRY_SECONDS;

  const tokensCol = await col<RefreshTokenDoc>("refreshTokens");
  const id = crypto.randomUUID().replace(/-/g, "");
  await tokensCol.put(id, {
    id, user_id: userId, token_hash: refreshTokenHash, expires_at: expiresAt, revoked: false,
  }, { expectedVersion: 0 });

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60,
    tokenType: "Bearer",
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload;
  } catch {
    throw new Error("Invalid or expired refresh token");
  }

  if (payload.type !== "refresh") {
    throw new Error("Invalid token type");
  }

  const refreshTokenHash = hashString(refreshToken);
  const tokensCol = await col<RefreshTokenDoc>("refreshTokens");
  const matches = await tokensCol.findBy("token_hash", refreshTokenHash);
  const tokenEntry = matches[0];

  if (!tokenEntry) {
    throw new Error("Refresh token not found");
  }

  if (tokenEntry.doc.revoked) {
    throw new Error("Refresh token has been revoked");
  }

  if (tokenEntry.doc.expires_at < Math.floor(Date.now() / 1000)) {
    await tokensCol.delete(tokenEntry.id);
    throw new Error("Refresh token has expired");
  }

  await tokensCol.delete(tokenEntry.id);

  return generateTokens(payload.userId);
}

export async function validateAccessToken(token: string): Promise<{ userId: string } | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    if (payload.type !== "access") {
      return null;
    }
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const refreshTokenHash = hashString(refreshToken);
  const tokensCol = await col<RefreshTokenDoc>("refreshTokens");
  const matches = await tokensCol.findBy("token_hash", refreshTokenHash);
  for (const entry of matches) {
    await tokensCol.put(entry.id, { ...entry.doc, revoked: true }, { expectedVersion: entry.version });
  }
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  const tokensCol = await col<RefreshTokenDoc>("refreshTokens");
  const matches = await tokensCol.findBy("user_id", userId);
  for (const entry of matches) {
    await tokensCol.put(entry.id, { ...entry.doc, revoked: true }, { expectedVersion: entry.version });
  }
}
