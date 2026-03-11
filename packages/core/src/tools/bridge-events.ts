/**
 * Bridge Events - WebSocket event subscription for CodeBridge
 * 
 * Manages WebSocket subscriptions for real-time CodeBridge events
 */

const bridgeSubscribers = new Set<{ send: (data: string) => void }>()

export function subscribeBridge(ws: { send: (data: string) => void }) {
  bridgeSubscribers.add(ws)
}

export function unsubscribeBridge(ws: { send: (data: string) => void }) {
  bridgeSubscribers.delete(ws)
}

export function emitBridgeEvent(event: { type: string; data: any }) {
  const payload = JSON.stringify(event)
  for (const ws of bridgeSubscribers) {
    try {
      ws.send(payload)
    } catch {
      bridgeSubscribers.delete(ws)
    }
  }
}
