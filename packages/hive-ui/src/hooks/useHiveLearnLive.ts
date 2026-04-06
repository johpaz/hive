/**
 * useHiveLearnLive — WS hook that streams HiveLearn swarm events with heartbeat.
 *
 * Events received from /hivelearn-events:
 *   hl:connected     — initial handshake
 *   swarm_started    — a lesson generation began
 *   swarm_completed  — generation finished
 *   agent_started    — { agentId, agentName }
 *   agent_completed  — { agentId, agentName }
 *   agent_failed     — { agentId, agentName, error }
 *   ping             — server keepalive → reply with pong
 *   pong             — response to our ping
 */
import { useEffect, useRef, useState, useCallback } from 'react';

export type AgentLiveStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface HiveLearnLiveState {
  isConnected: boolean;
  isGenerating: boolean;
  agentStatuses: Record<string, AgentLiveStatus>;
  currentAgentId: string | null;
}

const PING_INTERVAL_MS  = 25_000;  // client ping every 25s
const BASE_RECONNECT_MS = 1_500;   // initial reconnect delay
const MAX_RECONNECT_MS  = 30_000;  // max reconnect delay

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Gateway runs on :18790 both in dev and prod
  const host = import.meta.env.DEV
    ? `${window.location.hostname}:18790`
    : window.location.host;
  return `${protocol}//${host}/hivelearn-events?sessionId=hl-ui`;
}

export function useHiveLearnLive(): HiveLearnLiveState {
  const [isConnected,    setIsConnected]    = useState(false);
  const [isGenerating,   setIsGenerating]   = useState(false);
  const [agentStatuses,  setAgentStatuses]  = useState<Record<string, AgentLiveStatus>>({});
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);

  const wsRef             = useRef<WebSocket | null>(null);
  const pingTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay    = useRef(BASE_RECONNECT_MS);
  const unmounted         = useRef(false);

  const clearTimers = useCallback(() => {
    if (pingTimerRef.current)      clearInterval(pingTimerRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    pingTimerRef.current      = null;
    reconnectTimerRef.current = null;
  }, []);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted.current) { ws.close(); return; }
        setIsConnected(true);
        reconnectDelay.current = BASE_RECONNECT_MS;

        // Client-side ping every 25s to keep connection alive through proxies
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (e) => {
        if (unmounted.current) return;
        try {
          const msg = JSON.parse(e.data as string) as { type: string; [k: string]: unknown };
          switch (msg.type) {
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
            case 'pong':
              break;
            case 'hl:connected':
              break;
            case 'swarm_started':
              setIsGenerating(true);
              setAgentStatuses({});
              setCurrentAgentId(null);
              break;
            case 'swarm_completed':
              setIsGenerating(false);
              setCurrentAgentId(null);
              break;
            case 'agent_started': {
              const id = msg.agentId as string;
              setCurrentAgentId(id);
              setAgentStatuses(prev => ({ ...prev, [id]: 'running' }));
              break;
            }
            case 'agent_completed': {
              const id = msg.agentId as string;
              setAgentStatuses(prev => ({ ...prev, [id]: 'completed' }));
              setCurrentAgentId(prev => (prev === id ? null : prev));
              break;
            }
            case 'agent_failed': {
              const id = msg.agentId as string;
              setAgentStatuses(prev => ({ ...prev, [id]: 'failed' }));
              setCurrentAgentId(prev => (prev === id ? null : prev));
              break;
            }
          }
        } catch { /* malformed JSON — ignore */ }
      };

      ws.onclose = () => {
        if (unmounted.current) return;
        setIsConnected(false);
        clearInterval(pingTimerRef.current!);
        pingTimerRef.current = null;

        // Exponential backoff reconnect
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_MS);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = () => {
        ws.close(); // triggers onclose → reconnect
      };
    } catch {
      // WebSocket constructor can throw if URL is invalid
      reconnectTimerRef.current = setTimeout(() => connect(), MAX_RECONNECT_MS);
    }
  }, [clearTimers]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      clearTimers();
      wsRef.current?.close();
    };
  }, [connect, clearTimers]);

  return { isConnected, isGenerating, agentStatuses, currentAgentId };
}
