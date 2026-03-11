import type { ServerWebSocket } from "bun";

export interface SessionId {
  userId: string;
}

export function parseSessionId(sessionId: string): SessionId | null {
  if (!sessionId || sessionId.trim() === "") {
    return null;
  }
  return { userId: sessionId };
}

export function formatSessionId(session: SessionId): string {
  return session.userId;
}

export interface Session {
  id: string;
  parsed: SessionId;
  createdAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  ws?: ServerWebSocket<unknown>;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  create(sessionId: string, ws?: ServerWebSocket<unknown>): Session {
    const parsed = parseSessionId(sessionId);
    if (!parsed) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActivityAt = new Date();
      if (ws) {
        existing.ws = ws;
      }
      return existing;
    }

    const session: Session = {
      id: sessionId,
      parsed,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      messageCount: 0,
    };
    if (ws !== undefined) {
      session.ws = ws;
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date();
      session.messageCount++;
    }
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  prune(maxAgeMs: number): number {
    const now = Date.now();
    let pruned = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt.getTime() > maxAgeMs) {
        this.sessions.delete(id);
        pruned++;
      }
    }

    return pruned;
  }
}

export const sessionManager = new SessionManager();
