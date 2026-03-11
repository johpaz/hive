export type BridgeProcessStatus = "running" | "stopped" | "error" | "completed" | "finished";

export interface BridgeProcess {
  id: string;
  name: string;
  command: string;
  status: BridgeProcessStatus;
  pid: number;
  startedAt: string;
  output: string[];
}

export interface BridgeLog {
  id: string;
  processId: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: string;
}

export interface CLIAdapter {
  id: string;
  name: string;
  version: string;
  connected: boolean;
  lastPing: string;
}
