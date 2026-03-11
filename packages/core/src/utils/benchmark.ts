/**
 * Utility for measuring resource usage (time and memory).
 */
export class Benchmark {
    private startTime: number = 0;
    private startMem: NodeJS.MemoryUsage | null = null;
    private name: string;

    constructor(name: string = "Benchmark") {
        this.name = name;
    }

    /**
     * Starts the benchmark timer and records initial memory usage.
     */
    start() {
        this.startTime = performance.now();
        this.startMem = process.memoryUsage();
        return this;
    }

    /**
     * Stops the benchmark and returns the metrics.
     */
    stop() {
        const endTime = performance.now();
        const endMem = process.memoryUsage();
        const duration = endTime - this.startTime;

        const metrics = {
            name: this.name,
            durationMs: duration.toFixed(2),
            heapUsed: this.formatMB(endMem.heapUsed),
            heapTotal: this.formatMB(endMem.heapTotal),
            rss: this.formatMB(endMem.rss),
            external: this.formatMB(endMem.external),
            heapDelta: this.startMem
                ? this.formatMB(endMem.heapUsed - this.startMem.heapUsed)
                : "0.00 MB",
            raw: {
                duration,
                memory: endMem,
                delta: this.startMem
                    ? endMem.heapUsed - this.startMem.heapUsed
                    : 0
            }
        };

        return metrics;
    }

    /**
     * Pretty-prints the benchmark results to the console.
     */
    print() {
        const m = this.stop();
        console.log(`\n📊 Benchmark: ${m.name}`);
        console.table({
            'Time': `${m.durationMs} ms`,
            'Heap Used': m.heapUsed,
            'Heap Total': m.heapTotal,
            'RSS': m.rss,
            'External': m.external,
            'Memory Delta': m.heapDelta
        });
    }

    private formatMB(bytes: number) {
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    /**
     * static helper for quick one-off benchmarks.
     */
    static async run(name: string, fn: () => Promise<any> | any) {
        const b = new Benchmark(name).start();
        await fn();
        b.print();
    }
}
