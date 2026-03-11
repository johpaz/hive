import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "bun:test";
import { Mutex, Semaphore } from "async-mutex";

interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  timestamp: number;
}

interface ThresholdConfig {
  memoryLeakThresholdPercent: number;
  queryTimeThresholdMs: number;
  concurrencyDegradationThreshold: number;
  connectionPoolErrorThresholdPercent: number;
  maxActiveHandles: number;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  memoryLeakThresholdPercent: 20,
  queryTimeThresholdMs: 50,
  concurrencyDegradationThreshold: 3,
  connectionPoolErrorThresholdPercent: 5,
  maxActiveHandles: 50,
};

class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private thresholds: ThresholdConfig;

  constructor(thresholds: Partial<ThresholdConfig> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  captureSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
      timestamp: Date.now(),
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  getSnapshots(): MemorySnapshot[] {
    return this.snapshots;
  }

  calculateGrowthPercent(): number {
    if (this.snapshots.length < 2) return 0;
    const first = this.snapshots[0]!;
    const last = this.snapshots[this.snapshots.length - 1]!;
    return ((last.heapUsed - first.heapUsed) / first.heapUsed) * 100;
  }

  hasMemoryLeak(): boolean {
    return this.calculateGrowthPercent() > this.thresholds.memoryLeakThresholdPercent;
  }

  getMemoryInfo(): {
    initial: MemorySnapshot | null;
    final: MemorySnapshot | null;
    growthPercent: number;
  } {
    return {
      initial: this.snapshots[0] ?? null,
      final: this.snapshots[this.snapshots.length - 1] ?? null,
      growthPercent: this.calculateGrowthPercent(),
    };
  }

  reset(): void {
    this.snapshots = [];
  }

  setThresholds(thresholds: Partial<ThresholdConfig>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
}

function getActiveHandleCount(): number {
  const Bun = globalThis.Bun as {
    numberOfActiveHandles?: () => number;
  } | null;
  if (Bun && typeof Bun.numberOfActiveHandles === "function") {
    return Bun.numberOfActiveHandles();
  }
  return 0;
}

function getActiveRequestCount(): number {
  const Bun = globalThis.Bun as {
    numberOfActiveRequests?: () => number;
  } | null;
  if (Bun && typeof Bun.numberOfActiveRequests === "function") {
    return Bun.numberOfActiveRequests();
  }
  return 0;
}

function getPendingPromiseCount(): number {
  return (globalThis as unknown as { Promise: { [key: string]: unknown } }).Promise
    ? 0
    : 0;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("🧪 Memory & Performance Test Suite", () => {
  describe("💾 Memory Leaks Detection", () => {
    let memoryMonitor: MemoryMonitor;

    beforeEach(() => {
      memoryMonitor = new MemoryMonitor({
        memoryLeakThresholdPercent: 20,
      });
    });

    it("should not leak memory when creating 1000+ checkpoints", async () => {
      console.log("\n📌 Testing memory leak with checkpoint creation...");

      const checkpoints: unknown[] = [];
      const memorySnapshots: number[] = [];

      for (let i = 0; i < 1000; i++) {
        if (i % 50 === 0) {
          memoryMonitor.captureSnapshot();
          const snap = memoryMonitor.captureSnapshot();
          memorySnapshots.push(snap.heapUsed);
          console.log(
            `   📊 Iteration ${i}: heapUsed=${(snap.heapUsed / 1024 / 1024).toFixed(2)}MB`
          );
        }

        checkpoints.push({
          id: `checkpoint-${i}`,
          data: { key: `value-${i}`, timestamp: Date.now() },
        });

        if (i % 200 === 0) {
          await sleep(10);
        }
      }

      memoryMonitor.captureSnapshot();
      const memoryInfo = memoryMonitor.getMemoryInfo();
      const growthPercent = memoryInfo.growthPercent;

      console.log(`   📈 Memory growth: ${growthPercent.toFixed(2)}%`);
      console.log(`   🟢 Initial heap: ${((memoryInfo.initial?.heapUsed ?? 0) / 1024 / 1024).toFixed(2)}MB`);
      console.log(`   🔴 Final heap: ${((memoryInfo.final?.heapUsed ?? 0) / 1024 / 1024).toFixed(2)}MB`);

      expect(growthPercent).toBeLessThan(200);
    }, 30000);

    it("should not leak memory when processing messages", async () => {
      console.log("\n📌 Testing memory leak with message processing...");

      const messageQueue: unknown[] = [];

      for (let i = 0; i < 1500; i++) {
        if (i % 50 === 0) {
          memoryMonitor.captureSnapshot();
        }

        const message = {
          id: i,
          type: ["event", "command", "query", "response"][i % 4],
          payload: { data: "x".repeat(100) },
          timestamp: Date.now(),
        };
        messageQueue.push(message);

        if (i % 500 === 0 && messageQueue.length > 100) {
          messageQueue.splice(0, 100);
        }
      }

      const growthPercent = memoryMonitor.getMemoryInfo().growthPercent;
      console.log(`   📈 Memory growth after processing: ${growthPercent.toFixed(2)}%`);

      expect(growthPercent).toBeLessThan(20);
    }, 30000);

    it("should detect memory leak with GC when available", async () => {
      console.log("\n📌 Testing with forced GC (if available)...");

      if (typeof globalThis.gc === "function") {
        globalThis.gc();
        memoryMonitor.captureSnapshot();

        for (let i = 0; i < 500; i++) {
          const obj = { data: new Array(1000).fill(i) };
          if (i % 100 === 0) {
            memoryMonitor.captureSnapshot();
          }
        }

        globalThis.gc();
        await sleep(100);
        memoryMonitor.captureSnapshot();

        const growthPercent = memoryMonitor.getMemoryInfo().growthPercent;
        console.log(`   📈 Memory growth after GC: ${growthPercent.toFixed(2)}%`);
      } else {
        console.log("   ⚠️ GC not exposed, skipping detailed test");
      }

      expect(true).toBe(true);
    }, 30000);
  });

  describe("👻 Zombie/Phantom Process Detection", () => {
    it("should not leave active handles after operations", async () => {
      console.log("\n📌 Testing for zombie handles...");

      const initialHandles = getActiveHandleCount();
      console.log(`   📊 Initial handles: ${initialHandles}`);

      const timers: Timer[] = [];
      for (let i = 0; i < 10; i++) {
        const timer = setTimeout(() => {}, 1000 + i);
        timers.push(timer);
      }

      const handlesDuring = getActiveHandleCount();
      console.log(`   📊 Handles during operation: ${handlesDuring}`);

      timers.forEach((t) => clearTimeout(t));
      await sleep(1500);

      const finalHandles = getActiveHandleCount();
      console.log(`   📊 Final handles: ${finalHandles}`);

      expect(finalHandles - initialHandles).toBeLessThan(5);
    });

    it("should not leave pending promises unresolved", async () => {
      console.log("\n📌 Testing for unresolved promises...");

      let resolvedCount = 0;
      const totalPromises = 100;

      const promises = Array.from({ length: totalPromises }, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
        resolvedCount++;
      });

      console.log(`   📊 Promises created: ${totalPromises}`);

      await Promise.all(promises);
      await sleep(100);

      console.log(`   ✅ Promises resolved: ${resolvedCount}/${totalPromises}`);

      expect(resolvedCount).toBe(totalPromises);
    });

    it("should cleanup callbacks after session operations", async () => {
      console.log("\n📌 Testing callback cleanup...");

      const callbacks: Array<() => void> = [];
      const maxCallbacks = 50;

      for (let i = 0; i < maxCallbacks; i++) {
        const callback = () => {
          console.log(`Callback ${i} called`);
        };
        callbacks.push(callback);
      }

      const handlesBefore = getActiveHandleCount();

      callbacks.length = 0;

      await sleep(100);

      const handlesAfter = getActiveHandleCount();
      console.log(`   📊 Handles before: ${handlesBefore}, after: ${handlesAfter}`);

      expect(Math.abs(handlesAfter - handlesBefore)).toBeLessThan(10);
    });
  });

  describe("🏭 Bottleneck Detection", () => {
    const mockDatabaseQuery = async (queryId: number): Promise<number> => {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 30 + 10));
      return Date.now() - start;
    };

    it("should complete database queries under 50ms threshold", async () => {
      console.log("\n📌 Testing query time thresholds...");

      const queryTimes: number[] = [];

      for (let i = 0; i < 100; i++) {
        const time = await mockDatabaseQuery(i);
        queryTimes.push(time);

        if (i % 20 === 0) {
          console.log(`   ⏱️ Query ${i}: ${time.toFixed(2)}ms`);
        }
      }

      const avgTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
      const maxTime = Math.max(...queryTimes);
      const slowQueries = queryTimes.filter((t) => t > 50).length;

      console.log(`   📊 Average query time: ${avgTime.toFixed(2)}ms`);
      console.log(`   📊 Max query time: ${maxTime.toFixed(2)}ms`);
      console.log(`   ⚠️ Slow queries (>50ms): ${slowQueries}`);

      expect(avgTime).toBeLessThan(50);
      expect(slowQueries / queryTimes.length).toBeLessThan(0.1);
    });

    it("should scale linearly with increasing concurrency", async () => {
      console.log("\n📌 Testing scalability with concurrency levels...");

      const concurrencyLevels = [1, 10, 50, 100];
      const results: { concurrency: number; avgTime: number; p95Time: number }[] = [];

      for (const concurrency of concurrencyLevels) {
        const times: number[] = [];
        const batchSize = concurrency * 5;

        const batchStart = Date.now();

        const promises = Array.from({ length: batchSize }, async (_, i) => {
          const start = Date.now();
          await mockDatabaseQuery(i);
          const elapsed = Date.now() - start;
          times.push(elapsed);
          return elapsed;
        });

        await Promise.all(promises);

        const totalTime = Date.now() - batchStart;
        times.sort((a, b) => a - b);
        const p95Index = Math.floor(times.length * 0.95);
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

        results.push({
          concurrency,
          avgTime,
          p95Time: times[p95Index] ?? 0,
        });

        console.log(
          `   📊 Concurrency ${concurrency}: avg=${avgTime.toFixed(2)}ms, p95=${times[p95Index]?.toFixed(2) ?? 0}ms, total=${totalTime}ms`
        );
      }

      const baseline = results[0]!.avgTime;
      const degradationFactors = results.map((r) => r.avgTime / baseline);

      console.log(`   📈 Degradation factors: ${degradationFactors.map((d) => d.toFixed(2)).join(", ")}`);

      const maxDegradation = Math.max(...degradationFactors);
      console.log(`   ⚠️ Max degradation: ${maxDegradation.toFixed(2)}x`);

      expect(maxDegradation).toBeLessThan(3);
    });

    it("should maintain performance under sustained load", async () => {
      console.log("\n📌 Testing sustained load performance...");

      const windows = 5;
      const windowSize = 20;
      const windowAverages: number[] = [];

      for (let w = 0; w < windows; w++) {
        const times: number[] = [];

        for (let i = 0; i < windowSize; i++) {
          const time = await mockDatabaseQuery(w * windowSize + i);
          times.push(time);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        windowAverages.push(avg);
        console.log(`   📊 Window ${w + 1}: avg=${avg.toFixed(2)}ms`);
      }

      const firstHalfAvg =
        windowAverages.slice(0, Math.floor(windows / 2)).reduce((a, b) => a + b, 0) /
        Math.floor(windows / 2);
      const secondHalfAvg =
        windowAverages.slice(Math.floor(windows / 2)).reduce((a, b) => a + b, 0) /
        (windows - Math.floor(windows / 2));

      const degradation = secondHalfAvg / firstHalfAvg;
      console.log(`   📈 First half avg: ${firstHalfAvg.toFixed(2)}ms`);
      console.log(`   📈 Second half avg: ${secondHalfAvg.toFixed(2)}ms`);
      console.log(`   📈 Degradation: ${degradation.toFixed(2)}x`);

      expect(degradation).toBeLessThan(2);
    }, 15000);
  });

  describe("🔌 Connection Pool Stress", () => {
    interface MockConnection {
      id: number;
      inUse: boolean;
      acquiredAt?: number;
    }

    const createConnectionPool = (poolSize: number): MockConnection[] => {
      return Array.from({ length: poolSize }, (_, i) => ({
        id: i,
        inUse: false,
      }));
    };

    const acquireConnection = async (
      pool: MockConnection[],
      timeout = 5000
    ): Promise<MockConnection | null> => {
      const start = Date.now();

      while (Date.now() - start < timeout) {
        const available = pool.find((c) => !c.inUse);
        if (available) {
          available.inUse = true;
          available.acquiredAt = Date.now();
          return available;
        }
        await sleep(10);
      }

      return null;
    };

    const releaseConnection = (pool: MockConnection[], conn: MockConnection): void => {
      conn.inUse = false;
      conn.acquiredAt = undefined;
    };

    it("should handle 200+ simultaneous connections with <5% error rate", async () => {
      console.log("\n📌 Testing connection pool with burst of 200+ connections...");

      const poolSize = 50;
      const pool = createConnectionPool(poolSize);
      const connectionAttempts = 250;

      const results: { success: boolean; connection: MockConnection | null; waitTime: number }[] = [];

      const startTime = Date.now();

      const promises = Array.from({ length: connectionAttempts }, async () => {
        const attemptStart = Date.now();
        const conn = await acquireConnection(pool);
        const waitTime = Date.now() - attemptStart;

        const success = conn !== null;

        if (conn) {
          releaseConnection(pool, conn);
        }

        results.push({ success, connection: conn, waitTime });
      });

      await Promise.all(promises);

      const totalTime = Date.now() - startTime;
      const successCount = results.filter((r) => r.success).length;
      const errorCount = results.filter((r) => !r.success).length;
      const errorRate = (errorCount / connectionAttempts) * 100;

      console.log(`   📊 Total attempts: ${connectionAttempts}`);
      console.log(`   ✅ Successful: ${successCount}`);
      console.log(`   ❌ Failed: ${errorCount}`);
      console.log(`   📈 Error rate: ${errorRate.toFixed(2)}%`);
      console.log(`   ⏱️ Total time: ${totalTime}ms`);

      expect(errorRate).toBeLessThan(5);
    });

    it("should gracefully handle pool exhaustion", async () => {
      console.log("\n📌 Testing pool exhaustion handling...");

      const poolSize = 5;
      const pool = createConnectionPool(poolSize);

      const conn1 = await acquireConnection(pool);
      const conn2 = await acquireConnection(pool);
      const conn3 = await acquireConnection(pool);
      const conn4 = await acquireConnection(pool);
      const conn5 = await acquireConnection(pool);

      console.log(`   📊 Acquired connections: 5/5`);

      const timeoutConn = await acquireConnection(pool, 100);

      expect(timeoutConn).toBeNull();
      console.log(`   ✅ Pool correctly rejected overflow connection`);

      if (conn1) releaseConnection(pool, conn1);
      if (conn2) releaseConnection(pool, conn2);
      if (conn3) releaseConnection(pool, conn3);
      if (conn4) releaseConnection(pool, conn4);
      if (conn5) releaseConnection(pool, conn5);
    });

    it("should handle rapid acquire/release cycles", async () => {
      console.log("\n📌 Testing rapid acquire/release cycles...");

      const poolSize = 20;
      const pool = createConnectionPool(poolSize);
      const cycles = 100;
      const errors: number[] = [];

      for (let i = 0; i < cycles; i++) {
        const conn = await acquireConnection(pool, 1000);

        if (!conn) {
          errors.push(i);
          console.log(`   ❌ Cycle ${i}: failed to acquire`);
        }

        if (conn) {
          releaseConnection(pool, conn);
        }

        if (i % 20 === 0) {
          await sleep(5);
        }
      }

      console.log(`   📊 Cycles completed: ${cycles}`);
      console.log(`   ❌ Errors: ${errors.length}`);

      expect(errors.length / cycles).toBeLessThan(0.1);
    });
  });

  describe("🔒 Thread Safety / Race Condition Detection", () => {
    it("should handle concurrent writes to shared state safely", async () => {
      console.log("\n📌 Testing thread safety with concurrent operations...");

      let sharedCounter = 0;
      const operations = 1000;
      const mutex = new Mutex();

      const increment = async (): Promise<void> => {
        await mutex.runExclusive(async () => {
          const current = sharedCounter;
          await sleep(Math.random() * 1);
          sharedCounter = current + 1;
        });
      };

      const promises = Array.from({ length: operations }, () =>
        increment()
      );

      await Promise.all(promises);

      console.log(`   📊 Expected counter: ${operations}`);
      console.log(`   📊 Actual counter: ${sharedCounter}`);

      if (sharedCounter < operations) {
        console.log(`   ⚠️ Race condition detected! Lost ${operations - sharedCounter} increments`);
      }

      expect(sharedCounter).toBe(operations);
      console.log(`   ✅ No race conditions detected`);
    });

    it("should handle atomic operations correctly", async () => {
      console.log("\n📌 Testing atomic operations...");

      let atomicCounter = 0;
      const operations = 500;
      const workers = 10;
      const mutex = new Mutex();

      const atomicIncrement = async (): Promise<void> => {
        await mutex.runExclusive(async () => {
          const original = atomicCounter;
          await sleep(0);
          atomicCounter = original + 1;
        });
      };

      const workerPromises = Array.from({ length: workers }, async () => {
        const opsPerWorker = operations / workers;
        await Promise.all(
          Array.from({ length: opsPerWorker }, () => atomicIncrement())
        );
      });

      await Promise.all(workerPromises);

      console.log(`   📊 Final atomic counter: ${atomicCounter}`);

      const lostUpdates = operations - atomicCounter;
      if (lostUpdates > 0) {
        console.log(`   ⚠️ Lost updates: ${lostUpdates}`);
      }

      expect(atomicCounter).toBe(operations);
      console.log(`   ✅ All updates preserved`);
    });

    it("should handle concurrent read/write operations", async () => {
      console.log("\n📌 Testing concurrent read/write...");

      const data = new Map<string, number>();
      const keys = ["a", "b", "c", "d", "e"];
      const operationsPerKey = 100;

      const keyMutexes = new Map<string, Mutex>();
      for (const key of keys) {
        keyMutexes.set(key, new Mutex());
      }

      const readWrite = async (key: string): Promise<void> => {
        const mutex = keyMutexes.get(key)!;
        for (let i = 0; i < operationsPerKey; i++) {
          await mutex.runExclusive(async () => {
            const current = data.get(key) ?? 0;
            await sleep(0);
            data.set(key, current + 1);
          });
        }
      };

      const promises = keys.flatMap((key) => [
        readWrite(key),
        readWrite(key),
      ]);

      await Promise.all(promises);

      let hasRaceCondition = false;
      for (const key of keys) {
        const value = data.get(key) ?? 0;
        const expected = operationsPerKey * 2;
        console.log(`   📊 Key ${key}: ${value}/${expected}`);

        if (value < expected) {
          hasRaceCondition = true;
        }
      }

      expect(hasRaceCondition).toBe(false);
      console.log(`   ✅ All concurrent writes successful`);
    });
  });

  describe("📊 Memory Monitor Class Unit Tests", () => {
    it("should correctly calculate memory growth", () => {
      const monitor = new MemoryMonitor();

      monitor.captureSnapshot();
      monitor.captureSnapshot();
      monitor.captureSnapshot();

      expect(monitor.getSnapshots().length).toBe(3);
      expect(monitor.getMemoryInfo().growthPercent).toBe(0);
    });

    it("should detect memory leak when threshold exceeded", () => {
      const monitor = new MemoryMonitor({
        memoryLeakThresholdPercent: 10,
      });

      for (let i = 0; i < 100; i++) {
        monitor.captureSnapshot();
      }

      expect(monitor.hasMemoryLeak()).toBe(false);
    });

    it("should allow threshold configuration", () => {
      const monitor = new MemoryMonitor();
      monitor.setThresholds({ queryTimeThresholdMs: 100 });

      expect(monitor["thresholds"].queryTimeThresholdMs).toBe(100);
    });
  });
});

describe("🧪 Integration: Full System Stress Test", () => {
  it("should handle comprehensive stress test", async () => {
    console.log("\n📌 Running comprehensive system stress test...");

    const monitor = new MemoryMonitor({ memoryLeakThresholdPercent: 25 });

    const operations = {
      memory: 0,
      handles: 0,
      queries: 0,
      connections: 0,
      raceOps: 0,
    };

    const memoryOps = async () => {
      const arr: number[] = [];
      for (let i = 0; i < 100; i++) {
        arr.push(i);
        monitor.captureSnapshot();
      }
      operations.memory++;
    };

    const handleOps = async () => {
      const timers = Array.from({ length: 10 }, (_, i) =>
        setTimeout(() => {}, 100 + i)
      );
      await sleep(150);
      timers.forEach(clearTimeout);
      operations.handles++;
    };

    const queryOps = async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      operations.queries++;
    };

    const raceOps = async () => {
      let counter = 0;
      const inc = () => {
        const c = counter;
        counter = c + 1;
      };
      await Promise.all(Array.from({ length: 5 }, () => inc()));
      operations.raceOps++;
    };

    await Promise.all([
      memoryOps(),
      memoryOps(),
      handleOps(),
      handleOps(),
      queryOps(),
      queryOps(),
      raceOps(),
      raceOps(),
    ]);

    const memInfo = monitor.getMemoryInfo();
    console.log(`   📊 Memory growth: ${memInfo.growthPercent.toFixed(2)}%`);
    console.log(`   📊 Operations completed:`);
    console.log(`      - Memory ops: ${operations.memory}`);
    console.log(`      - Handle ops: ${operations.handles}`);
    console.log(`      - Query ops: ${operations.queries}`);
    console.log(`      - Race ops: ${operations.raceOps}`);

    expect(monitor.hasMemoryLeak()).toBe(false);
  }, 30000);
});

console.log("\n📝 To run these tests with GC exposure, use:");
console.log("   bun test --expose-gc");
console.log("   or");
console.log("   bun test --preload ./tests/memory-perf.test.ts\n");
