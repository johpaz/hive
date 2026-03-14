import { create } from "zustand";
import type { BridgeProcess, BridgeLog } from "@/types";

const CODE_BRIDGE_URL = "ws://localhost:18791/ws";
const API_URL = import.meta.env.VITE_API_URL || "";
const GATEWAY_WS_URL = API_URL
    ? API_URL.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
const GATEWAY_BRIDGE_URL = `${GATEWAY_WS_URL}/bridge-events`;

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function createLog(level: BridgeLog["level"], message: string, processId: string = "system"): BridgeLog {
  return {
    id: generateId(),
    processId,
    level,
    message,
    timestamp: new Date().toISOString(),
  };
}

interface BridgeState {
  processes: BridgeProcess[];
  logs: BridgeLog[];
  isConnected: boolean;
  socket: WebSocket | null;
  gatewaySocket: WebSocket | null;
  addProcess: (process: BridgeProcess) => void;
  removeProcess: (id: string) => void;
  updateProcess: (id: string, updates: Partial<BridgeProcess>) => void;
  addLog: (log: BridgeLog) => void;
  clearLogs: () => void;
  connect: () => void;
  disconnect: () => void;
  sendCommand: (cmd: { cmd: string; [key: string]: unknown }) => void;
  connectGateway: () => void;
}

export const useBridgeStore = create<BridgeState>((set, get) => ({
  processes: [],
  logs: [],
  isConnected: false,
  socket: null,
  gatewaySocket: null,

  addProcess: (process) => set((s) => ({ processes: [...s.processes, process] })),
  removeProcess: (id) => set((s) => ({ processes: s.processes.filter((p) => p.id !== id) })),
  updateProcess: (id, updates) =>
    set((s) => ({
      processes: s.processes.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  addLog: (log) => set((s) => ({ logs: [log, ...s.logs].slice(0, 500) })),
  clearLogs: () => set({ logs: [] }),

  sendCommand: (cmd) => {
    const { socket, isConnected } = get();
    if (socket && isConnected) {
      socket.send(JSON.stringify(cmd));
    }
  },

  // Connect to the Code Bridge service (port 18791)
  connect: () => {
    const { socket: existingSocket, isConnected } = get();
    if (existingSocket || isConnected) return;

    try {
      const ws = new WebSocket(CODE_BRIDGE_URL);

      ws.onopen = () => {
        set({ isConnected: true, socket: ws });
        get().addLog(createLog("info", "Connected to Code Bridge"));
        get().sendCommand({ cmd: "status" });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "code-bridge:status" && Array.isArray(data.agents)) {
            const processes: BridgeProcess[] = data.agents.map((agent: { taskId: string; role: string; cli: string; pid: number; state: string }) => ({
              id: agent.taskId,
              name: agent.role,
              command: agent.cli,
              status: agent.state as BridgeProcess["status"],
              pid: agent.pid,
              startedAt: new Date().toISOString(),
              output: [],
            }));
            set({ processes });
          }

          if (data.type === "agent:started") {
            const newProcess: BridgeProcess = {
              id: data.taskId,
              name: data.role,
              command: data.cli,
              status: "running",
              pid: data.pid,
              startedAt: new Date().toISOString(),
              output: [],
            };
            get().addProcess(newProcess);
            get().addLog(createLog("info", `Agent started: ${data.role} (PID: ${data.pid})`, data.taskId));
          }

          if (data.type === "agent:output") {
            const process = get().processes.find((p) => p.id === data.taskId);
            if (process) {
              get().updateProcess(data.taskId, { output: [...process.output, data.chunk] });
            }
          }

          if (data.type === "agent:finished") {
            get().updateProcess(data.taskId, { status: "completed" });
            get().addLog(createLog("info", `Agent finished: ${data.role}`, data.taskId));
          }

          if (data.type === "agent:error") {
            get().updateProcess(data.taskId, { status: "error" });
            get().addLog(createLog("error", data.message, data.taskId));
          }

          if (data.type === "agent:cancelled") {
            get().updateProcess(data.taskId, { status: "stopped" });
            get().addLog(createLog("warn", `Agent cancelled: ${data.role}`, data.taskId));
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onerror = () => {
        get().addLog(createLog("error", "Code Bridge WebSocket error"));
      };

      ws.onclose = () => {
        set({ isConnected: false, socket: null });
        get().addLog(createLog("info", "Disconnected from Code Bridge"));
        setTimeout(() => {
          if (!get().isConnected) get().connect();
        }, 5000);
      };

      set({ socket: ws });
    } catch {
      set({ isConnected: false, socket: null });
    }
  },

  // Connect to the gateway's /bridge-events endpoint to receive terminal events
  connectGateway: () => {
    const { gatewaySocket } = get();
    if (gatewaySocket) return;

    try {
      const ws = new WebSocket(GATEWAY_BRIDGE_URL);

      ws.onopen = () => {
        get().addLog(createLog("info", "Connected to gateway bridge events"));
      };

      ws.onmessage = (event) => {
        try {
          const evt = JSON.parse(event.data);

          if (evt.type === "bridge:cmd_start") {
            const d = evt.data as { processId: string; command: string; cwd?: string; name?: string };
            const newProcess: BridgeProcess = {
              id: d.processId,
              name: d.name ?? "terminal",
              command: d.command,
              status: "running",
              pid: 0,
              startedAt: new Date().toISOString(),
              output: [],
            };
            get().addProcess(newProcess);
            get().addLog(createLog("info", `$ ${d.command}${d.cwd ? ` (in ${d.cwd})` : ""}`, d.processId));
          }

          if (evt.type === "bridge:cmd_output") {
            const d = evt.data as { processId: string; chunk: string; stream: string };
            const process = get().processes.find((p) => p.id === d.processId);
            if (process) {
              get().updateProcess(d.processId, { output: [...process.output, d.chunk] });
            }
            get().addLog(createLog(d.stream === "stderr" ? "warn" : "info", d.chunk, d.processId));
          }

          if (evt.type === "bridge:cmd_done") {
            const d = evt.data as { processId: string; exitCode: number; success: boolean };
            get().updateProcess(d.processId, { status: d.success ? "completed" : "error" });
            get().addLog(createLog(d.success ? "info" : "error", `Exit code: ${d.exitCode}`, d.processId));
          }

          if (evt.type === "bridge:cmd_error") {
            const d = evt.data as { processId: string; message: string };
            get().updateProcess(d.processId, { status: "error" });
            get().addLog(createLog("error", d.message, d.processId));
          }
        } catch {
          // Ignore non-JSON
        }
      };

      ws.onerror = () => {
        // Gateway may not be available immediately
      };

      ws.onclose = () => {
        set({ gatewaySocket: null });
        // Reconnect after 5 seconds
        setTimeout(() => {
          if (!get().gatewaySocket) get().connectGateway();
        }, 5000);
      };

      set({ gatewaySocket: ws });
    } catch {
      set({ gatewaySocket: null });
    }
  },

  disconnect: () => {
    const { socket, gatewaySocket } = get();
    if (socket) {
      socket.close();
      set({ socket: null, isConnected: false });
    }
    if (gatewaySocket) {
      gatewaySocket.close();
      set({ gatewaySocket: null });
    }
  },
}));
