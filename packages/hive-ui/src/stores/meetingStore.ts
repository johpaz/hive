import { create } from "zustand";
import { getApiBaseUrl, getWsBaseUrl } from "@/lib/gateway-url";

export interface MeetingSegment {
  seq: number;
  speaker: string | null;
  text: string;
  created_at?: number;
}

export interface MeetingSession {
  id: string;
  title: string;
  status: "active" | "stopped" | "report_ready";
  stt_model: string;
  started_at: number;
  stopped_at: number | null;
  report_path: string | null;
  segment_count?: number;
}

interface MeetingStore {
  sessions: MeetingSession[];
  activeSessionId: string | null;
  segments: MeetingSegment[];
  isRecording: boolean;
  isConnecting: boolean;
  error: string | null;
  wsConnection: WebSocket | null;

  // Actions
  startSession: (title: string, sttModel?: string) => Promise<string | null>;
  stopSession: () => Promise<void>;
  fetchSessions: () => Promise<void>;
  fetchSession: (id: string) => Promise<void>;
  addSegmentLocal: (segment: MeetingSegment) => void;
  setWsConnection: (ws: WebSocket | null) => void;
  setRecording: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
  setError: (e: string | null) => void;
  clearActiveSession: () => void;
  generateReport: (sessionId: string) => Promise<string | null>;
}

export const useMeetingStore = create<MeetingStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  segments: [],
  isRecording: false,
  isConnecting: false,
  error: null,
  wsConnection: null,

  startSession: async (title, sttModel = "whisper-large-v3-turbo") => {
    set({ error: null, isConnecting: true });
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, stt_model: sttModel }),
      });
      const data = await res.json() as { ok: boolean; session?: MeetingSession; error?: string };
      if (!data.ok || !data.session) {
        set({ error: data.error ?? "Error al crear sesión", isConnecting: false });
        return null;
      }
      set({
        activeSessionId: data.session.id,
        segments: [],
        sessions: [data.session, ...get().sessions],
        isConnecting: false,
      });
      return data.session.id;
    } catch (err) {
      set({ error: (err as Error).message, isConnecting: false });
      return null;
    }
  },

  stopSession: async () => {
    const { activeSessionId, wsConnection } = get();
    if (!activeSessionId) return;

    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({ type: "meeting_stop" }));
    } else {
      try {
        await fetch(`${getApiBaseUrl()}/api/meetings/${activeSessionId}/stop`, {
          method: "POST",
        });
      } catch { /* ignore */ }
    }

    wsConnection?.close();
    set({ isRecording: false, wsConnection: null });
  },

  fetchSessions: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/meetings`);
      const data = await res.json() as { ok: boolean; sessions?: MeetingSession[] };
      if (data.ok && data.sessions) set({ sessions: data.sessions });
    } catch { /* ignore */ }
  },

  fetchSession: async (id) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/meetings/${id}`);
      const data = await res.json() as { ok: boolean; session?: MeetingSession; segments?: MeetingSegment[] };
      if (data.ok && data.session) {
        set({
          activeSessionId: id,
          segments: data.segments ?? [],
        });
      }
    } catch { /* ignore */ }
  },

  addSegmentLocal: (segment) =>
    set((state) => ({ segments: [...state.segments, segment] })),

  setWsConnection: (ws) => set({ wsConnection: ws }),
  setRecording: (v) => set({ isRecording: v }),
  setConnecting: (v) => set({ isConnecting: v }),
  setError: (e) => set({ error: e }),
  clearActiveSession: () =>
    set({ activeSessionId: null, segments: [], isRecording: false, wsConnection: null }),

  generateReport: async (sessionId) => {
    set({ error: null });
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/meetings/${sessionId}/report`, {
        method: "POST",
      });
      const data = await res.json() as { ok: boolean; report_path?: string; error?: string };
      if (!data.ok || !data.report_path) {
        set({ error: data.error ?? "Error al generar el reporte" });
        return null;
      }
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: "report_ready" as const, report_path: data.report_path! } : s
        ),
      }));
      return data.report_path;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },
}));

export function buildMeetingWsUrl(meetingSessionId: string): string {
  const base = getWsBaseUrl();
  return `${base}/meeting-stream?meetingSessionId=${encodeURIComponent(meetingSessionId)}`;
}
