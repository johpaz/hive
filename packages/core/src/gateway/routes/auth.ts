import { col } from "../../storage/hive";
import type { UserDoc, RefreshTokenDoc } from "../../storage/collections";
import { readFileSync } from "node:fs";
import { getHiveDir } from "../../config/loader";
import * as path from "node:path";
import jwt from "jsonwebtoken";

type CorsHelper = (res: Response, req: Request) => Response;

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

const JWT_SECRET = process.env.HIVE_JWT_SECRET || process.env.HIVE_AUTH_TOKEN || "hive-default-jwt-secret-change-in-production";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;

function hashToken(token: string): string {
  return Bun.hash(token + JWT_SECRET).toString(16);
}

/** The single user doc — Hive is a single-user app, so `UPDATE users SET ...` with no WHERE targets this row. */
async function getSingleUser(): Promise<{ id: string; version: number; doc: UserDoc } | undefined> {
  const usersCol = await col<UserDoc>("users");
  return (await usersCol.scan({ limit: 1 }))[0];
}

export async function generateTokens(userId: string): Promise<AuthTokens> {
  const accessToken = jwt.sign({ userId, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign({ userId, type: "refresh", jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });

  const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
  const tokenHash = hashToken(refreshToken);

  const tokensCol = await col<RefreshTokenDoc>("refreshTokens");
  const id = crypto.randomUUID().replace(/-/g, "");
  await tokensCol.put(id, { id, user_id: userId, token_hash: tokenHash, expires_at: expiresAt, revoked: false }, { expectedVersion: 0 });

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    tokenType: "Bearer"
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens | null> {
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as { userId: string; type: string; jti: string };
    if (decoded.type !== "refresh") return null;

    const tokenHash = hashToken(refreshToken);
    const tokensCol = await col<RefreshTokenDoc>("refreshTokens");
    const matches = await tokensCol.findBy("token_hash", tokenHash);
    const now = Math.floor(Date.now() / 1000);
    const stored = matches.find(e => !e.doc.revoked && e.doc.expires_at > now);

    if (!stored) return null;

    await tokensCol.delete(stored.id);

    return generateTokens(stored.doc.user_id);
  } catch {
    return null;
  }
}

export async function validateAccessToken(token: string): Promise<{ userId: string } | null> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; type: string };
    if (decoded.type !== "access") return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

function getAuthTokenFromFile(): string {
  // The auth token lives in ~/.hive/.auth_token — same value as HIVE_AUTH_TOKEN env var
  try {
    return readFileSync(path.join(getHiveDir(), ".auth_token"), "utf-8").trim();
  } catch {
    return process.env.HIVE_AUTH_TOKEN ?? "";
  }
}

/** GET /api/auth/status — public
 *  Returns whether this instance has email+password credentials configured.
 *  The UI uses this to decide whether to show the login page or allow direct access.
 */
export async function handleAuthStatus(
  req: Request,
  cors: CorsHelper
): Promise<Response> {
  const user = (await getSingleUser())?.doc;

  const hasCredentials = !!(user?.email && user?.password_hash);
  return cors(Response.json({ hasCredentials, email: user?.email ?? null }), req);
}

/** GET /api/auth/recovery-key — requires auth
 *  Returns the recovery key (HIVE_AUTH_TOKEN) so the UI can display it.
 */
export async function handleRecoveryKey(
  req: Request,
  cors: CorsHelper
): Promise<Response> {
  const recoveryKey = getAuthTokenFromFile();
  return cors(Response.json({ recoveryKey }), req);
}

/** POST /api/auth/login — public
 *  body: { email, password }
 *  Returns: { authToken } on success, 401 on failure.
 */
export async function handleLogin(
  req: Request,
  cors: CorsHelper
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { email?: string; password?: string };

  if (!body.email || !body.password) {
    return cors(Response.json({ error: "Email y contraseña requeridos" }, { status: 400 }), req);
  }

  const usersCol = await col<UserDoc>("users");
  const targetEmail = body.email.toLowerCase().trim();
  const matches = await usersCol.scan({});
  const user = matches.find(e => e.doc.email === targetEmail)?.doc;

  if (!user?.password_hash) {
    return cors(Response.json({ error: "Credenciales inválidas" }, { status: 401 }), req);
  }

  const valid = await Bun.password.verify(body.password, user.password_hash);
  if (!valid) {
    return cors(Response.json({ error: "Credenciales inválidas" }, { status: 401 }), req);
  }

  const authToken = process.env.HIVE_AUTH_TOKEN ?? getAuthTokenFromFile();
  return cors(Response.json({ authToken }), req);
}

/** POST /api/auth/setup-credentials — requires existing auth token
 *  Sets email + password for the first time (or updates them).
 *  body: { email, password }
 */
export async function handleSetupCredentials(
  req: Request,
  cors: CorsHelper
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { email?: string; password?: string };

  if (!body.email || !body.password) {
    return cors(Response.json({ error: "Email y contraseña requeridos" }, { status: 400 }), req);
  }

  if (body.password.length < 8) {
    return cors(Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 }), req);
  }

  const passwordHash = await Bun.password.hash(body.password, { algorithm: "bcrypt", cost: 10 });
  const email = body.email.toLowerCase().trim();

  const usersCol = await col<UserDoc>("users");
  const entry = await getSingleUser();
  if (entry) {
    await usersCol.put(entry.id, { ...entry.doc, email, password_hash: passwordHash }, { expectedVersion: entry.version });
  }

  return cors(Response.json({ success: true }), req);
}

/** POST /api/auth/change-password — requires existing auth token
 *  body: { currentPassword, newPassword }
 */
export async function handleChangePassword(
  req: Request,
  cors: CorsHelper
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string };

  if (!body.currentPassword || !body.newPassword) {
    return cors(Response.json({ error: "Campos requeridos" }, { status: 400 }), req);
  }

  if (body.newPassword.length < 8) {
    return cors(Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 }), req);
  }

  const entry = await getSingleUser();

  if (!entry?.doc.password_hash) {
    return cors(Response.json({ error: "No hay contraseña configurada" }, { status: 400 }), req);
  }

  const valid = await Bun.password.verify(body.currentPassword, entry.doc.password_hash);
  if (!valid) {
    return cors(Response.json({ error: "Contraseña actual incorrecta" }, { status: 401 }), req);
  }

  const newHash = await Bun.password.hash(body.newPassword, { algorithm: "bcrypt", cost: 10 });
  const usersCol = await col<UserDoc>("users");
  await usersCol.put(entry.id, { ...entry.doc, password_hash: newHash }, { expectedVersion: entry.version });

  return cors(Response.json({ success: true }), req);
}

/** POST /api/auth/recover — public
 *  Resets password using the recovery key (= HIVE_AUTH_TOKEN from ~/.hive/.auth_token).
 *  body: { recoveryKey, newPassword }
 */
export async function handleRecover(
  req: Request,
  cors: CorsHelper
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { recoveryKey?: string; newPassword?: string };

  if (!body.recoveryKey || !body.newPassword) {
    return cors(Response.json({ error: "Recovery key y nueva contraseña requeridos" }, { status: 400 }), req);
  }

  if (body.newPassword.length < 8) {
    return cors(Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 }), req);
  }

  const storedToken = getAuthTokenFromFile();
  if (!storedToken || body.recoveryKey.trim() !== storedToken) {
    return cors(Response.json({ error: "Recovery key inválido" }, { status: 401 }), req);
  }

  const newHash = await Bun.password.hash(body.newPassword, { algorithm: "bcrypt", cost: 10 });
  const usersCol = await col<UserDoc>("users");
  const entry = await getSingleUser();
  if (entry) {
    await usersCol.put(entry.id, { ...entry.doc, password_hash: newHash }, { expectedVersion: entry.version });
  }

  const authToken = process.env.HIVE_AUTH_TOKEN ?? storedToken;
  return cors(Response.json({ success: true, authToken }), req);
}

/** POST /api/auth/disable — requires existing auth token
 *  Removes email + password (disables login protection).
 */
export async function handleDisableAuth(
  req: Request,
  cors: CorsHelper
): Promise<Response> {
  const usersCol = await col<UserDoc>("users");
  const entry = await getSingleUser();
  if (entry) {
    await usersCol.put(entry.id, { ...entry.doc, email: null, password_hash: null }, { expectedVersion: entry.version });
  }
  return cors(Response.json({ success: true }), req);
}
