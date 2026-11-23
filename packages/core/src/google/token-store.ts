/**
 * Dónde se guardan los tokens de Google. El SDK no decide: Hive los cifra en
 * HiveDB y hive-cloud los guarda en Postgres por workspace. Quien integre
 * implementa `GoogleTokenStore` y la registra con `configureGoogle()`.
 */
export interface GoogleTokenSet {
  accessToken: string;
  /** Google sólo lo entrega con access_type=offline + prompt=consent. */
  refreshToken: string | null;
  /** Epoch ms en que caduca el access token. */
  expiresAt: number;
  /** Scopes concedidos realmente (pueden ser menos que los pedidos). */
  scopes: string[];
  /** Cuenta de Google conectada. */
  email: string | null;
  /** Identificador estable de la cuenta (`sub` del id_token). El email puede cambiar; esto no. */
  sub?: string | null;
  emailVerified?: boolean;
}

export interface GoogleTokenStore {
  get(userId: string): Promise<GoogleTokenSet | null>;
  put(userId: string, tokens: GoogleTokenSet): Promise<void>;
  delete(userId: string): Promise<void>;
}

/** Sólo para tests y desarrollo: no persiste nada. */
export class MemoryGoogleTokenStore implements GoogleTokenStore {
  private readonly data = new Map<string, GoogleTokenSet>();
  async get(userId: string) { return this.data.get(userId) ?? null; }
  async put(userId: string, tokens: GoogleTokenSet) { this.data.set(userId, tokens); }
  async delete(userId: string) { this.data.delete(userId); }
}
