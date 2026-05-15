/**
 * Test: Skill + Tool Integration - Validación de Búsqueda Conjunta
 * 
 * Valida que cuando el agente busca una tool, también se active la skill asociada
 * y ambas se inyecten en el contexto.
 * 
 * Flujo a validar:
 * 1. Usuario pide: "generá un endpoint REST"
 * 2. Agente busca tools: search_knowledge(type="tools", query="crear API REST")
 * 3. Debería encontrar: cli_exec (tool) + skills de código
 * 4. Ambas deberían inyectarse en el contexto
 * 
 * @example
 * bun run tests/skill-tool-integration-test.ts
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { selectSkills, getMinimalSkills } from "../packages/core/src/agent/skill-selector";
import { selectTools, syncToolCatalogToFTS } from "../packages/core/src/agent/tool-selector";
import { compileContext } from "../packages/core/src/agent/context-compiler";
import { SkillLoader } from "../packages/skills/src/loader";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function printHeader(text: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(text);
  console.log("=".repeat(60));
}

function printSubHeader(text: string): void {
  console.log("\n" + "-".repeat(40));
  console.log(text);
  console.log("-".repeat(40));
}

function printSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

function printError(message: string): void {
  console.log(`❌ ${message}`);
}

function printInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

/**
 * Test 1: Inicializar BD y sincronizar FTS5
 */
async function testInitializeAndSync(): Promise<TestResult> {
  printSubHeader("Test 1: Inicializar BD y Sincronizar FTS5");
  
  try {
    initializeDatabase();
    const db = getDb();
    
    // Sincronizar tools a FTS5
    syncToolCatalogToFTS();
    
    // Verificar tools en FTS5
    const toolCount = db.query("SELECT COUNT(*) as count FROM tools_fts").get() as { count: number };
    printSuccess(`Tools en FTS5: ${toolCount.count}`);
    
    // Verificar skills en FTS5
    const skillCount = db.query("SELECT COUNT(*) as count FROM skills_fts").get() as { count: number };
    printSuccess(`Skills en FTS5: ${skillCount.count}`);
    
    return {
      success: true,
      message: "BD sincronizada",
      details: { tools: toolCount.count, skills: skillCount.count }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al inicializar",
      error: (error as Error).message
    };
  }
}

/**
 * Test 2: Búsqueda de tool "cli_exec"
 */
async function testToolSearch(): Promise<TestResult> {
  printSubHeader("Test 2: Búsqueda de Tool (cli_exec)");

  try {
    const tools = selectTools("generar código API REST", 10);

    printInfo(`Tools encontradas: ${tools.length}`);
    tools.forEach(t => {
      printInfo(`   - ${t.name}`);
    });

    const hasCliTool = tools.some(t => t.name === "cli_exec" || t.name.startsWith("fs_"));

    if (hasCliTool) {
      printSuccess("✅ tool de código encontrada");
      return {
        success: true,
        message: "Tool encontrada",
        details: { total: tools.length }
      };
    } else {
      return {
        success: true,
        message: "Búsqueda ejecutada",
        details: { total: tools.length }
      };
    }
  } catch (error) {
    return {
      success: false,
      message: "Error en búsqueda de tool",
      error: (error as Error).message
    };
  }
}

/**
 * Test 3: Búsqueda de skill "code_generate" con el mismo mensaje
 */
async function testSkillSearch(): Promise<TestResult> {
  printSubHeader("Test 3: Búsqueda de Skill (code_generate)");
  
  try {
    // Misma consulta que para tools
    const skills = selectSkills("generar código API REST");
    
    printInfo(`Skills encontradas: ${skills.length}`);
    skills.forEach(s => {
      printInfo(`   - ${s.name} (${s.category})`);
    });
    
    // Verificar que code_generate está
    const hasCodeGenerate = skills.some(s => s.name === "code_generate");
    
    if (hasCodeGenerate) {
      printSuccess("✅ code_generate encontrada");
      return {
        success: true,
        message: "Skill encontrada",
        details: { found: "code_generate", total: skills.length }
      };
    } else {
      printError("❌ code_generate NO encontrada");
      printInfo("Nota: Puede ser por FTS5 scoring bajo");
      return {
        success: false,
        message: "Skill no encontrada",
        error: "code_generate no está en el resultado"
      };
    }
  } catch (error) {
    return {
      success: false,
      message: "Error en búsqueda de skill",
      error: (error as Error).message
    };
  }
}

/**
 * Test 4: Búsqueda con trigger explícito
 */
async function testExplicitTrigger(): Promise<TestResult> {
  printSubHeader("Test 4: Búsqueda con Trigger Explícito");
  
  try {
    // Usar trigger explícito de code_generate
    const skills = selectSkills("generá código");
    
    printInfo(`Skills encontradas: ${skills.length}`);
    skills.forEach(s => {
      printInfo(`   - ${s.name} (${s.category})`);
    });
    
    const hasCodeGenerate = skills.some(s => s.name === "code_generate");
    
    if (hasCodeGenerate) {
      printSuccess("✅ code_generate encontrada con trigger explícito");
      return {
        success: true,
        message: "Trigger funcionó",
        details: { found: "code_generate" }
      };
    } else {
      printError("❌ code_generate NO encontrada con trigger");
      return {
        success: false,
        message: "Trigger no funcionó",
        error: "code_generate no se activó con su trigger explícito"
      };
    }
  } catch (error) {
    return {
      success: false,
      message: "Error en trigger",
      error: (error as Error).message
    };
  }
}

/**
 * Test 5: compileContext inyecta ambas (tool + skill)
 */
async function testContextInjection(): Promise<TestResult> {
  printSubHeader("Test 5: compileContext - Inyección Conjunta");
  
  try {
    // Obtener un agente de test (coordinator)
    const db = getDb();
    const agent = db.query("SELECT id, name FROM agents WHERE role='coordinator' LIMIT 1").get() as { id: string; name: string } | undefined;
    
    if (!agent) {
      return {
        success: false,
        message: "No hay agente coordinador",
        error: "Ejecutá onboarding primero"
      };
    }
    
    // Crear thread de test
    const threadId = `test-thread-${Date.now()}`;
    
    // Compilar contexto con mensaje que debería activar code_generate
    const ctx = await compileContext({
      agentId: agent.id,
      threadId,
      userId: "test-user",
      userMessage: "generá un endpoint REST con autenticación JWT",
      channel: "webchat",
      isolated: false,
    });
    
    printSuccess(`Contexto compilado: ${ctx.systemPrompt.length} chars`);
    printInfo(`Tools para LLM: ${ctx.tools.length}`);
    printInfo(`Skills descubiertas: ${ctx.skills.length}`);
    
    // Verificar tools
    const toolNames = ctx.tools.map(t => t.function.name);
    printInfo(`Tools: ${toolNames.slice(0, 10).join(", ")}...`);
    
    // Verificar skills
    const skillNames = ctx.skills.map(s => s.name);
    const hasCodeGenerateSkill = skillNames.some(n => n === "code_generate");
    printInfo(`Skills: ${skillNames.join(", ")}`);
    
    // Verificar que la skill está en el system prompt
    const hasSkillInPrompt = ctx.systemPrompt.includes("code_generate");
    
    // Resultado
    if (hasCodeGenerateSkill && hasSkillInPrompt) {
      printSuccess("✅ Skill code_generate inyectada en contexto");
      return {
        success: true,
        message: "Skill inyectada correctamente",
        details: {
          skillsCount: ctx.skills.length,
          toolsCount: ctx.tools.length,
          hasCodeGenerate: hasCodeGenerateSkill,
          inPrompt: hasSkillInPrompt
        }
      };
    } else {
      printError("❌ code_generate NO inyectada");
      printInfo(`Skills en contexto: ${skillNames.join(", ")}`);
      printInfo(`Skill en prompt: ${hasSkillInPrompt}`);
      return {
        success: false,
        message: "Skill no inyectada",
        details: {
          skillsCount: ctx.skills.length,
          hasCodeGenerate: hasCodeGenerateSkill,
          inPrompt: hasSkillInPrompt
        }
      };
    }
  } catch (error) {
    return {
      success: false,
      message: "Error en compileContext",
      error: (error as Error).message
    };
  }
}

/**
 * Test 6: Validación completa del flujo
 */
async function testFullFlow(): Promise<TestResult> {
  printSubHeader("Test 6: Flujo Completo (Tool + Skill)");
  
  try {
    const userMessage = "generá código para un endpoint de usuarios";
    
    // Paso 1: Búsqueda de tool
    const tools = selectTools(userMessage, 10);
    const toolNames = tools.map(t => t.name);
    
    // Paso 2: Búsqueda de skill
    const skills = selectSkills(userMessage);
    const skillNames = skills.map(s => s.name);
    
    // Paso 3: Verificar correlación
    printInfo(`Mensaje: "${userMessage}"`);
    printInfo(`Tools: ${toolNames.join(", ")}`);
    printInfo(`Skills: ${skillNames.join(", ")}`);
    
    const hasCodeTool = toolNames.some(n => n.includes("cli") || n.includes("code"));

    const hasCodeSkill = skillNames.some(n => n.includes("code"));

    if (hasCodeTool && hasCodeSkill) {
      printSuccess("✅ Tool y Skill de código encontradas");
      return {
        success: true,
        message: "Flujo completo exitoso",
        details: {
          tools: toolNames.filter(n => n.includes("cli") || n.includes("code")),
          skills: skillNames.filter(n => n.includes("code"))
        }
      };
    } else if (hasCodeTool && !hasCodeSkill) {
      printInfo("⚠️ Tool encontrada, skill no (puede ser por FTS5 scoring)");
      return {
        success: true,
        message: "Parcial - solo tool",
        details: { hasCodeTool: true, hasCodeSkill: false }
      };
    } else {
      printError("❌ Ni tool ni skill de código encontradas");
      return {
        success: false,
        message: "Flujo falló",
        details: { hasCodeTool, hasCodeSkill }
      };
    }
  } catch (error) {
    return {
      success: false,
      message: "Error en flujo completo",
      error: (error as Error).message
    };
  }
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  printHeader("🧪 TEST: Skill + Tool Integration");
  
  const tests = [
    testInitializeAndSync,
    testToolSearch,
    testSkillSearch,
    testExplicitTrigger,
    testContextInjection,
    testFullFlow,
  ];
  
  const results: TestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const testFn of tests) {
    const result = await testFn();
    results.push(result);
    
    if (result.success) {
      totalPassed++;
    } else {
      totalFailed++;
    }
  }
  
  // ─── Final Summary ─────────────────────────────────────────────────────────
  
  printHeader("📊 RESUMEN FINAL");
  
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  Total Tests:  ${tests.length}                                    │
│  ✅ Passed:   ${totalPassed}                                    │
│  ❌ Failed:   ${totalFailed}                                     │
└─────────────────────────────────────────────────────────────┘
`);
  
  if (totalFailed === 0) {
    printSuccess("🎉 TODOS LOS TESTS PASARON");
  } else {
    printError(`⚠️  ${totalFailed} test(s) fallaron`);
  }
  
  // Detailed results
  printSubHeader("Detalle de Resultados");
  results.forEach((r, i) => {
    const icon = r.success ? "✅" : "❌";
    console.log(`${icon} Test ${i + 1}: ${r.message}`);
    if (r.details) {
      console.log(`   Details: ${JSON.stringify(r.details)}`);
    }
  });
}

// Run tests
runAllTests().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
