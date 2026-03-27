import { getDb } from "../../storage/sqlite";
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

export async function generateTokens(userId: string): Promise<AuthTokens> {
  const accessToken = jwt.sign({ userId, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign({ userId, type: "refresh", jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  
  const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
  const tokenHash = hashToken(refreshToken);
  
  getDb().query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
  ).run(userId, tokenHash, expiresAt);
  
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
    const stored = getDb().query(
      `SELECT user_id FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > ?`
    ).get(tokenHash, Math.floor(Date.now() / 1000)) as { user_id: string } | undefined;
    
    if (!stored) return null;
    
    getDb().query(`DELETE FROM refresh_tokens WHERE token_hash = ?`).run(tokenHash);
    
    return generateTokens(stored.user_id);
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
  const user = getDb().query(
    `SELECT email, password_hash FROM users LIMIT 1`
  ).get() as { email: string | null; password_hash: string | null } | null;

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

  const user = getDb().query(
    `SELECT password_hash FROM users WHERE email = ? LIMIT 1`
  ).get(body.email.toLowerCase().trim()) as { password_hash: string | null } | null;

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

  getDb().query(
    `UPDATE users SET email = ?, password_hash = ?`
  ).run(email, passwordHash);

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

  const user = getDb().query(
    `SELECT password_hash FROM users LIMIT 1`
  ).get() as { password_hash: string | null } | null;

  if (!user?.password_hash) {
    return cors(Response.json({ error: "No hay contraseña configurada" }, { status: 400 }), req);
  }

  const valid = await Bun.password.verify(body.currentPassword, user.password_hash);
  if (!valid) {
    return cors(Response.json({ error: "Contraseña actual incorrecta" }, { status: 401 }), req);
  }

  const newHash = await Bun.password.hash(body.newPassword, { algorithm: "bcrypt", cost: 10 });
  getDb().query(`UPDATE users SET password_hash = ?`).run(newHash);

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
  getDb().query(`UPDATE users SET password_hash = ?`).run(newHash);

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
  getDb().query(`UPDATE users SET email = NULL, password_hash = NULL`).run();
  return cors(Response.json({ success: true }), req);
}
