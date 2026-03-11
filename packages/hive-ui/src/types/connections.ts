import type { ConnectedChannel, ChannelStats } from "./channels";
import type { Provider, FailoverConfig } from "./providers";

export interface ConnectionsOverview {
  channels: ConnectedChannel[];
  providers: Provider[];
  failoverConfig: FailoverConfig;
  totalActiveChannels: number;
  totalActiveProviders: number;
  systemHealth: "healthy" | "degraded" | "critical";
}

export interface ConnectionsSummary {
  channelsByType: Record<string, number>;
  providersByStatus: Record<string, number>;
  aggregateStats: ChannelStats;
}
