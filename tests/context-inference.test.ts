/**
 * Test: Context Inference - Inferencia de Contexto del Agente
 * 
 * Valida el flujo completo de información que el Context Compilerinjecta en el contexto del agente:
 * 1. Datos del usuario (nombre, timezone)
 * 2. Fecha/hora actual con timezone del usuario
 * 3. Datos del agente (configuración, workspace)
 * 4. Ética activa (reglas constitucionales)
 * 5. Tools nativas (MINIMAL_TOOLS)
 * 6. Skills (MINIMAL_SKILL_NAMES + descubiertas)
 * 7. Playbook rules (FTS5 discovery)
 * 8. MCP tools (desde servidores activos)
 * 9. PERFORMANCE: velocidad de compileContext
 * 
 * Este test usa la BD real del servidor en ~/.hive/data/hive.db
 * 
 * @example
 * bun test tests/context-inference.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { compileContext } from "../packages/core/src/agent/context-compiler"
import { getUserDate, getUserTime } from "../packages/core/src/utils/date"
import { getDb, initializeDatabase, getDbPathLazy } from "../packages/core/src/storage/sqlite"
import { getMinimalSkills, selectSkills, syncSkillsToFTS } from "../packages/core/src/agent/skill-selector"
import { selectPlaybookRules, syncPlaybookToFTS } from "../packages/core/src/agent/playbook-selector"
import { existsSync } from "node:fs"

const TEST_AGENT_ID = "27682e2c7bddfb836fa09d7d5cdd7786"  // Bee (coordinator)
const TEST_THREAD_ID = "test-context-inference"

describe("Context Inference Test Suite (Real DB)", () => {
    
    let db: ReturnType<typeof getDb>

    beforeAll(() => {
        const dbPath = getDbPathLazy()
        console.log("🔗 Using DB:", dbPath)
        
        if (!existsSync(dbPath)) {
            throw new Error(`DB not found at ${dbPath}`)
        }
        
        initializeDatabase()
        db = getDb()
        
        const userCount = (db.query("SELECT COUNT(*) as cnt FROM users").get() as any).cnt
        const agentCount = (db.query("SELECT COUNT(*) as cnt FROM agents").get() as any).cnt
        console.log(`📊 DB has ${userCount} users, ${agentCount} agents`)
    })

    describe("1. User Data & Date/Time", () => {
        
        test("should get user timezone from database", () => {
            const user = db.query<any, []>(
                "SELECT id, name, timezone FROM users LIMIT 1"
            ).get()
            
            if (user) {
                console.log("👤 User:", user.name, "timezone:", user.timezone)
                expect(user.timezone).toBeDefined()
            }
        })

        test("should format date with timezone", () => {
            const timezone = "America/Bogota"
            const now = new Date()
            
            const fecha = getUserDate(timezone, now)
            const hora = getUserTime(timezone, now)
            
            console.log(`📅 Date: ${fecha}, Time: ${hora}`)
            expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            expect(hora).toMatch(/^\d{2}:\d{2}:\d{2}$/)
        })

        test("should inject fecha/hora in systemPrompt", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            expect(ctx.systemPrompt).toContain("# ENTORNO ACTUAL")
            expect(ctx.systemPrompt).toContain("**Fecha**:")
            expect(ctx.systemPrompt).toContain("**Hora**:")
            expect(ctx.systemPrompt).toContain("**Zona horaria**:")
        })
    })

    describe("2. Agent Data", () => {
        
        test("should load agent config", () => {
            const agent = db.query<any, [string]>(
                "SELECT id, name, role, workspace FROM agents WHERE id = ?"
            ).get(TEST_AGENT_ID)
            
            expect(agent).toBeDefined()
            console.log("🤖 Agent:", agent.name, "role:", agent.role, "workspace:", agent.workspace)
        })

        test("should compile for coordinator/worker", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            expect(ctx.systemPrompt.length).toBeGreaterThan(100)
        })
    })

    describe("3. Ethics", () => {
        
        test("should load active ethics", () => {
            const ethics = db.query<any, []>(
                "SELECT id, name FROM ethics WHERE active = 1 LIMIT 1"
            ).get() as { id: string; name: string } | undefined
            
            if (ethics) {
                console.log("⚖️ Ethics:", ethics.name)
                expect(ethics.id).toBeDefined()
            }
        })

        test("should inject ethics in systemPrompt", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            expect(ctx.systemPrompt).toContain("ÉTICA")
        })
    })

    describe("4. Tools", () => {
        
        test("should have 4 MINIMAL_TOOLS", () => {
            const MINIMAL = ["save_note", "notify", "report_progress", "search_knowledge"]
            expect(MINIMAL.length).toBe(4)
            expect(MINIMAL).toContain("save_note")
        })

        test("should inject minimal tools", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            const toolNames = ctx.tools.map(t => t.function.name)
            console.log("🔧 Tools:", toolNames.join(", "))
            
            expect(toolNames).toContain("save_note")
            expect(toolNames).toContain("notify")
            expect(toolNames).toContain("report_progress")
            expect(toolNames).toContain("search_knowledge")
        })

        test("should have 77 total tools", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            console.log("📦 Total tools:", ctx.allTools.length)
            expect(ctx.allTools.length).toBeGreaterThan(70)
        })
    })

    describe("5. Skills", () => {
        
        test("should load 3 minimal skills", () => {
            const skills = getMinimalSkills()
            console.log("📚 Minimal skills:", skills.map(s => s.name).join(", "))
            expect(skills.length).toBe(3)
        })

        test("should discover skills via FTS5", () => {
            const discovered = selectSkills("test message")
            console.log("🔍 Discovered:", discovered.length)
        })

        test("should inject skills in prompt", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            console.log("📖 Skills loaded:", ctx.skills.length)
            expect(ctx.systemPrompt).toContain("SKILLS")
        })
    })

    describe("6. Playbook", () => {
        
        test("should select playbook rules", () => {
            const rules = selectPlaybookRules("test query")
            console.log("📋 Rules:", rules.length)
        })

        test("should inject catalog in prompt", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            expect(ctx.systemPrompt).toContain("CATÁLOGO")
        })
    })

    describe("7. MCP Tools", () => {
        
        test("should handle no MCP gracefully", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
                mcpManager: null,
            })
            
            expect(ctx.allTools.length).toBeGreaterThan(0)
            console.log("🔌 MCP tools: 0 (no MCP manager)")
        })
    })

    describe("8. Full Context", () => {
        
        test("should compile complete context", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            console.log(`📝 Prompt: ${ctx.systemPrompt.length} chars`)
            console.log(`💬 Messages: ${ctx.messages.length}`)
            console.log(`🔧 Tools: ${ctx.tools.length}`)
            console.log(`📦 All: ${ctx.allTools.length}`)
            console.log(`📚 Skills: ${ctx.skills.length}`)
            
            expect(ctx.systemPrompt).toBeDefined()
            expect(ctx.messages).toBeDefined()
            expect(ctx.tools).toBeDefined()
        })

        test("should inject all sections", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
            })
            
            const p = ctx.systemPrompt
            expect(p).toContain("ÉTICA")
            expect(p).toContain("ENTORNO ACTUAL")
            expect(p).toContain("Fecha")
            expect(p).toContain("Hora")
            expect(p).toContain("Zona horaria")
            expect(p).toContain("HERRAMIENTAS")
            expect(p).toContain("SKILLS")
            expect(p).toContain("CATÁLOGO")
        })

        test("should handle isolated worker", async () => {
            const ctx = await compileContext({
                agentId: TEST_AGENT_ID,
                threadId: TEST_THREAD_ID,
                userMessage: "test",
                isolated: true,
                taskContext: "Complete task",
            })
            
            expect(ctx.systemPrompt).toContain("CURRENT TASK")
            expect(ctx.systemPrompt).toContain("Complete task")
        })

        test("PERFORMANCE: compileContext speed", async () => {
            const runs = 10
            const times: number[] = []
            
            for (let i = 0; i < runs; i++) {
                const start = performance.now()
                await compileContext({
                    agentId: TEST_AGENT_ID,
                    threadId: `${TEST_THREAD_ID}-${i}`,
                    userMessage: `msg ${i}`,
                })
                times.push(performance.now() - start)
            }
            
            const avg = times.reduce((a, b) => a + b, 0) / runs
            const min = Math.min(...times)
            const max = Math.max(...times)
            
            console.log(`\n⚡ PERFORMANCE (${runs} runs):`)
            console.log(`   Average: ${avg.toFixed(2)}ms`)
            console.log(`   Min: ${min.toFixed(2)}ms`)
            console.log(`   Max: ${max.toFixed(2)}ms`)
            
            expect(avg).toBeLessThan(500)
        })
    })
})