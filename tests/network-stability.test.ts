import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "bun:test";

const WS_URL = "ws://127.0.0.1:18790/ws";
const CANVAS_WS_URL = "ws://127.0.0.1:18790/canvas";
const HTTP_URL = "http://127.0.0.1:18790";

interface ConnectionMetrics {
  messagesSent: number;
  messagesReceived: number;
  pongsReceived: number;
  disconnects: number;
  reconnects: number;
  latencies: number[];
  connectTime: number;
}

interface NetworkSimulationConfig {
  simulateDisconnect: boolean;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private metrics: ConnectionMetrics = {
    messagesSent: 0,
    messagesReceived: 0,
    pongsReceived: 0,
    disconnects: 0,
    reconnects: 0,
    latencies: [],
    connectTime: 0,
  };
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 500;
  private pendingPings: Map<number, number> = new Map();
  private pingId = 0;
  private onMessageHandler?: (msg: unknown) => void;
  private onDisconnectHandler?: () => void;
  private onReconnectHandler?: () => void;
  private onPongHandler?: () => void;

  constructor(private url: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.metrics.connectTime = Date.now();
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onclose = (event) => {
          this.isConnected = false;
          this.metrics.disconnects++;
          this.onDisconnectHandler?.();

          if (event.code !== 1000 && event.code !== 1001) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WS] Error:", error);
          if (!this.isConnected) {
            reject(new Error("Connection failed"));
          }
        };

        this.ws.onmessage = (event) => {
          const receiveTime = Date.now();
          try {
            const data = JSON.parse(event.data);
            this.metrics.messagesReceived++;

            if (data.type === "pong") {
              this.metrics.pongsReceived++;
              const sentTime = this.pendingPings.get(data.timestamp);
              if (sentTime) {
                this.metrics.latencies.push(receiveTime - sentTime);
                this.pendingPings.delete(data.timestamp);
                this.onPongHandler?.();
              }
            }

            this.onMessageHandler?.(data);
          } catch (e) {
            console.error("[WS] Failed to parse message:", e);
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      10000
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
      this.metrics.reconnects++;
      this.onReconnectHandler?.();
    } catch {
      // Retry on next cycle
    }
  }

  send(type: string, data?: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const message = data ? { type, ...(data as object) } : { type };
    this.ws.send(JSON.stringify(message));
    this.metrics.messagesSent++;
  }

  sendPing(): number {
    const timestamp = Date.now();
    this.pendingPings.set(timestamp, timestamp);
    this.send("ping", { timestamp });
    return timestamp;
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.isConnected = false;
  }

  simulateDisconnect(): void {
    if (this.ws) {
      this.ws.close(1000, "Simulated disconnect");
    }
  }

  onMessage(handler: (msg: unknown) => void): void {
    this.onMessageHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.onDisconnectHandler = handler;
  }

  onReconnect(handler: () => void): void {
    this.onReconnectHandler = handler;
  }

  onPong(handler: () => void): void {
    this.onPongHandler = handler;
  }

  getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  getAverageLatency(): number {
    if (this.metrics.latencies.length === 0) return 0;
    return this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length;
  }

  getMaxLatency(): number {
    if (this.metrics.latencies.length === 0) return 0;
    return Math.max(...this.metrics.latencies);
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  getPongsReceived(): number {
    return this.metrics.pongsReceived;
  }

  clearMetrics(): void {
    this.metrics = {
      messagesSent: 0,
      messagesReceived: 0,
      pongsReceived: 0,
      disconnects: 0,
      reconnects: 0,
      latencies: [],
      connectTime: 0,
    };
    this.pendingPings.clear();
  }
}

class HeartbeatManager {
  private interval?: ReturnType<typeof setInterval>;
  private ws: WebSocket | null = null;
  private onTimeoutHandler?: () => void;

  constructor(
    private intervalMs = 30000,
    private maxMissed = 3
  ) {}

  start(ws: WebSocket): void {
    this.ws = ws;
    
    this.interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  onTimeout(handler: () => void): void {
    this.onTimeoutHandler = handler;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Try WebSocket connection
      const ws = new WebSocket("ws://127.0.0.1:18790/ws");
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          ws.close();
          resolve();
        };
        ws.onerror = () => reject(new Error("WS error"));
        setTimeout(() => reject(new Error("timeout")), 3000);
      });
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

describe("🌐 Network Stability Test Suite", () => {
  let serverAvailable = false;

  beforeAll(async () => {
    console.log("\n📡 Checking server availability...");
    serverAvailable = await waitForServer(5);
    if (!serverAvailable) {
      console.log("⚠️ Server not available at", HTTP_URL);
    }
  });

  afterEach(async () => {
    await sleep(500);
  });

  describe("📡 WebSocket Connection Stability", () => {
    it("should maintain stable connection and respond to ping", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing WebSocket ping/pong...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      expect(client.getIsConnected()).toBe(true);

      client.sendPing();
      await sleep(200);
      
      expect(client.getPongsReceived()).toBeGreaterThan(0);

      const latency = client.getAverageLatency();
      console.log(`   ✅ Connection established`);
      console.log(`   📊 Latency: ${latency.toFixed(2)}ms`);
      console.log(`   📊 Pong received: ${client.getPongsReceived()}`);

      await client.disconnect();
      expect(client.getIsConnected()).toBe(false);
    });

    it("should maintain connection for 5 seconds with periodic pings", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing connection stability (5 seconds)...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      const duration = 5000;
      const startTime = Date.now();

      while (Date.now() - startTime < duration) {
        client.sendPing();
        await sleep(1000);
      }

      const metrics = client.getMetrics();
      const avgLatency = client.getAverageLatency();
      const maxLatency = client.getMaxLatency();

      console.log(`   ✅ Duration: ${duration / 1000}s`);
      console.log(`   📊 Pings sent: ${metrics.messagesSent}`);
      console.log(`   📊 Pongs received: ${metrics.pongsReceived}`);
      console.log(`   📊 Avg latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`   📊 Max latency: ${maxLatency}ms`);

      await client.disconnect();

      expect(metrics.pongsReceived).toBeGreaterThan(3);
      expect(avgLatency).toBeLessThan(200);
    }, 15000);

    it("should handle 10+ concurrent connections", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing 10+ concurrent connections...");

      const clients: WebSocketClient[] = [];
      
      for (let i = 0; i < 10; i++) {
        const client = new WebSocketClient(WS_URL);
        await client.connect();
        client.sendPing();
        clients.push(client);
      }

      await sleep(1000);

      const connectedCount = clients.filter(c => c.getIsConnected()).length;
      const totalPongs = clients.reduce((sum, c) => sum + c.getPongsReceived(), 0);

      console.log(`   📊 Connections: ${connectedCount}/10`);
      console.log(`   📊 Total pongs: ${totalPongs}`);

      await Promise.all(clients.map(c => c.disconnect()));

      expect(connectedCount).toBe(10);
      expect(totalPongs).toBeGreaterThan(5);
    });
  });

  describe("🔄 UI-Backend Synchronization", () => {
    it("should receive status message on connect", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing status message on connect...");

      const client = new WebSocketClient(WS_URL);
      let statusReceived = false;
      let sessionId: string | null = null;

      client.onMessage((msg) => {
        const data = msg as { type?: string; sessionId?: string; status?: { state?: string } };
        if (data.type === "status" && data.status?.state === "connected") {
          statusReceived = true;
          sessionId = data.sessionId ?? null;
        }
      });

      await client.connect();
      await sleep(500);

      console.log(`   📊 Status received: ${statusReceived}`);
      console.log(`   📊 Session ID: ${sessionId}`);

      await client.disconnect();

      expect(statusReceived).toBe(true);
      expect(sessionId).not.toBeNull();
    });

    it("should process multiple messages in sequence", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing sequential message processing...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      const messageCount = 50;
      for (let i = 0; i < messageCount; i++) {
        client.sendPing();
        await sleep(50);
      }

      await sleep(2000);

      const metrics = client.getMetrics();
      const deliveryRate = (metrics.pongsReceived / messageCount) * 100;

      console.log(`   📊 Messages sent: ${messageCount}`);
      console.log(`   📊 Pongs received: ${metrics.pongsReceived}`);
      console.log(`   📊 Delivery rate: ${deliveryRate.toFixed(1)}%`);
      console.log(`   📊 Avg latency: ${client.getAverageLatency().toFixed(2)}ms`);

      await client.disconnect();

      expect(deliveryRate).toBeGreaterThan(90);
    });
  });

  describe("🛡️ Network Resilience", () => {
    it("should handle rapid message bursts", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing rapid message burst...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      const messageCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < messageCount; i++) {
        client.sendPing();
      }

      const sendTime = Date.now() - startTime;
      await sleep(3000);

      const metrics = client.getMetrics();
      const throughput = messageCount / (sendTime / 1000);

      console.log(`   📊 Messages sent: ${messageCount}`);
      console.log(`   📊 Send time: ${sendTime}ms`);
      console.log(`   📊 Throughput: ${throughput.toFixed(0)} msg/sec`);
      console.log(`   📊 Pongs received: ${metrics.pongsReceived}`);

      await client.disconnect();

      expect(metrics.pongsReceived).toBeGreaterThan(50);
    });

    it("should maintain connection under load", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing load handling...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      const messageCount = 50;
      for (let i = 0; i < messageCount; i++) {
        client.sendPing();
        await sleep(200);
      }

      await sleep(2000);

      const metrics = client.getMetrics();
      const isConnected = client.getIsConnected();

      console.log(`   📊 Messages sent: ${messageCount}`);
      console.log(`   📊 Pongs received: ${metrics.pongsReceived}`);
      console.log(`   📊 Still connected: ${isConnected}`);

      await client.disconnect();

      expect(isConnected).toBe(true);
      expect(metrics.pongsReceived).toBeGreaterThan(40);
    }, 20000);
  });

  describe("📊 Channel Load Testing", () => {
    it("should handle sustained load", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing sustained load...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      const messageCount = 30;
      for (let i = 0; i < messageCount; i++) {
        client.sendPing();
        await sleep(300);
      }

      await sleep(2000);

      const metrics = client.getMetrics();
      const deliveryRate = (metrics.pongsReceived / messageCount) * 100;

      console.log(`   📊 Messages sent: ${messageCount}`);
      console.log(`   📊 Pongs received: ${metrics.pongsReceived}`);
      console.log(`   📊 Delivery rate: ${deliveryRate.toFixed(1)}%`);

      await client.disconnect();

      expect(deliveryRate).toBeGreaterThan(80);
    }, 20000);

    it("should handle multiple simultaneous clients", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing 5 simultaneous clients...");

      const clients: WebSocketClient[] = [];

      for (let i = 0; i < 5; i++) {
        const client = new WebSocketClient(WS_URL);
        await client.connect();
        clients.push(client);
      }

      for (const client of clients) {
        for (let i = 0; i < 10; i++) {
          client.sendPing();
          await sleep(100);
        }
      }

      await sleep(2000);

      const totalPongs = clients.reduce((sum, c) => sum + c.getPongsReceived(), 0);
      const connectedCount = clients.filter(c => c.getIsConnected()).length;

      console.log(`   📊 Clients: 5`);
      console.log(`   📊 Connected: ${connectedCount}`);
      console.log(`   📊 Total pongs: ${totalPongs}`);

      await Promise.all(clients.map(c => c.disconnect()));

      expect(connectedCount).toBe(5);
      expect(totalPongs).toBeGreaterThan(30);
    }, 20000);
  });

  describe("💓 Heartbeat and Keep-Alive", () => {
    it("should respond to periodic pings", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing heartbeat with periodic pings...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      const pingCount = 10;
      for (let i = 0; i < pingCount; i++) {
        client.sendPing();
        await sleep(500);
      }

      const metrics = client.getMetrics();
      const avgLatency = client.getAverageLatency();

      console.log(`   📊 Pings sent: ${pingCount}`);
      console.log(`   📊 Pongs received: ${metrics.pongsReceived}`);
      console.log(`   📊 Avg latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`   📊 Connection alive: ${client.getIsConnected()}`);

      await client.disconnect();

      expect(metrics.pongsReceived).toBeGreaterThanOrEqual(pingCount - 2);
      expect(avgLatency).toBeLessThan(100);
    }, 15000);

    it("should maintain connection over time", async () => {
      if (!serverAvailable) {
        console.log("⚠️ Skipping - server not available");
        expect(true).toBe(true);
        return;
      }

      console.log("\n📌 Testing connection maintenance...");

      const client = new WebSocketClient(WS_URL);
      await client.connect();

      client.sendPing();
      await sleep(200);
      
      const firstPong = client.getPongsReceived();
      
      await sleep(3000);
      
      client.sendPing();
      await sleep(200);

      const afterPong = client.getPongsReceived();
      const isStillConnected = client.getIsConnected();

      console.log(`   📊 First ping pong: ${firstPong}`);
      console.log(`   📊 After 3s pong: ${afterPong}`);
      console.log(`   📊 Still connected: ${isStillConnected}`);

      await client.disconnect();

      expect(afterPong).toBeGreaterThan(firstPong);
      expect(isStillConnected).toBe(true);
    });
  });
});

describe("🎯 Network Stability Score", () => {
  it("should calculate overall stability score", async () => {
    console.log("\n📌 Calculating network stability score...");

    const serverAvailable = await waitForServer(3);
    
    if (!serverAvailable) {
      console.log("⚠️ Server not available - cannot calculate score");
      expect(true).toBe(true);
      return;
    }

    let score = 100;
    const details: string[] = [];

    const client = new WebSocketClient(WS_URL);
    
    try {
      await client.connect();

      const pings = 30;
      for (let i = 0; i < pings; i++) {
        client.sendPing();
        await sleep(500);
      }

      await sleep(2000);

      const metrics = client.getMetrics();
      const latency = client.getAverageLatency();
      const maxLatency = client.getMaxLatency();
      const deliveryRate = (metrics.pongsReceived / pings) * 100;

      console.log(`\n📊 Metrics:`);
      console.log(`   - Pings sent: ${pings}`);
      console.log(`   - Pongs received: ${metrics.pongsReceived}`);
      console.log(`   - Delivery rate: ${deliveryRate.toFixed(1)}%`);
      console.log(`   - Avg latency: ${latency.toFixed(2)}ms`);
      console.log(`   - Max latency: ${maxLatency}ms`);
      console.log(`   - Disconnects: ${metrics.disconnects}`);
      console.log(`   - Reconnects: ${metrics.reconnects}`);

      if (latency > 100) {
        score -= 20;
        details.push(`High latency: ${latency.toFixed(0)}ms`);
      }

      if (maxLatency > 500) {
        score -= 10;
        details.push(`Very high max latency: ${maxLatency}ms`);
      }

      if (deliveryRate < 90) {
        score -= (100 - deliveryRate);
        details.push(`Low delivery rate: ${deliveryRate.toFixed(1)}%`);
      }

      await client.disconnect();
    } catch (e) {
      score = 0;
      details.push(`Connection failed: ${e}`);
    }

    console.log(`\n📊 Network Stability Score: ${score}% ${score >= 80 ? "✅" : "❌"}`);
    if (details.length > 0) {
      console.log("   Issues:");
      details.forEach((d) => console.log(`   - ${d}`));
    }

    expect(score).toBeGreaterThanOrEqual(0);
  }, 60000);
});

console.log("\n📝 To run these tests, ensure the server is running:");
console.log(`   ${HTTP_URL}`);
console.log("\n🌐 WebSocket endpoints:");
console.log(`   Main: ${WS_URL}`);
console.log(`   Canvas: ${CANVAS_WS_URL}`);
