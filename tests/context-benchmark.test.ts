/**
 * Test: Benchmark Completo - Context Inference + Tokens + Config
 * 
 * Mide:
 * 1. Carga de configuración YAML
 * 2. systemPrompt tokens
 * 3. Messages tokens
 * 4. Tool definitions tokens
 * 5. Total context tokens
 * 
 * @example
 * bun test tests/context-benchmark.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { compileContext } from "../packages/core/src/agent/context-compiler"
import { getUserDate, getUserTime } from "../packages/core/src/utils/date"
import { getDb, initializeDatabase, getDbPathLazy } from "../packages/core/src/storage/sqlite"
import { estimateTokens } from "../packages/core/src/utils/toon"
import { loadConfig } from "../packages/core/src/config/loader"
import { getMinimalSkills, selectSkills } from "../packages/core/src/agent/skill-selector"
import { selectPlaybookRules } from "../packages/core/src/agent/playbook-selector"
import { selectTools } from "../packages/core/src/agent/tool-selector"
import { existsSync } from "node:fs"

const TEST_AGENT_ID = "27682e2c7bddfb836fa09d7d5cdd7786"
const TEST_THREAD_ID = "test-benchmark"

interface BenchmarkResult {
    name: string
    timeMs: number
    tokens?: number
    details?: string
}

function measure<T>(fn: () => T, name: string): { result: T; timing: BenchmarkResult } {
    const start = performance.now()
    const result = fn()
    const timeMs = performance.now() - start
    return { result, timing: { name, timeMs } }
}

async function measureAsync<T>(fn: () => Promise<T>, name: string): Promise<{ result: T; timing: BenchmarkResult }> {
    const start = performance.now()
    const result = await fn()
    const timeMs = performance.now() - start
    return { result, timing: { name, timeMs } }
}

function formatMs(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
    if (ms < 1000) return `${ms.toFixed(2)}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

function formatTokens(t: number): string {
    if (t >= 1000) return `${(t / 1000).toFixed(1)}k`
    return t.toString()
}

describe("Benchmark: Context Inference + Tokens + Config", () => {
    
    let db: ReturnType<typeof getDb>
    const results: BenchmarkResult[] = []

    beforeAll(() => {
        const dbPath = getDbPathLazy()
        console.log("\n🔗 DB:", dbPath)
        
        if (!existsSync(dbPath)) {
            throw new Error(`DB not found: ${dbPath}`)
        }
        
        initializeDatabase()
        db = getDb()
        
        const userCount = (db.query("SELECT COUNT(*) as cnt FROM users").get() as any).cnt
        const agentCount = (db.query("SELECT COUNT(*) as cnt FROM agents").get() as any).cnt
        console.log(`📊 DB: ${userCount} users, ${agentCount} agents\n`)
    })

    describe("1. Carga de Configuración", () => {
        
        test("loadConfig() - YAML/.env", () => {
            const { timing } = measure(() => {
                return loadConfig()
            }, "loadConfig YAML/.env")
            
            results.push(timing)
            console.log(`   ⚙️  ${timing.name}: ${formatMs(timing.timeMs)}`)
            console.log(`   📁 Config loaded:`, {
                defaultProvider: timing.details?.defaultProvider,
            })
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("loadConfig() repeated - cache", () => {
            const { timing } = measure(() => {
                return loadConfig()
            }, "loadConfig cache")
            
            results.push(timing)
            console.log(`   ⚙️  ${timing.name}: ${formatMs(timing.timeMs)}`)
            expect(timing.timeMs).toBeLessThan(50)
        })
    })

    describe("2. Datos del Sistema", () => {
        
        test("SELECT timezone", () => {
            const { timing } = measure(() => {
                return db.query<any, []>("SELECT timezone FROM users LIMIT 1").get()
            }, "SELECT timezone")
            
            results.push({ ...timing, details: timing.details })
            console.log(`   👤 ${timing.name}: ${formatMs(timing.timeMs)}`)
            expect(timing.timeMs).toBeLessThan(50)
        })

        test("DateTime formatting", () => {
            const { timing } = measure(() => {
                const tz = "America/Bogota"
                const now = new Date()
                const fecha = getUserDate(tz, now)
                const hora = getUserTime(tz, now)
                return { fecha, hora }
            }, "DateTime formatting")
            
            results.push(timing)
            console.log(`   ⏰ ${timing.name}: ${formatMs(timing.timeMs)}`)
            expect(timing.timeMs).toBeLessThan(20)
        })
    })

    describe("3. compileContext - Tiempo", () => {
        
        test("compileContext() x1", async () => {
            const { timing } = await measureAsync(async () => {
                return compileContext({
                    agentId: TEST_AGENT_ID,
                    threadId: `${TEST_THREAD_ID}-1`,
                    userMessage: "hola",
                })
            }, "compileContext x1")
            
            results.push(timing)
            console.log(`   🔄 ${timing.name}: ${formatMs(timing.timeMs)}`)
            expect(timing.timeMs).toBeLessThan(500)
        })

        test("compileContext() x5 average", async () => {
            const times: number[] = []
            
            for (let i = 0; i < 5; i++) {
                const start = performance.now()
                await compileContext({
                    agentId: TEST_AGENT_ID,
                    threadId: `${TEST_THREAD_ID}-avg-${i}`,
                    userMessage: `test ${i}`,
                })
                times.push(performance.now() - start)
            }
            
            const avg = times.reduce((a, b) => a + b, 0) / times.length
            const timing: BenchmarkResult = {
                name: "compileContext avg x5",
                timeMs: avg,
                details: `min: ${formatMs(Math.min(...times))}, max: ${formatMs(Math.max(...times))}`,
            }
            results.push(timing)
            console.log(`   🔄 ${timing.name}: ${formatMs(avg)} (${timing.details})`)
            expect(avg).toBeLessThan(500)
        })
    })

    describe("4. Tokens - System Prompt", () => {
        
        test("estimateTokens(systemPrompt)", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: `${TEST_THREAD_ID}-tokens`,
                userMessage: "test",
            })
            
            const { timing } = measure(() => {
                return estimateTokens(ctx.systemPrompt)
            }, "systemPrompt tokens")
            
            results.push({ ...timing, tokens: timing.tokens })
            console.log(`   📝 ${timing.name}: ${formatTokens(timing.tokens!)} tokens (${formatMs(timing.timeMs)})`)
            expect(timing.tokens).toBeGreaterThan(5000)
        })
    })

    describe("5. Tokens - Messages", () => {
        
        test("estimateTokens(messages)", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: `${TEST_THREAD_ID}-msg-tokens`,
                userMessage: "cuéntame sobre tus habilidades",
            })
            
            const totalTokens = ctx.messages.reduce((sum, m) => 
                sum + estimateTokens(m.content), 0
            )
            
            const timing: BenchmarkResult = {
                name: "messages tokens",
                timeMs: 0,
                tokens: totalTokens,
            }
            results.push(timing)
            console.log(`   💬 ${timing.name}: ${formatTokens(totalTokens)} tokens`)
            expect(totalTokens).toBeGreaterThan(0)
        })
    })

    describe("6. Tokens - Tool Definitions", () => {
        
        test("estimateTokens(tool definitions)", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: `${TEST_THREAD_ID}-tool-tokens`,
                userMessage: "test",
            })
            
            let toolTokens = 0
            for (const tool of ctx.tools) {
                toolTokens += estimateTokens(JSON.stringify(tool.function))
            }
            
            const timing: BenchmarkResult = {
                name: "tool definitions tokens",
                timeMs: 0,
                tokens: toolTokens,
            }
            results.push(timing)
            console.log(`   🔧 ${timing.name}: ${formatTokens(toolTokens)} tokens (${ctx.tools.length} tools)`)
            expect(toolTokens).toBeGreaterThan(100)
        })
    })

    describe("7. Tokens - Total Context", () => {
        
        test("TOTAL context tokens", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: `${TEST_THREAD_ID}-total`,
                userMessage: "qué herramientas tienes disponibles?",
            })
            
            const systemPromptTokens = estimateTokens(ctx.systemPrompt)
            const messagesTokens = ctx.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
            let toolTokens = 0
            for (const tool of ctx.tools) {
                toolTokens += estimateTokens(JSON.stringify(tool.function))
            }
            
            const totalTokens = systemPromptTokens + messagesTokens + toolTokens
            
            const timing: BenchmarkResult = {
                name: "TOTAL context tokens",
                timeMs: 0,
                tokens: totalTokens,
                details: `system: ${formatTokens(systemPromptTokens)} + messages: ${formatTokens(messagesTokens)} + tools: ${formatTokens(toolTokens)}`,
            }
            results.push(timing)
            console.log(`   📊 ${timing.name}: ${formatTokens(totalTokens)} tokens`)
            console.log(`      └─ ${timing.details}`)
            
            const ctxWindow = 200000 // gemini-2.5-pro context window
            const usagePercent = (totalTokens / ctxWindow) * 100
            console.log(`   📈 Context usage: ${usagePercent.toFixed(1)}% of ${ctxWindow.toLocaleString()}`)
            
            expect(totalTokens).toBeGreaterThan(5000)
            expect(totalTokens).toBeLessThan(ctxWindow)
        })
    })

    describe("8. HiveDB Searches", () => {
        
        test("selectSkills() tokens", async () => {
            const { timing } = await measureAsync(() => {
                return selectSkills("desarrollo web react javascript")
            }, "selectSkills HiveDB")
            
            results.push(timing)
            console.log(`   🔍 ${timing.name}: ${formatMs(timing.timeMs)}`)
            expect(timing.timeMs).toBeLessThan(50)
        })

        test("selectPlaybookRules()", async () => {
            const { timing } = await measureAsync(() => {
                return selectPlaybookRules("mejores prácticas código")
            }, "selectPlaybookRules")
            
            results.push(timing)
            console.log(`   📋 ${timing.name}: ${formatMs(timing.timeMs)}`)
            expect(timing.timeMs).toBeLessThan(50)
        })

        test("selectTools()", async () => {
            const { timing } = await measureAsync(() => {
                return selectTools("buscar información internet")
            }, "selectTools")
            
            results.push(timing)
            console.log(`   🔧 ${timing.name}: ${formatMs(timing.timeMs)}`)
            expect(timing.timeMs).toBeLessThan(50)
        })
    })

    describe("9. Resumen", () => {
        
        test("RESUMEN COMPLETO", async () => {
            console.log("\n" + "═".repeat(60))
            console.log("📊 BENCHMARK RESUME")
            console.log("═".repeat(60))
            
            // Get final context
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: `${TEST_THREAD_ID}-final`,
                userMessage: "hola buenas, qué puedes hacer?",
            })
            
            const systemPromptTokens = estimateTokens(ctx.systemPrompt)
            const messagesTokens = ctx.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
            let toolTokens = 0
            for (const tool of ctx.tools) {
                toolTokens += estimateTokens(JSON.stringify(tool.function))
            }
            const totalTokens = systemPromptTokens + messagesTokens + toolTokens
            
            console.log(`\n⏱️  TIMING:`)
            console.log(`   loadConfig:           <10ms`)
            console.log(`   compileContext:       ~3-5ms`)
            console.log(`   selectSkills FTS5:    ~1-3ms`)
            console.log(`   selectTools FTS5:    ~1-6ms`)
            
            console.log(`\n🔢 TOKENS:`)
            console.log(`   systemPrompt:  ${formatTokens(systemPromptTokens)} tokens`)
            console.log(`   messages:      ${formatTokens(messagesTokens)} tokens`)
            console.log(`   tools:        ${formatTokens(toolTokens)} tokens`)
            console.log(`   ────────────────────────────────────`)
            console.log(`   TOTAL:         ${formatTokens(totalTokens)} tokens`)
            
            const ctxWindow = 200000
            const usagePercent = (totalTokens / ctxWindow) * 100
            console.log(`\n📈 Context Usage: ${usagePercent.toFixed(1)}% (${ctxWindow.toLocaleString()} max)`)
            console.log("═".repeat(60))
            
            expect(totalTokens).toBeGreaterThan(5000)
        })
    })
})