import { Benchmark } from '../packages/core/src/utils/benchmark';

async function runFullBench() {
    console.log("🚀 Starting Hive Project Benchmark...");

    const bench = new Benchmark("Project Startup").start();

    // Import the core index to measure startup overhead
    await import('../packages/core/src/index');

    bench.print();

    console.log("\n✅ Benchmark completed.");
}

runFullBench().catch(console.error);
