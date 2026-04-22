/**
 * Test: Context Inference - Medición de Velocidad por Componente
 * 
 * Mide el tiempo de cada paso de la inferencia de contexto:
 * 1. Usuario (datos + timezone)
 * 2. Fecha/Hora
 * 3. Datos del agente
 * 4. Ética
 * 5. Tools nativas
 * 6. Skills (minimal + discovered)
 * 7. Playbook rules
 * 8. MCP tools
 * 9. Búsqueda FTS5 (tools, skills, mcp, playbook)
 * 
 * @example
 * bun test tests/context-inference-timing.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { compileContext } from "../packages/core/src/agent/context-compiler"
import { getUserDate, getUserTime } from "../packages/core/src/utils/date"
import { getDb, initializeDatabase, getDbPathLazy } from "../packages/core/src/storage/sqlite"
import { getMinimalSkills, selectSkills, syncSkillsToFTS } from "../packages/core/src/agent/skill-selector"
import { selectPlaybookRules, syncPlaybookToFTS } from "../packages/core/src/agent/playbook-selector"
import { selectTools } from "../packages/core/src/agent/tool-selector"
import { existsSync } from "node:fs"

const TEST_AGENT_ID = "27682e2c7bddfb836fa09d7d5cdd7786"
const TEST_THREAD_ID = "test-timing"

interface TimingResult {
    name: string
    timeMs: number
    details?: string
}

function measure<T>(fn: () => T, name: string): { result: T; timing: TimingResult } {
    const start = performance.now()
    const result = fn()
    const timeMs = performance.now() - start
    return { result, timing: { name, timeMs } }
}

async function measureAsync<T>(fn: () => Promise<T>, name: string): Promise<{ result: T; timing: TimingResult }> {
    const start = performance.now()
    const result = await fn()
    const timeMs = performance.now() - start
    return { result, timing: { name, timeMs } }
}

function printTiming(timing: TimingResult): void {
    console.log(`   ⏱️  ${timing.name}: ${timing.timeMs.toFixed(2)}ms`)
}

function formatMs(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
    if (ms < 1000) return `${ms.toFixed(2)}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

describe("Context Inference Timing - Por Componente", () => {
    
    let db: ReturnType<typeof getDb>

    beforeAll(() => {
        const dbPath = getDbPathLazy()
        console.log("\n🔗 Using DB:", dbPath)
        
        if (!existsSync(dbPath)) {
            throw new Error(`DB not found at ${dbPath}`)
        }
        
        initializeDatabase()
        db = getDb()
        
        const userCount = (db.query("SELECT COUNT(*) as cnt FROM users").get() as any).cnt
        const agentCount = (db.query("SELECT COUNT(*) as cnt FROM agents").get() as any).cnt
        console.log(`📊 DB: ${userCount} users, ${agentCount} agents\n`)
    })

    describe("1. Usuario - Datos del Usuario", () => {
        
        test("GET usuario de DB", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT id, name, timezone FROM users LIMIT 1"
                ).get()
            }, "SELECT usuario")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("2. Fecha/Hora - Timezone", () => {
        
        test("GET timezone + format date", () => {
            const { timing } = measure(() => {
                const timezone = "America/Bogota"
                const now = new Date()
                const fecha = getUserDate(timezone, now)
                const hora = getUserTime(timezone, now)
                return { fecha, hora }
            }, "DateTime formatting")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(10)
        })

        test("getUserDate()", () => {
            const { timing } = measure(() => {
                return getUserDate("America/Bogota", new Date())
            }, "getUserDate")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(5)
        })

        test("getUserTime()", () => {
            const { timing } = measure(() => {
                return getUserTime("America/Bogota", new Date())
            }, "getUserTime")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(5)
        })
    })

    describe("3. Agente - Datos del Agente", () => {
        
        test("SELECT agente config", () => {
            const { timing } = measure(() => {
                return db.query<any, [string]>(
                    "SELECT * FROM agents WHERE id = ?"
                ).get(TEST_AGENT_ID)
            }, "SELECT agente")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(50)
        })

        test("SELECT workspace", () => {
            const { timing } = measure(() => {
                return db.query<any, [string]>(
                    "SELECT workspace FROM agents WHERE id = ?"
                ).get(TEST_AGENT_ID)
            }, "SELECT workspace")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(50)
        })
    })

    describe("4. Ética - Reglas Éticas", () => {
        
        test("SELECT ética activa", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT content FROM ethics WHERE active = 1 LIMIT 1"
                ).get()
            }, "SELECT ética")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(50)
        })

        test("SELECT all ethics", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT id, name, content FROM ethics"
                ).all()
            }, "SELECT all ethics")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("5. Tools - Herramientas Nativas", () => {
        
        test("createAllTools()", () => {
            const { result, timing } = measure(() => {
                const { createAllTools } = require("../packages/core/src/tools/index.ts")
                const config = { tools: {} }
                return createAllTools(config)
            }, "createAllTools")
            
            printTiming(timing)
            console.log(`   📦 Tools creadas: ${result.length}`)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("FILTER minimal tools", () => {
            const MINIMAL = new Set(["save_note", "notify", "report_progress", "search_knowledge"])
            
            const { result, timing } = measure(() => {
                const { createAllTools } = require("../packages/core/src/tools/index.ts")
                const config = { tools: {} }
                const all = createAllTools(config)
                return all.filter(t => MINIMAL.has(t.name))
            }, "filter MINIMAL_TOOLS")
            
            printTiming(timing)
            expect(result.length).toBe(4)
        })

        test("SELECT tools from DB", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT * FROM tools WHERE active = 1 LIMIT 50"
                ).all()
            }, "SELECT tools")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("6. Skills - Carga de Skills", () => {
        
        test("getMinimalSkills()", () => {
            const { timing } = measure(() => {
                return getMinimalSkills()
            }, "getMinimalSkills")
            
            printTiming(timing)
            console.log(`   📚 Minimal: ${timing.details || ""}`)
            expect(timing.timeMs).toBeLessThan(50)
        })

        test("SELECT skills from DB", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT * FROM skills WHERE active = 1"
                ).all()
            }, "SELECT skills")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("SELECT skills FTS", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(`
                    SELECT rowid, bm25(skills_fts) as score
                    FROM skills_fts
                    WHERE skills_fts MATCH 'code'
                    ORDER BY score ASC
                    LIMIT 10
                `).all()
            }, "FTS5 skills search")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("7. Skills Discovery FTS5", () => {
        
        test("selectSkills('code')", () => {
            const { timing } = measure(() => {
                return selectSkills("code debug refactor")
            }, "selectSkills FTS5")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("selectSkills('canvas')", () => {
            const { timing } = measure(() => {
                return selectSkills("formulario interactivo")
            }, "selectSkills canvas")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("selectSkills('web')", () => {
            const { timing } = measure(() => {
                return selectSkills("buscar información web")
            }, "selectSkills web")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("selectSkills('cron')", () => {
            const { timing } = measure(() => {
                return selectSkills("tarea programada recordatorio")
            }, "selectSkills cron")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("8. Playbook - Reglas ACE", () => {
        
        test("SELECT playbook rules", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT * FROM playbook WHERE active = 1"
                ).all()
            }, "SELECT playbook")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("SELECT playbook FTS", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(`
                    SELECT rowid FROM playbook_fts
                    WHERE playbook_fts MATCH 'code*'
                    LIMIT 5
                `).all()
            }, "FTS5 playbook search")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("selectPlaybookRules()", () => {
            const { timing } = measure(() => {
                return selectPlaybookRules("cómo escribir buen código")
            }, "selectPlaybookRules")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("9. MCP Tools", () => {
        
        test("SELECT mcp_servers", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT * FROM mcp_servers WHERE enabled = 1"
                ).all()
            }, "SELECT mcp_servers")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("SELECT mcp_tools", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(
                    "SELECT * FROM mcp_tools LIMIT 50"
                ).all()
            }, "SELECT mcp_tools")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("SELECT mcp_tools FTS", () => {
            const { timing } = measure(() => {
                return db.query<any, []>(`
                    SELECT rowid FROM mcp_tools_fts
                    WHERE mcp_tools_fts MATCH 'github*'
                    LIMIT 10
                `).all()
            }, "FTS5 mcp_tools search")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("10. Tool Selector FTS5", () => {
        
        test("selectTools('web')", () => {
            const { timing } = measure(() => {
                return selectTools("buscar web internet")
            }, "selectTools web")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("selectTools('file')", () => {
            const { timing } = measure(() => {
                return selectTools("leer archivo filesystem")
            }, "selectTools file")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("selectTools('canvas')", () => {
            const { timing } = measure(() => {
                return selectTools("mostrar interfaz formulario")
            }, "selectTools canvas")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })

        test("selectTools('code')", () => {
            const { timing } = measure(() => {
                return selectTools("ejecutar código programar")
            }, "selectTools code")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(100)
        })
    })

    describe("11. Compile Context Completo", () => {
        
        test("compileContext() - vacío", async () => {
            const { timing } = await measureAsync(async () => {
                return compileContext({
                    agentId: TEST_AGENT_ID,
                    threadId: `${TEST_THREAD_ID}-empty`,
                    userMessage: "",
                })
            }, "compileContext empty")
            
            printTiming(timing)
            console.log(`   📝 Prompt: ${timing.details || ""}`)
            expect(timing.timeMs).toBeLessThan(500)
        })

        test("compileContext() - mensaje simple", async () => {
            const { timing } = await measureAsync(async () => {
                return compileContext({
                    agentId: TEST_AGENT_ID,
                    threadId: `${TEST_THREAD_ID}-simple`,
                    userMessage: "hola",
                })
            }, "compileContext simple")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(500)
        })

        test("compileContext() - mensaje complejo", async () => {
            const { timing } = await measureAsync(async () => {
                return compileContext({
                    agentId: TEST_AGENT_ID,
                    threadId: `${TEST_THREAD_ID}-complex`,
                    userMessage: "busca información sobre react hooks y crea un componente de formulario",
                })
            }, "compileContext complex")
            
            printTiming(timing)
            expect(timing.timeMs).toBeLessThan(500)
        })

        test("compileContext() - x10 promedio", async () => {
            const times: number[] = []
            
            for (let i = 0; i < 10; i++) {
                const start = performance.now()
                await compileContext({
                    agentId: TEST_AGENT_ID,
                    threadId: `${TEST_THREAD_ID}-perf-${i}`,
                    userMessage: `test message ${i}`,
                })
                times.push(performance.now() - start)
            }
            
            const avg = times.reduce((a, b) => a + b, 0) / times.length
            const min = Math.min(...times)
            const max = Math.max(...times)
            
            console.log(`\n⚡ PERFORMANCE compileContext (10 runs):`)
            console.log(`   Average: ${formatMs(avg)}`)
            console.log(`   Min: ${formatMs(min)}`)
            console.log(`   Max: ${formatMs(max)}`)
            
            expect(avg).toBeLessThan(500)
        })
    })

    describe("12. Resumen - Tiempos Promedio", () => {
        
        test("RESUMEN - Todas las búsquedas FTS5", async () => {
            const searches = [
                { name: "selectSkills(code)", fn: () => selectSkills("code debug") },
                { name: "selectSkills(canvas)", fn: () => selectSkills("formulario") },
                { name: "selectSkills(web)", fn: () => selectSkills("buscar web") },
                { name: "selectPlaybookRules", fn: () => selectPlaybookRules("código") },
                { name: "selectTools", fn: () => selectTools("web search") },
            ]
            
            console.log("\n📊 RESUMEN - Búsquedas FTS5:")
            
            for (const search of searches) {
                const start = performance.now()
                search.fn()
                const time = performance.now() - start
                console.log(`   🔍 ${search.name}: ${formatMs(time)}`)
            }
        })
    })
})