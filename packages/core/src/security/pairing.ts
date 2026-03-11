import crypto from "crypto";
import { eventBus } from "../events/event-bus.ts";
import { logger } from "../utils/logger.ts";

export interface PairingCode {
  code: string;
  channel: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

export interface PairingConfig {
  codeLength?: number;
  expirationMs?: number;
  maxAttempts?: number;
}

export interface PairingStats {
  pendingCodes: number;
  totalAllowlist: number;
  byChannel: Record<string, { pending: number; allowed: number }>;
}

export class PairingService {
  private codes: Map<string, PairingCode> = new Map();
  private allowlist: Map<string, Set<string>> = new Map();
  private config: Required<PairingConfig>;
  private log = logger.child("pairing");

  constructor(config: PairingConfig = {}) {
    this.config = {
      codeLength: config.codeLength ?? 8,
      expirationMs: config.expirationMs ?? 10 * 60 * 1000,
      maxAttempts: config.maxAttempts ?? 3,
    };

    this.startCleanup();
  }

  generateCode(channel: string, userId: string): string {
    this.cleanup();

    const code = this.generateSecureCode();
    const now = Date.now();

    const record: PairingCode = {
      code,
      channel,
      userId,
      createdAt: now,
      expiresAt: now + this.config.expirationMs,
      attempts: 0,
    };

    this.codes.set(code, record);

    this.log.info(`Generated pairing code for ${channel}:${userId}`);

    eventBus.emit("pairing:requested", {
      channel,
      userId,
      code,
      expiresAt: record.expiresAt,
    });

    return code;
  }

  validateCode(code: string): PairingCode | null {
    const record = this.codes.get(code);
    if (!record) return null;

    if (Date.now() > record.expiresAt) {
      this.codes.delete(code);
      eventBus.emit("pairing:expired", {
        code,
        channel: record.channel,
        userId: record.userId,
      });
      return null;
    }

    return record;
  }

  approve(code: string): { success: boolean; error?: string } {
    const record = this.validateCode(code);
    if (!record) {
      return { success: false, error: "Invalid or expired code" };
    }

    if (!this.allowlist.has(record.channel)) {
      this.allowlist.set(record.channel, new Set());
    }
    this.allowlist.get(record.channel)!.add(record.userId);

    this.codes.delete(code);

    this.log.info(`Approved pairing for ${record.channel}:${record.userId}`);

    eventBus.emit("pairing:approved", {
      channel: record.channel,
      userId: record.userId,
    });

    return { success: true };
  }

  reject(code: string, reason: string): boolean {
    const record = this.codes.get(code);
    if (!record) return false;

    this.codes.delete(code);

    this.log.info(`Rejected pairing for ${record.channel}:${record.userId}: ${reason}`);

    eventBus.emit("pairing:rejected", {
      channel: record.channel,
      userId: record.userId,
      reason,
    });

    return true;
  }

  attempt(code: string): boolean {
    const record = this.codes.get(code);
    if (!record) return false;

    record.attempts++;

    if (record.attempts >= this.config.maxAttempts) {
      this.codes.delete(code);
      this.log.warn(`Code ${code} exhausted attempts`);
      return false;
    }

    return true;
  }

  isAllowed(channel: string, userId: string): boolean {
    const channelAllowlist = this.allowlist.get(channel);
    return channelAllowlist?.has(userId) ?? false;
  }

  removeFromAllowlist(channel: string, userId: string): boolean {
    const channelAllowlist = this.allowlist.get(channel);
    if (!channelAllowlist) return false;

    const removed = channelAllowlist.delete(userId);

    if (channelAllowlist.size === 0) {
      this.allowlist.delete(channel);
    }

    if (removed) {
      this.log.info(`Removed ${userId} from allowlist for ${channel}`);
    }

    return removed;
  }

  listAllowed(channel?: string): { channel: string; userId: string }[] {
    const result: { channel: string; userId: string }[] = [];

    if (channel) {
      const channelAllowlist = this.allowlist.get(channel);
      if (channelAllowlist) {
        for (const userId of channelAllowlist) {
          result.push({ channel, userId });
        }
      }
    } else {
      for (const [ch, users] of this.allowlist) {
        for (const userId of users) {
          result.push({ channel: ch, userId });
        }
      }
    }

    return result;
  }

  listPending(): PairingCode[] {
    this.cleanup();
    return Array.from(this.codes.values());
  }

  getStats(): PairingStats {
    const byChannel: Record<string, { pending: number; allowed: number }> = {};

    for (const [channel, users] of this.allowlist) {
      byChannel[channel] = {
        pending: 0,
        allowed: users.size,
      };
    }

    for (const record of this.codes.values()) {
      if (!byChannel[record.channel]) {
        byChannel[record.channel] = { pending: 0, allowed: 0 };
      }
      byChannel[record.channel]!.pending++;
    }

    return {
      pendingCodes: this.codes.size,
      totalAllowlist: Array.from(this.allowlist.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      byChannel,
    };
  }

  clear(): void {
    this.codes.clear();
    this.allowlist.clear();
    this.log.info("All pairing data cleared");
  }

  private generateSecureCode(): string {
    const bytes = crypto.randomBytes(Math.ceil(this.config.codeLength / 2));
    return bytes.toString("hex").toUpperCase().slice(0, this.config.codeLength);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [code, record] of this.codes) {
      if (now > record.expiresAt) {
        this.codes.delete(code);
        eventBus.emit("pairing:expired", {
          code,
          channel: record.channel,
          userId: record.userId,
        });
      }
    }
  }

  private startCleanup(): void {
    setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }
}

export const pairingService = new PairingService();
