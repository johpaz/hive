export type BridgeProcessStatus = "starting" | "running" | "stopped" | "error";

export interface BridgeLog {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  source?: string;
}

export interface BridgeProcess {
  id: string;
  name: string;
  status: BridgeProcessStatus;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  logs?: BridgeLog[];
}

export interface CLIAdapter {
  id: string;
  name: string;
  type: "binary" | "bun-global" | "docker" | "development" | string;
  available: boolean;
  version?: string;
  path?: string;
}
