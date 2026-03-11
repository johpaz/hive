import { logger } from "../utils/logger.ts";

export interface SessionState {
  id: string;
  agentId: string;
  channel: string;
  userId: string;
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
  status: "active" | "idle" | "closed";
}

export interface AgentState {
  id: string;
  name: string;
  status: "ready" | "busy" | "error";
  currentSessionId?: string;
  lastError?: string;
}

export interface ChannelState {
  name: string;
  accountId: string;
  status: "connected" | "disconnected" | "error";
  lastActivity?: number;
  error?: string;
}

export interface MetricsState {
  totalMessages: number;
  totalSessions: number;
  totalToolCalls: number;
  averageResponseTime: number;
  errors: number;
  startedAt: number;
}

export interface HiveState {
  sessions: Map<string, SessionState>;
  agents: Map<string, AgentState>;
  channels: Map<string, ChannelState>;
  metrics: MetricsState;
}

export interface StateSnapshot {
  id: string;
  timestamp: number;
  state: HiveState;
  reason?: string;
  action?: string;
  correlationId?: string;
}

interface StateStoreOptions {
  maxSnapshots?: number;
  enableSnapshots?: boolean;
}

const defaultMetrics: MetricsState = {
  totalMessages: 0,
  totalSessions: 0,
  totalToolCalls: 0,
  averageResponseTime: 0,
  errors: 0,
  startedAt: Date.now(),
};

export class StateStore {
  private state: HiveState;
  private snapshots: StateSnapshot[] = [];
  private readonly maxSnapshots: number;
  private readonly enableSnapshots: boolean;
  private listeners: Set<(state: Readonly<HiveState>) => void> = new Set();
  private correlationId?: string;

  constructor(options: StateStoreOptions = {}) {
    this.maxSnapshots = options.maxSnapshots ?? 100;
    this.enableSnapshots = options.enableSnapshots ?? true;
    this.state = this.createInitialState();
  }

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  clearCorrelationId(): void {
    this.correlationId = undefined;
  }

  private createInitialState(): HiveState {
    return {
      sessions: new Map(),
      agents: new Map(),
      channels: new Map(),
      metrics: { ...defaultMetrics },
    };
  }

  getState(): Readonly<HiveState> {
    return this.state;
  }

  update(updater: (draft: HiveState) => void, reason?: string): void {
    const newState = this.cloneState(this.state);
    updater(newState);

    if (this.enableSnapshots) {
      this.saveSnapshot(newState, reason);
    }

    this.state = newState;
    this.notifyListeners();
  }

  private cloneState(state: HiveState): HiveState {
    return {
      sessions: new Map(state.sessions),
      agents: new Map(state.agents),
      channels: new Map(state.channels),
      metrics: { ...state.metrics },
    };
  }

  private saveSnapshot(state: HiveState, reason?: string): void {
    const snapshot: StateSnapshot = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      state: this.cloneState(state),
      reason,
      action: reason,
      correlationId: this.correlationId,
    };

    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  getSnapshotAt(timestamp: number): StateSnapshot | undefined {
    return this.snapshots.find((s) => s.timestamp >= timestamp);
  }

  getSnapshotById(id: string): StateSnapshot | undefined {
    return this.snapshots.find((s) => s.id === id);
  }

  getAllSnapshots(): StateSnapshot[] {
    return [...this.snapshots];
  }

  getRecentSnapshots(count: number = 10): StateSnapshot[] {
    return this.snapshots.slice(-count);
  }

  subscribe(listener: (state: Readonly<HiveState>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        logger.error("[StateStore] Listener error:", { error: (error as Error).message });
      }
    }
  }

  createSession(session: Omit<SessionState, "createdAt" | "lastActivityAt" | "messageCount" | "status">): SessionState {
    const newSession: SessionState = {
      ...session,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      messageCount: 0,
      status: "active",
    };

    this.update((state) => {
      state.sessions.set(session.id, newSession);
      state.metrics.totalSessions++;
    }, `Session created: ${session.id}`);

    return newSession;
  }

  updateSession(sessionId: string, updates: Partial<SessionState>): void {
    this.update((state) => {
      const session = state.sessions.get(sessionId);
      if (session) {
        state.sessions.set(sessionId, { ...session, ...updates });
      }
    }, `Session updated: ${sessionId}`);
  }

  closeSession(sessionId: string): void {
    this.update((state) => {
      const session = state.sessions.get(sessionId);
      if (session) {
        state.sessions.set(sessionId, { ...session, status: "closed" });
      }
    }, `Session closed: ${sessionId}`);
  }

  incrementMessageCount(sessionId: string): void {
    this.update((state) => {
      const session = state.sessions.get(sessionId);
      if (session) {
        session.messageCount++;
        session.lastActivityAt = Date.now();
        state.sessions.set(sessionId, session);
        state.metrics.totalMessages++;
      }
    });
  }

  registerAgent(agent: Omit<AgentState, "status">): void {
    this.update((state) => {
      state.agents.set(agent.id, { ...agent, status: "ready" });
    }, `Agent registered: ${agent.id}`);
  }

  updateAgent(agentId: string, updates: Partial<AgentState>): void {
    this.update((state) => {
      const agent = state.agents.get(agentId);
      if (agent) {
        state.agents.set(agentId, { ...agent, ...updates });
      }
    }, `Agent updated: ${agentId}`);
  }

  updateChannel(channelName: string, accountId: string, updates: Partial<ChannelState>): void {
    this.update((state) => {
      const key = `${channelName}:${accountId}`;
      const channel = state.channels.get(key);
      if (channel) {
        state.channels.set(key, { ...channel, ...updates });
      } else {
        state.channels.set(key, {
          name: channelName,
          accountId,
          status: "disconnected",
          ...updates,
        });
      }
    }, `Channel updated: ${channelName}:${accountId}`);
  }

  recordToolCall(duration: number, success: boolean): void {
    this.update((state) => {
      state.metrics.totalToolCalls++;
      if (!success) {
        state.metrics.errors++;
      }
      const total = state.metrics.totalToolCalls;
      const prevAvg = state.metrics.averageResponseTime;
      state.metrics.averageResponseTime = prevAvg + (duration - prevAvg) / total;
    });
  }

  reset(): void {
    this.state = this.createInitialState();
    this.snapshots = [];
    this.saveSnapshot(this.state, "Store reset");
  }

  exportState(): string {
    const exportable = {
      sessions: Object.fromEntries(this.state.sessions),
      agents: Object.fromEntries(this.state.agents),
      channels: Object.fromEntries(this.state.channels),
      metrics: this.state.metrics,
    };
    return JSON.stringify(exportable, null, 2);
  }

  export(): string {
    return this.exportState();
  }

  getStats(): {
    sessionsCount: number;
    activeSessions: number;
    agentsCount: number;
    channelsCount: number;
    snapshotsCount: number;
    uptime: number;
  } {
    const activeSessions = Array.from(this.state.sessions.values()).filter(
      (s) => s.status === "active"
    ).length;

    return {
      sessionsCount: this.state.sessions.size,
      activeSessions,
      agentsCount: this.state.agents.size,
      channelsCount: this.state.channels.size,
      snapshotsCount: this.snapshots.length,
      uptime: Date.now() - this.state.metrics.startedAt,
    };
  }
}

export const stateStore = new StateStore();
